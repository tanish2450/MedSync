import { runDayBefore, runTick } from "../lib/scheduler.js";

// EventBridge targets. Both are idempotent and safe to retry.
export const tick = async () => { const s = await runTick(); console.log("tick", JSON.stringify(s)); return s; };
export const dayBefore = async () => { const s = await runDayBefore(); console.log("dayBefore", JSON.stringify(s)); return s; };
