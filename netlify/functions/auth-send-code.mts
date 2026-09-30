import type { Config } from "@netlify/functions";
import { EMAIL_RE, cleanEmail, codes, hash, json, readJson } from "../lib/common.mts";
import { codeEmail, mailConfigured, sendMail } from "../lib/mail.mts";
import { randomInt } from "node:crypto";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

export default async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!mailConfigured()) return json(503, { error: "mail_not_configured" });
  const body = await readJson<{ email?: string }>(req);
  const email = cleanEmail(body?.email);
  if (!EMAIL_RE.test(email) || email.length > 200) return json(400, { error: "invalid_email" });

  const store = codes();
  const existing = (await store.get(email, { type: "json" })) as { sentAt: number } | null;
  if (existing && Date.now() - existing.sentAt < RESEND_COOLDOWN_MS) return json(429, { error: "too_soon" });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Seule l'empreinte du code est conservée
  await store.setJSON(email, { hash: hash(`${email}:${code}`), sentAt: Date.now(), expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 });

  const { subject, html } = codeEmail(code);
  const sent = await sendMail(email, subject, html);
  if (!sent.ok) return json(502, { error: "mail_send_failed", brevoStatus: sent.status });
  return json(200, { ok: true });
};

export const config: Config = { path: "/api/auth/send-code" };
