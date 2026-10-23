import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

/**
 * Best-effort FHIR sync to Amazon HealthLake. DynamoDB remains the operational copy the dashboards read.
 * Enabled only when HEALTHLAKE_ENDPOINT is set, e.g. https://healthlake.us-east-1.amazonaws.com/datastore/<id>/r4
 */
export async function postFhir(resource: { resourceType: string } & Record<string, unknown>): Promise<boolean> {
  const endpoint = process.env.HEALTHLAKE_ENDPOINT;
  if (!endpoint) return false;
  try {
    const url = new URL(`${endpoint.replace(/\/$/, "")}/${resource.resourceType}`);
    const region = process.env.AWS_REGION ?? "us-east-1";
    const signer = new SignatureV4({
      service: "healthlake", region, sha256: Sha256,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    });
    const body = JSON.stringify(resource);
    const req = new HttpRequest({
      method: "POST", protocol: url.protocol, hostname: url.hostname, path: url.pathname,
      headers: { host: url.hostname, "content-type": "application/fhir+json" }, body,
    });
    const signed = await signer.sign(req);
    const res = await fetch(url, { method: "POST", headers: signed.headers as Record<string, string>, body });
    if (!res.ok) console.warn("healthlake sync failed", res.status);
    return res.ok;
  } catch (e) {
    console.warn("healthlake sync error", (e as Error).name);
    return false;
  }
}
