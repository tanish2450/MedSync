import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ROLES, type Role } from "./types.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const forbidden = (m = "Forbidden") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);

export interface Caller { sub: string; email: string; name: string; role: Role }

export function callerFrom(event: APIGatewayProxyEvent): Caller {
  const c = (event.requestContext.authorizer?.claims ?? {}) as Record<string, string>;
  let groups: string[] = [];
  const g = c["cognito:groups"];
  if (g) groups = g.startsWith("[") ? g.replace(/[\[\]]/g, "").split(/[ ,]+/).filter(Boolean) : g.split(",");
  const role = ROLES.find((r) => groups.includes(r));
  if (!c.sub || !role) throw forbidden("No role assigned");
  return { sub: c.sub, email: c.email ?? "", name: c.name ?? c.email ?? c.sub, role };
}

const CORS = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};
export const ok = (body: unknown, status = 200): APIGatewayProxyResult => ({
  statusCode: status, headers: { "Content-Type": "application/json", ...CORS }, body: JSON.stringify(body),
});
export const fail = (status: number, message: string, details?: unknown): APIGatewayProxyResult =>
  ok({ error: message, details }, status);

export function parseBody<T = any>(event: APIGatewayProxyEvent): T {
  if (!event.body) return {} as T;
  try { return JSON.parse(event.body) as T; } catch { throw badRequest("Invalid JSON body"); }
}
