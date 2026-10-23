import { useState } from "react";
import { Icon } from "./brand";

/*
 * Google Maps without an API key: the classic embed URL for in-page maps and the Maps URLs API
 * (https://developers.google.com/maps/documentation/urls) for directions and searches in Google Maps.
 */
export interface Place { lat?: number | string | null; lng?: number | string | null; name?: string; address?: string }
type Coords = [number, number];

const coordsOf = (p: Place): Coords | null => {
  const lat = Number(p.lat), lng = Number(p.lng);
  return p.lat != null && p.lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};
const labelOf = (p: Place) => [p.name, p.address].filter(Boolean).join(", ");

export const embedUrl = (q: string, zoom = 15, near?: Coords | null) =>
  `https://maps.google.com/maps?q=${encodeURIComponent(q)}${near ? `&ll=${near[0]},${near[1]}` : ""}&z=${zoom}&output=embed`;
export const directionsUrl = (p: Place) => {
  const c = coordsOf(p);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c ? `${c[0]},${c[1]}` : labelOf(p))}`;
};
export const searchUrl = (query: string, near?: Coords | null) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(near ? `${query} near ${near[0]},${near[1]}` : query)}`;
/** Pins the exact coordinates when we have them; otherwise lets Google geocode the name + address. */
const placeQuery = (p: Place) => { const c = coordsOf(p); return c ? `${c[0]},${c[1]} (${p.name ?? "Location"})` : labelOf(p); };

export function MapEmbed({ place, height = 240, zoom = 15, title }: { place: Place; height?: number; zoom?: number; title?: string }) {
  if (!coordsOf(place) && !labelOf(place)) return null;
  return (
    <div className="map" style={{ height }}>
      <iframe title={title ?? `Map of ${place.name ?? "location"}`} src={embedUrl(placeQuery(place), zoom)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    </div>
  );
}

export const DirectionsLink = ({ place, label = "Directions", className = "sm" }: { place: Place; label?: string; className?: string }) => (
  <a href={directionsUrl(place)} target="_blank" rel="noreferrer" className={`btnlink ${className}`}><Icon n="pin" />{label}</a>
);
export const MapsSearchLink = ({ query, near, label }: { query: string; near?: Coords | null; label: string }) => (
  <a href={searchUrl(query, near)} target="_blank" rel="noreferrer" className="btnlink sm"><Icon n="pin" />{label}</a>
);

/** Browser location, asked for only when the person taps the button. */
export function useHere() {
  const [here, setHere] = useState<Coords | null>(null); const [msg, setMsg] = useState("");
  const locate = () => {
    if (!navigator.geolocation) { setMsg("Location isn't available in this browser."); return; }
    setMsg("Finding you…");
    navigator.geolocation.getCurrentPosition((p) => { setHere([p.coords.latitude, p.coords.longitude]); setMsg(""); }, () => setMsg("Couldn't get your location. Showing the city instead."), { timeout: 10000, maximumAge: 300000 });
  };
  return { here, msg, locate };
}

const NEARBY = [
  { k: "pharmacy", label: "Medical shops" }, { k: "hospital", label: "Hospitals" },
  { k: "clinic", label: "Clinics" }, { k: "diagnostic lab", label: "Labs" },
] as const;

/** Patient home: medical shops / hospitals / clinics / labs around the patient, on Google Maps. */
export function NearbyCare({ fallbackArea = "Bengaluru" }: { fallbackArea?: string }) {
  const [kind, setKind] = useState<(typeof NEARBY)[number]["k"]>("pharmacy");
  const { here, msg, locate } = useHere();
  const q = here ? `${kind} near ${here[0]},${here[1]}` : `${kind} in ${fallbackArea}`;
  return (
    <section className="card nearby">
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="grow" style={{ margin: 0 }}>Near you</h2>
        {!here && <button className="sm" onClick={locate}><Icon n="pin" />Use my location</button>}
        <MapsSearchLink query={kind} near={here} label="Open in Google Maps" />
      </div>
      <div className="seg" role="tablist" aria-label="What to find">
        {NEARBY.map((n) => <button key={n.k} role="tab" aria-selected={kind === n.k} className={kind === n.k ? "on" : ""} onClick={() => setKind(n.k)}>{n.label}</button>)}
      </div>
      {msg && <small className="muted">{msg}</small>}
      <div className="map" style={{ height: 300 }}>
        <iframe key={q} title={`Map of nearby ${kind}`} src={embedUrl(q, here ? 14 : 12, here)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
      </div>
      <small className="muted">{here ? "Showing places around your current location." : `Showing ${fallbackArea}. Tap “Use my location” for places around you.`}</small>
    </section>
  );
}
