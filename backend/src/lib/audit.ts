import { randomUUID } from "node:crypto";
import { putItem } from "./db.js";

export interface AuditInput {
  actor: string; actorRole: string; action: string; entity: string;
  before?: unknown; after?: unknown; outcome?: "success" | "denied"; meta?: Record<string, unknown>;
}

/** Append-only audit record. Never throws into business flow for non-clinical failures, but clinical writes await it. */
export async function audit(e: AuditInput): Promise<void> {
  const ts = new Date().toISOString();
  await putItem("AuditEvents", {
    entity: e.entity, eventKey: `${ts}#${randomUUID()}`, timestamp: ts,
    actor: e.actor, actorRole: e.actorRole, action: e.action,
    before: e.before ?? null, after: e.after ?? null, outcome: e.outcome ?? "success", meta: e.meta ?? {},
  });
}
