/* DataLab — barrière d'accès : e-mail + code à 6 chiffres (envoyé via Brevo), console admin sur #admin. */
(() => {
  'use strict';
  const SESSION_KEY = 'datalab:session';
  const ADMIN_KEY = 'datalab:admin';
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isLocalHost = ['localhost', '127.0.0.1', ''].includes(location.hostname) || location.protocol === 'file:';

  // ------------------------------------------------------------------ session
  function readSession() {
    try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  let session = readSession();
  function setSession(s) {
    session = s;
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* stockage indisponible */ }
  }

  // ------------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(status, code, data = {}) { super(code); this.status = status; this.code = code; this.data = data; }
  }
  async function api(path, init = {}) {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (session && !session.local) headers.set('Authorization', `Bearer ${session.token}`);
    let res;
    try { res = await fetch(`./api/${path}`, { ...init, headers }); } catch (e) { throw new ApiError(0, 'network'); }
    const type = res.headers.get('content-type') || '';
    // Sans serveur (fichier local, simple serveur statique), on reçoit du HTML ou une 404
    if (!type.includes('application/json')) throw new ApiError(res.status, res.status === 404 || res.status === 501 || type.includes('html') ? 'no_server' : 'bad_response');
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, String(data.error || 'error'), data);
    return data;
  }

  const AUTH_ERRORS = {
    network: 'Connexion impossible. Vérifie ta connexion internet.',
    no_server: 'Le serveur de connexion n\'est pas disponible ici. Lance l\'app avec « netlify dev » ou utilise la version en ligne.',
    mail_not_configured: 'L\'envoi d\'e-mails n\'est pas encore configuré (BREVO_API_KEY et MAIL_FROM dans Netlify).',
    mail_send_failed: 'L\'e-mail n\'a pas pu être envoyé. Vérifie l\'adresse et réessaie.',
    invalid_email: 'Cette adresse e-mail n\'est pas valide.',
    too_soon: 'Patiente 30 secondes avant de redemander un code.',
    no_code: 'Aucun code en cours pour cette adresse : redemande un code.',
    expired: 'Ce code a expiré : redemande un code.',
    wrong_code: 'Code incorrect.',
    too_many_attempts: 'Trop d\'essais : redemande un nouveau code.',
    blocked: 'Ce compte est suspendu.',
    invalid_session: 'Ta session a expiré : reconnecte-toi.',
  };
  function authError(e) {
    if (e instanceof ApiError) {
      if (e.code === 'wrong_code' && typeof e.data.remaining === 'number') {
        const r = e.data.remaining, s = r > 1 ? 's' : '';
        return `Code incorrect (${r} essai${s} restant${s}).`;
      }
      return AUTH_ERRORS[e.code] || `Erreur (${e.status}).`;
    }
    return 'Erreur inattendue.';
  }

  // ------------------------------------------------------------------ déverrouillage de l'app
  const readyCallbacks = [];
  let unlocked = false;
  function unlock() {
    document.body.classList.remove('locked');
    gate.hidden = true;
    renderAccountButton();
    if (!unlocked) { unlocked = true; readyCallbacks.splice(0).forEach(fn => fn()); }
  }
  function lock(message = '') {
    document.body.classList.add('locked');
    gate.hidden = false;
    renderEmailStep(message);
  }

  // ------------------------------------------------------------------ écran de connexion
  const gate = document.createElement('div');
  gate.className = 'auth-gate';
  gate.hidden = true;
  document.body.appendChild(gate);
  let email = '', cooldown = 0, cooldownTimer, noServer = false;

  const brand = `<div class="auth-brand"><img src="icon.svg" alt="" width="48" height="48"><div><b>DataLab</b><small>Nettoyer, transformer, analyser vos données</small></div></div>`;
  const alertBox = msg => (msg ? `<div class="auth-alert" role="alert">⚠️ ${esc(msg)}</div>` : '');
  const localBox = () => (noServer && isLocalHost ? `<div class="auth-card auth-dev"><b class="small">Mode développement</b>
      <p class="muted small">Les fonctions serveur ne tournent pas sur ce serveur local. Tu peux tester l'app sans compte (sur cet appareil uniquement).</p>
      <button class="btn small" data-auth="local">Continuer en local</button></div>` : '');
  const footer = '<p class="muted auth-foot">En continuant, tu acceptes de recevoir les e-mails liés à ton compte (code de connexion). Tes fichiers restent traités dans ton navigateur.</p>';

  function renderEmailStep(message = '') {
    gate.innerHTML = `<div class="auth-wrap">${brand}
      <form class="auth-card" data-step="email" novalidate>
        <h1>Ton espace <span class="accent">personnel</span></h1>
        <p class="muted">Connecte-toi avec ton e-mail pour accéder à DataLab. Pas de mot de passe, juste un code.</p>
        <label class="field"><span>Adresse e-mail</span>
          <input type="email" name="email" inputmode="email" autocomplete="email" placeholder="toi@exemple.com" value="${esc(email)}" required></label>
        ${alertBox(message)}
        <button class="btn primary big" name="submit" ${email.includes('@') ? '' : 'disabled'}>Recevoir mon code →</button>
        <ul class="auth-perks muted small">
          <li>🧹 Plus de 75 outils de nettoyage, calcul et analyse</li>
          <li>📊 Graphiques, statistiques et requêtes SQL</li>
          <li>🔒 Tes données restent dans ton navigateur</li>
        </ul>
      </form>${localBox()}${footer}</div>`;
    const input = gate.querySelector('[name=email]');
    input.addEventListener('input', () => { email = input.value; gate.querySelector('[name=submit]').disabled = !email.includes('@'); });
    setTimeout(() => input.focus(), 30);
  }

  function renderCodeStep(message = '') {
    gate.innerHTML = `<div class="auth-wrap">${brand}
      <form class="auth-card" data-step="code" novalidate>
        <button type="button" class="btn ghost small back" data-auth="change">← Changer d'e-mail</button>
        <h1>Vérifie ta boîte mail 📬</h1>
        <p class="muted">Un code à 6 chiffres a été envoyé à <b>${esc(email)}</b>. Pense à regarder dans les spams.</p>
        <input class="code-input mono" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="Code à 6 chiffres">
        ${alertBox(message)}
        <button class="btn primary big" name="submit" disabled>Me connecter</button>
        <button type="button" class="btn ghost" data-auth="resend" ${cooldown > 0 ? 'disabled' : ''}>${cooldown > 0 ? `Renvoyer un code (${cooldown} s)` : 'Renvoyer un code'}</button>
      </form>${footer}</div>`;
    const input = gate.querySelector('[name=code]');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      gate.querySelector('[name=submit]').disabled = input.value.length !== 6;
      if (input.value.length === 6) verify(input.value);
    });
    setTimeout(() => input.focus(), 30);
  }

  function setBusy(label) {
    const b = gate.querySelector('[name=submit]');
    if (b) { b.disabled = true; b.textContent = label; }
  }
  function startCooldown() {
    cooldown = 30;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldown--;
      const b = gate.querySelector('[data-auth=resend]');
      if (b) { b.disabled = cooldown > 0; b.textContent = cooldown > 0 ? `Renvoyer un code (${cooldown} s)` : 'Renvoyer un code'; }
      if (cooldown <= 0) clearInterval(cooldownTimer);
    }, 1000);
  }

  async function requestCode() {
    email = email.trim();
    setBusy('Envoi du code…');
    try {
      await api('auth/send-code', { method: 'POST', body: JSON.stringify({ email }) });
      startCooldown();
      renderCodeStep();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_server') noServer = true;
      if (gate.querySelector('[data-step=code]')) renderCodeStep(authError(e)); else renderEmailStep(authError(e));
    }
  }
  let verifying = false;
  async function verify(code) {
    if (verifying || code.length !== 6) return;
    verifying = true;
    setBusy('Vérification…');
    try {
      const res = await api('auth/verify', { method: 'POST', body: JSON.stringify({ email: email.trim(), code }) });
      setSession({ email: res.email, token: res.token });
      unlock();
    } catch (e) {
      renderCodeStep(authError(e));
    } finally { verifying = false; }
  }

  gate.addEventListener('submit', e => {
    e.preventDefault();
    const step = e.target.dataset.step;
    if (step === 'email') requestCode();
    else if (step === 'code') verify(gate.querySelector('[name=code]').value);
  });
  gate.addEventListener('click', e => {
    const b = e.target.closest('[data-auth]');
    if (!b) return;
    if (b.dataset.auth === 'change') renderEmailStep();
    else if (b.dataset.auth === 'resend') requestCode();
    else if (b.dataset.auth === 'local') { setSession({ email: 'local', token: '', local: true }); unlock(); }
  });

  // ------------------------------------------------------------------ compte (barre du haut)
  function renderAccountButton() {
    const b = document.getElementById('btnAccount');
    if (!b || !session) return;
    b.hidden = false;
    b.title = session.local ? 'Mode local (sans compte)' : `Connecté : ${session.email}`;
  }
  async function logout() {
    const who = session && !session.local ? session.email : 'mode local';
    if (!confirm(`Connecté : ${who}\n\nSe déconnecter de cet appareil ?`)) return;
    try { if (session && !session.local) await api('me', { method: 'DELETE' }); } catch (e) { /* session déjà expirée */ }
    setSession(null);
    location.reload();
  }

  // ------------------------------------------------------------------ console admin (#admin)
  const admin = document.createElement('div');
  admin.className = 'admin-view';
  admin.hidden = true;
  document.body.appendChild(admin);
  let adminKey = '';
  try { adminKey = sessionStorage.getItem(ADMIN_KEY) || ''; } catch (e) { /* ignoré */ }
  let adminUsers = null, adminQuery = '';

  const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  async function adminLoad() {
    const btn = admin.querySelector('[data-admin=open]');
    if (btn) { btn.disabled = true; btn.textContent = 'Chargement…'; }
    try {
      const res = await fetch('./api/admin', { headers: { 'x-admin-key': adminKey } });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error(res.status === 401 ? 'Clé admin invalide.' : 'Serveur indisponible.');
      adminUsers = (await res.json()).users;
      try { sessionStorage.setItem(ADMIN_KEY, adminKey); } catch (e) { /* ignoré */ }
      renderAdmin();
    } catch (e) { adminUsers = null; renderAdmin(e.message); }
  }
  async function adminBlock(emailToBlock, blocked) {
    await fetch('./api/admin', { method: 'POST', headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailToBlock, blocked }) });
    adminLoad();
  }
  function renderAdmin(error = '') {
    const head = `<div class="admin-head"><h1>Console admin</h1><button class="btn" data-admin="close">✕ Fermer</button></div>`;
    if (!adminUsers) {
      admin.innerHTML = `<div class="admin-inner">${head}<p class="muted">Suivi des utilisateurs de DataLab.</p>
        <form class="admin-login" data-admin-form><input type="password" name="key" placeholder="Clé admin (ADMIN_KEY)" value="${esc(adminKey)}" autocomplete="current-password">
        <button class="btn primary" data-admin="open">Ouvrir</button></form>${alertBox(error)}</div>`;
      admin.querySelector('[name=key]').focus();
      return;
    }
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const q = adminQuery.toLowerCase();
    const list = adminUsers.filter(u => u.email.includes(q));
    admin.innerHTML = `<div class="admin-inner">${head}
      <div class="admin-stats">
        <div class="auth-card"><b>${adminUsers.length}</b><span class="muted">Comptes</span></div>
        <div class="auth-card"><b>${adminUsers.filter(u => u.lastSeen >= week).length}</b><span class="muted">Actifs sur 7 jours</span></div>
        <div class="auth-card"><b>${adminUsers.reduce((a, u) => a + u.opens, 0)}</b><span class="muted">Ouvertures</span></div>
        <div class="auth-card"><b>${adminUsers.filter(u => u.blocked).length}</b><span class="muted">Bloqués</span></div>
      </div>
      <div class="row"><input type="search" data-admin="search" placeholder="🔎 Rechercher un utilisateur…" value="${esc(adminQuery)}"><span class="spacer"></span><button class="btn" data-admin="refresh">↻ Actualiser</button></div>
      ${list.map(u => `<div class="ds-item ${u.blocked ? 'is-blocked' : ''}"><strong>${esc(u.email)}</strong>
        <span class="muted small">Inscrit le ${fmtDate(u.createdAt)} · vu le ${fmtDate(u.lastSeen)} · ${u.opens} ouverture(s)</span>
        <button class="btn small ${u.blocked ? '' : 'danger'}" data-block="${esc(u.email)}" data-state="${u.blocked ? '0' : '1'}">${u.blocked ? 'Débloquer' : 'Bloquer'}</button></div>`).join('')
        || '<p class="muted">Aucun utilisateur.</p>'}</div>`;
  }
  function openAdmin() { admin.hidden = false; renderAdmin(); if (adminKey && !adminUsers) adminLoad(); }
  function closeAdmin() { admin.hidden = true; if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search); }
  admin.addEventListener('submit', e => { e.preventDefault(); adminKey = admin.querySelector('[name=key]').value.trim(); if (adminKey) adminLoad(); });
  admin.addEventListener('click', e => {
    const a = e.target.closest('[data-admin]');
    if (a && a.dataset.admin === 'close') closeAdmin();
    if (a && a.dataset.admin === 'refresh') adminLoad();
    const b = e.target.closest('[data-block]');
    if (b) adminBlock(b.dataset.block, b.dataset.state === '1');
  });
  admin.addEventListener('input', e => {
    if (e.target.dataset.admin !== 'search') return;
    adminQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderAdmin();
    const s = admin.querySelector('[data-admin=search]');
    s.focus(); s.setSelectionRange(pos, pos);
  });
  addEventListener('hashchange', () => { if (location.hash === '#admin') openAdmin(); });

  // ------------------------------------------------------------------ démarrage
  async function boot() {
    const acc = document.getElementById('btnAccount');
    if (acc) acc.addEventListener('click', logout);
    if (location.hash === '#admin') openAdmin();
    if (!session) return lock();
    if (session.local) return unlock();
    try {
      await api('me');
      unlock();
    } catch (e) {
      // Hors ligne ou serveur momentanément injoignable : la session enregistrée reste valable
      if (['network', 'no_server', 'bad_response'].includes(e.code) || e.status >= 500) return unlock();
      setSession(null);
      lock(authError(e));
    }
  }

  window.DLAuth = {
    whenReady(fn) { if (unlocked) fn(); else readyCallbacks.push(fn); },
    get session() { return session; },
  };
  document.body.classList.add('locked');
  boot();
})();
