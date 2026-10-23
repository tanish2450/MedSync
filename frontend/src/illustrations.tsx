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

const BLUE = "#8FB8F0";
const Check = ({ x, y }: { x: number; y: number }) => <path d={`M${x - 4} ${y}l3 3 6-7`} stroke={G} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
const Heart = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) =>
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 10C-11 2-13-5-10-9c3-4 8-3 10 1 2-4 7-5 10-1 3 4 1 11-10 19z" fill={O} stroke={K} strokeWidth={1.4} strokeLinejoin="round" />;

/** Doctor reviewing a patient chart on a clipboard. */
export const DoctorChart = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="medium" hair="short" top="coat" inner={G} glasses x={8} y={28} />
    <rect x="118" y="82" width="80" height="108" rx="6" fill={Y} stroke={K} strokeWidth={1.6} />
    <rect x="126" y="94" width="64" height="88" rx="2" fill={W} stroke={K} strokeWidth={1.3} />
    <rect x="144" y="76" width="28" height="13" rx="3" fill={GREY} stroke={K} strokeWidth={1.4} />
    <path d="M132 120h12l5-11 6 22 5-11h20" stroke={O} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Check x={136} y={146} /><path d="M146 146h34" {...line} /><Check x={136} y={162} /><path d="M146 162h26" {...line} />
    <Hand x={120} y={146} skin="medium" />
  </svg>
);

/** Doctor beside a calendar with booked days and a clock. */
export const DoctorCalendar = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="light" hair="long" top="coat" inner={Y} x={0} y={30} />
    <rect x="116" y="52" width="108" height="100" rx="8" fill={W} stroke={K} strokeWidth={1.6} />
    <path d="M116 60a8 8 0 0 1 8-8h92a8 8 0 0 1 8 8v16H116z" fill={G} stroke={K} strokeWidth={1.6} />
    <path d="M140 46v12M200 46v12" stroke={K} strokeWidth={3} strokeLinecap="round" />
    {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => {
      const x = 134 + c * 24, y = 92 + r * 20, on = (c + r) % 3 === 0;
      return on ? <Check key={`${c}${r}`} x={x} y={y} /> : <circle key={`${c}${r}`} cx={x} cy={y} r="3" fill={GREY} />;
    }))}
    <circle cx="206" cy="132" r="9" fill={Y} />
    <circle cx="206" cy="168" r="20" fill={Y} stroke={K} strokeWidth={1.6} /><path d="M206 156v12l8 5" {...line} />
    <Hand x={118} y={150} skin="light" />
  </svg>
);

/** Doctor checking a patient's prescription photo on a phone. */
export const DoctorScan = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="light" hair="bun" top="coat" inner={BLUE} x={6} y={28} />
    <rect x="128" y="88" width="56" height="98" rx="9" fill={K} />
    <rect x="133" y="98" width="46" height="78" rx="3" fill={W} />
    <text x="140" y="120" fontSize="15" fontWeight="700" fill={O} fontFamily="Georgia,serif">Rx</text>
    <path d="M140 132h32M140 142h26M140 152h30M140 162h18" {...line} />
    <circle cx="196" cy="84" r="16" fill={W} fillOpacity=".7" stroke={K} strokeWidth={2.4} /><path d="M207 96l13 13" stroke={K} strokeWidth={4} strokeLinecap="round" />
    <Hand x={130} y={150} skin="light" />
  </svg>
);

/** Nurse with a checklist board. */
export const NurseDesk = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="deep" hair="bun" top="sweater" topColor={BLUE} x={4} y={28} />
    <path d="M62 116h16M70 108v16" stroke={W} strokeWidth={4} strokeLinecap="round" transform="translate(4 28)" />
    <rect x="122" y="70" width="96" height="116" rx="8" fill={W} stroke={K} strokeWidth={1.6} />
    <rect x="122" y="70" width="96" height="20" rx="8" fill={Y} stroke={K} strokeWidth={1.6} />
    {[108, 130, 152, 174].map((y, i) => <g key={y}><rect x="132" y={y - 7} width="13" height="13" rx="3" fill={W} stroke={K} strokeWidth={1.4} />{i < 3 && <Check x={138} y={y} />}<path d={`M152 ${y}h${i % 2 ? 40 : 54}`} {...line} /></g>)}
    <Hand x={124} y={142} skin="deep" />
  </svg>
);

