import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { callerFrom, fail, HttpError, ok, parseBody } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { match, type Route } from "./router.js";
import { patientRoutes } from "./routes/patients.js";
import { medRoutes } from "./routes/meds.js";
import { schedulingRoutes } from "./routes/scheduling.js";
import { adminRoutes } from "./routes/admin.js";
import { doseRoutes } from "./routes/doses.js";
import { notificationRoutes } from "./routes/notifications.js";
import { profileRoutes } from "./routes/profile.js";
import { scanRoutes } from "./routes/scans.js";
import { orderRoutes } from "./routes/orders.js";
import { signupComplete } from "./signup.js";

const routes: Route[] = [...patientRoutes, ...medRoutes, ...schedulingRoutes, ...adminRoutes, ...doseRoutes, ...notificationRoutes, ...profileRoutes, ...scanRoutes, ...orderRoutes];

/** Single API Gateway proxy Lambda. API Gateway's Cognito authorizer authenticates; this enforces role + ownership. */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "OPTIONS") return ok({});
  try {
    // Self sign-up: authenticated by Cognito but intentionally has no role/group yet, so it bypasses callerFrom.
    if (event.httpMethod === "POST" && /\/signup\/complete$/.test(event.path)) {
      return ok(await signupComplete(event, parseBody(event)), 201);
    }
    const caller = callerFrom(event);
    const m = match(routes, event.httpMethod, event.path.replace(/^\/(v1|prod|api)(?=\/)/, ""));
    if (!m) return fail(404, "Route not found");
    if (m.route.roles && !m.route.roles.includes(caller.role)) {
      // Role-level denials are audited (spec: admin editing a medicine via API gets 403 and the attempt is logged)
      await audit({
        actor: caller.sub, actorRole: caller.role, action: `${m.route.method} ${m.route.path}`,
        entity: m.params.id ? `patient#${m.params.id}` : "api", outcome: "denied",
      }).catch(() => undefined);
      return fail(403, "Your role is not permitted to do this");
    }
    const data = await m.route.handler({
      caller, params: m.params, query: (event.queryStringParameters ?? {}) as Record<string, string>,
      body: ["POST", "PUT", "PATCH"].includes(event.httpMethod) ? parseBody(event) : {}, event,
    });
    return ok(data ?? { ok: true }, m.route.status ?? 200);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 403) {
        try { const c = callerFrom(event); await audit({ actor: c.sub, actorRole: c.role, action: `${event.httpMethod} ${event.path}`, entity: "api", outcome: "denied" }); } catch { /* ignore */ }
      }
      return fail(e.status, e.message, e.details);
    }
    console.error("Unhandled error", (e as Error).name, (e as Error).message); // never log request bodies (PHI)
    return fail(500, "Internal error");
  }
}
