import type { Config } from "@netlify/functions";
import { authenticate, hash, json, saveProfile, sessions } from "../lib/common.mts";

// GET : vérifie la session (et met à jour « vu le ») · DELETE : déconnexion de cet appareil
export default async (req: Request) => {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { profile } = auth;

  if (req.method === "DELETE") {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    await sessions().delete(hash(token));
    return json(200, { ok: true });
  }
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  profile.lastSeen = new Date().toISOString();
  profile.opens += 1;
  await saveProfile(profile);
  return json(200, { email: profile.email, createdAt: profile.createdAt });
};

export const config: Config = { path: "/api/me" };
