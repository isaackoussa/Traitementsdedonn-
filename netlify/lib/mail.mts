// Envoi d'e-mails via Brevo + gabarits HTML.
import { env } from "./common.mts";

/** MAIL_DRY_RUN=1 : les e-mails sont écrits dans les logs au lieu d'être envoyés (tests locaux). */
const dryRun = () => env("MAIL_DRY_RUN") === "1";

export function mailConfigured(): boolean {
  return dryRun() || !!(env("BREVO_API_KEY") && env("MAIL_FROM"));
}

export function appUrl(): string {
  return (env("APP_URL") ?? env("URL") ?? "https://datalab.netlify.app").replace(/\/$/, "");
}

export async function sendMail(to: string, subject: string, html: string): Promise<{ ok: boolean; status?: number; details?: string }> {
  if (dryRun()) {
    console.log(`[MAIL_DRY_RUN] à ${to} — ${subject}\n${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)}`);
    return { ok: true };
  }
  const key = env("BREVO_API_KEY");
  const from = env("MAIL_FROM");
  if (!key || !from) return { ok: false, details: "mail_not_configured" };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: env("MAIL_FROM_NAME") ?? "DataLab" },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const details = await res.text().catch(() => "");
    console.error("Brevo: échec d'envoi", res.status, details);
    return { ok: false, status: res.status, details };
  }
  return { ok: true };
}

/** Ajoute (ou met à jour) l'utilisateur dans les contacts Brevo. Sans effet si non configuré. */
export async function syncBrevoContact(email: string) {
  const key = env("BREVO_API_KEY");
  if (!key) return;
  const listId = Number(env("BREVO_LIST_ID"));
  try {
    const res = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, updateEnabled: true, ...(listId ? { listIds: [listId] } : {}) }),
    });
    if (!res.ok) console.warn("Brevo contact:", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.warn("Brevo contact:", e);
  }
}

// ————— Gabarits —————

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(opts: { preheader: string; title: string; body: string; cta?: { label: string; href: string } }): string {
  const cta = opts.cta
    ? `<tr><td align="center" style="padding:8px 32px 32px"><a href="${opts.cta.href}" style="display:inline-block;background:#3b5bdb;color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:12px">${esc(opts.cta.label)}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1d2330">
<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(20,30,60,.12)">
<tr><td style="background:linear-gradient(135deg,#3b5bdb,#0c8599);background-color:#3b5bdb;padding:28px 32px;color:#ffffff">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.2);text-align:center;font-size:20px;color:#fff">📊</td>
<td style="padding-left:12px;font-weight:800;font-size:18px;color:#fff">DataLab</td></tr></table>
<h1 style="margin:18px 0 0;font-size:26px;line-height:1.2;color:#ffffff">${esc(opts.title)}</h1>
</td></tr>
<tr><td style="padding:28px 32px 12px;font-size:16px;line-height:1.6">${opts.body}</td></tr>
${cta}
</table>
<p style="font-size:12px;color:#677084;margin:16px 0 0">Tu reçois cet e-mail car tu as un compte DataLab.</p>
</td></tr></table></body></html>`;
}

export function codeEmail(code: string) {
  return {
    subject: `${code} est ton code DataLab`,
    html: layout({
      preheader: `Ton code de connexion : ${code}`,
      title: "Ton code de connexion",
      body: `<p style="margin:0 0 12px">Voici ton code pour te connecter à DataLab :</p>
<p style="margin:0 0 16px;font-size:36px;font-weight:800;letter-spacing:8px;color:#3b5bdb">${code}</p>
<p style="margin:0;font-size:14px;color:#4f566b">Il est valable 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore simplement ce message.</p>`,
    }),
  };
}

export function welcomeEmail() {
  return {
    subject: "Bienvenue dans DataLab 📊",
    html: layout({
      preheader: "Ton laboratoire de traitement de données est prêt.",
      title: "Bienvenue dans DataLab !",
      body: `<p style="margin:0 0 12px">Hello 👋</p>
<p style="margin:0 0 12px">Ton compte est créé. Tu as accès à plus de 75 outils pour nettoyer, transformer, analyser et visualiser tes données.</p>
<ul style="margin:0 0 12px;padding-left:20px"><li>import CSV, JSON, Excel et ODS</li><li>nettoyage, formules, regroupements, tableaux croisés, jointures</li><li>statistiques, graphiques et requêtes SQL</li><li>export dans 11 formats</li></ul>
<p style="margin:0">Tes fichiers restent traités dans ton navigateur : ils ne sont jamais envoyés sur nos serveurs.</p>`,
      cta: { label: "Ouvrir DataLab", href: appUrl() },
    }),
  };
}
