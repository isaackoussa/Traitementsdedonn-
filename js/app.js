/* DataLab — interface utilisateur */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtInt = n => n.toLocaleString('fr-FR');
  const STORE_KEY = 'datalab:v1';
  const PREVIEW_ROWS = 5000;

  const S = {
    data: DT.ds([], []), name: '', datasets: {}, log: [], undo: [], redo: [],
    page: 0, pageSize: 100, search: '', sort: null, view: null,
    tool: null, result: null, sqlResult: null, tab: 'data', chart: null,
  };

  // ------------------------------------------------------------------ utilitaires UI
  let toastTimer;
  function toast(msg, ms = 3000) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  const status = msg => { $('#status').textContent = msg; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const typeCache = new WeakMap();
  function colTypes(d) {
    if (!typeCache.has(d)) {
      const sample = d.rows.length > 3000 ? d.rows.slice(0, 3000) : d.rows;
      typeCache.set(d, Object.fromEntries(d.columns.map(c => [c, DT.inferType(sample.map(r => r[c]))])));
    }
    return typeCache.get(d);
  }

  function cellHTML(v, extra = '') {
    if (DT.isMissing(v)) return `<td class="null"${extra}>∅</td>`;
    if (typeof v === 'boolean') return `<td${extra}>${v ? 'vrai' : 'faux'}</td>`;
    if (typeof v === 'number') return `<td class="num"${extra}>${esc(v)}</td>`;
    const s = String(v);
    return `<td${extra} title="${s.length > 40 ? esc(s.slice(0, 500)) : ''}">${esc(s)}</td>`;
  }
  /** Tableau HTML générique (aperçus, résultats, SQL). */
  function tableHTML(d, limit = 200) {
    if (!d.columns.length) return '<div class="empty-state">Aucune colonne.</div>';
    const types = colTypes(d);
    const rows = d.rows.slice(0, limit);
    return `<table class="grid"><thead><tr><th class="rownum">#</th>${d.columns.map(c => `<th title="${esc(c)}">${esc(c)}<span class="type t-${types[c]}">${types[c]}</span></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td class="rownum">${i + 1}</td>${d.columns.map(c => cellHTML(r[c])).join('')}</tr>`).join('')}</tbody></table>
      ${d.rows.length > limit ? `<p class="muted small" style="padding:6px 10px">… ${fmtInt(d.rows.length - limit)} lignes supplémentaires non affichées</p>` : ''}`;
  }

  function download(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /** Fenêtre modale : renvoie le <form> si OK, sinon null. */
  function modal(title, bodyHTML, okLabel = 'OK', onOpen) {
    const dlg = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modalOk').textContent = okLabel;
    $('#modalOk').hidden = !okLabel;
    return new Promise(resolve => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? $('#modalForm') : null), { once: true });
      dlg.returnValue = '';
      dlg.showModal();
      if (onOpen) onOpen($('#modalBody'));
      const first = $('#modalBody').querySelector('input, textarea, select');
      if (first) first.focus();
    });
  }
  async function ask(title, label, value = '') {
    const f = await modal(title, `<label class="field"><span>${esc(label)}</span><input name="v" value="${esc(value)}" required></label>`);
    return f ? f.elements.v.value.trim() : null;
  }

  // ------------------------------------------------------------------ état, historique, persistance
  function persistNow() {
    clearTimeout(persistTimer);
    try {
      const payload = JSON.stringify({ data: S.data, name: S.name, datasets: S.datasets, log: S.log.map(l => ({ ...l, time: +l.time })) });
      if (payload.length < 4.5e6) localStorage.setItem(STORE_KEY, payload);
      else { localStorage.removeItem(STORE_KEY); status('Données trop volumineuses pour la sauvegarde automatique.'); }
    } catch (e) { /* stockage indisponible : on continue sans sauvegarde */ }
  }
  let persistTimer;
  const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 800); };

  function restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.data || !Array.isArray(s.data.columns)) return false;
      S.data = s.data; S.name = s.name || ''; S.datasets = s.datasets || {};
      S.log = (s.log || []).map(l => ({ ...l, time: new Date(l.time) }));
      return true;
    } catch (e) { return false; }
  }

  function commit(data, label, step, name) {
    S.undo.push({ data: S.data, name: S.name, logLen: S.log.length });
    if (S.undo.length > 60) S.undo.shift();
    S.redo = [];
    S.data = data;
    if (name !== undefined) S.name = name;
    S.log.push({ label, step: step || null, time: new Date(), rows: data.rows.length, cols: data.columns.length });
    S.page = 0; S.view = null;
    if (S.sort && !data.columns.includes(S.sort.col)) S.sort = null;
    status(`${label} — ${fmtInt(data.rows.length)} lignes × ${data.columns.length} colonnes`);
    refresh();
  }
  function undo() {
    const u = S.undo.pop();
    if (!u) return toast('Rien à annuler.');
    S.redo.push({ data: S.data, name: S.name, entries: S.log.splice(u.logLen) });
    S.data = u.data; S.name = u.name; S.view = null;
    status('Annulé.'); refresh();
  }
  function redo() {
    const r = S.redo.pop();
    if (!r) return toast('Rien à rétablir.');
    S.undo.push({ data: S.data, name: S.name, logLen: S.log.length });
    S.data = r.data; S.name = r.name; S.log.push(...r.entries); S.view = null;
    status('Rétabli.'); refresh();
  }

  function refresh() {
    const d = S.data;
    $('#datasetName').textContent = S.name ? `— ${S.name}` : d.columns.length ? '' : '— aucun jeu de données';
    $('#dims').textContent = d.columns.length ? `${fmtInt(d.rows.length)} lignes × ${d.columns.length} colonnes` : '';
    $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
    renderTable();
    renderActiveTab();
    if (S.tool) { renderToolForm(); schedulePreview(); }
    persist();
  }

  // ------------------------------------------------------------------ import
  function autoType(d) {
    // convertit en nombres les colonnes numériques (sauf codes à zéro initial, ex. codes postaux)
    const types = colTypes(d);
    const numCols = d.columns.filter(c => types[c] === 'nombre' && !d.rows.some(r => typeof r[c] === 'string' && /^[-+]?0\d/.test(r[c].trim())));
    if (!numCols.length) return d;
    return DT.ds(d.columns, d.rows.map(r => {
      const o = { ...r };
      for (const c of numCols) if (typeof o[c] === 'string') { const n = DT.toNum(o[c]); o[c] = Number.isNaN(n) ? null : n; }
      return o;
    }));
  }
  function decode(buf) {
    const utf8 = new TextDecoder('utf-8').decode(buf);
    return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
  }
  function parseText(text, hasHeader = true, delimiter = '') {
    const t = text.replace(/^﻿/, '').trim();
    if (!t) throw new Error('Aucune donnée.');
    if (/^[[{]/.test(t)) {
      try { return DT.fromJSON(JSON.parse(t)); } catch (e) {
        const lines = t.split(/\r?\n/).filter(Boolean);
        try { return DT.fromJSON(lines.map(l => JSON.parse(l))); } catch (e2) { /* pas du JSON : on tente le CSV */ }
      }
    }
    need(window.Papa, 'La bibliothèque CSV n\'est pas chargée (connexion Internet requise).');
    const res = Papa.parse(t, { delimiter, skipEmptyLines: 'greedy' });
    if (!res.data.length) throw new Error('Impossible de lire les données.');
    return autoType(DT.fromMatrix(res.data, hasHeader));
  }
  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function sheetDates(d) {
    return DT.ds(d.columns, d.rows.map(r => {
      let o = r;
      for (const c of d.columns) if (r[c] instanceof Date) {
        const v = r[c];
        if (o === r) o = { ...r };
        const pad = n => String(n).padStart(2, '0');
        const day = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
        o[c] = v.getHours() || v.getMinutes() || v.getSeconds() ? `${day} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}` : day;
      }
      return o;
    }));
  }
  async function parseFile(name, buf) {
    const ext = name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
      need(window.XLSX, 'La bibliothèque Excel n\'est pas chargée (connexion Internet requise).');
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      return wb.SheetNames.map(sn => ({
        name: wb.SheetNames.length > 1 ? `${name.replace(/\.[^.]+$/, '')} — ${sn}` : name.replace(/\.[^.]+$/, ''),
        data: sheetDates(DT.fromMatrix(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null }))),
      })).filter(s => s.data.columns.length);
    }
    const text = decode(buf);
    return [{ name: name.replace(/\.[^.]+$/, ''), data: parseText(text, true, ext === 'tsv' ? '\t' : '') }];
  }
  function loadSheets(sheets) {
    if (!sheets.length) throw new Error('Aucune donnée trouvée.');
    const [first, ...rest] = sheets;
    for (const s of rest) S.datasets[uniqueDsName(s.name)] = s.data;
    S.sort = null; S.search = ''; $('#tableSearch').value = '';
    commit(first.data, `Import : ${first.name}`, null, first.name);
    setTab('data');
    if (rest.length) toast(`${rest.length} autre(s) feuille(s)/fichier(s) ajouté(s) aux jeux de données.`, 5000);
  }
  function uniqueDsName(n) { let name = n || 'jeu', i = 2; while (S.datasets[name]) name = `${n} (${i++})`; return name; }

  async function importFiles(files) {
    try {
      status('Lecture…');
      const sheets = [];
      for (const f of files) sheets.push(...await parseFile(f.name, await f.arrayBuffer()));
      loadSheets(sheets);
    } catch (e) { toast('Erreur d\'import : ' + e.message, 6000); status('Erreur d\'import.'); }
  }

  async function importPaste() {
    const f = await modal('Coller des données', `
      <p class="muted">Collez un tableau copié depuis Excel / Google Sheets, du CSV ou du JSON.</p>
      <textarea name="text" placeholder="nom;age;ville&#10;Alice;30;Paris"></textarea>
      <label class="field check"><input type="checkbox" name="header" checked><span>La première ligne contient les en-têtes</span></label>
      <label class="field"><span>Nom du jeu de données</span><input name="name" value="Données collées"></label>`, 'Importer');
    if (!f) return;
    try { loadSheets([{ name: f.elements.name.value || 'Données collées', data: parseText(f.elements.text.value, f.elements.header.checked) }]); }
    catch (e) { toast('Erreur : ' + e.message, 6000); }
  }
  async function importUrl() {
    const url = await ask('Charger depuis une URL', 'Adresse d\'un fichier CSV, JSON ou Excel (le serveur doit autoriser CORS)', 'https://');
    if (!url) return;
    try {
      status('Téléchargement…');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'donnees.csv');
      const ct = res.headers.get('content-type') || '';
      const fname = /\.\w+$/.test(name) ? name : name + (ct.includes('json') ? '.json' : '.csv');
      loadSheets(await parseFile(fname, await res.arrayBuffer()));
    } catch (e) { toast('Erreur : ' + e.message, 6000); status('Échec du téléchargement.'); }
  }
  function loadSample() {
    S.datasets[uniqueDsName('vendeurs')] = DT.sampleSellers();
    loadSheets([{ name: 'ventes (exemple)', data: DT.sampleSales() }]);
    toast('Exemple chargé : « ventes » (avec erreurs volontaires à nettoyer) + « vendeurs » dans les jeux de données.', 6000);
  }

  // ------------------------------------------------------------------ tableau principal
  function viewIndex() {
    const d = S.data;
    const key = `${S.search}\u0000${S.sort ? S.sort.col + S.sort.dir : ''}`;
    if (S.view && S.view.data === d && S.view.key === key) return S.view.idx;
    let idx = d.rows.map((_, i) => i);
    if (S.search) {
      const q = S.search.toLowerCase();
      idx = idx.filter(i => d.columns.some(c => { const v = d.rows[i][c]; return v !== null && v !== undefined && String(v).toLowerCase().includes(q); }));
    }
    if (S.sort) {
      const { col, dir } = S.sort;
      idx.sort((a, b) => {
        const va = d.rows[a][col], vb = d.rows[b][col];
        const ma = DT.isMissing(va), mb = DT.isMissing(vb);
        if (ma || mb) return ma === mb ? a - b : ma ? 1 : -1;
        return (dir === 'desc' ? -1 : 1) * DT.compareValues(va, vb) || a - b;
      });
    }
    S.view = { data: d, key, idx };
    return idx;
  }

  function renderTable() {
    const wrap = $('#tableWrap'), d = S.data;
    if (!d.columns.length) {
      wrap.innerHTML = `<div class="empty-state dropzone"><h2>Bienvenue dans DataLab 🧪</h2>
        <p>Importez un fichier <b>CSV, TSV, JSON, Excel ou ODS</b> (glisser-déposer accepté), collez des données, ou essayez l'exemple.</p>
        <div class="row"><button class="btn primary" data-act="open">📂 Ouvrir un fichier</button><button class="btn" data-act="paste">📋 Coller</button><button class="btn" data-act="sample">✨ Charger l'exemple</button></div>
        <p class="small">${DT.TOOLS.length} outils : nettoyage, colonnes, lignes, calculs, texte, dates, restructuration, analyse statistique, graphiques, SQL, export…<br>Tout est traité localement dans votre navigateur.</p></div>`;
      $('#tableInfo').textContent = ''; $('#pager').innerHTML = '';
      return;
    }
    const idx = viewIndex();
    const pages = Math.max(1, Math.ceil(idx.length / S.pageSize));
    S.page = Math.min(S.page, pages - 1);
    const start = S.page * S.pageSize;
    const slice = idx.slice(start, start + S.pageSize);
    const types = colTypes(d);
    const sortInd = c => (S.sort && S.sort.col === c ? `<span class="sort-ind">${S.sort.dir === 'asc' ? '▲' : '▼'}</span>` : '');
    wrap.innerHTML = `<table class="grid"><thead><tr><th class="rownum">#</th>${d.columns.map((c, j) =>
      `<th data-col="${j}" title="${esc(c)} — cliquer pour les actions">${esc(c)}${sortInd(c)}<span class="type t-${types[c]}">${types[c]}</span></th>`).join('')}</tr></thead>
      <tbody>${slice.map(i => `<tr><td class="rownum">${i + 1}</td>${d.columns.map((c, j) => cellHTML(d.rows[i][c], ` data-r="${i}" data-c="${j}"`)).join('')}</tr>`).join('')}</tbody></table>
      ${!slice.length ? '<div class="empty-state">Aucune ligne ne correspond.</div>' : ''}`;
    $('#tableInfo').textContent = S.search ? `${fmtInt(idx.length)} ligne(s) trouvée(s) sur ${fmtInt(d.rows.length)}` : 'Double-cliquez une cellule pour la modifier';
    $('#pager').innerHTML = pages > 1 ? `<button class="btn small" data-page="0" ${S.page === 0 ? 'disabled' : ''}>«</button>
      <button class="btn small" data-page="${S.page - 1}" ${S.page === 0 ? 'disabled' : ''}>‹</button>
      <span class="muted">Page ${S.page + 1} / ${pages} (lignes ${fmtInt(start + 1)}–${fmtInt(Math.min(start + S.pageSize, idx.length))})</span>
      <button class="btn small" data-page="${S.page + 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>›</button>
      <button class="btn small" data-page="${pages - 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>»</button>` : '';
  }

  function parseCellInput(s, old) {
    if (s === '') return null;
    if (typeof old === 'boolean') { const b = DT.toBool(s); if (b !== null) return b; }
    if (/^[-+]?\d+([.,]\d+)?$/.test(s.trim()) && !/^[-+]?0\d/.test(s.trim())) return DT.toNum(s);
    return s;
  }
  function editCell(td) {
    const i = +td.dataset.r, c = S.data.columns[+td.dataset.c];
    const old = S.data.rows[i][c];
    const input = document.createElement('input');
    input.value = DT.isMissing(old) ? '' : String(old);
    td.classList.add('editing'); td.textContent = ''; td.appendChild(input); input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      const v = parseCellInput(input.value, old);
      if (!save || v === old || (DT.isMissing(v) && DT.isMissing(old))) { renderTable(); return; }
      const rows = S.data.rows.slice();
      rows[i] = { ...rows[i], [c]: v };
      commit(DT.ds(S.data.columns.slice(), rows), `Modification de la cellule ${c} (ligne ${i + 1})`);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  }

  // menu contextuel des colonnes
  function showColumnMenu(col, x, y) {
    const items = [
      ['▲ Trier la vue (croissant)', () => { S.sort = { col, dir: 'asc' }; renderTable(); }],
      ['▼ Trier la vue (décroissant)', () => { S.sort = { col, dir: 'desc' }; renderTable(); }],
      S.sort ? ['✕ Annuler le tri de la vue', () => { S.sort = null; renderTable(); }] : null,
      ['⇅ Appliquer le tri aux données', () => applyTool('sort', { c1: col, d1: S.sort && S.sort.col === col ? S.sort.dir : 'asc' })],
      '-',
      ['🔍 Filtrer…', () => openTool('filter', { column: col })],
      ['✎ Renommer…', async () => { const n = await ask('Renommer la colonne', 'Nouveau nom', col); if (n) applyTool('rename', { column: col, name: n }); }],
      ['⧉ Dupliquer', () => applyTool('duplicateCol', { column: col })],
      ['🗑 Supprimer', () => applyTool('deleteCols', { columns: [col] })],
      '-',
      ['🔢 Convertir en nombre', () => applyTool('convert', { columns: [col], type: 'number' })],
      ['🔤 Convertir en texte', () => applyTool('convert', { columns: [col], type: 'text' })],
      ['📅 Convertir en date', () => applyTool('convert', { columns: [col], type: 'date' })],
      ['🧹 Supprimer les espaces', () => applyTool('trim', { columns: [col], inner: true })],
      ['🩹 Remplir les vides…', () => openTool('fillMissing', { columns: [col] })],
      '-',
      ['📊 Fréquences', () => applyTool('valueCounts', { column: col })],
      ['📈 Graphique', () => { setTab('chart'); $('#chartX').value = col; drawChart(); }],
      ['ℹ️ Profil de la colonne', () => { setTab('profile'); setTimeout(() => { const el = document.querySelector(`.card[data-col="${CSS.escape(col)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 50); }],
    ].filter(Boolean);
    const menu = $('#ctxMenu');
    menu.innerHTML = items.map((it, k) => (it === '-' ? '<hr>' : `<button data-k="${k}">${esc(it[0])}</button>`)).join('');
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 8)) + 'px';
    menu.onclick = e => { const b = e.target.closest('button'); if (!b) return; menu.hidden = true; items[+b.dataset.k][1](); };
  }

  // ------------------------------------------------------------------ outils : barre latérale
  const openCats = new Set(['Nettoyage']);
  function renderToolList() {
    const q = DT.removeAccents($('#toolSearch').value.trim().toLowerCase());
    const match = t => !q || DT.removeAccents(`${t.name} ${t.desc} ${t.cat}`.toLowerCase()).includes(q);
    $('#toolList').innerHTML = DT.CATEGORIES.map(c => {
      const tools = DT.TOOLS.filter(t => t.cat === c.name && match(t));
      if (!tools.length) return '';
      return `<details class="cat" data-cat="${esc(c.name)}" ${q || openCats.has(c.name) ? 'open' : ''}><summary>${c.icon} ${esc(c.name)} <span class="count">${tools.length}</span></summary>
        ${tools.map(t => `<button class="tool-btn ${S.tool && S.tool.def.id === t.id ? 'active' : ''}" data-tool="${t.id}" title="${esc(t.desc)}">${esc(t.name)}</button>`).join('')}</details>`;
    }).join('') || '<p class="muted" style="padding:10px">Aucun outil trouvé.</p>';
  }

  // ------------------------------------------------------------------ outils : formulaire et aperçu
  function defaultValue(def) {
    if (def.default !== undefined) return Array.isArray(def.default) ? def.default.slice() : def.default;
    if (def.type === 'columns' || def.type === 'multiselect') return [];
    if (def.type === 'column') return def.optional ? '' : S.data.columns[0] || '';
    if (def.type === 'dataset') return Object.keys(S.datasets)[0] || '';
    return '';
  }
  function openTool(id, preset = {}) {
    const def = DT.toolById[id];
    if (!def) return;
    const params = {};
    for (const p of def.params) params[p.name] = preset[p.name] !== undefined ? preset[p.name] : defaultValue(p);
    S.tool = { def, params };
    $('#toolTitle').textContent = def.name;
    $('#toolDesc').textContent = def.desc;
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    $('#sidebar').classList.remove('open');
    renderToolForm(); renderToolList(); schedulePreview(true);
  }
  function closeTool() {
    S.tool = null;
    $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
    renderToolList();
  }

  function fieldHTML(def, value) {
    const cols = S.data.columns;
    const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
    const multi = (options, selected) => `<div class="multi-actions"><a data-all="1">Tout</a><a data-all="0">Aucun</a></div>
      <div class="multi" data-param="${def.name}" data-kind="multi">${options.map(([v, l]) =>
        `<label><input type="checkbox" value="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}>${esc(l)}</label>`).join('') || '<span class="muted small">Aucune option</span>'}</div>`;
    const label = `<span>${esc(def.label)}</span>`;
    switch (def.type) {
      case 'column': {
        const types = colTypes(S.data);
        return `<label class="field">${label}<select data-param="${def.name}">${def.optional ? opt('', '(aucune)', !value) : ''}${cols.map(c => opt(c, `${c}  · ${types[c]}`, c === value)).join('')}</select></label>`;
      }
      case 'columns': return `<div class="field">${label}${multi(cols.map(c => [c, c]), value || [])}</div>`;
      case 'multiselect': return `<div class="field">${label}${multi(def.options, value || [])}</div>`;
      case 'select': return `<label class="field">${label}<select data-param="${def.name}">${def.options.map(([v, l]) => opt(v, l, v === value)).join('')}</select></label>`;
      case 'checkbox': return `<label class="field check"><input type="checkbox" data-param="${def.name}" ${value ? 'checked' : ''}>${label}</label>`;
      case 'number': return `<label class="field">${label}<input type="number" step="any" data-param="${def.name}" value="${esc(value)}"></label>`;
      case 'textarea': return `<label class="field">${label}<textarea rows="3" class="mono" data-param="${def.name}" spellcheck="false">${esc(value)}</textarea></label>`;
      case 'dataset': {
        const names = Object.keys(S.datasets);
        return `<label class="field">${label}<select data-param="${def.name}">${names.map(n => opt(n, n, n === value)).join('') || opt('', '(aucun — enregistrez un jeu d\'abord)', true)}</select></label>`;
      }
      case 'datasetColumn': {
        const o = S.datasets[S.tool.params[def.of]];
        const oc = o ? o.columns : [];
        return `<label class="field">${label}<select data-param="${def.name}">${oc.map(c => opt(c, c, c === value)).join('')}</select></label>`;
      }
      default: return `<label class="field">${label}<input type="text" data-param="${def.name}" value="${esc(value)}"></label>`;
    }
  }
  function renderToolForm() {
    const { def, params } = S.tool;
    // valeurs cohérentes avec les colonnes actuelles
    for (const p of def.params) {
      if (p.type === 'column' && params[p.name] && !S.data.columns.includes(params[p.name])) params[p.name] = p.optional ? '' : S.data.columns[0] || '';
      if (p.type === 'column' && !p.optional && !params[p.name]) params[p.name] = S.data.columns[0] || '';
      if (p.type === 'columns') params[p.name] = (params[p.name] || []).filter(c => S.data.columns.includes(c));
      if (p.type === 'datasetColumn') {
        const o = S.datasets[params[p.of]];
        if (o && !o.columns.includes(params[p.name])) {
          const lk = def.params.find(x => x.type === 'column');
          params[p.name] = lk && o.columns.includes(params[lk.name]) ? params[lk.name] : o.columns[0];
        }
      }
    }
    $('#toolForm').innerHTML = def.params.length ? def.params.map(p => `<div class="fwrap" data-for="${p.name}" ${p.when && !p.when(params) ? 'hidden' : ''}>${fieldHTML(p, params[p.name])}</div>`).join('')
      : '<p class="muted">Cet outil n\'a pas de paramètre.</p>';
  }
  function readParams() {
    const { def, params } = S.tool;
    for (const p of def.params) {
      const el = $('#toolForm').querySelector(`[data-param="${p.name}"]`);
      if (!el) continue;
      if (el.dataset.kind === 'multi') params[p.name] = [...el.querySelectorAll('input:checked')].map(i => i.value);
      else if (p.type === 'checkbox') params[p.name] = el.checked;
      else if (p.type === 'number') params[p.name] = el.value === '' ? '' : Number(el.value);
      else params[p.name] = el.value;
    }
    return params;
  }
  function updateVisibility() {
    const { def, params } = S.tool;
    for (const p of def.params) if (p.when) { const w = $('#toolForm').querySelector(`[data-for="${p.name}"]`); if (w) w.hidden = !p.when(params); }
  }

  let previewTimer;
  function schedulePreview(now) {
    clearTimeout(previewTimer);
    if (!S.tool) return;
    if (!$('#livePreview').checked && !now) return;
    previewTimer = setTimeout(renderPreview, now ? 0 : 250);
  }
  function renderPreview() {
    if (!S.tool) return;
    const err = $('#toolError'), prev = $('#toolPreview');
    err.hidden = true;
    if (!S.data.columns.length) { prev.innerHTML = '<p class="muted">Chargez des données pour utiliser les outils.</p>'; return; }
    const d = S.data;
    const partial = d.rows.length > PREVIEW_ROWS && !['groupBy', 'pivot', 'describe', 'correlation', 'valueCounts', 'crosstab'].includes(S.tool.def.id);
    const src = partial ? DT.ds(d.columns, d.rows.slice(0, PREVIEW_ROWS)) : d;
    try {
      const out = DT.runTool(S.tool.def.id, src, S.tool.params, { datasets: S.datasets });
      const res = out.result ? out.data : out;
      const added = res.columns.filter(c => !d.columns.includes(c)), removed = d.columns.filter(c => !res.columns.includes(c));
      const info = out.result ? `Résultat : ${fmtInt(res.rows.length)} lignes × ${res.columns.length} colonnes (affiché dans l'onglet Résultat)`
        : `${partial ? `Aperçu sur les ${fmtInt(PREVIEW_ROWS)} premières lignes · ` : ''}${fmtInt(src.rows.length)} → ${fmtInt(res.rows.length)} lignes · ${d.columns.length} → ${res.columns.length} colonnes`
          + (added.length ? `<br>➕ ${added.map(esc).join(', ')}` : '') + (removed.length ? `<br>➖ ${removed.map(esc).join(', ')}` : '');
      prev.innerHTML = `<h4>Aperçu</h4><p class="muted">${info}${out.result ? `<br><b>${esc(out.title)}</b>` : ''}</p><div class="table-wrap">${tableHTML(res, 15)}</div>`;
    } catch (e) {
      const hint = /^(Choisissez|Saisissez|Indiquez)/.test(e.message);
      err.textContent = (hint ? 'ℹ️ ' : '⚠️ ') + e.message; err.classList.toggle('hint', hint); err.hidden = false; prev.innerHTML = '';
    }
  }

  function stepLabel(def, p) {
    const bits = [];
    for (const x of def.params) {
      const v = p[x.name];
      if ((x.type === 'column' && v) || (x.type === 'columns' && v && v.length)) bits.push(Array.isArray(v) ? v.slice(0, 4).join(', ') + (v.length > 4 ? '…' : '') : v);
    }
    return def.name + (bits.length ? ` (${bits.join(' · ')})` : '');
  }
  function applyTool(id, params) {
    const def = DT.toolById[id];
    try {
      const out = DT.runTool(id, S.data, params, { datasets: S.datasets });
      if (out.result) { showResult(out.title, out.data); return true; }
      commit(out, stepLabel(def, params), { tool: id, params: JSON.parse(JSON.stringify(params)) });
      toast(`✓ ${def.name}`);
      return true;
    } catch (e) { toast('⚠️ ' + e.message, 5000); return false; }
  }

  // ------------------------------------------------------------------ onglets
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    if (tab === 'result') $('#resultBadge').hidden = true;
    renderActiveTab();
  }
  function renderActiveTab() {
    if (S.tab === 'profile') renderProfile();
    else if (S.tab === 'chart') renderChartControls();
    else if (S.tab === 'datasets') renderDatasets();
    else if (S.tab === 'history') renderHistory();
    else if (S.tab === 'sql') renderSqlExamples();
  }

  // ---- résultat
  function showResult(title, data) {
    S.result = { title, data };
    $('#resultTitle').textContent = title;
    $('#resultTable').innerHTML = tableHTML(data, 1000);
    $('#resultActions').hidden = false;
    if (S.tab !== 'result') { setTab('result'); }
    status(`${title} — ${fmtInt(data.rows.length)} lignes`);
  }

  // ---- profil
  function histSVG(vals, bins = 20) {
    if (!vals.length) return '';
    let min = vals[0], max = vals[0];
    for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
    const k = min === max ? 1 : bins, counts = new Array(k).fill(0);
    for (const v of vals) counts[min === max ? 0 : Math.min(k - 1, Math.floor(((v - min) / (max - min)) * k))]++;
    const top = Math.max(...counts), w = 240 / k;
    return `<svg class="hist" viewBox="0 0 240 60" width="100%" height="60" role="img" aria-label="Histogramme">${counts.map((c, i) =>
      `<rect x="${i * w + 0.5}" y="${60 - (c / top) * 58}" width="${Math.max(1, w - 1)}" height="${(c / top) * 58}"><title>${DT.round(min + (i * (max - min)) / k, 3)} – ${DT.round(min + ((i + 1) * (max - min)) / k, 3)} : ${c}</title></rect>`).join('')}</svg>
      <div class="muted small" style="display:flex;justify-content:space-between"><span>${DT.round(min, 3)}</span><span>${DT.round(max, 3)}</span></div>`;
  }
  function renderProfile() {
    const d = S.data, el = $('#profile');
    if (!d.columns.length) { el.innerHTML = '<div class="empty-state">Chargez des données pour voir leur profil.</div>'; return; }
    const types = colTypes(d), n = d.rows.length;
    const nf = x => (Number.isFinite(x) ? DT.round(x, 4).toLocaleString('fr-FR') : '—');
    const cols = d.columns.slice(0, 80);
    el.innerHTML = cols.map(c => {
      const vals = d.rows.map(r => r[c]);
      const miss = vals.filter(DT.isMissing).length;
      const vc = DT.valueCounts(vals);
      const t = types[c];
      let body = '';
      if (t === 'nombre') {
        const nums = DT.numericValues(d.rows, c), s = DT.describeNums(nums);
        body = `<dl><dt>Moyenne</dt><dd>${nf(s.mean)}</dd><dt>Écart-type</dt><dd>${nf(s.std)}</dd><dt>Min</dt><dd>${nf(s.min)}</dd><dt>Q1</dt><dd>${nf(s.q1)}</dd>
          <dt>Médiane</dt><dd>${nf(s.median)}</dd><dt>Q3</dt><dd>${nf(s.q3)}</dd><dt>Max</dt><dd>${nf(s.max)}</dd><dt>Somme</dt><dd>${nf(s.sum)}</dd></dl>${histSVG(nums)}`;
      } else {
        const top = vc.slice(0, 6), max = top.length ? top[0][1] : 1;
        const lens = vals.filter(v => !DT.isMissing(v)).map(v => String(v).length);
        body = `<dl><dt>Longueur min / max</dt><dd>${lens.length ? Math.min(...lens) + ' / ' + Math.max(...lens) : '—'}</dd></dl>
          ${top.map(([v, k]) => `<div class="bar-row"><span class="lbl" title="${esc(v)}"><i style="width:${(k / max) * 100}%"></i><span>${esc(v)}</span></span><b>${fmtInt(k)}</b></div>`).join('')}`;
      }
      const fill = n ? ((n - miss) / n) * 100 : 0;
      return `<div class="card" data-col="${esc(c)}"><h4 title="${esc(c)}">${esc(c)}</h4><span class="small t-${t}">${t.toUpperCase()}</span>
        <div class="meter" title="Taux de remplissage"><i style="width:${fill}%"></i></div>
        <dl><dt>Remplies</dt><dd>${fmtInt(n - miss)} (${DT.round(fill, 1)} %)</dd><dt>Manquantes</dt><dd>${fmtInt(miss)}</dd><dt>Distinctes</dt><dd>${fmtInt(vc.length)}</dd></dl>${body}</div>`;
    }).join('') + (d.columns.length > 80 ? `<p class="muted">… ${d.columns.length - 80} colonnes non affichées.</p>` : '');
  }

  // ---- graphiques
  const PALETTE = ['#3b5bdb', '#e8590c', '#2b8a3e', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#5c940d', '#862e9c', '#1971c2', '#d6336c', '#495057'];
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
  function renderChartControls() {
    const d = S.data, types = colTypes(d);
    const xSel = $('#chartX'), prevX = xSel.value;
    xSel.innerHTML = d.columns.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (d.columns.includes(prevX)) xSel.value = prevX;
    const checked = new Set([...document.querySelectorAll('#chartY input:checked')].map(i => i.value));
    const nums = d.columns.filter(c => types[c] === 'nombre');
    if (!checked.size && nums.length) checked.add(nums.find(c => !/(^id|id$|^id_|_id)/i.test(c)) || nums[0]);
    $('#chartY').innerHTML = [...nums, ...d.columns.filter(c => types[c] !== 'nombre')].map(c =>
      `<label><input type="checkbox" value="${esc(c)}" ${checked.has(c) ? 'checked' : ''}> ${esc(c)} <span class="small t-${types[c]}">${types[c]}</span></label>`).join('');
    if (!S.chart && d.columns.length) drawChart();
  }
  function drawChart() {
    const d = S.data, msg = $('#chartMsg');
    msg.textContent = '';
    if (!window.Chart) { msg.textContent = 'Chart.js n\'est pas chargé (connexion Internet requise).'; return; }
    if (S.chart) { S.chart.destroy(); S.chart = null; }
    if (!d.columns.length) return;
    const type = $('#chartType').value, x = $('#chartX').value, agg = $('#chartAgg').value, sort = $('#chartSort').value;
    const limit = Math.max(1, +$('#chartLimit').value || 30), bins = Math.max(2, +$('#chartBins').value || 15);
    const ys = [...document.querySelectorAll('#chartY input:checked')].map(i => i.value);
    const css = getComputedStyle(document.documentElement);
    Chart.defaults.color = css.getPropertyValue('--muted').trim();
    Chart.defaults.borderColor = css.getPropertyValue('--border').trim();
    Chart.defaults.font.family = css.getPropertyValue('--font').trim();
    let cfg;
    try {
      if (type === 'scatter') {
        need(ys.length, 'Choisissez au moins une colonne Y.');
        cfg = { type: 'scatter', data: { datasets: ys.map((y, k) => ({ label: `${y} selon ${x}`, backgroundColor: alpha(PALETTE[k % PALETTE.length], 0.6),
          data: d.rows.slice(0, 20000).map(r => ({ x: DT.toNum(r[x]), y: DT.toNum(r[y]) })).filter(p => !Number.isNaN(p.x) && !Number.isNaN(p.y)) })) },
          options: { scales: { x: { title: { display: true, text: x } }, y: { title: { display: true, text: ys.join(', ') } } } } };
      } else if (type === 'hist') {
        const col = ys[0] || x;
        const vals = DT.numericValues(d.rows, col);
        need(vals.length, `La colonne « ${col} » ne contient pas de nombres.`);
        let min = Infinity, max = -Infinity;
        for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
        const k = min === max ? 1 : bins, counts = new Array(k).fill(0);
        for (const v of vals) counts[min === max ? 0 : Math.min(k - 1, Math.floor(((v - min) / (max - min)) * k))]++;
        const labels = counts.map((_, i) => `${DT.round(min + (i * (max - min)) / k, 2)} – ${DT.round(min + ((i + 1) * (max - min)) / k, 2)}`);
        cfg = { type: 'bar', data: { labels, datasets: [{ label: `Effectif — ${col}`, data: counts, backgroundColor: alpha(PALETTE[0], 0.75), barPercentage: 1, categoryPercentage: 1 }] },
          options: { plugins: { legend: { display: false }, title: { display: true, text: `Distribution de ${col}` } } } };
      } else if (type === 'box') {
        need(ys.length, 'Choisissez au moins une colonne Y.');
        let groups;
        if (ys.length === 1 && x !== ys[0]) {
          const m = new Map();
          for (const r of d.rows) { const k = DT.isMissing(r[x]) ? '(vide)' : String(r[x]); const v = DT.toNum(r[ys[0]]); if (Number.isNaN(v)) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
          groups = [...m.entries()].sort((a, b) => DT.compareValues(a[0], b[0])).slice(0, limit);
        } else groups = ys.map(y => [y, DT.numericValues(d.rows, y)]);
        const stats = groups.map(([, v]) => {
          const s = DT.describeNums(v), iqr = s.q3 - s.q1;
          const lo = Math.max(s.min, s.q1 - 1.5 * iqr), hi = Math.min(s.max, s.q3 + 1.5 * iqr);
          return { ...s, lo, hi };
        });
        cfg = { type: 'bar', data: { labels: groups.map(g => g[0]), datasets: [
          { label: 'Moustaches (1,5 × IQR)', data: stats.map(s => [s.lo, s.hi]), backgroundColor: css.getPropertyValue('--muted').trim(), barPercentage: 0.04, grouped: false },
          { label: 'Q1 – Q3', data: stats.map(s => [s.q1, s.q3]), backgroundColor: alpha(PALETTE[0], 0.55), borderColor: PALETTE[0], borderWidth: 1, barPercentage: 0.5, grouped: false },
          { type: 'scatter', label: 'Médiane', data: stats.map((s, i) => ({ x: groups[i][0], y: s.median })), pointStyle: 'line', pointRadius: 18, borderWidth: 3, borderColor: PALETTE[1], backgroundColor: PALETTE[1] },
        ] }, options: { plugins: { tooltip: { callbacks: { label: c => { const s = stats[c.dataIndex]; return `min ${DT.round(s.min, 3)} · Q1 ${DT.round(s.q1, 3)} · méd. ${DT.round(s.median, 3)} · Q3 ${DT.round(s.q3, 3)} · max ${DT.round(s.max, 3)} (n=${s.count})`; } } } } } };
      } else {
        const useAgg = agg !== 'none';
        const series = useAgg && agg === 'count_all' && !ys.length ? ['__count'] : ys;
        need(series.length, 'Choisissez au moins une colonne Y (ou l\'agrégation « Nombre de lignes »).');
        let labels, values;
        if (useAgg) {
          const m = new Map();
          d.rows.forEach((r, i) => { const k = DT.isMissing(r[x]) ? '(vide)' : String(r[x]); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
          labels = [...m.keys()];
          values = series.map(y => labels.map(k => DT.aggregate(m.get(k).map(i => (y === '__count' ? 1 : d.rows[i][y])), agg)));
        } else {
          const rows = d.rows.slice(0, 5000);
          labels = rows.map(r => (DT.isMissing(r[x]) ? '(vide)' : String(r[x])));
          values = series.map(y => rows.map(r => { const n = DT.toNum(r[y]); return Number.isNaN(n) ? null : n; }));
        }
        let order = labels.map((_, i) => i);
        if (sort === 'x') order.sort((a, b) => DT.compareValues(labels[a], labels[b]));
        else if (sort !== 'none') order.sort((a, b) => (sort === 'desc' ? -1 : 1) * ((values[0][a] ?? -Infinity) - (values[0][b] ?? -Infinity)));
        const truncated = order.length > limit;
        order = order.slice(0, limit);
        labels = order.map(i => labels[i]); values = values.map(v => order.map(i => v[i]));
        const circ = ['pie', 'doughnut', 'polarArea'].includes(type);
        const aggLbl = { sum: 'somme', mean: 'moyenne', median: 'médiane', count_all: 'nombre', min: 'min', max: 'max', none: '' }[agg];
        const datasets = series.map((y, k) => {
          const color = PALETTE[k % PALETTE.length];
          return {
            label: y === '__count' ? 'Nombre de lignes' : `${y}${aggLbl ? ` (${aggLbl})` : ''}`, data: values[k],
            backgroundColor: circ ? labels.map((_, i) => PALETTE[i % PALETTE.length]) : type === 'area' || type === 'radar' ? alpha(color, 0.25) : type === 'line' ? color : alpha(color, 0.8),
            borderColor: circ ? css.getPropertyValue('--panel').trim() : color, borderWidth: type === 'line' || type === 'area' || type === 'radar' ? 2 : 1,
            fill: type === 'area' || type === 'radar', tension: 0.25, pointRadius: labels.length > 60 ? 0 : 3,
          };
        });
        const chartType = { barh: 'bar', stacked: 'bar', area: 'line' }[type] || type;
        cfg = { type: chartType, data: { labels, datasets: circ ? datasets.slice(0, 1) : datasets }, options: {
          indexAxis: type === 'barh' ? 'y' : 'x',
          scales: circ || type === 'radar' ? undefined : { x: { stacked: type === 'stacked', title: { display: true, text: type === 'barh' ? '' : x } }, y: { stacked: type === 'stacked', beginAtZero: true } },
          plugins: { title: { display: truncated, text: `${limit} premières catégories affichées` } },
        } };
      }
      cfg.options = { locale: 'fr-FR', responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, ...cfg.options };
      S.chart = new Chart($('#chartCanvas'), cfg);
    } catch (e) { msg.textContent = '⚠️ ' + e.message; }
  }
  function chartPng() {
    if (!S.chart) return toast('Tracez d\'abord un graphique.');
    const src = $('#chartCanvas'), c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    c.toBlob(b => download(b, `graphique_${$('#chartType').value}.png`, 'image/png'));
  }

  // ---- SQL
  const sqlName = n => n.replace(/[[\]]/g, '');
  function registerTables() {
    const reg = (name, d) => {
      const t = sqlName(name);
      alasql(`CREATE TABLE IF NOT EXISTS [${t}]`);
      alasql.tables[t].data = d.rows;
    };
    reg('data', S.data);
    for (const [n, d] of Object.entries(S.datasets)) reg(n, d);
  }
  function runSql() {
    if (!window.alasql) return toast('Le moteur SQL n\'est pas chargé (connexion Internet requise).');
    const q = $('#sqlInput').value.trim();
    if (!q) return;
    try {
      registerTables();
      const t0 = performance.now();
      let res = alasql(q);
      if (Array.isArray(res) && res.length && Array.isArray(res[0])) res = res[res.length - 1];
      if (!Array.isArray(res)) { $('#sqlResult').innerHTML = `<p style="padding:10px">Résultat : <b>${esc(JSON.stringify(res))}</b></p>`; $('#sqlActions').hidden = true; return; }
      const d = DT.fromRecords(res.map(r => (r && typeof r === 'object' ? r : { valeur: r })));
      S.sqlResult = d;
      $('#sqlResult').innerHTML = tableHTML(d, 1000);
      $('#sqlInfo').textContent = `${fmtInt(d.rows.length)} ligne(s) en ${Math.round(performance.now() - t0)} ms`;
      $('#sqlActions').hidden = false;
    } catch (e) {
      $('#sqlResult').innerHTML = `<div class="error" style="margin:10px">${esc(e.message)}</div>`;
      $('#sqlActions').hidden = true;
    }
  }
  function renderSqlExamples() {
    const d = S.data, types = colTypes(d);
    const q = c => `[${c}]`;
    const nums = d.columns.filter(c => types[c] === 'nombre');
    const num = nums.find(c => !/(^id|id$|^id_|_id)/i.test(c)) || nums[0], cat = d.columns.find(c => types[c] === 'texte');
    const ex = [['Aperçu', 'SELECT * FROM data LIMIT 20'], ['Nombre de lignes', 'SELECT COUNT(*) AS nb FROM data']];
    if (cat) ex.push([`Comptage par ${cat}`, `SELECT ${q(cat)}, COUNT(*) AS nb\nFROM data\nGROUP BY ${q(cat)}\nORDER BY nb DESC`]);
    if (cat && num) ex.push([`Stats de ${num} par ${cat}`, `SELECT ${q(cat)}, COUNT(*) AS nb, SUM(${q(num)}) AS somme, AVG(${q(num)}) AS moyenne, MIN(${q(num)}) AS mini, MAX(${q(num)}) AS maxi\nFROM data\nGROUP BY ${q(cat)}\nORDER BY somme DESC`]);
    if (num) ex.push([`Top 10 par ${num}`, `SELECT * FROM data\nWHERE ${q(num)} IS NOT NULL\nORDER BY ${q(num)} DESC\nLIMIT 10`]);
    if (cat) ex.push(['Valeurs distinctes', `SELECT DISTINCT ${q(cat)} FROM data ORDER BY ${q(cat)}`]);
    const other = Object.keys(S.datasets)[0];
    if (other) {
      const shared = d.columns.find(c => S.datasets[other].columns.includes(c));
      if (shared) ex.push([`Jointure avec « ${other} »`, `SELECT d.*, o.*\nFROM data AS d\nLEFT JOIN [${sqlName(other)}] AS o ON d.${q(shared)} = o.${q(shared)}`]);
    }
    $('#sqlExamples').innerHTML = '<option value="">Exemples…</option>' + ex.map(([l, s]) => `<option value="${esc(s)}">${esc(l)}</option>`).join('');
  }

  // ---- jeux de données
  function renderDatasets() {
    const names = Object.keys(S.datasets);
    $('#datasetList').innerHTML = names.length ? names.map(n => {
      const d = S.datasets[n];
      return `<div class="ds-item" data-ds="${esc(n)}"><strong>${esc(n)}</strong><span class="muted">${fmtInt(d.rows.length)} lignes × ${d.columns.length} colonnes</span>
        <button class="btn small" data-dsact="load">Ouvrir</button><button class="btn small" data-dsact="join">Joindre…</button><button class="btn small" data-dsact="append">Empiler</button>
        <button class="btn small" data-dsact="rename">Renommer</button><button class="btn small" data-dsact="export">Exporter</button><button class="btn small danger" data-dsact="delete">Supprimer</button></div>`;
    }).join('') : '<div class="empty-state">Aucun jeu enregistré. Enregistrez le jeu actuel (ou importez plusieurs fichiers / feuilles) pour faire des jointures et des unions.</div>';
  }
  async function saveAsDataset(data = S.data, suggested = S.name || 'jeu') {
    if (!data.columns.length) return toast('Aucune donnée à enregistrer.');
    const n = await ask('Enregistrer comme jeu de données', 'Nom', uniqueDsName(suggested));
    if (!n) return;
    if (S.datasets[n] && !confirm(`Remplacer le jeu « ${n} » ?`)) return;
    S.datasets[n] = data;
    persist(); renderDatasets();
    toast(`Jeu « ${n} » enregistré.`);
  }
  async function datasetAction(name, act) {
    const d = S.datasets[name];
    if (act === 'load') { commit(d, `Ouverture du jeu « ${name} »`, null, name); setTab('data'); }
    else if (act === 'join') openTool('join', { other: name });
    else if (act === 'append') openTool('append', { other: name });
    else if (act === 'export') openExport(d, name);
    else if (act === 'delete') { if (confirm(`Supprimer le jeu « ${name} » ?`)) { delete S.datasets[name]; persist(); renderDatasets(); } }
    else if (act === 'rename') {
      const n = await ask('Renommer le jeu', 'Nouveau nom', name);
      if (!n || n === name) return;
      if (S.datasets[n]) return toast('Ce nom existe déjà.');
      S.datasets = Object.fromEntries(Object.entries(S.datasets).map(([k, v]) => [k === name ? n : k, v]));
      persist(); renderDatasets();
    }
  }

  // ---- historique et recettes
  function renderHistory() {
    $('#historyList').innerHTML = S.log.length ? S.log.map(l => `<li>${esc(l.label)}<span class="muted">${l.time.toLocaleTimeString('fr-FR')} · ${fmtInt(l.rows)} × ${l.cols}${l.step ? ' · rejouable' : ''}</span></li>`).join('')
      : '<p class="muted">Aucune opération pour le moment.</p>';
  }
  function exportRecipe() {
    const steps = S.log.filter(l => l.step).map(l => ({ label: l.label, ...l.step }));
    if (!steps.length) return toast('Aucune étape rejouable (appliquez des outils d\'abord).');
    download(JSON.stringify({ app: 'DataLab', version: 1, steps }, null, 2), 'recette_datalab.json', 'application/json');
  }
  async function replayRecipe(file) {
    try {
      const r = JSON.parse(await file.text());
      const steps = r.steps || r;
      need(Array.isArray(steps), 'Recette invalide.');
      let n = 0;
      for (const s of steps) {
        need(DT.toolById[s.tool], `Outil inconnu : ${s.tool}`);
        const out = DT.runTool(s.tool, S.data, s.params, { datasets: S.datasets });
        if (out.result) { showResult(out.title, out.data); continue; }
        commit(out, `Recette : ${s.label || DT.toolById[s.tool].name}`, { tool: s.tool, params: s.params });
        n++;
      }
      toast(`Recette rejouée : ${n} étape(s).`);
    } catch (e) { toast('Erreur de recette : ' + e.message, 6000); }
  }

  // ------------------------------------------------------------------ export
  const FORMATS = [
    ['csv', 'CSV (virgule)'], ['csvfr', 'CSV Excel français (point-virgule, décimales à virgule)'], ['tsv', 'TSV (tabulation)'], ['xlsx', 'Excel (.xlsx)'],
    ['ods', 'OpenDocument (.ods)'], ['json', 'JSON'], ['jsonl', 'JSON Lines'], ['sql', 'SQL (CREATE + INSERT)'], ['md', 'Markdown'], ['html', 'Tableau HTML'], ['xml', 'XML'],
  ];
  function serialize(d, fmt, name) {
    switch (fmt) {
      case 'csv': return ['﻿' + DT.toCSV(d, ','), 'csv', 'text/csv'];
      case 'csvfr': return ['﻿' + DT.toCSV(d, ';', true, true), 'csv', 'text/csv'];
      case 'tsv': return [DT.toCSV(d, '\t'), 'tsv', 'text/tab-separated-values'];
      case 'json': return [DT.toJSONText(d), 'json', 'application/json'];
      case 'jsonl': return [d.rows.map(r => JSON.stringify(Object.fromEntries(d.columns.map(c => [c, r[c] ?? null])))).join('\n'), 'jsonl', 'application/x-ndjson'];
      case 'sql': return [DT.toSQL(d, DT.toSnake(name || 'donnees')), 'sql', 'application/sql'];
      case 'md': return [DT.toMarkdown(d), 'md', 'text/markdown'];
      case 'html': return [DT.toHTML(d), 'html', 'text/html'];
      case 'xml': return [DT.toXML(d), 'xml', 'application/xml'];
      default: return null;
    }
  }
  async function openExport(d = S.data, name = S.name || 'donnees') {
    if (!d.columns.length) return toast('Aucune donnée à exporter.');
    const f = await modal('Exporter', `
      <label class="field"><span>Format</span><select name="fmt">${FORMATS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Nom du fichier (sans extension)</span><input name="file" value="${esc(DT.toSnake(name))}"></label>
      <p class="muted small">${fmtInt(d.rows.length)} lignes × ${d.columns.length} colonnes</p>
      <button type="button" class="btn" id="btnCopy">📋 Copier dans le presse-papiers</button>`, 'Télécharger', body => {
      body.querySelector('#btnCopy').onclick = async () => {
        const fmt = body.querySelector('[name=fmt]').value;
        const s = serialize(d, ['xlsx', 'ods'].includes(fmt) ? 'tsv' : fmt, name);
        try { await navigator.clipboard.writeText(s[0].replace(/^﻿/, '')); toast('Copié ✓ (collable dans Excel en TSV pour les formats tableur)'); }
        catch (e) { toast('Copie impossible : ' + e.message); }
      };
    });
    if (!f) return;
    const fmt = f.elements.fmt.value, file = f.elements.file.value || 'donnees';
    if (fmt === 'xlsx' || fmt === 'ods') {
      if (!window.XLSX) return toast('La bibliothèque Excel n\'est pas chargée.');
      const ws = XLSX.utils.json_to_sheet(d.rows.map(r => Object.fromEntries(d.columns.map(c => [c, r[c] ?? null]))), { header: d.columns });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (name || 'Données').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Données');
      XLSX.writeFile(wb, `${file}.${fmt}`, { bookType: fmt });
    } else {
      const [content, ext, mime] = serialize(d, fmt, name);
      download(content, `${file}.${ext}`, mime + ';charset=utf-8');
    }
    toast('Export lancé ✓');
  }

  // ------------------------------------------------------------------ événements
  function bind() {
    $('#fileInput').addEventListener('change', e => { if (e.target.files.length) importFiles([...e.target.files]); e.target.value = ''; });
    $('#btnPaste').onclick = importPaste;
    $('#btnUrl').onclick = importUrl;
    $('#btnSample').onclick = loadSample;
    $('#btnUndo').onclick = undo; $('#btnHistUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnExport').onclick = () => openExport();
    $('#btnMenu').onclick = () => $('#sidebar').classList.toggle('open');
    $('#btnTheme').onclick = () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('datalab:theme', next); } catch (e) { /* ignoré */ }
      if (S.tab === 'chart') drawChart();
    };

    // glisser-déposer
    let dragDepth = 0;
    addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('drag'); $('#tableWrap').classList.add('dropzone', 'drag'); });
    addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#tableWrap').classList.remove('drag'); } });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#tableWrap').classList.remove('drag'); if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });

    // tableau
    $('#tableWrap').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) { ({ open: () => $('#fileInput').click(), paste: importPaste, sample: loadSample })[act.dataset.act](); return; }
      const th = e.target.closest('th[data-col]');
      if (th) { const r = th.getBoundingClientRect(); showColumnMenu(S.data.columns[+th.dataset.col], r.left, r.bottom + 2); }
    });
    $('#tableWrap').addEventListener('contextmenu', e => {
      const th = e.target.closest('th[data-col]');
      if (th) { e.preventDefault(); showColumnMenu(S.data.columns[+th.dataset.col], e.clientX, e.clientY); }
    });
    $('#tableWrap').addEventListener('dblclick', e => { const td = e.target.closest('td[data-r]'); if (td && !td.classList.contains('editing')) editCell(td); });
    $('#pager').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) { S.page = +b.dataset.page; renderTable(); $('#tableWrap').scrollTop = 0; } });
    $('#tableSearch').addEventListener('input', debounce(e => { S.search = e.target.value.trim(); S.page = 0; renderTable(); }, 200));
    $('#pageSize').onchange = e => { S.pageSize = +e.target.value; S.page = 0; renderTable(); };
    $('#btnAddRow').onclick = () => {
      if (!S.data.columns.length) return toast('Chargez d\'abord des données.');
      commit(DT.ds(S.data.columns.slice(), [...S.data.rows, Object.fromEntries(S.data.columns.map(c => [c, null]))]), 'Ajout d\'une ligne');
      S.search = ''; $('#tableSearch').value = ''; S.sort = null;
      S.page = Math.ceil(S.data.rows.length / S.pageSize) - 1; renderTable();
    };
    $('#btnSaveAs').onclick = () => saveAsDataset();
    document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu') && !e.target.closest('th[data-col]')) $('#ctxMenu').hidden = true; });

    // outils
    $('#toolSearch').addEventListener('input', renderToolList);
    $('#toolList').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) openTool(b.dataset.tool); });
    $('#toolList').addEventListener('toggle', e => {
      if (!e.target.dataset.cat || $('#toolSearch').value.trim()) return;
      if (e.target.open) openCats.add(e.target.dataset.cat); else openCats.delete(e.target.dataset.cat);
    }, true);
    $('#btnCloseTool').onclick = closeTool;
    $('#toolForm').addEventListener('click', e => {
      const a = e.target.closest('[data-all]');
      if (!a) return;
      a.parentElement.nextElementSibling.querySelectorAll('input').forEach(i => { i.checked = a.dataset.all === '1'; });
      readParams(); updateVisibility(); schedulePreview();
    });
    const onFormChange = e => {
      readParams(); updateVisibility();
      const el = e.target.closest('[data-param]');
      const def = el && S.tool.def.params.find(p => p.name === el.dataset.param);
      if (def && def.type === 'dataset') renderToolForm();
      schedulePreview();
    };
    $('#toolForm').addEventListener('input', onFormChange);
    $('#toolForm').addEventListener('change', onFormChange);
    $('#toolForm').addEventListener('submit', e => e.preventDefault());
    $('#livePreview').onchange = () => schedulePreview(true);
    $('#btnApply').onclick = () => { if (!S.tool) return; readParams(); applyTool(S.tool.def.id, S.tool.params); };

    // onglets
    $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

    // résultat
    $('#btnResultApply').onclick = () => { if (S.result) { commit(S.result.data, `Résultat : ${S.result.title}`); setTab('data'); } };
    $('#btnResultSave').onclick = () => S.result && saveAsDataset(S.result.data, S.result.title.split(' — ')[0]);
    $('#btnResultExport').onclick = () => S.result && openExport(S.result.data, S.result.title.split(' — ')[0]);

    // graphiques
    $('#btnChart').onclick = drawChart;
    $('#btnChartPng').onclick = chartPng;
    ['#chartType', '#chartX', '#chartAgg', '#chartSort', '#chartLimit', '#chartBins'].forEach(s => $(s).addEventListener('change', drawChart));
    $('#chartY').addEventListener('change', drawChart);

    // SQL
    $('#btnSql').onclick = runSql;
    $('#sqlInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
    $('#sqlExamples').onchange = e => { if (e.target.value) { $('#sqlInput').value = e.target.value; e.target.value = ''; runSql(); } };
    $('#btnSqlApply').onclick = () => { if (S.sqlResult) { commit(S.sqlResult, `Requête SQL : ${$('#sqlInput').value.trim().slice(0, 80)}`); setTab('data'); } };
    $('#btnSqlSave').onclick = () => S.sqlResult && saveAsDataset(S.sqlResult, 'requete');

    // jeux de données & historique
    $('#btnSaveCurrent').onclick = () => saveAsDataset();
    $('#datasetList').addEventListener('click', e => { const b = e.target.closest('[data-dsact]'); if (b) datasetAction(b.closest('[data-ds]').dataset.ds, b.dataset.dsact); });
    $('#btnExportRecipe').onclick = exportRecipe;
    $('#recipeInput').addEventListener('change', e => { if (e.target.files[0]) replayRecipe(e.target.files[0]); e.target.value = ''; });
    $('#btnReset').onclick = () => {
      if (!confirm('Effacer toutes les données, jeux enregistrés et l\'historique ?')) return;
      Object.assign(S, { data: DT.ds([], []), name: '', datasets: {}, log: [], undo: [], redo: [], result: null, sqlResult: null, sort: null, search: '', view: null });
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignoré */ }
      closeTool(); refresh(); setTab('data');
    };

    addEventListener('pagehide', persistNow);

    // clavier
    addEventListener('keydown', e => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && !inField && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && !inField && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape' && !$('#modal').open) { if (!$('#ctxMenu').hidden) $('#ctxMenu').hidden = true; else if (S.tool) closeTool(); }
    });
  }

  // ------------------------------------------------------------------ démarrage
  function init() {
    try { const t = localStorage.getItem('datalab:theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignoré */ }
    bind();
    renderToolList();
    if (restore()) status('Session précédente restaurée.');
    refresh();
  }
  init();
})();
