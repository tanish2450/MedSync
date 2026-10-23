import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { ComprehendMedicalClient, InferRxNormCommand } from "@aws-sdk/client-comprehendmedical";
import type { Alert } from "./types.js";

const bedrock = new BedrockRuntimeClient({});
const cmed = new ComprehendMedicalClient({ region: process.env.COMPREHEND_MEDICAL_REGION ?? process.env.AWS_REGION });

const SYSTEM = `You rewrite pharmacology records into plain language.
Rules: use ONLY the fields inside <record>. Do not add facts, drugs, doses or advice that are not in the record.
If something is not in the record, write "not stated". Never say a combination is "safe". Do not diagnose or prescribe.
Return ONLY JSON: {"doctor":"<2-3 sentence clinical wording>","patient":"<2 short sentences in simple language>"}`;

/** Bedrock explains an ALREADY-RETRIEVED interaction record. Returns null on any failure (UI then shows stored fields). */
export async function explainAlert(a: Alert): Promise<{ doctor: string; patient: string } | null> {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId || a.type !== "interaction") return null;
  const record = { drugs: a.drugs, severity: a.severity, mechanism: a.mechanism, effect: a.effect, recommendation: a.recommendation };
  try {
    const gid = process.env.BEDROCK_GUARDRAIL_ID;
    const res = await bedrock.send(new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages: [{ role: "user", content: [{ text: `<record>${JSON.stringify(record)}</record>` }] }],
      inferenceConfig: { temperature: 0, maxTokens: 500 },
      ...(gid ? { guardrailConfig: { guardrailIdentifier: gid, guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? "DRAFT" } } : {}),
    }));
    const text = res.output?.message?.content?.map((c) => ("text" in c ? c.text : "")).join("") ?? "";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof json.doctor === "string" && typeof json.patient === "string") return { doctor: json.doctor, patient: json.patient };
    return null;
  } catch (e) {
    console.warn("bedrock explain failed", (e as Error).name);
    return null;
  }
}

/** Optional RxNorm cross-reference via Comprehend Medical (traceability only; catalogue ingredients stay authoritative). */
export async function rxNormConcepts(text: string): Promise<{ text: string; rxcui?: string; score?: number }[]> {
  if (process.env.COMPREHEND_MEDICAL_ENABLED !== "true") return [];
  try {
    const r = await cmed.send(new InferRxNormCommand({ Text: text }));
    return (r.Entities ?? []).map((e) => ({ text: e.Text ?? "", rxcui: e.RxNormConcepts?.[0]?.Code, score: e.RxNormConcepts?.[0]?.Score }));
  } catch (e) {
    console.warn("comprehend medical failed", (e as Error).name);
    return [];
  }
}