/** Nurse on a call, confirming tomorrow's appointments. */
export const NursePhone = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="light" hair="short" hairColor="#5A2E1C" top="sweater" topColor={BLUE} x={30} y={30} />
    <rect x="124" y="58" width="14" height="30" rx="4" fill={K} transform="rotate(18 131 73)" />
    <Hand x={130} y={92} skin="light" r={-20} />
    <path d="M156 40h56a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8h-40l-12 10v-10h-4a8 8 0 0 1-8-8V48a8 8 0 0 1 8-8z" fill={Y} />
    <path d="M168 58l6 6 12-12" stroke={K} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M192 58h18" {...line} />
    <path d="M152 96c6 4 6 12 0 16M160 90c10 8 10 22 0 30" stroke={O} strokeWidth={2.2} strokeLinecap="round" fill="none" />
  </svg>
);

/** Caregiver with an arm around an elderly family member. */
export const CaregiverCare = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <Person skin="medium" hair="short" hairColor="#B9BEC6" top="sweater" topColor={Y} glasses x={-4} y={44} s={0.92} />
    <Person skin="light" hair="long" hairColor="#5A2E1C" top="sweater" topColor={G} x={98} y={30} s={0.95} flip />
    <path d="M150 136c-20-12-42-14-60-6" stroke={K} strokeWidth={13} strokeLinecap="round" fill="none" />
    <path d="M150 136c-20-12-42-14-60-6" stroke={G} strokeWidth={10} strokeLinecap="round" fill="none" />
    <Hand x={88} y={131} skin="light" />
    <Heart x={118} y={34} s={1.2} /><Heart x={142} y={20} s={0.7} />
  </svg>
);

/** Pharmacist at the counter in front of medicine shelves. */
export const Pharmacist = () => (
  <svg viewBox="0 0 240 200" aria-hidden="true" className="illo">
    <path d="M12 58h216M12 104h216" stroke={GREY} strokeWidth={6} strokeLinecap="round" />
    {[[24, O], [44, Y], [64, G], [174, Y], [194, O], [214, G]].map(([x, c]) => <g key={`a${x}`}><rect x={Number(x) - 7} y="36" width="14" height="20" rx="3" fill={String(c)} stroke={K} strokeWidth={1.2} /><rect x={Number(x) - 5} y="31" width="10" height="6" rx="1.5" fill={W} stroke={K} strokeWidth={1.2} /></g>)}
    {[[30, G], [52, W], [182, O], [206, W]].map(([x, c]) => <rect key={`b${x}`} x={Number(x) - 9} y="84" width="18" height="18" rx="3" fill={String(c)} stroke={K} strokeWidth={1.2} />)}
    <Person skin="deep" hair="short" top="coat" inner={G} x={50} y={34} />
    <rect x="0" y="166" width="240" height="34" fill={Y} stroke={K} strokeWidth={1.6} />
    <rect x="150" y="138" width="26" height="30" rx="4" fill={O} stroke={K} strokeWidth={1.4} /><rect x="147" y="131" width="32" height="9" rx="2" fill={W} stroke={K} strokeWidth={1.4} />
    <path d="M60 168v-22h34v22" fill={W} stroke={K} strokeWidth={1.4} /><path d="M70 146c0-8 14-8 14 0" {...line} />
  </svg>
);

/** Page header with an illustration on the right; used at the top of each role's main screens. */
export function PageBanner({ title, sub, art, action }: { title: string; sub?: string; art: ReactNode; action?: ReactNode }) {
  return (
    <section className="pbanner">
      <div className="pb-text"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}{action && <div className="pb-action">{action}</div>}</div>
      <div className="pb-art">{art}</div>
    </section>
  );
}

/** Empty state with an illustration on top. */
export function IlloEmpty({ art, title, children }: { art: ReactNode; title: string; children?: ReactNode }) {
  return <div className="illo-empty">{art}<b>{title}</b>{children && <div className="muted">{children}</div>}</div>;
}
