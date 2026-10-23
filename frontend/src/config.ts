export interface Config { apiUrl: string; userPoolId: string; clientId: string; region: string; googleEnabled?: boolean; cognitoDomain?: string }
let cfg: Config | null = null;
export async function loadConfig(): Promise<Config> {
  const r = await fetch("/config.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`config.json ${r.status} (copy public/config.example.json to public/config.json for local dev)`);
  cfg = (await r.json()) as Config;
  return cfg;
}
export const config = (): Config => { if (!cfg) throw new Error("config not loaded"); return cfg; };
