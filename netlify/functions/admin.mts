import type { Config } from "@netlify/functions";
import { cleanEmail, env, json, profiles, readJson, saveProfile, type Profile } from "../lib/common.mts";

// Console admin : liste des utilisateurs, blocage / déblocage d'un compte
export default async (req: Request) => {
  const key = env("ADMIN_KEY");
  if (!key || req.headers.get("x-admin-key") !== key) return json(401, { error: "unauthorized" });

  if (req.method === "POST") {
    const body = await readJson<{ email?: string; blocked?: boolean }>(req);
    const p = (await profiles().get(cleanEmail(body?.email), { type: "json" })) as Profile | null;
    if (!p) return json(404, { error: "not_found" });
    p.blocked = !!body?.blocked;
    await saveProfile(p);
    return json(200, { ok: true });
  }

  const { blobs } = await profiles().list();
  const list = await Promise.all(blobs.map(({ key }) => profiles().get(key, { type: "json" }) as Promise<Profile | null>));
  const users = list
    .filter((p): p is Profile => !!p)
    .map((p) => ({ email: p.email, createdAt: p.createdAt, lastSeen: p.lastSeen, opens: p.opens, blocked: !!p.blocked }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  return json(200, { users });
};

export const config: Config = { path: "/api/admin" };
