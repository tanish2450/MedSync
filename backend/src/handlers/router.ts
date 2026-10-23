import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Caller } from "../lib/http.js";
import type { Role } from "../lib/types.js";

export interface Ctx {
  caller: Caller; params: Record<string, string>; query: Record<string, string>; body: any; event: APIGatewayProxyEvent;
}
export interface Route {
  method: string; path: string; roles?: Role[]; handler: (c: Ctx) => Promise<unknown>; status?: number;
}
export interface Matched { route: Route; params: Record<string, string> }

export function match(routes: Route[], method: string, path: string): Matched | null {
  const segs = path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    const rs = r.path.split("/").filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params: Record<string, string> = {}; let okMatch = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].startsWith(":")) params[rs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rs[i] !== segs[i]) { okMatch = false; break; }
    }
    if (okMatch) return { route: r, params };
  }
  return null;
}
