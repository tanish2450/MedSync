import { config } from "./config";
import { getIdToken } from "./auth";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError(401, "Session expired. Please sign in again.");
  const res = await fetch(`${config().apiUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: token }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? data?.message ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>("PUT", p, b ?? {});
export const del = <T = any>(p: string) => api<T>("DELETE", p);
