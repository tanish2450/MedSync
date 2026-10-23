import type { ReactNode } from "react";

/*
 * Original flat "people" illustrations for MedSync: white coats, soft skin tones, one green / yellow / orange accent each.
 * Built from one <Person> rig so every scene shares the same proportions and line weight.
 */
const K = "#232A35", W = "#FFFFFF", G = "#5FC8A0", Y = "#FFD23F", O = "#E8743B", GREY = "#D9DCE1";
const SKIN = { light: "#F6C3A6", medium: "#E08A5C", deep: "#A45E3D" } as const;
const line = { stroke: K, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

type Hair = "bun" | "short" | "long" | "beard";
interface PersonP { skin: keyof typeof SKIN; hair: Hair; hairColor?: string; top: "coat" | "sweater"; topColor?: string; inner?: string; glasses?: boolean; x?: number; y?: number; s?: number; flip?: boolean }

/** 140×170 figure: head centred at (70,50), shoulders from y≈92. */
function Person({ skin, hair, hairColor = K, top, topColor = G, inner = G, glasses, x = 0, y = 0, s = 1, flip }: PersonP) {
  const c = SKIN[skin];
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})${flip ? " translate(-140 0)" : ""}`}>
      {hair === "long" && <path d="M44 52C40 22 62 13 79 19c19 6 19 33 15 66H46c0-14-2-23-2-33z" fill={hairColor} />}
      <path d="M10 172C10 116 34 90 70 86c36 4 60 30 60 86z" fill={top === "coat" ? W : topColor} stroke={K} strokeWidth={1.6} strokeLinejoin="round" />
      {top === "coat" ? <>
        <path d="M58 87l12 30 12-30z" fill={inner} />
        <path d="M58 87l-7 42M82 87l7 42M98 132h14M30 140c2 12 2 22 0 32" {...line} />
      </> : <path d="M56 88q14 12 28 0M34 136c4 10 6 22 4 36M106 136c-4 10-6 22-4 36" {...line} />}
      <path d="M62 72h16v16q-8 6-16 0z" fill={c} />
      <ellipse cx="49" cy="54" rx="4.5" ry="6.5" fill={c} />
      <ellipse cx="70" cy="50" rx="22" ry="25" fill={c} />
      {hair === "bun" && <><circle cx="54" cy="20" r="12" fill={hairColor} /><path d="M47 54C43 27 61 18 78 22c16 4 18 20 14 28-6-12-18-16-30-12-8 4-12 10-12 22z" fill={hairColor} /></>}
      {(hair === "short" || hair === "beard") && <path d="M48 52C45 28 61 19 77 22c16 3 19 16 15 26-4-9-12-13-22-11-8 2-14 7-16 17z" fill={hairColor} />}
      {hair === "long" && <path d="M48 50c2-14 12-24 28-24 10 0 16 6 18 14-10-6-24-6-34 2-6 4-10 6-12 8z" fill={hairColor} />}
      {hair === "beard" && <path d="M49 56c0 32 42 32 42 0-6 12-36 12-42 0z" fill={hairColor} />}
      <circle cx="78" cy="50" r="2.2" fill={K} />
      <path d="M73 42q5-3 10 0M88 52q4 5-1 7" {...line} />
      {hair === "beard" ? <path d="M70 66q6 5 12 0z" fill={K} /> : <path d="M71 64q6 5 12 0" {...line} />}
      {glasses && <><circle cx="64" cy="50" r="6.5" {...line} /><circle cx="81" cy="50" r="6.5" {...line} /><path d="M70.5 50h4" {...line} /></>}
    </g>
  );
}
const Hand = ({ x, y, skin, r = 0 }: { x: number; y: number; skin: keyof typeof SKIN; r?: number }) =>
  <ellipse cx={x} cy={y} rx="8" ry="6.5" fill={SKIN[skin]} stroke={K} strokeWidth={1.2} transform={`rotate(${r} ${x} ${y})`} />;
const Star = ({ x, y }: { x: number; y: number }) =>
  <path transform={`translate(${x} ${y})`} d="M0-7l2 5h6l-5 3.5 2 6L0 4l-5 3.5 2-6-5-3.5h6z" fill={Y} />;

/** Doctor holding a review card with five stars. */
export const DoctorReviews = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="light" hair="bun" top="coat" inner={G} x={30} y={28} s={1} />
    <rect x="104" y="128" width="104" height="66" rx="3" fill={W} stroke={Y} strokeWidth={6} />
    {[122, 140, 158, 176, 194].map((x) => <Star key={x} x={x} y={146} />)}
    <path d="M118 164h76M118 174h68M118 184h44" {...line} />
    <Hand x={110} y={130} skin="light" r={-20} />
  </svg>
);

/** Bearded doctor in a green circle holding a “Book” tag. */
export const DoctorBook = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <defs><clipPath id="illo-book"><circle cx="120" cy="100" r="92" /></clipPath></defs>
    <circle cx="120" cy="100" r="92" fill={G} />
    <g clipPath="url(#illo-book)"><Person skin="medium" hair="beard" hairColor="#6B3A1F" top="coat" inner={GREY} x={50} y={40} s={1.05} /></g>
    <g transform="rotate(-6 128 156)"><rect x="92" y="140" width="84" height="32" rx="2" fill={Y} /><text x="134" y="163" textAnchor="middle" fontSize="20" fill={K} fontFamily="'Segoe Print','Comic Sans MS',cursive">Book</text></g>
    <path d="M172 160c10 2 18 10 22 22l-14 6c-4-8-8-12-14-14z" fill={O} />
  </svg>
);

/** Doctor giving a thumbs-up behind a patient who holds an insurance card. */
export const DoctorPatient = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="deep" hair="long" top="coat" inner={Y} glasses x={10} y={8} s={0.95} />
    <Person skin="light" hair="short" hairColor="#5A2E1C" top="sweater" topColor={G} x={78} y={52} s={0.9} flip />
    <rect x="126" y="150" width="40" height="24" rx="3" fill={W} stroke={K} strokeWidth={1.2} />
    <path d="M134 162h8M138 158v8" stroke={G} strokeWidth={3} strokeLinecap="round" /><path d="M148 158h12M148 163h12M148 168h8" {...line} />
    <Hand x={124} y={164} skin="light" /><Hand x={168} y={164} skin="light" />
  </svg>
);

/** Doctor answering a message: speech bubbles beside a waving doctor. */
export const DoctorChat = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="medium" hair="short" top="coat" inner={G} x={20} y={30} s={0.98} />
    <path d="M150 30h70a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8h-48l-12 12v-12h-10a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" fill={W} stroke={K} strokeWidth={1.4} />
    <path d="M160 46h52M160 58h36" {...line} />
    <path d="M168 100h44a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8h-6v10l-10-10h-28a8 8 0 0 1-8-8v-18a8 8 0 0 1 8-8z" fill={Y} />
    <circle cx="178" cy="117" r="3" fill={K} /><circle cx="190" cy="117" r="3" fill={K} /><circle cx="202" cy="117" r="3" fill={K} />
    <path d="M128 112c4-14 10-20 18-22" {...line} /><Hand x={148} y={88} skin="medium" r={-30} />
  </svg>
);

/** Patient with a pill bottle and a couple of pills. */
export const PatientMeds = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="light" hair="long" hairColor="#5A2E1C" top="sweater" topColor={Y} x={40} y={28} s={1} />
    <rect x="128" y="126" width="34" height="46" rx="5" fill={O} stroke={K} strokeWidth={1.4} />
    <rect x="124" y="116" width="42" height="14" rx="3" fill={W} stroke={K} strokeWidth={1.4} />
    <rect x="134" y="140" width="22" height="18" rx="2" fill={W} /><path d="M140 149h10M145 144v10" stroke={G} strokeWidth={2.6} strokeLinecap="round" />
    <Hand x={124} y={150} skin="light" />
    <g transform="rotate(-30 196 160)"><rect x="184" y="154" width="24" height="12" rx="6" fill={W} stroke={K} strokeWidth={1.3} /><path d="M196 154v12" fill="none" stroke={K} strokeWidth={1.3} /><rect x="196" y="154.6" width="11.4" height="10.8" rx="5.4" fill={G} /></g>
    <circle cx="206" cy="182" r="6" fill={Y} stroke={K} strokeWidth={1.3} />
  </svg>
);

/** Empty state with an illustration on top. */
export function IlloEmpty({ art, title, children }: { art: ReactNode; title: string; children?: ReactNode }) {
  return <div className="illo-empty">{art}<b>{title}</b>{children && <div className="muted">{children}</div>}</div>;
}
