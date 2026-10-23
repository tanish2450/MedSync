import type { ReactNode } from "react";

/* Flat "visit reason" illustrations: warm yellow fill, dark outline, orange accents. 64×64 each. */
const Y = "#FFD23F", O = "#FF8A4C", K = "#1F2430", W = "#FFFFFF";
const s = { stroke: K, strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const spark = (x: number, y: number) => <path d={`M${x} ${y - 4}v-3M${x - 5} ${y - 2}l-2-2M${x + 5} ${y - 2}l2-2`} stroke={O} strokeWidth={2.2} strokeLinecap="round" />;

const ART: Record<string, ReactNode> = {
  Cardiology: <>
    <path d="M32 44C19 35 15 28 18 22c3-6 10-6 14 0 4-6 11-6 14 0 3 6-1 13-14 22z" fill={Y} {...s} />
    <path d="M12 46c5 0 9 3 15 3h15c3 0 3 4 0 4H27c-7 0-10-2-15-2" fill="none" {...s} />{spark(32, 16)}
  </>,
  Diabetology: <>
    <path d="M28 12S16 27 16 35a12 12 0 0 0 24 0c0-8-12-23-12-23z" fill={O} {...s} />
    <path d="M22 36a6 6 0 0 0 5 6" stroke={W} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    <rect x="38" y="34" width="14" height="18" rx="3" fill={Y} {...s} /><path d="M42 40h6M42 45h4" {...s} />
  </>,
  Endocrinology: <>
    <path d="M30 28c-2-9-8-14-13-12s-6 12-3 20 10 12 14 8c3-3 3-9 2-16z" fill={Y} {...s} />
    <path d="M34 28c2-9 8-14 13-12s6 12 3 20-10 12-14 8c-3-3-3-9-2-16z" fill={Y} {...s} />
    <path d="M28 34h8" {...s} /><path d="M32 10v8" {...s} />{spark(32, 54)}
  </>,
  Neurology: <>
    <path d="M23 18c-6 0-10 5-9 10-4 2-4 9 1 11 0 5 5 8 10 6 2 4 9 5 12 1 4 3 10 1 11-4 5-1 7-7 4-11 2-5-2-11-8-11-1-5-8-7-12-4-3-3-7-2-9 2z" fill={Y} {...s} />
    <path d="M32 18v26M24 27c3 0 5 3 3 6M41 25c-3 1-4 4-1 6M23 38c2-2 5-2 6 0M38 40c1-3 4-3 6-2" fill="none" {...s} />
    <path d="M12 14l2 2M10 20h3" stroke={O} strokeWidth={2.2} strokeLinecap="round" />
  </>,
  Psychiatry: <>
    <path d="M22 52v-7c-6-3-9-9-9-16 0-10 8-17 18-17 9 0 16 6 16 14l4 7-4 2v5c0 3-2 4-5 4h-4v8z" fill={Y} {...s} />
    <path d="M28 30c2 2 4 2 6 0" fill="none" {...s} />
    <path d="M42 18a4 4 0 0 1 7-3 4 4 0 0 1 6 4 3 3 0 0 1-2 6H43a4 4 0 0 1-1-7z" fill={W} {...s} />
    <path d="M10 14a3 3 0 0 1 5-2 3 3 0 0 1 4 3 2 2 0 0 1-1 4h-7a3 3 0 0 1-1-5z" fill={W} {...s} />
  </>,
  Pulmonology: <>
    <path d="M28 24c-8 0-14 12-14 22 0 6 6 6 10 4 4-2 4-6 4-10z" fill={Y} {...s} />
    <path d="M36 24c8 0 14 12 14 22 0 6-6 6-10 4-4-2-4-6-4-10z" fill={Y} {...s} />
    <path d="M32 10v16l-4 6M32 26l4 6" fill="none" {...s} /><path d="M19 38c2-1 4-1 5 1M45 38c-2-1-4-1-5 1" stroke={O} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  </>,
  Gastroenterology: <>
    <path d="M26 10v8c0 4-9 7-9 17 0 9 8 15 17 15 9 0 15-6 15-13 0-8-8-11-13-8-3 2-6 0-6-4V10" fill={Y} {...s} />
    <path d="M24 38c3 3 9 4 13 1" stroke={O} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  </>,
  Orthopaedics: <>
    <path d="M19 27a6 6 0 1 1 7-7l15 15a6 6 0 1 1 6 6 6 6 0 1 1-6 6L26 32a6 6 0 1 1-7-5z" fill={Y} {...s} />{spark(48, 14)}
  </>,
  Dermatology: <>
    <path d="M13 51c0-22 14-37 38-38 0 24-15 38-38 38z" fill={Y} {...s} />
    <path d="M13 51l28-28M24 40l-2-9M32 32l9 1" fill="none" {...s} />
    <circle cx="38" cy="22" r="2" fill={O} /><circle cx="44" cy="30" r="2" fill={O} /><circle cx="30" cy="42" r="2" fill={O} />
  </>,
  Paediatrics: <>
    <circle cx="20" cy="20" r="6" fill={Y} {...s} /><circle cx="44" cy="20" r="6" fill={Y} {...s} />
    <circle cx="32" cy="35" r="16" fill={Y} {...s} /><ellipse cx="32" cy="41" rx="7" ry="5" fill={W} {...s} />
    <circle cx="26" cy="32" r="1.8" fill={K} /><circle cx="38" cy="32" r="1.8" fill={K} /><path d="M30 39h4" {...s} />
    <circle cx="22" cy="38" r="2" fill={O} opacity=".7" /><circle cx="42" cy="38" r="2" fill={O} opacity=".7" />
  </>,
  Gynaecology: <>
    <circle cx="32" cy="26" r="13" fill={Y} {...s} /><path d="M32 39v14M25 46h14" fill="none" {...s} />
    <path d="M27 24a5 5 0 0 1 5-4" stroke={W} strokeWidth={2.4} strokeLinecap="round" fill="none" />{spark(50, 14)}
  </>,
  ENT: <>
    <path d="M24 44c0 6 4 8 8 8s6-4 6-8c0-6 12-9 12-21 0-9-7-15-16-15s-16 7-16 16" fill={Y} {...s} />
    <path d="M26 24c0-4 3-7 7-7s7 3 7 7c0 4-4 6-4 10" fill="none" {...s} />
    <path d="M52 30c2 2 2 6 0 8M56 27c3 4 3 10 0 14" stroke={O} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  </>,
  Ophthalmology: <>
    <circle cx="20" cy="32" r="10" fill={W} {...s} /><circle cx="44" cy="32" r="10" fill={W} {...s} />
    <path d="M30 31c1-2 3-2 4 0M10 30l-4-3M54 30l4-3" fill="none" {...s} />
    <circle cx="20" cy="32" r="5" fill={Y} {...s} /><circle cx="20" cy="32" r="2" fill={K} />
    <path d="M39 33c2 2 6 2 8 0" fill="none" {...s} />
  </>,
  Nephrology: <>
    <path d="M24 14c-9 0-13 9-13 18s4 18 13 18c6 0 7-4 7-8 0-3-3-5-3-10s3-7 3-10c0-4-1-8-7-8z" fill={Y} {...s} />
    <path d="M40 14c9 0 13 9 13 18s-4 18-13 18c-6 0-7-4-7-8 0-3 3-5 3-10s-3-7-3-10c0-4 1-8 7-8z" fill={O} {...s} />
  </>,
  Oncology: <>
    <path d="M32 40l-9 13-6-4 9-13M32 40l9 13 6-4-9-13" fill={O} {...s} />
    <path d="M32 40c-6-7-10-12-10-18 0-6 4-10 10-10s10 4 10 10c0 6-4 11-10 18z" fill={Y} {...s} />
    <path d="M27 22c0-3 2-5 5-5s5 2 5 5" fill="none" {...s} />
  </>,
  "General Medicine": <>
    <path d="M18 12v12a10 10 0 0 0 20 0V12" fill="none" {...s} strokeWidth={3} />
    <path d="M28 34v5a11 11 0 0 0 22 0v-4" fill="none" {...s} strokeWidth={3} />
    <circle cx="50" cy="30" r="6" fill={Y} {...s} /><circle cx="50" cy="30" r="2" fill={O} />
    <circle cx="18" cy="11" r="2.5" fill={Y} {...s} /><circle cx="38" cy="11" r="2.5" fill={Y} {...s} />
  </>,
};
const FALLBACK = <>
  <rect x="12" y="20" width="40" height="30" rx="6" fill={Y} {...s} /><path d="M25 20v-4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4" fill="none" {...s} />
  <path d="M32 28v14M25 35h14" stroke={W} strokeWidth={4} strokeLinecap="round" />
</>;

/* Older/alternate spellings map onto the same art. */
const ALIAS: Record<string, string> = { Cardiologist: "Cardiology", Diabetes: "Diabetology", Orthopedics: "Orthopaedics", Pediatrics: "Paediatrics", Gynecology: "Gynaecology", "OB/GYN": "Gynaecology", Dentistry: "General Medicine", "General Physician": "General Medicine" };
export const SpecialtyArt = ({ name }: { name: string }) => (
  <svg viewBox="0 0 64 64" aria-hidden="true">{ART[name] ?? ART[ALIAS[name]] ?? FALLBACK}</svg>
);

/** Row of illustrated specialty tiles; clicking one searches doctors in that specialty. */
export function SpecialtyTiles({ specialties, onPick, active }: { specialties: string[]; onPick: (s: string) => void; active?: string }) {
  if (!specialties.length) return null;
  return (
    <div className="spec-row" role="list">
      {specialties.map((sp) => (
        <button key={sp} type="button" role="listitem" className={`spec${active === sp ? " on" : ""}`} onClick={() => onPick(sp)}>
          <span className="spec-tile"><SpecialtyArt name={sp} /></span>
          <span className="spec-name">{sp}</span>
        </button>
      ))}
    </div>
  );
}
