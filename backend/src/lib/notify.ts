import { randomUUID } from "node:crypto";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { getItem, putItem } from "./db.js";

const sns = new SNSClient({});

export interface NotifyInput {
  userId: string; type: string; title: string; body: string;
  /** Short, PHI-minimal text for SMS. If omitted, no SMS is attempted. */
  sms?: string; payload?: Record<string, unknown>;
  /** Makes delivery idempotent: a second call with the same key is ignored. */
  dedupeKey?: string;
}

export async function phoneFor(userId: string): Promise<string | null> {
  for (const t of ["Patients", "Doctors", "Users"]) {
    const r = await getItem<{ phone?: string }>(t, t === "Users" ? { id: userId } : { id: userId });
    if (r?.phone) return r.phone.replace(/[\s()-]/g, "");
  }
  return null;
}

/**
 * Always writes an in-app notification (what the bell shows). SMS goes via SNS only when SMS_ENABLED=true and the
 * recipient has a phone number. Every channel's delivery status is stored on the notification.
 * Returns false when the dedupe key was already used.
 */
export async function notify(n: NotifyInput): Promise<boolean> {
  if (n.dedupeKey) {
    try { await putItem("Notifications", { userId: n.userId, id: `!dedupe#${n.dedupeKey}`, createdAt: new Date().toISOString() }, "attribute_not_exists(id)"); }
    catch (e: any) { if (e?.name === "ConditionalCheckFailedException") return false; throw e; }
  }
  const createdAt = new Date().toISOString();
  const deliveryStatus: Record<string, string> = { "in-app": "delivered" };
  if (n.sms) {
    if (process.env.SMS_ENABLED !== "true") deliveryStatus.sms = "disabled";
    else {
      const phone = await phoneFor(n.userId);
      if (!phone || !/^\+\d{8,15}$/.test(phone)) deliveryStatus.sms = "no-valid-phone";
      else {
        try { await sns.send(new PublishCommand({ PhoneNumber: phone, Message: n.sms.slice(0, 140) })); deliveryStatus.sms = "sent"; }
        catch (e) { deliveryStatus.sms = `failed:${(e as Error).name}`; }
      }
    }
  }
  await putItem("Notifications", {
    userId: n.userId, id: `${createdAt}#${randomUUID().slice(0, 8)}`, type: n.type, title: n.title, body: n.body,
    payload: n.payload ?? {}, channels: Object.keys(deliveryStatus), deliveryStatus, createdAt, readAt: null,
  });
  return true;
}
