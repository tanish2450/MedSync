import { useEffect } from "react";

export interface Schedule { frequency: string; timings?: string[] }
interface Preset { id: string; label: string; frequency: string; times: string[] }
const PRESETS: Preset[] = [
  { id: "od", label: "Once daily", frequency: "once daily", times: ["08:00"] },
  { id: "bd", label: "Twice daily", frequency: "twice daily", times: ["08:00", "20:00"] },
  { id: "tds", label: "Three times daily", frequency: "three times daily", times: ["08:00", "14:00", "21:00"] },
  { id: "qid", label: "Four times daily", frequency: "four times daily", times: ["08:00", "12:00", "17:00", "21:00"] },
  { id: "q6", label: "Every 6 hours", frequency: "every 6 hours", times: ["00:00", "06:00", "12:00", "18:00"] },
  { id: "q8", label: "Every 8 hours", frequency: "every 8 hours", times: ["06:00", "14:00", "22:00"] },
  { id: "q12", label: "Every 12 hours", frequency: "every 12 hours", times: ["06:00", "18:00"] },
  { id: "hs", label: "At bedtime", frequency: "at night", times: ["21:00"] },
  { id: "prn", label: "Only when needed (no reminders)", frequency: "as needed", times: [] },
  { id: "custom", label: "Custom times", frequency: "", times: [] },
];
const WORDS = ["", "once daily", "twice daily", "three times daily", "four times daily"];
const labelFor = (n: number) => (n <= 4 ? WORDS[n] : `${n} times daily`);

/** Identify which preset a stored schedule belongs to (so Modify opens on the right choice). */
export function presetOf(s: Schedule): string {
  const hit = PRESETS.find((p) => p.id !== "custom" && p.frequency === s.frequency.trim().toLowerCase());
  return hit ? hit.id : "custom";
}
export function defaultSchedule(): Schedule { return { frequency: "once daily", timings: ["08:00"] }; }

/**
 * The doctor picks how often and at WHICH TIMES. Those exact times are saved with the prescription and are what the
 * patient is reminded at, so what the doctor sees here is what the patient gets.
 */
export function FrequencyPicker({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const times = value.timings ?? [];
  const id = presetOf(value);
  const prn = id === "prn";
  const fixedCount = id !== "custom" && !prn;
  useEffect(() => { if (!value.timings && !prn) onChange({ ...value, timings: PRESETS.find((p) => p.id === id)?.times ?? [] }); /* eslint-disable-next-line */ }, []);
  const choose = (pid: string) => {
    const p = PRESETS.find((x) => x.id === pid)!;
    if (pid === "custom") onChange({ frequency: labelFor(times.length || 1), timings: times.length ? times : ["08:00"] });
    else onChange({ frequency: p.frequency, timings: p.times.length ? p.times : undefined });
  };
  const setTimes = (t: string[]) => {
    const sorted = [...t];
    onChange({ frequency: id === "custom" ? labelFor(t.length) : value.frequency, timings: sorted });
  };
  const sortedUnique = new Set(times).size === times.length;
  return (
    <div className="fld full">
      <label>How often</label>
      <select value={id} onChange={(e) => choose(e.target.value)}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      {!prn && <>
        <label className="gap">Reminder times (IST) — the patient is reminded at exactly these times</label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {times.map((t, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <input type="time" style={{ width: 130 }} value={t} required onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
              {id === "custom" && times.length > 1 && <button type="button" className="sm" aria-label="Remove time" onClick={() => setTimes(times.filter((_, j) => j !== i))}>×</button>}
            </span>))}
          {id === "custom" && times.length < 8 && <button type="button" className="sm" onClick={() => setTimes([...times, "12:00"])}>+ Add time</button>}
        </div>
        {!sortedUnique && <small className="err">Each reminder time must be different.</small>}
      </>}
      <small className="muted">{prn ? "No reminders are sent; the patient takes it when needed." : fixedCount || id === "custom" ? `${times.length} dose${times.length === 1 ? "" : "s"} a day: ${[...times].sort().join(" · ") || "—"}` : ""}</small>
    </div>
  );
}
