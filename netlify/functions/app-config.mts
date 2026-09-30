import type { Config } from "@netlify/functions";
import { json } from "../lib/common.mts";
import { mailConfigured } from "../lib/mail.mts";

// Configuration publique pour l'app (état du service mail)
export default async () => json(200, { ok: true, mail: mailConfigured() });

export const config: Config = { path: "/api/config" };
