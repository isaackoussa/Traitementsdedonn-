/*
 * DataLab — moteur de traitement de données (sans dépendance, utilisable dans le navigateur et Node).
 * Un jeu de données est { columns: string[], rows: object[] }.
 * Les outils ne modifient jamais les lignes existantes : ils renvoient de nouveaux objets.
 */
(function (root, factory) {
  const DT = factory();
  if (typeof module === 'object' && module.exports) module.exports = DT;
  else root.DT = DT;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ utilitaires
  const isMissing = v =>
    v === null || v === undefined ||
    (typeof v === 'number' && Number.isNaN(v)) ||
    (typeof v === 'string' && v.trim() === '');

  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isMissing(v)) return NaN;
    let s = String(v).trim().replace(/[\s  ]/g, '').replace(/[€$£%]/g, '');
    if (/^[-+]?\d{1,3}((\.\d{3}){2,}(,\d+)?|(\.\d{3})+,\d+)$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^[-+]?\d*,\d+$/.test(s)) s = s.replace(',', '.');
    else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }
  const isNum = v => !Number.isNaN(toNum(v));

  function mkDate(y, mo, d, h, mi, se) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, +(h || 0), +(mi || 0), +(se || 0)));
    return dt.getUTCDate() === d ? dt : null;
  }

  function toDate(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (isMissing(v)) return null;
    if (typeof v === 'number') {
      // numéro de série Excel plausible (1954 → 2119)
      if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return mkDate(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y < 50 ? 2000 : 1900;
      return mkDate(y, +m[2], +m[1], m[4], m[5], m[6]); // jj/mm/aaaa (format français)
    }
    if (/[a-z]/i.test(s) && /\d{4}/.test(s)) {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) return new Date(t);
    }
    return null;
  }

  const pad2 = n => String(n).padStart(2, '0');
  function formatDate(d, fmt = 'YYYY-MM-DD') {
    if (!d) return null;
    const map = {
      YYYY: d.getUTCFullYear(), YY: pad2(d.getUTCFullYear() % 100), MM: pad2(d.getUTCMonth() + 1),
      DD: pad2(d.getUTCDate()), HH: pad2(d.getUTCHours()), mm: pad2(d.getUTCMinutes()), ss: pad2(d.getUTCSeconds()),
    };
    return fmt.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, t => map[t]);
  }

  const TRUE_WORDS = ['true', 'vrai', 'oui', 'yes', 'y', 'o', '1', 'x'];
  const FALSE_WORDS = ['false', 'faux', 'non', 'no', 'n', '0'];
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (isMissing(v)) return null;
    const s = String(v).trim().toLowerCase();
    if (TRUE_WORDS.includes(s)) return true;
    if (FALSE_WORDS.includes(s)) return false;
    return null;
  }

  function inferType(values) {
    let n = 0, num = 0, bool = 0, date = 0;
    for (const v of values) {
      if (isMissing(v)) continue;
      if (++n > 2000) break;
      if (typeof v === 'boolean') { bool++; continue; }
      if (isNum(v)) num++;
      else if (['true', 'false', 'vrai', 'faux', 'oui', 'non', 'yes', 'no'].includes(String(v).trim().toLowerCase())) bool++;
      else if (typeof v === 'string' && toDate(v)) date++;
    }
    if (!n) return 'vide';
    const k = Math.min(n, 2000);
    if (num / k >= 0.95) return 'nombre';
    if (bool / k >= 0.95) return 'booléen';
    if (date / k >= 0.9) return 'date';
    return 'texte';
  }

  function removeAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function toSnake(s) {
    return removeAccents(s).trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'colonne';
  }
  function titleCase(s) { return String(s).toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }

  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  function compareValues(a, b) {
    const ma = isMissing(a), mb = isMissing(b);
    if (ma || mb) return ma === mb ? 0 : ma ? 1 : -1;
    const na = toNum(a), nb = toNum(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return collator.compare(String(a), String(b));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const round = (x, d = 2) => { const f = 10 ** d; return Math.round(x * f) / f; };
  const cleanNum = x => (Number.isFinite(x) ? round(x, 10) : null);

  // ------------------------------------------------------------------ statistiques
  function numericValues(rows, col) {
    const out = [];
    for (const r of rows) { const n = toNum(r[col]); if (!Number.isNaN(n)) out.push(n); }
    return out;
  }
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function describeNums(vals) {
    const n = vals.length;
    if (!n) return { count: 0 };
    const s = vals.slice().sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0), mean = sum / n;
    const variance = n > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);
    const skew = n > 2 && std > 0 ? (n / ((n - 1) * (n - 2))) * s.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) : NaN;
    return {
      count: n, sum, mean, variance, std, min: s[0], q1: quantile(s, 0.25), median: quantile(s, 0.5),
      q3: quantile(s, 0.75), max: s[n - 1], skew,
    };
  }
  function valueCounts(values) {
    const m = new Map();
    for (const v of values) {
      if (isMissing(v)) continue;
      const k = String(v);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  }

  function aggregate(values, agg) {
    const present = values.filter(v => !isMissing(v));
    const nums = () => present.map(toNum).filter(x => !Number.isNaN(x));
    switch (agg) {
      case 'count': return present.length;
      case 'count_all': return values.length;
      case 'nunique': return new Set(present.map(String)).size;
      case 'sum': return cleanNum(nums().reduce((a, b) => a + b, 0));
      case 'mean': { const n = nums(); return n.length ? cleanNum(n.reduce((a, b) => a + b, 0) / n.length) : null; }
      case 'median': { const n = nums().sort((a, b) => a - b); return n.length ? cleanNum(quantile(n, 0.5)) : null; }
      case 'min': { const n = nums(); return n.length ? Math.min(...n) : (present.length ? present.slice().sort(compareValues)[0] : null); }
      case 'max': { const n = nums(); return n.length ? Math.max(...n) : (present.length ? present.slice().sort(compareValues).pop() : null); }
      case 'std': { const d = describeNums(nums()); return d.count > 1 ? cleanNum(d.std) : null; }
      case 'var': { const d = describeNums(nums()); return d.count > 1 ? cleanNum(d.variance) : null; }
      case 'first': return present.length ? present[0] : null;
      case 'last': return present.length ? present[present.length - 1] : null;
      case 'mode': { const vc = valueCounts(present); return vc.length ? vc[0][0] : null; }
      case 'concat': return [...new Set(present.map(String))].join(', ');
      default: throw new Error('Agrégation inconnue : ' + agg);
    }
  }
  const AGGS = [
    ['count', 'Nombre (non vides)'], ['count_all', 'Nombre (toutes lignes)'], ['nunique', 'Valeurs distinctes'],
    ['sum', 'Somme'], ['mean', 'Moyenne'], ['median', 'Médiane'], ['min', 'Minimum'], ['max', 'Maximum'],
    ['std', 'Écart-type'], ['var', 'Variance'], ['first', 'Première'], ['last', 'Dernière'], ['mode', 'Mode'],
    ['concat', 'Concaténation'],
  ];

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return NaN;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  function ranks(vals) {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }
  function pairs(rows, a, b) {
    const xs = [], ys = [];
    for (const r of rows) {
      const x = toNum(r[a]), y = toNum(r[b]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) { xs.push(x); ys.push(y); }
    }
    return [xs, ys];
  }
  function linearRegression(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : NaN, intercept = my - slope * mx;
    const r = pearson(xs, ys);
    return { n, slope, intercept, r, r2: r * r };
  }

  // ------------------------------------------------------------------ helpers de jeu de données
  const ds = (columns, rows) => ({ columns, rows });
  function uniqueName(columns, name) {
    let n = name || 'colonne', i = 2;
    while (columns.includes(n)) n = `${name}_${i++}`;
    return n;
  }
  const colsOrAll = (d, cols) => (cols && cols.length ? cols.filter(c => d.columns.includes(c)) : d.columns.slice());
  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function needCol(d, c, label = 'colonne') { need(c && d.columns.includes(c), `Choisissez une ${label} valide.`); }

  function mapCols(d, cols, fn) {
    return ds(d.columns.slice(), d.rows.map((r, i) => {
      const o = { ...r };
      for (const c of cols) o[c] = fn(r[c], r, i, c);
      return o;
    }));
  }
  /** Ajoute (ou remplace) une colonne calculée, placée après `after` si fourni. */
  function withColumn(d, name, fn, after) {
    let columns = d.columns.slice();
    if (!columns.includes(name)) {
      const pos = after && columns.includes(after) ? columns.indexOf(after) + 1 : columns.length;
      columns.splice(pos, 0, name);
    }
    const rows = d.rows.map((r, i) => ({ ...r, [name]: fn(r, i) }));
    return ds(columns, rows);
  }
  /** Calcule une colonne dérivée : en place ou dans une nouvelle colonne nommée col + suffixe. */
  function derive(d, cols, suffix, inPlace, fnFactory) {
    let out = d;
    for (const c of cols) {
      const f = fnFactory(c, out);
      if (inPlace) out = mapCols(out, [c], (v, r, i) => f(v, r, i));
      else out = withColumn(out, uniqueName(out.columns, c + suffix), (r, i) => f(r[c], r, i), c);
    }
    return out;
  }
  function groupIndex(rows, keyCols) {
    const m = new Map();
    rows.forEach((r, i) => {
      const k = keyCols.length ? JSON.stringify(keyCols.map(c => (isMissing(r[c]) ? null : String(r[c])))) : '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    });
    return m;
  }
  function template(tpl, r) {
    return String(tpl).replace(/\{([^{}]+)\}/g, (m, c) => (c in r ? (isMissing(r[c]) ? '' : String(r[c])) : m));
  }
  function literal(v) {
    if (v === '' || v === null || v === undefined) return v;
    const n = toNum(v);
    return !Number.isNaN(n) && /^[-+]?[\d.,\s]+$/.test(String(v)) ? n : v;
  }

  // expressions utilisateur (colonne calculée / filtre avancé)
  const EXPR_HELPERS = {
    num: toNum, date: v => toDate(v), fmt: formatDate, round, vide: isMissing, isEmpty: isMissing,
    upper: s => String(s ?? '').toUpperCase(), lower: s => String(s ?? '').toLowerCase(),
    len: s => String(s ?? '').length, sansAccents: removeAccents,
    si: (c, a, b) => (c ? a : b), coalesce: (...a) => a.find(x => !isMissing(x)) ?? null,
  };
  function compileExpr(expr) {
    need(expr && String(expr).trim(), 'Saisissez une expression.');
    const names = Object.keys(EXPR_HELPERS);
    // eslint-disable-next-line no-new-func
    const fn = new Function('r', 'i', 'rows', ...names, `with (r) { return (${expr}); }`);
    const helpers = names.map(n => EXPR_HELPERS[n]);
    return (r, i, rows) => fn(r, i, rows, ...helpers);
  }

  // ------------------------------------------------------------------ filtres
  const OPS = [
    ['eq', '= égal à'], ['ne', '≠ différent de'], ['gt', '> supérieur à'], ['gte', '≥ supérieur ou égal'],
    ['lt', '< inférieur à'], ['lte', '≤ inférieur ou égal'], ['between', 'entre (valeur et valeur 2)'],
    ['contains', 'contient'], ['notcontains', 'ne contient pas'], ['starts', 'commence par'], ['ends', 'finit par'],
    ['regex', 'correspond à la regex'], ['in', 'dans la liste (a, b, c)'], ['notin', 'hors de la liste'],
    ['empty', 'est vide'], ['notempty', "n'est pas vide"],
  ];
  function makeTest(op, val, val2, caseSensitive) {
    const norm = s => (caseSensitive ? String(s) : String(s).toLowerCase());
    const nv = toNum(val), nv2 = toNum(val2);
    const dv = toDate(val), dv2 = toDate(val2);
    const cmp = (v, target, nt, dt) => {
      const n = toNum(v);
      if (!Number.isNaN(n) && !Number.isNaN(nt)) return n - nt;
      const d = toDate(v);
      if (d && dt) return d - dt;
      return collator.compare(String(v), String(target));
    };
    const list = String(val ?? '').split(',').map(s => norm(s.trim()));
    let re;
    if (op === 'regex') re = new RegExp(val, caseSensitive ? '' : 'i');
    return v => {
      if (op === 'empty') return isMissing(v);
      if (op === 'notempty') return !isMissing(v);
      if (isMissing(v)) return op === 'ne' || op === 'notcontains' || op === 'notin';
      switch (op) {
        case 'eq': return !Number.isNaN(nv) && isNum(v) ? toNum(v) === nv : norm(v) === norm(val);
        case 'ne': return !Number.isNaN(nv) && isNum(v) ? toNum(v) !== nv : norm(v) !== norm(val);
        case 'gt': return cmp(v, val, nv, dv) > 0;
        case 'gte': return cmp(v, val, nv, dv) >= 0;
        case 'lt': return cmp(v, val, nv, dv) < 0;
        case 'lte': return cmp(v, val, nv, dv) <= 0;
        case 'between': return cmp(v, val, nv, dv) >= 0 && cmp(v, val2, nv2, dv2) <= 0;
        case 'contains': return norm(v).includes(norm(val));
        case 'notcontains': return !norm(v).includes(norm(val));
        case 'starts': return norm(v).startsWith(norm(val));
        case 'ends': return norm(v).endsWith(norm(val));
        case 'regex': return re.test(String(v));
        case 'in': return list.includes(norm(v).trim());
        case 'notin': return !list.includes(norm(v).trim());
        default: throw new Error('Opérateur inconnu : ' + op);
      }
    };
  }

  // ------------------------------------------------------------------ dates
  const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  const DATE_PARTS = {
    annee: ['Année', d => d.getUTCFullYear()],
    mois: ['Mois (n°)', d => d.getUTCMonth() + 1],
    nom_mois: ['Nom du mois', d => MONTH_NAMES[d.getUTCMonth()]],
    jour: ['Jour du mois', d => d.getUTCDate()],
    jour_semaine: ['Jour de semaine (1=lundi)', d => d.getUTCDay() || 7],
    nom_jour: ['Nom du jour', d => DAY_NAMES[d.getUTCDay()]],
    trimestre: ['Trimestre', d => Math.floor(d.getUTCMonth() / 3) + 1],
    semaine: ['Semaine ISO', isoWeek],
    annee_mois: ['Année-mois', d => formatDate(d, 'YYYY-MM')],
    heure: ['Heure', d => d.getUTCHours()],
    weekend: ['Week-end ?', d => [0, 6].includes(d.getUTCDay())],
  };
  function addToDate(d, amount, unit) {
    const r = new Date(d.getTime());
    switch (unit) {
      case 'jours': r.setUTCDate(r.getUTCDate() + amount); break;
      case 'semaines': r.setUTCDate(r.getUTCDate() + 7 * amount); break;
      case 'mois': r.setUTCMonth(r.getUTCMonth() + amount); break;
      case 'annees': r.setUTCFullYear(r.getUTCFullYear() + amount); break;
      case 'heures': r.setTime(r.getTime() + amount * 3600000); break;
      default: throw new Error('Unité inconnue');
    }
    return r;
  }
  function diffDates(a, b, unit) {
    const ms = b - a;
    switch (unit) {
      case 'jours': return Math.round(ms / 86400000 * 100) / 100;
      case 'semaines': return round(ms / (7 * 86400000));
      case 'heures': return round(ms / 3600000);
      case 'mois': return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
      case 'annees': {
        let y = b.getUTCFullYear() - a.getUTCFullYear();
        if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
        return y;
      }
      default: throw new Error('Unité inconnue');
    }
  }
  const DATE_UNITS = [['jours', 'Jours'], ['semaines', 'Semaines'], ['mois', 'Mois'], ['annees', 'Années'], ['heures', 'Heures']];

  // ------------------------------------------------------------------ définition des outils
  // Types de paramètres : column, columns, text, textarea, number, select, multiselect, checkbox, dataset, datasetColumn
  const P = {
    col: (name = 'column', label = 'Colonne', extra = {}) => ({ name, label, type: 'column', ...extra }),
    cols: (name = 'columns', label = 'Colonnes (vide = toutes)', extra = {}) => ({ name, label, type: 'columns', ...extra }),
    text: (name, label, def = '', extra = {}) => ({ name, label, type: 'text', default: def, ...extra }),
    num: (name, label, def = 0, extra = {}) => ({ name, label, type: 'number', default: def, ...extra }),
    sel: (name, label, options, def, extra = {}) => ({ name, label, type: 'select', options, default: def ?? options[0][0], ...extra }),
    chk: (name, label, def = false) => ({ name, label, type: 'checkbox', default: def }),
  };
  const result = (title, data) => ({ result: true, title, data });

  const TOOLS = [];
  const CATEGORIES = [];
  function cat(name, icon, tools) { CATEGORIES.push({ name, icon }); tools.forEach(t => TOOLS.push({ cat: name, ...t })); }

  // ======================= NETTOYAGE
  cat('Nettoyage', '🧹', [
    {
      id: 'dedupe', name: 'Supprimer les doublons', desc: 'Supprime les lignes identiques (sur toutes les colonnes ou certaines).',
      params: [P.cols('columns', 'Colonnes de comparaison (vide = toutes)'), P.sel('keep', 'Conserver', [['first', 'La première occurrence'], ['last', 'La dernière occurrence']]),
        P.chk('loose', 'Ignorer la casse et les espaces')],
      run(d, p) {
        const cols = colsOrAll(d, p.columns);
        const key = r => JSON.stringify(cols.map(c => { const v = isMissing(r[c]) ? '' : String(r[c]); return p.loose ? v.trim().toLowerCase().replace(/\s+/g, ' ') : v; }));
        const seen = new Set(), keep = [];
        const order = p.keep === 'last' ? d.rows.slice().reverse() : d.rows;
        for (const r of order) { const k = key(r); if (!seen.has(k)) { seen.add(k); keep.push(r); } }
        return ds(d.columns.slice(), p.keep === 'last' ? keep.reverse() : keep);
      },
    },
    {
      id: 'dropEmptyRows', name: 'Supprimer les lignes vides', desc: 'Supprime les lignes dont toutes les cellules sont vides.', params: [],
      run: d => ds(d.columns.slice(), d.rows.filter(r => d.columns.some(c => !isMissing(r[c])))),
    },
    {
      id: 'dropEmptyCols', name: 'Supprimer les colonnes vides', desc: 'Supprime les colonnes vides (ou presque vides selon le seuil).',
      params: [P.num('threshold', '% minimum de valeurs manquantes pour supprimer', 100)],
      run(d, p) {
        const n = d.rows.length || 1;
        const keep = d.columns.filter(c => (d.rows.filter(r => isMissing(r[c])).length / n) * 100 < +p.threshold);
        return ds(keep, d.rows.map(r => Object.fromEntries(keep.map(c => [c, r[c]]))));
      },
    },
    {
      id: 'dropMissing', name: 'Supprimer les lignes incomplètes', desc: 'Supprime les lignes contenant des valeurs manquantes.',
      params: [P.cols(), P.sel('mode', 'Supprimer si', [['any', 'au moins une valeur manque'], ['all', 'toutes les valeurs manquent']])],
      run(d, p) {
        const cols = colsOrAll(d, p.columns);
        return ds(d.columns.slice(), d.rows.filter(r => (p.mode === 'all' ? !cols.every(c => isMissing(r[c])) : !cols.some(c => isMissing(r[c])))));
      },
    },
    {
      id: 'fillMissing', name: 'Remplir les valeurs manquantes', desc: 'Remplace les cellules vides par une valeur, une statistique ou une interpolation.',
      params: [P.cols(), P.sel('method', 'Méthode', [['const', 'Valeur constante'], ['zero', 'Zéro'], ['mean', 'Moyenne'], ['median', 'Médiane'],
        ['mode', 'Valeur la plus fréquente'], ['ffill', 'Valeur précédente'], ['bfill', 'Valeur suivante'], ['interp', 'Interpolation linéaire']]),
      P.text('value', 'Valeur (méthode constante)', 'N/A')],
      run(d, p) {
        const cols = colsOrAll(d, p.columns);
        let out = d;
        for (const c of cols) {
          const vals = out.rows.map(r => r[c]);
          let filled;
          if (['mean', 'median', 'mode'].includes(p.method)) {
            const f = aggregate(vals, p.method);
            filled = vals.map(v => (isMissing(v) ? f : v));
          } else if (p.method === 'const' || p.method === 'zero') {
            const f = p.method === 'zero' ? 0 : literal(p.value);
            filled = vals.map(v => (isMissing(v) ? f : v));
          } else if (p.method === 'ffill') {
            let last = null; filled = vals.map(v => (isMissing(v) ? last : (last = v)));
          } else if (p.method === 'bfill') {
            let next = null; filled = vals.slice().reverse().map(v => (isMissing(v) ? next : (next = v))).reverse();
          } else if (p.method === 'interp') {
            filled = vals.slice();
            const known = vals.map((v, i) => [i, toNum(v)]).filter(x => !Number.isNaN(x[1]));
            for (let k = 0; k < known.length - 1; k++) {
              const [i0, v0] = known[k], [i1, v1] = known[k + 1];
              for (let i = i0 + 1; i < i1; i++) if (isMissing(vals[i])) filled[i] = cleanNum(v0 + ((v1 - v0) * (i - i0)) / (i1 - i0));
            }
          }
          out = ds(out.columns, out.rows.map((r, i) => (r[c] === filled[i] ? r : { ...r, [c]: filled[i] })));
        }
        return ds(d.columns.slice(), out.rows);
      },
    },
    {
      id: 'trim', name: 'Supprimer les espaces superflus', desc: 'Retire les espaces en début/fin de texte et réduit les espaces multiples.',
      params: [P.cols(), P.chk('inner', 'Réduire aussi les espaces internes multiples', true)],
      run: (d, p) => mapCols(d, colsOrAll(d, p.columns), v => (typeof v === 'string' ? (p.inner ? v.replace(/\s+/g, ' ') : v).trim() : v)),
    },
    {
      id: 'case', name: 'Changer la casse', desc: 'MAJUSCULES, minuscules, Première Lettre En Majuscule…',
      params: [P.cols(), P.sel('mode', 'Casse', [['upper', 'MAJUSCULES'], ['lower', 'minuscules'], ['title', 'Titre (Chaque Mot)'], ['sentence', 'Phrase (Première lettre)']])],
      run(d, p) {
        const f = { upper: s => s.toUpperCase(), lower: s => s.toLowerCase(), title: titleCase, sentence: s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() }[p.mode];
        return mapCols(d, colsOrAll(d, p.columns), v => (typeof v === 'string' ? f(v) : v));
      },
    },
    {
      id: 'replace', name: 'Rechercher / remplacer', desc: 'Remplace du texte (expressions régulières possibles, $1 pour les groupes).',
      params: [P.cols(), P.text('find', 'Rechercher'), P.text('repl', 'Remplacer par'), P.chk('regex', 'Expression régulière'),
        P.chk('cs', 'Respecter la casse'), P.chk('whole', 'Cellule entière uniquement')],
      run(d, p) {
        need(p.find !== '' || p.whole, 'Indiquez le texte à rechercher.');
        const flags = 'g' + (p.cs ? '' : 'i');
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(p.whole ? `^(?:${p.regex ? p.find : esc(p.find)})$` : p.regex ? p.find : esc(p.find), flags);
        return mapCols(d, colsOrAll(d, p.columns), v => {
          if (v === null || v === undefined) return p.whole && p.find === '' ? literal(p.repl) : v;
          const s = String(v);
          re.lastIndex = 0;
          if (!re.test(s)) return v;
          re.lastIndex = 0;
          return literal(s.replace(re, p.regex ? p.repl : p.repl.replace(/\$/g, '$$$$')));
        });
      },
    },
    {
      id: 'accents', name: 'Supprimer les accents', desc: 'é → e, ç → c, etc.', params: [P.cols()],
      run: (d, p) => mapCols(d, colsOrAll(d, p.columns), v => (typeof v === 'string' ? removeAccents(v) : v)),
    },
    {
      id: 'specialChars', name: 'Supprimer les caractères spéciaux', desc: 'Ne conserve que lettres, chiffres, espaces (et caractères autorisés).',
      params: [P.cols(), P.text('allowed', 'Caractères supplémentaires autorisés', '-_.@')],
      run(d, p) {
        const extra = (p.allowed || '').replace(/[\]\\^-]/g, '\\$&');
        const re = new RegExp(`[^\\p{L}\\p{N}\\s${extra}]`, 'gu');
        return mapCols(d, colsOrAll(d, p.columns), v => (typeof v === 'string' ? v.replace(re, '') : v));
      },
    },
    {
      id: 'convert', name: 'Convertir le type', desc: 'Convertit en nombre, entier, texte, booléen ou date (les valeurs invalides deviennent vides).',
      params: [P.cols('columns', 'Colonnes'), P.sel('type', 'Type cible', [['number', 'Nombre décimal'], ['integer', 'Nombre entier'], ['text', 'Texte'],
        ['boolean', 'Booléen (vrai/faux)'], ['date', 'Date (AAAA-MM-JJ)'], ['datetime', 'Date et heure']])],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const f = {
          number: v => { const n = toNum(v); return Number.isNaN(n) ? null : n; },
          integer: v => { const n = toNum(v); return Number.isNaN(n) ? null : Math.round(n); },
          text: v => (isMissing(v) ? '' : String(v)),
          boolean: toBool,
          date: v => formatDate(toDate(v)),
          datetime: v => formatDate(toDate(v), 'YYYY-MM-DD HH:mm:ss'),
        }[p.type];
        return mapCols(d, colsOrAll(d, p.columns), f);
      },
    },
    {
      id: 'standardizeDates', name: 'Uniformiser les dates', desc: 'Reconnaît de nombreux formats (jj/mm/aaaa, ISO, série Excel…) et les réécrit dans un format unique.',
      params: [P.cols('columns', 'Colonnes'), P.sel('fmt', 'Format de sortie', [['YYYY-MM-DD', 'AAAA-MM-JJ'], ['DD/MM/YYYY', 'JJ/MM/AAAA'], ['MM/DD/YYYY', 'MM/JJ/AAAA'],
        ['YYYY-MM-DD HH:mm:ss', 'AAAA-MM-JJ HH:mm:ss'], ['DD/MM/YYYY HH:mm', 'JJ/MM/AAAA HH:mm'], ['YYYY-MM', 'AAAA-MM'], ['custom', 'Personnalisé…']]),
      P.text('custom', 'Format personnalisé (YYYY, YY, MM, DD, HH, mm, ss)', 'DD.MM.YYYY'), P.chk('keepInvalid', 'Conserver les valeurs non reconnues', true)],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const fmt = p.fmt === 'custom' ? p.custom : p.fmt;
        return mapCols(d, p.columns, v => { const dt = toDate(v); return dt ? formatDate(dt, fmt) : (p.keepInvalid ? v : null); });
      },
    },
  ]);

  // ======================= COLONNES
  cat('Colonnes', '🏛️', [
    {
      id: 'rename', name: 'Renommer une colonne', desc: 'Donne un nouveau nom à une colonne.',
      params: [P.col(), P.text('name', 'Nouveau nom')],
      run(d, p) {
        needCol(d, p.column);
        need(p.name && p.name.trim(), 'Saisissez un nouveau nom.');
        const name = p.name.trim();
        need(name === p.column || !d.columns.includes(name), 'Une colonne porte déjà ce nom.');
        return ds(d.columns.map(c => (c === p.column ? name : c)), d.rows.map(r => {
          const o = {};
          for (const c of d.columns) o[c === p.column ? name : c] = r[c];
          return o;
        }));
      },
    },
    {
      id: 'renameAll', name: 'Renommer toutes les colonnes', desc: 'snake_case, minuscules, sans accents, préfixe/suffixe…',
      params: [P.sel('mode', 'Transformation', [['snake', 'snake_case'], ['lower', 'minuscules'], ['upper', 'MAJUSCULES'], ['title', 'Titre'],
        ['trim', 'Supprimer les espaces superflus'], ['accents', 'Supprimer les accents'], ['prefix', 'Ajouter un préfixe'], ['suffix', 'Ajouter un suffixe']]),
      P.text('text', 'Préfixe / suffixe', ''), P.cols('columns', 'Colonnes (vide = toutes)')],
      run(d, p) {
        const target = colsOrAll(d, p.columns);
        const f = { snake: toSnake, lower: s => s.toLowerCase(), upper: s => s.toUpperCase(), title: titleCase, trim: s => s.trim().replace(/\s+/g, ' '),
          accents: removeAccents, prefix: s => p.text + s, suffix: s => s + p.text }[p.mode];
        const names = [];
        const map = {};
        for (const c of d.columns) { const n = uniqueName(names, target.includes(c) ? f(c) : c); names.push(n); map[c] = n; }
        return ds(names, d.rows.map(r => { const o = {}; for (const c of d.columns) o[map[c]] = r[c]; return o; }));
      },
    },
    {
      id: 'deleteCols', name: 'Supprimer des colonnes', desc: 'Supprime les colonnes sélectionnées.',
      params: [P.cols('columns', 'Colonnes à supprimer')],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const keep = d.columns.filter(c => !p.columns.includes(c));
        return ds(keep, d.rows.map(r => Object.fromEntries(keep.map(c => [c, r[c]]))));
      },
    },
    {
      id: 'keepCols', name: 'Sélectionner des colonnes', desc: 'Ne conserve que les colonnes choisies (dans l\'ordre du tableau).',
      params: [P.cols('columns', 'Colonnes à garder')],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const keep = d.columns.filter(c => p.columns.includes(c));
        return ds(keep, d.rows.map(r => Object.fromEntries(keep.map(c => [c, r[c]]))));
      },
    },
    {
      id: 'duplicateCol', name: 'Dupliquer une colonne', desc: 'Crée une copie d\'une colonne.',
      params: [P.col(), P.text('name', 'Nom de la copie (optionnel)')],
      run(d, p) { needCol(d, p.column); return withColumn(d, uniqueName(d.columns, p.name || p.column + '_copie'), r => r[p.column], p.column); },
    },
    {
      id: 'moveCol', name: 'Déplacer une colonne', desc: 'Change la position d\'une colonne.',
      params: [P.col(), P.sel('pos', 'Position', [['start', 'Au début'], ['end', 'À la fin'], ['before', 'Avant la colonne…'], ['after', 'Après la colonne…']]),
        P.col('ref', 'Colonne de référence', { optional: true })],
      run(d, p) {
        needCol(d, p.column);
        const cols = d.columns.filter(c => c !== p.column);
        let i = p.pos === 'start' ? 0 : cols.length;
        if (p.pos === 'before' || p.pos === 'after') { needCol({ columns: cols }, p.ref, 'colonne de référence'); i = cols.indexOf(p.ref) + (p.pos === 'after' ? 1 : 0); }
        cols.splice(i, 0, p.column);
        return ds(cols, d.rows);
      },
    },
    {
      id: 'sortCols', name: 'Trier les colonnes', desc: 'Réordonne les colonnes par ordre alphabétique.',
      params: [P.sel('dir', 'Ordre', [['asc', 'A → Z'], ['desc', 'Z → A']])],
      run(d, p) { const c = d.columns.slice().sort(collator.compare); if (p.dir === 'desc') c.reverse(); return ds(c, d.rows); },
    },
    {
      id: 'split', name: 'Fractionner une colonne', desc: 'Découpe une colonne en plusieurs selon un séparateur.',
      params: [P.col(), P.text('sep', 'Séparateur', ','), P.chk('regex', 'Séparateur = expression régulière'), P.num('max', 'Nombre max. de parties (0 = toutes)', 0),
        P.text('prefix', 'Préfixe des nouvelles colonnes (vide = nom de la colonne)'), P.chk('drop', 'Supprimer la colonne d\'origine'), P.chk('trim', 'Supprimer les espaces des parties', true)],
      run(d, p) {
        needCol(d, p.column);
        need(p.sep !== '', 'Indiquez un séparateur.');
        const sep = p.regex ? new RegExp(p.sep) : p.sep;
        const max = +p.max > 0 ? +p.max : Infinity;
        const parts = d.rows.map(r => {
          if (isMissing(r[p.column])) return [];
          let a = String(r[p.column]).split(sep);
          if (a.length > max) a = [...a.slice(0, max - 1), a.slice(max - 1).join(p.regex ? ' ' : p.sep)];
          return p.trim ? a.map(s => s.trim()) : a;
        });
        const n = Math.min(50, Math.max(1, ...parts.map(a => a.length)));
        let columns = d.columns.slice();
        const base = p.prefix || p.column;
        const names = [];
        for (let k = 0; k < n; k++) { const nm = uniqueName([...columns, ...names], `${base}_${k + 1}`); names.push(nm); }
        const at = columns.indexOf(p.column) + 1;
        columns.splice(at, 0, ...names);
        if (p.drop) columns = columns.filter(c => c !== p.column);
        const rows = d.rows.map((r, i) => {
          const o = { ...r };
          names.forEach((nm, k) => { o[nm] = parts[i][k] !== undefined ? literal(parts[i][k]) : null; });
          if (p.drop) delete o[p.column];
          return o;
        });
        return ds(columns, rows);
      },
    },
    {
      id: 'merge', name: 'Fusionner des colonnes', desc: 'Concatène plusieurs colonnes en une seule.',
      params: [P.cols('columns', 'Colonnes à fusionner (dans l\'ordre du tableau)'), P.text('sep', 'Séparateur', ' '), P.text('name', 'Nom de la nouvelle colonne', 'fusion'),
        P.chk('skipEmpty', 'Ignorer les valeurs vides', true), P.chk('drop', 'Supprimer les colonnes d\'origine')],
      run(d, p) {
        need(p.columns && p.columns.length >= 2, 'Choisissez au moins deux colonnes.');
        const cols = d.columns.filter(c => p.columns.includes(c));
        const name = uniqueName(p.drop ? d.columns.filter(c => !cols.includes(c)) : d.columns, p.name || 'fusion');
        let out = withColumn(d, name, r => cols.map(c => r[c]).filter(v => !p.skipEmpty || !isMissing(v)).map(v => (isMissing(v) ? '' : String(v))).join(p.sep), cols[cols.length - 1]);
        if (p.drop) {
          const keep = out.columns.filter(c => !cols.includes(c));
          out = ds(keep, out.rows.map(r => Object.fromEntries(keep.map(c => [c, r[c]]))));
        }
        return out;
      },
    },
    {
      id: 'formula', name: 'Colonne calculée (formule)', desc: 'Formule JavaScript. Ex. : Prix * Quantite, num(r["Prix TTC"]) / 1.2, si(Age >= 18, "majeur", "mineur"). Fonctions : num, date, fmt, round, vide, upper, lower, len, sansAccents, si, coalesce.',
      params: [P.text('name', 'Nom de la colonne', 'resultat'), { name: 'expr', label: 'Formule', type: 'textarea', default: '' }],
      run(d, p) {
        const f = compileExpr(p.expr);
        const name = (p.name || 'resultat').trim();
        return withColumn(d, name, (r, i) => { const v = f(r, i, d.rows); return typeof v === 'number' ? cleanNum(v) : v instanceof Date ? formatDate(v) : v; });
      },
    },
    {
      id: 'template', name: 'Colonne à partir d\'un modèle', desc: 'Construit un texte avec {Colonne}. Ex. : "{Prénom} {Nom} ({Ville})".',
      params: [P.text('name', 'Nom de la colonne', 'texte'), P.text('tpl', 'Modèle', '{colonne}')],
      run: (d, p) => withColumn(d, p.name || 'texte', r => template(p.tpl, r)),
    },
    {
      id: 'conditional', name: 'Colonne conditionnelle (SI)', desc: 'SI condition ALORS valeur SINON autre valeur. {Colonne} insère la valeur d\'une colonne.',
      params: [P.col(), P.sel('op', 'Condition', OPS), P.text('value', 'Valeur'), P.text('value2', 'Valeur 2 (pour « entre »)'),
        P.text('then', 'Alors', 'oui'), P.text('else', 'Sinon', 'non'), P.text('name', 'Nom de la colonne', 'condition')],
      run(d, p) {
        needCol(d, p.column);
        const t = makeTest(p.op, p.value, p.value2, false);
        return withColumn(d, p.name || 'condition', r => literal(template(t(r[p.column]) ? p.then : p.else, r)));
      },
    },
    {
      id: 'constant', name: 'Ajouter une colonne constante', desc: 'Ajoute une colonne remplie d\'une même valeur.',
      params: [P.text('name', 'Nom', 'nouvelle'), P.text('value', 'Valeur', '')],
      run: (d, p) => withColumn(d, uniqueName(d.columns, p.name || 'nouvelle'), () => literal(p.value)),
    },
    {
      id: 'index', name: 'Ajouter un index / identifiant', desc: 'Numérote les lignes (1, 2, 3…) ou crée un identifiant.',
      params: [P.text('name', 'Nom', 'id'), P.num('start', 'Début', 1), P.num('step', 'Pas', 1), P.text('prefix', 'Préfixe (ex. CLI-)', ''), P.num('padding', 'Nombre de chiffres (0 = libre)', 0)],
      run(d, p) {
        const name = uniqueName(d.columns, p.name || 'id');
        const out = withColumn(d, name, (r, i) => {
          const n = +p.start + i * +p.step;
          return p.prefix || +p.padding ? p.prefix + String(n).padStart(+p.padding, '0') : n;
        });
        return ds([name, ...out.columns.filter(c => c !== name)], out.rows);
      },
    },
    {
      id: 'regexExtract', name: 'Extraire avec une regex', desc: 'Extrait la partie d\'un texte correspondant à une expression régulière. Ex. : ([\\w.]+)@([\\w.]+) pour un e-mail.',
      params: [P.col(), P.text('pattern', 'Expression régulière', '(\\d+)'), P.num('group', 'Groupe capturé (0 = tout)', 1), P.chk('all', 'Toutes les occurrences (séparées par des virgules)'),
        P.text('name', 'Nom de la colonne', 'extrait')],
      run(d, p) {
        needCol(d, p.column);
        const re = new RegExp(p.pattern, p.all ? 'g' : '');
        const g = +p.group;
        return withColumn(d, uniqueName(d.columns, p.name || 'extrait'), r => {
          if (isMissing(r[p.column])) return null;
          const s = String(r[p.column]);
          if (p.all) { const m = [...s.matchAll(re)].map(x => x[g]).filter(x => x !== undefined); return m.length ? m.join(', ') : null; }
          const m = s.match(re);
          return m && m[g] !== undefined ? literal(m[g]) : null;
        }, p.column);
      },
    },
  ]);

  // ======================= LIGNES
  cat('Lignes', '📋', [
    {
      id: 'filter', name: 'Filtrer les lignes', desc: 'Conserve (ou supprime) les lignes selon une ou deux conditions.',
      params: [P.col(), P.sel('op', 'Condition', OPS), P.text('value', 'Valeur'), P.text('value2', 'Valeur 2 (pour « entre »)'),
        P.sel('combine', 'Seconde condition', [['none', 'Aucune'], ['and', 'ET'], ['or', 'OU']]),
        P.col('column2', 'Colonne (2e condition)', { optional: true }), P.sel('op2', 'Condition (2e)', OPS), P.text('value3', 'Valeur (2e condition)'),
        P.chk('cs', 'Respecter la casse'), P.sel('action', 'Action', [['keep', 'Conserver les lignes correspondantes'], ['remove', 'Supprimer les lignes correspondantes']])],
      run(d, p) {
        needCol(d, p.column);
        const t1 = makeTest(p.op, p.value, p.value2, p.cs);
        let test = r => t1(r[p.column]);
        if (p.combine !== 'none') {
          needCol(d, p.column2, 'colonne pour la 2e condition');
          const t2 = makeTest(p.op2, p.value3, '', p.cs);
          test = p.combine === 'and' ? r => t1(r[p.column]) && t2(r[p.column2]) : r => t1(r[p.column]) || t2(r[p.column2]);
        }
        return ds(d.columns.slice(), d.rows.filter(r => (p.action === 'remove' ? !test(r) : test(r))));
      },
    },
    {
      id: 'filterExpr', name: 'Filtre avancé (formule)', desc: 'Conserve les lignes où la formule est vraie. Ex. : Age > 30 && Ville == "Paris", num(Prix) < 100.',
      params: [{ name: 'expr', label: 'Formule', type: 'textarea', default: '' }],
      run(d, p) { const f = compileExpr(p.expr); return ds(d.columns.slice(), d.rows.filter((r, i) => !!f(r, i, d.rows))); },
    },
    {
      id: 'sort', name: 'Trier les lignes', desc: 'Tri sur une à trois colonnes (nombres, dates et textes reconnus).',
      params: [P.col('c1', 'Trier par'), P.sel('d1', 'Ordre', [['asc', 'Croissant'], ['desc', 'Décroissant']]),
        P.col('c2', 'Puis par', { optional: true }), P.sel('d2', 'Ordre', [['asc', 'Croissant'], ['desc', 'Décroissant']]),
        P.col('c3', 'Puis par', { optional: true }), P.sel('d3', 'Ordre', [['asc', 'Croissant'], ['desc', 'Décroissant']])],
      run(d, p) {
        needCol(d, p.c1);
        const keys = [[p.c1, p.d1], [p.c2, p.d2], [p.c3, p.d3]].filter(k => k[0] && d.columns.includes(k[0]));
        const cmpVal = (a, b) => {
          const ta = toDate(a), tb = toDate(b);
          if (ta && tb && !isNum(a) && !isNum(b)) return ta - tb;
          return compareValues(a, b);
        };
        const rows = d.rows.map((r, i) => [r, i]).sort((x, y) => {
          for (const [c, dir] of keys) {
            const ma = isMissing(x[0][c]), mb = isMissing(y[0][c]);
            if (ma || mb) { if (ma !== mb) return ma ? 1 : -1; continue; }
            const v = cmpVal(x[0][c], y[0][c]);
            if (v) return dir === 'desc' ? -v : v;
          }
          return x[1] - y[1];
        }).map(x => x[0]);
        return ds(d.columns.slice(), rows);
      },
    },
    {
      id: 'sample', name: 'Échantillonner', desc: 'Tire un échantillon aléatoire, les premières/dernières lignes, ou une ligne sur k.',
      params: [P.sel('method', 'Méthode', [['random', 'Aléatoire (n lignes)'], ['pct', 'Aléatoire (% des lignes)'], ['head', 'Premières n lignes'], ['tail', 'Dernières n lignes'], ['every', 'Une ligne sur n']]),
        P.num('n', 'n / pourcentage', 10), P.num('seed', 'Graine aléatoire', 42)],
      run(d, p) {
        const n = Math.max(0, +p.n);
        if (p.method === 'head') return ds(d.columns.slice(), d.rows.slice(0, n));
        if (p.method === 'tail') return ds(d.columns.slice(), n ? d.rows.slice(-n) : []);
        if (p.method === 'every') { need(n >= 1, 'n doit être ≥ 1.'); return ds(d.columns.slice(), d.rows.filter((r, i) => i % Math.round(n) === 0)); }
        const k = p.method === 'pct' ? Math.round((d.rows.length * n) / 100) : Math.min(n, d.rows.length);
        const rng = mulberry32(+p.seed || 1);
        const idx = d.rows.map((r, i) => i);
        for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        return ds(d.columns.slice(), idx.slice(0, k).sort((a, b) => a - b).map(i => d.rows[i]));
      },
    },
    {
      id: 'topN', name: 'Top / Flop N', desc: 'Les N lignes avec les plus grandes (ou plus petites) valeurs, éventuellement par groupe.',
      params: [P.col('column', 'Colonne numérique'), P.num('n', 'N', 10), P.sel('dir', 'Sens', [['desc', 'Plus grandes valeurs'], ['asc', 'Plus petites valeurs']]),
        P.col('group', 'Par groupe (optionnel)', { optional: true })],
      run(d, p) {
        needCol(d, p.column);
        const s = (a, b) => (p.dir === 'desc' ? -1 : 1) * compareValues(a[p.column], b[p.column]);
        const g = groupIndex(d.rows, p.group ? [p.group] : []);
        const rows = [];
        for (const idx of g.values()) rows.push(...idx.map(i => d.rows[i]).filter(r => !isMissing(r[p.column])).sort(s).slice(0, +p.n));
        return ds(d.columns.slice(), rows);
      },
    },
    {
      id: 'deleteRows', name: 'Supprimer des lignes (plage)', desc: 'Supprime les lignes de la position « de » à « à » (numérotation à partir de 1).',
      params: [P.num('from', 'De la ligne', 1), P.num('to', 'À la ligne', 1)],
      run(d, p) { const a = +p.from - 1, b = +p.to - 1; return ds(d.columns.slice(), d.rows.filter((r, i) => i < a || i > b)); },
    },
    {
      id: 'shuffle', name: 'Mélanger les lignes', desc: 'Ordre aléatoire (reproductible grâce à la graine).', params: [P.num('seed', 'Graine', 42)],
      run(d, p) {
        const rng = mulberry32(+p.seed || 1), rows = d.rows.slice();
        for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
        return ds(d.columns.slice(), rows);
      },
    },
    { id: 'reverse', name: 'Inverser l\'ordre des lignes', desc: 'La dernière ligne devient la première.', params: [], run: d => ds(d.columns.slice(), d.rows.slice().reverse()) },
    {
      id: 'explode', name: 'Éclater une liste en lignes', desc: 'Une cellule « a, b, c » devient 3 lignes.',
      params: [P.col(), P.text('sep', 'Séparateur', ',')],
      run(d, p) {
        needCol(d, p.column);
        const rows = [];
        for (const r of d.rows) {
          const v = r[p.column];
          if (isMissing(v)) { rows.push(r); continue; }
          for (const part of String(v).split(p.sep)) rows.push({ ...r, [p.column]: literal(part.trim()) });
        }
        return ds(d.columns.slice(), rows);
      },
    },
  ]);

  // ======================= NUMÉRIQUE
  cat('Numérique', '🔢', [
    {
      id: 'math', name: 'Opération mathématique', desc: 'Ajoute, multiplie, applique log, racine, puissance, valeur absolue…',
      params: [P.cols('columns', 'Colonnes'), P.sel('op', 'Opération', [['add', '+ ajouter'], ['sub', '− soustraire'], ['mul', '× multiplier'], ['div', '÷ diviser'],
        ['pow', 'puissance'], ['mod', 'modulo'], ['abs', 'valeur absolue'], ['sqrt', 'racine carrée'], ['log', 'logarithme népérien'], ['log10', 'log base 10'],
        ['exp', 'exponentielle'], ['neg', 'opposé'], ['inv', 'inverse (1/x)']]), P.num('value', 'Valeur (pour + − × ÷ puissance modulo)', 1), P.chk('inPlace', 'Modifier en place', true)],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const k = +p.value;
        const f = { add: x => x + k, sub: x => x - k, mul: x => x * k, div: x => x / k, pow: x => x ** k, mod: x => x % k, abs: Math.abs, sqrt: Math.sqrt,
          log: Math.log, log10: Math.log10, exp: Math.exp, neg: x => -x, inv: x => 1 / x }[p.op];
        return derive(d, p.columns, '_' + p.op, p.inPlace, () => v => { const n = toNum(v); return Number.isNaN(n) ? (isMissing(v) ? null : v) : cleanNum(f(n)); });
      },
    },
    {
      id: 'colMath', name: 'Opération entre deux colonnes', desc: 'A + B, A − B, A × B, A ÷ B, écart en %…',
      params: [P.col('a', 'Colonne A'), P.sel('op', 'Opération', [['add', 'A + B'], ['sub', 'A − B'], ['mul', 'A × B'], ['div', 'A ÷ B'], ['pct', 'Variation % (B − A) / A'],
        ['min', 'min(A, B)'], ['max', 'max(A, B)'], ['mean', 'moyenne(A, B)']]), P.col('b', 'Colonne B'), P.text('name', 'Nom du résultat', 'resultat')],
      run(d, p) {
        needCol(d, p.a, 'colonne A'); needCol(d, p.b, 'colonne B');
        const f = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b, pct: (a, b) => ((b - a) / a) * 100,
          min: Math.min, max: Math.max, mean: (a, b) => (a + b) / 2 }[p.op];
        return withColumn(d, p.name || 'resultat', r => { const a = toNum(r[p.a]), b = toNum(r[p.b]); return Number.isNaN(a) || Number.isNaN(b) ? null : cleanNum(f(a, b)); });
      },
    },
    {
      id: 'round', name: 'Arrondir', desc: 'Arrondi, arrondi inférieur ou supérieur.',
      params: [P.cols('columns', 'Colonnes'), P.num('decimals', 'Décimales', 2), P.sel('mode', 'Mode', [['round', 'Au plus proche'], ['floor', 'Inférieur'], ['ceil', 'Supérieur'], ['trunc', 'Troncature']])],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        const f = 10 ** +p.decimals;
        return mapCols(d, p.columns, v => { const n = toNum(v); return Number.isNaN(n) ? v : cleanNum(Math[p.mode](n * f) / f); });
      },
    },
    {
      id: 'minmax', name: 'Normaliser (min-max)', desc: 'Ramène les valeurs entre 0 et 1 (ou une autre plage).',
      params: [P.cols('columns', 'Colonnes'), P.num('lo', 'Minimum cible', 0), P.num('hi', 'Maximum cible', 1), P.chk('inPlace', 'Modifier en place')],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        return derive(d, p.columns, '_norm', p.inPlace, c => {
          const s = describeNums(numericValues(d.rows, c));
          return v => { const n = toNum(v); if (Number.isNaN(n)) return null; return cleanNum(s.max === s.min ? +p.lo : +p.lo + ((n - s.min) * (+p.hi - +p.lo)) / (s.max - s.min)); };
        });
      },
    },
    {
      id: 'zscore', name: 'Standardiser (z-score)', desc: '(x − moyenne) / écart-type.',
      params: [P.cols('columns', 'Colonnes'), P.chk('inPlace', 'Modifier en place')],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        return derive(d, p.columns, '_z', p.inPlace, c => {
          const s = describeNums(numericValues(d.rows, c));
          return v => { const n = toNum(v); return Number.isNaN(n) || !s.std ? null : cleanNum((n - s.mean) / s.std); };
        });
      },
    },
    {
      id: 'bin', name: 'Discrétiser (classes)', desc: 'Regroupe des valeurs numériques en intervalles (largeur égale, quantiles ou bornes personnalisées).',
      params: [P.col(), P.sel('method', 'Méthode', [['width', 'Intervalles de même largeur'], ['quantile', 'Quantiles (effectifs égaux)'], ['custom', 'Bornes personnalisées']]),
        P.num('bins', 'Nombre de classes', 5), P.text('edges', 'Bornes personnalisées (ex. 0, 18, 65, 120)', ''), P.text('labels', 'Libellés (optionnel, séparés par des virgules)', ''),
        P.text('name', 'Nom de la colonne', 'classe')],
      run(d, p) {
        needCol(d, p.column);
        const vals = numericValues(d.rows, p.column).sort((a, b) => a - b);
        need(vals.length, 'La colonne ne contient pas de nombres.');
        let edges;
        if (p.method === 'custom') { edges = String(p.edges).split(/[;,]/).map(toNum).filter(x => !Number.isNaN(x)).sort((a, b) => a - b); need(edges.length >= 2, 'Indiquez au moins deux bornes.'); }
        else {
          const k = Math.max(1, Math.round(+p.bins));
          edges = [];
          for (let i = 0; i <= k; i++) edges.push(p.method === 'width' ? vals[0] + ((vals[vals.length - 1] - vals[0]) * i) / k : quantile(vals, i / k));
          edges = [...new Set(edges.map(e => cleanNum(e)))];
        }
        const labels = p.labels ? String(p.labels).split(',').map(s => s.trim()) : [];
        const fmt = x => (Number.isInteger(x) ? x : round(x, 2));
        return withColumn(d, uniqueName(d.columns, p.name || 'classe'), r => {
          const n = toNum(r[p.column]);
          if (Number.isNaN(n) || n < edges[0] || n > edges[edges.length - 1]) return null;
          let i = edges.findIndex((e, k) => k > 0 && (n < e || k === edges.length - 1));
          if (i < 1) i = 1;
          return labels[i - 1] || `[${fmt(edges[i - 1])} ; ${fmt(edges[i])}${i === edges.length - 1 ? ']' : '['}`;
        }, p.column);
      },
    },
    {
      id: 'clip', name: 'Écrêter (winsoriser)', desc: 'Limite les valeurs extrêmes aux percentiles choisis ou à des bornes fixes.',
      params: [P.cols('columns', 'Colonnes'), P.sel('mode', 'Bornes', [['pct', 'Percentiles'], ['abs', 'Valeurs fixes']]), P.num('lo', 'Borne basse (percentile ou valeur)', 1), P.num('hi', 'Borne haute (percentile ou valeur)', 99)],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        let out = d;
        for (const c of p.columns) {
          const s = numericValues(d.rows, c).sort((a, b) => a - b);
          const lo = p.mode === 'pct' ? quantile(s, +p.lo / 100) : +p.lo, hi = p.mode === 'pct' ? quantile(s, +p.hi / 100) : +p.hi;
          out = mapCols(out, [c], v => { const n = toNum(v); return Number.isNaN(n) ? v : cleanNum(Math.min(hi, Math.max(lo, n))); });
        }
        return out;
      },
    },
    {
      id: 'cumulative', name: 'Cumul (somme cumulée…)', desc: 'Somme, moyenne, min, max ou comptage cumulés, éventuellement par groupe.',
      params: [P.col(), P.sel('fn', 'Fonction', [['sum', 'Somme cumulée'], ['mean', 'Moyenne cumulée'], ['min', 'Minimum cumulé'], ['max', 'Maximum cumulé'], ['count', 'Comptage cumulé']]),
        P.col('group', 'Par groupe (optionnel)', { optional: true }), P.text('name', 'Nom de la colonne (optionnel)')],
      run(d, p) {
        needCol(d, p.column);
        const out = new Array(d.rows.length);
        for (const idx of groupIndex(d.rows, p.group ? [p.group] : []).values()) {
          let acc = null, n = 0;
          for (const i of idx) {
            const x = toNum(d.rows[i][p.column]);
            if (!Number.isNaN(x)) {
              n++;
              acc = acc === null ? (p.fn === 'count' ? 1 : x) : p.fn === 'sum' || p.fn === 'mean' ? acc + x : p.fn === 'min' ? Math.min(acc, x) : p.fn === 'max' ? Math.max(acc, x) : acc + 1;
            }
            out[i] = acc === null ? null : cleanNum(p.fn === 'mean' ? acc / n : acc);
          }
        }
        return withColumn(d, uniqueName(d.columns, p.name || `${p.column}_cumul`), (r, i) => out[i], p.column);
      },
    },
    {
      id: 'diff', name: 'Différence / variation', desc: 'Écart ou variation % avec la ligne précédente (décalage configurable).',
      params: [P.col(), P.sel('mode', 'Calcul', [['diff', 'Différence'], ['pct', 'Variation en %'], ['lag', 'Valeur décalée (lag)']]), P.num('lag', 'Décalage (lignes)', 1),
        P.col('group', 'Par groupe (optionnel)', { optional: true })],
      run(d, p) {
        needCol(d, p.column);
        const out = new Array(d.rows.length).fill(null), k = Math.round(+p.lag) || 1;
        for (const idx of groupIndex(d.rows, p.group ? [p.group] : []).values()) {
          idx.forEach((i, j) => {
            const pj = j - k;
            if (pj < 0 || pj >= idx.length) return;
            const prevRaw = d.rows[idx[pj]][p.column];
            if (p.mode === 'lag') { out[i] = prevRaw ?? null; return; }
            const cur = toNum(d.rows[i][p.column]), prev = toNum(prevRaw);
            if (Number.isNaN(cur) || Number.isNaN(prev)) return;
            out[i] = p.mode === 'pct' ? (prev ? cleanNum(round(((cur - prev) / Math.abs(prev)) * 100, 4)) : null) : cleanNum(cur - prev);
          });
        }
        return withColumn(d, uniqueName(d.columns, `${p.column}_${p.mode}`), (r, i) => out[i], p.column);
      },
    },
    {
      id: 'movingAvg', name: 'Moyenne mobile', desc: 'Moyenne (ou somme) glissante sur une fenêtre de n lignes.',
      params: [P.col(), P.num('window', 'Fenêtre', 3), P.sel('fn', 'Fonction', [['mean', 'Moyenne'], ['sum', 'Somme'], ['median', 'Médiane'], ['min', 'Min'], ['max', 'Max']]),
        P.chk('center', 'Fenêtre centrée')],
      run(d, p) {
        needCol(d, p.column);
        const w = Math.max(1, Math.round(+p.window));
        const vals = d.rows.map(r => r[p.column]);
        return withColumn(d, uniqueName(d.columns, `${p.column}_mm${w}`), (r, i) => {
          const start = p.center ? i - Math.floor(w / 2) : i - w + 1;
          if (start < 0 || start + w > vals.length) return null;
          return aggregate(vals.slice(start, start + w), p.fn);
        }, p.column);
      },
    },
    {
      id: 'rank', name: 'Rang', desc: 'Classement des valeurs (1 = plus grande ou plus petite), éventuellement par groupe.',
      params: [P.col(), P.sel('dir', 'Rang 1 =', [['desc', 'Plus grande valeur'], ['asc', 'Plus petite valeur']]), P.sel('method', 'Ex-aequo', [['min', 'Même rang (1, 2, 2, 4)'], ['dense', 'Rang dense (1, 2, 2, 3)']]),
        P.col('group', 'Par groupe (optionnel)', { optional: true })],
      run(d, p) {
        needCol(d, p.column);
        const out = new Array(d.rows.length).fill(null);
        for (const idx of groupIndex(d.rows, p.group ? [p.group] : []).values()) {
          const s = idx.filter(i => !isMissing(d.rows[i][p.column])).sort((a, b) => (p.dir === 'desc' ? -1 : 1) * compareValues(d.rows[a][p.column], d.rows[b][p.column]));
          let rank = 0, dense = 0, prev;
          s.forEach((i, k) => {
            const v = d.rows[i][p.column];
            if (k === 0 || compareValues(v, prev) !== 0) { rank = k + 1; dense++; }
            out[i] = p.method === 'dense' ? dense : rank;
            prev = v;
          });
        }
        return withColumn(d, uniqueName(d.columns, `${p.column}_rang`), (r, i) => out[i], p.column);
      },
    },
    {
      id: 'pctTotal', name: 'Part du total (%)', desc: 'Pourcentage de chaque valeur par rapport au total (ou au total du groupe).',
      params: [P.col(), P.col('group', 'Par groupe (optionnel)', { optional: true }), P.num('decimals', 'Décimales', 2)],
      run(d, p) {
        needCol(d, p.column);
        const out = new Array(d.rows.length).fill(null);
        for (const idx of groupIndex(d.rows, p.group ? [p.group] : []).values()) {
          const tot = idx.reduce((a, i) => { const n = toNum(d.rows[i][p.column]); return Number.isNaN(n) ? a : a + n; }, 0);
          idx.forEach(i => { const n = toNum(d.rows[i][p.column]); out[i] = Number.isNaN(n) || !tot ? null : round((n / tot) * 100, +p.decimals); });
        }
        return withColumn(d, uniqueName(d.columns, `${p.column}_pct`), (r, i) => out[i], p.column);
      },
    },
    {
      id: 'oneHot', name: 'Encodage one-hot', desc: 'Crée une colonne 0/1 par catégorie (variables indicatrices).',
      params: [P.col(), P.chk('drop', 'Supprimer la colonne d\'origine'), P.num('max', 'Nombre max. de catégories', 30)],
      run(d, p) {
        needCol(d, p.column);
        const cats = valueCounts(d.rows.map(r => r[p.column])).slice(0, +p.max).map(x => x[0]).sort(collator.compare);
        let columns = d.columns.slice();
        const names = cats.map(c => uniqueName(columns, `${p.column}_${c}`));
        columns.splice(columns.indexOf(p.column) + 1, 0, ...names);
        if (p.drop) columns = columns.filter(c => c !== p.column);
        return ds(columns, d.rows.map(r => {
          const o = { ...r };
          cats.forEach((c, k) => { o[names[k]] = !isMissing(r[p.column]) && String(r[p.column]) === c ? 1 : 0; });
          if (p.drop) delete o[p.column];
          return o;
        }));
      },
    },
    {
      id: 'labelEncode', name: 'Encodage numérique (label)', desc: 'Remplace chaque catégorie par un code entier (ordre alphabétique ou de fréquence).',
      params: [P.col(), P.sel('order', 'Ordre des codes', [['alpha', 'Alphabétique'], ['freq', 'Fréquence décroissante']]), P.num('start', 'Premier code', 0)],
      run(d, p) {
        needCol(d, p.column);
        const vc = valueCounts(d.rows.map(r => r[p.column])).map(x => x[0]);
        if (p.order === 'alpha') vc.sort(collator.compare);
        const map = new Map(vc.map((v, i) => [v, i + +p.start]));
        return withColumn(d, uniqueName(d.columns, `${p.column}_code`), r => (isMissing(r[p.column]) ? null : map.get(String(r[p.column]))), p.column);
      },
    },
  ]);

  // ======================= TEXTE
  cat('Texte', '🔤', [
    {
      id: 'length', name: 'Longueur du texte', desc: 'Nombre de caractères ou de mots.',
      params: [P.col(), P.sel('unit', 'Compter', [['chars', 'Caractères'], ['words', 'Mots']])],
      run(d, p) {
        needCol(d, p.column);
        return withColumn(d, uniqueName(d.columns, `${p.column}_${p.unit === 'words' ? 'mots' : 'longueur'}`), r => {
          if (isMissing(r[p.column])) return 0;
          const s = String(r[p.column]);
          return p.unit === 'words' ? s.trim().split(/\s+/).filter(Boolean).length : s.length;
        }, p.column);
      },
    },
    {
      id: 'substring', name: 'Extraire une sous-chaîne', desc: 'Garde n caractères à partir d\'une position (négatif = depuis la fin).',
      params: [P.col(), P.num('start', 'Position de départ (1 = début, −3 = 3 derniers)', 1), P.num('len', 'Longueur (0 = jusqu\'à la fin)', 3), P.text('name', 'Nom de la colonne (vide = en place)', '')],
      run(d, p) {
        needCol(d, p.column);
        const st = +p.start, ln = +p.len;
        const f = v => { if (isMissing(v)) return v; const s = String(v); const a = st > 0 ? st - 1 : Math.max(0, s.length + st); return s.substr(a, ln > 0 ? ln : undefined); };
        return p.name ? withColumn(d, uniqueName(d.columns, p.name), r => f(r[p.column]), p.column) : mapCols(d, [p.column], f);
      },
    },
    {
      id: 'padText', name: 'Compléter (padding)', desc: 'Complète à une longueur fixe, ex. codes postaux 1000 → 01000.',
      params: [P.cols('columns', 'Colonnes'), P.num('len', 'Longueur', 5), P.text('char', 'Caractère', '0'), P.sel('side', 'Côté', [['start', 'À gauche'], ['end', 'À droite']])],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        return mapCols(d, p.columns, v => (isMissing(v) ? v : p.side === 'start' ? String(v).padStart(+p.len, p.char || ' ') : String(v).padEnd(+p.len, p.char || ' ')));
      },
    },
    {
      id: 'affix', name: 'Ajouter préfixe / suffixe', desc: 'Ajoute du texte avant et/ou après chaque valeur.',
      params: [P.cols('columns', 'Colonnes'), P.text('prefix', 'Préfixe'), P.text('suffix', 'Suffixe'), P.chk('skipEmpty', 'Ignorer les cellules vides', true)],
      run(d, p) {
        need(p.columns && p.columns.length, 'Choisissez au moins une colonne.');
        return mapCols(d, p.columns, v => (p.skipEmpty && isMissing(v) ? v : `${p.prefix}${isMissing(v) ? '' : v}${p.suffix}`));
      },
    },
    {
      id: 'extractNumber', name: 'Extraire les nombres', desc: '« 12,5 kg » → 12.5 ; « Réf A-42 » → 42.',
      params: [P.col(), P.chk('inPlace', 'Modifier en place')],
      run(d, p) {
        needCol(d, p.column);
        const f = v => { if (isMissing(v)) return null; if (typeof v === 'number') return v; const m = String(v).match(/[-+]?\d[\d\s .,]*/); return m ? (Number.isNaN(toNum(m[0].trim().replace(/[.,]$/, ''))) ? null : toNum(m[0].trim().replace(/[.,]$/, ''))) : null; };
        return p.inPlace ? mapCols(d, [p.column], f) : withColumn(d, uniqueName(d.columns, `${p.column}_nombre`), r => f(r[p.column]), p.column);
      },
    },
    {
      id: 'slug', name: 'Créer un slug / identifiant', desc: '« Élodie Durand » → « elodie-durand ».',
      params: [P.col(), P.text('sep', 'Séparateur', '-')],
      run(d, p) {
        needCol(d, p.column);
        return withColumn(d, uniqueName(d.columns, `${p.column}_slug`), r => (isMissing(r[p.column]) ? null
          : removeAccents(String(r[p.column])).toLowerCase().replace(/[^a-z0-9]+/g, p.sep).replace(new RegExp(`^\\${p.sep}+|\\${p.sep}+$`, 'g'), '')), p.column);
      },
    },
    {
      id: 'stripHtml', name: 'Nettoyer le HTML', desc: 'Supprime les balises HTML et décode les entités courantes.', params: [P.cols()],
      run: (d, p) => mapCols(d, colsOrAll(d, p.columns), v => (typeof v === 'string'
        ? v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
        : v)),
    },
    {
      id: 'validate', name: 'Valider un format', desc: 'Vérifie e-mails, téléphones, codes postaux, URL… et crée une colonne vrai/faux.',
      params: [P.col(), P.sel('kind', 'Format', [['email', 'E-mail'], ['phoneFr', 'Téléphone français'], ['cpFr', 'Code postal français'], ['url', 'URL'],
        ['iban', 'IBAN (structure)'], ['number', 'Nombre'], ['date', 'Date'], ['regex', 'Regex personnalisée']]), P.text('pattern', 'Regex personnalisée', '')],
      run(d, p) {
        needCol(d, p.column);
        const res = { email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, phoneFr: /^(?:(?:\+|00)33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/, cpFr: /^(?:0[1-9]|[1-8]\d|9[0-8])\d{3}$/,
          url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i, iban: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/ };
        const f = p.kind === 'number' ? v => isNum(v) : p.kind === 'date' ? v => !!toDate(v)
          : v => (p.kind === 'regex' ? new RegExp(p.pattern) : res[p.kind]).test(p.kind === 'iban' ? String(v).replace(/\s/g, '').toUpperCase() : String(v).trim());
        return withColumn(d, uniqueName(d.columns, `${p.column}_valide`), r => (isMissing(r[p.column]) ? false : f(r[p.column])), p.column);
      },
    },
  ]);

  // ======================= DATES
  cat('Dates', '📅', [
    {
      id: 'dateParts', name: 'Extraire des éléments de date', desc: 'Année, mois, jour, jour de semaine, trimestre, semaine…',
      params: [P.col(), { name: 'parts', label: 'Éléments', type: 'multiselect', options: Object.entries(DATE_PARTS).map(([k, v]) => [k, v[0]]), default: ['annee', 'mois'] }],
      run(d, p) {
        needCol(d, p.column);
        need(p.parts && p.parts.length, 'Choisissez au moins un élément.');
        let out = d, after = p.column;
        for (const part of Object.keys(DATE_PARTS).filter(k => p.parts.includes(k))) {
          const name = uniqueName(out.columns, `${p.column}_${part}`);
          out = withColumn(out, name, r => { const dt = toDate(r[p.column]); return dt ? DATE_PARTS[part][1](dt) : null; }, after);
          after = name;
        }
        return out;
      },
    },
    {
      id: 'dateDiff', name: 'Écart entre deux dates', desc: 'Nombre de jours, mois, années… entre deux colonnes (ou jusqu\'à aujourd\'hui).',
      params: [P.col('start', 'Date de début'), P.col('end', 'Date de fin (vide = aujourd\'hui)', { optional: true }), P.sel('unit', 'Unité', DATE_UNITS), P.text('name', 'Nom de la colonne', 'ecart')],
      run(d, p) {
        needCol(d, p.start, 'date de début');
        const now = new Date();
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        return withColumn(d, uniqueName(d.columns, p.name || 'ecart'), r => {
          const a = toDate(r[p.start]), b = p.end ? toDate(r[p.end]) : today;
          return a && b ? diffDates(a, b, p.unit) : null;
        });
      },
    },
    {
      id: 'dateAdd', name: 'Ajouter / retirer du temps', desc: 'Décale des dates de n jours, mois, années…',
      params: [P.col(), P.num('amount', 'Quantité (négatif pour retirer)', 30), P.sel('unit', 'Unité', DATE_UNITS), P.text('name', 'Nom de la colonne (vide = en place)', '')],
      run(d, p) {
        needCol(d, p.column);
        const f = v => { const dt = toDate(v); if (!dt) return null; const r = addToDate(dt, +p.amount, p.unit); return formatDate(r, p.unit === 'heures' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'); };
        return p.name ? withColumn(d, uniqueName(d.columns, p.name), r => f(r[p.column]), p.column) : mapCols(d, [p.column], f);
      },
    },
    {
      id: 'age', name: 'Calculer un âge', desc: 'Âge en années révolues à partir d\'une date de naissance.',
      params: [P.col('column', 'Date de naissance'), P.text('at', 'À la date (vide = aujourd\'hui)', ''), P.text('name', 'Nom de la colonne', 'age')],
      run(d, p) {
        needCol(d, p.column);
        const now = new Date();
        const ref = p.at ? toDate(p.at) : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        need(ref, 'Date de référence invalide.');
        return withColumn(d, uniqueName(d.columns, p.name || 'age'), r => { const b = toDate(r[p.column]); return b ? diffDates(b, ref, 'annees') : null; }, p.column);
      },
    },
  ]);

  // ======================= RESTRUCTURER
  cat('Restructurer', '🔀', [
    {
      id: 'groupBy', name: 'Grouper et agréger', desc: 'Regroupe les lignes et calcule somme, moyenne, nombre… par groupe (comme un GROUP BY).',
      params: [P.cols('by', 'Grouper par'), P.cols('values', 'Colonnes à agréger'), { name: 'aggs', label: 'Agrégations', type: 'multiselect', options: AGGS, default: ['sum'] },
        P.chk('countRows', 'Ajouter le nombre de lignes par groupe', true)],
      run(d, p) {
        const by = (p.by || []).filter(c => d.columns.includes(c));
        need(by.length || (p.values && p.values.length) || p.countRows, 'Choisissez des colonnes.');
        const vals = (p.values || []).filter(c => d.columns.includes(c));
        const aggs = vals.length ? (p.aggs && p.aggs.length ? p.aggs : ['sum']) : [];
        const cols = [...by, ...(p.countRows ? ['nb_lignes'] : [])];
        for (const v of vals) for (const a of aggs) cols.push(`${v}_${a}`);
        const rows = [];
        for (const idx of groupIndex(d.rows, by).values()) {
          const g = idx.map(i => d.rows[i]);
          const o = {};
          for (const c of by) o[c] = g[0][c];
          if (p.countRows) o.nb_lignes = g.length;
          for (const v of vals) for (const a of aggs) o[`${v}_${a}`] = aggregate(g.map(r => r[v]), a);
          rows.push(o);
        }
        return ds(cols, rows);
      },
    },
    {
      id: 'pivot', name: 'Tableau croisé dynamique', desc: 'Lignes × colonnes avec une valeur agrégée (pivot).',
      params: [P.col('index', 'Lignes'), P.col('columns', 'Colonnes'), P.col('values', 'Valeurs (vide = comptage)', { optional: true }),
        P.sel('agg', 'Agrégation', AGGS, 'sum'), P.text('fill', 'Valeur des cases vides', '0'), P.chk('totals', 'Ajouter les totaux', true)],
      run(d, p) {
        needCol(d, p.index, 'colonne pour les lignes'); needCol(d, p.columns, 'colonne pour les colonnes');
        const agg = p.values ? p.agg : 'count_all';
        const colVals = [...new Set(d.rows.map(r => (isMissing(r[p.columns]) ? '(vide)' : String(r[p.columns]))))].sort(collator.compare);
        need(colVals.length <= 500, 'Trop de colonnes (> 500).');
        const cells = new Map();
        for (const r of d.rows) {
          const k = isMissing(r[p.index]) ? '(vide)' : String(r[p.index]);
          const c = isMissing(r[p.columns]) ? '(vide)' : String(r[p.columns]);
          if (!cells.has(k)) cells.set(k, new Map());
          const m = cells.get(k);
          if (!m.has(c)) m.set(c, []);
          m.get(c).push(p.values ? r[p.values] : 1);
        }
        const fill = literal(p.fill);
        const idxName = p.index;
        const colNames = colVals.map(c => (c === idxName ? c + '_' : c));
        const cols = [idxName, ...colNames, ...(p.totals ? ['Total'] : [])];
        const keys = [...cells.keys()].sort(collator.compare);
        const rows = keys.map(k => {
          const o = { [idxName]: literal(k) };
          const all = [];
          colVals.forEach((c, j) => { const v = cells.get(k).get(c); if (v) all.push(...v); o[colNames[j]] = v ? aggregate(v, agg) : fill; });
          if (p.totals) o.Total = aggregate(all, agg);
          return o;
        });
        if (p.totals) {
          const t = { [idxName]: 'Total' };
          colVals.forEach((c, j) => { const all = []; for (const k of keys) { const v = cells.get(k).get(c); if (v) all.push(...v); } t[colNames[j]] = aggregate(all, agg); });
          t.Total = aggregate(d.rows.map(r => (p.values ? r[p.values] : 1)), agg);
          rows.push(t);
        }
        return ds(cols, rows);
      },
    },
    {
      id: 'melt', name: 'Dépivoter (colonnes → lignes)', desc: 'Transforme des colonnes en paires (variable, valeur) : format « long ».',
      params: [P.cols('ids', 'Colonnes identifiantes (conservées)'), P.cols('values', 'Colonnes à dépivoter (vide = toutes les autres)'),
        P.text('varName', 'Nom de la colonne « variable »', 'variable'), P.text('valueName', 'Nom de la colonne « valeur »', 'valeur')],
      run(d, p) {
        const ids = (p.ids || []).filter(c => d.columns.includes(c));
        const vals = p.values && p.values.length ? p.values.filter(c => d.columns.includes(c) && !ids.includes(c)) : d.columns.filter(c => !ids.includes(c));
        need(vals.length, 'Aucune colonne à dépivoter.');
        const vn = p.varName || 'variable', valn = p.valueName || 'valeur';
        const rows = [];
        for (const r of d.rows) for (const v of vals) { const o = {}; for (const c of ids) o[c] = r[c]; o[vn] = v; o[valn] = r[v]; rows.push(o); }
        return ds([...ids, vn, valn], rows);
      },
    },
    {
      id: 'transpose', name: 'Transposer', desc: 'Les lignes deviennent des colonnes et inversement.',
      params: [P.col('header', 'Colonne servant d\'en-têtes (optionnel)', { optional: true })],
      run(d, p) {
        need(d.rows.length <= 1000, 'Trop de lignes pour transposer (max. 1000).');
        const names = [];
        d.rows.forEach((r, i) => names.push(uniqueName(['champ', ...names], p.header && !isMissing(r[p.header]) ? String(r[p.header]) : `ligne_${i + 1}`)));
        const src = d.columns.filter(c => c !== p.header);
        return ds(['champ', ...names], src.map(c => { const o = { champ: c }; d.rows.forEach((r, i) => { o[names[i]] = r[c]; }); return o; }));
      },
    },
    {
      id: 'join', name: 'Joindre un autre jeu de données', desc: 'Fusionne avec un jeu enregistré via une clé commune (comme RECHERCHEV / JOIN SQL).',
      params: [{ name: 'other', label: 'Jeu de données à joindre', type: 'dataset' }, P.col('leftKey', 'Clé (jeu actuel)'),
        { name: 'rightKey', label: 'Clé (autre jeu)', type: 'datasetColumn', of: 'other' },
        P.sel('how', 'Type de jointure', [['left', 'Gauche (garder toutes les lignes actuelles)'], ['inner', 'Interne (seulement les correspondances)'], ['right', 'Droite'], ['full', 'Complète'],
          ['anti', 'Anti-jointure (lignes sans correspondance)']]), P.chk('loose', 'Clés insensibles à la casse et aux espaces', true)],
      run(d, p, ctx) {
        const o = ctx && ctx.datasets && ctx.datasets[p.other];
        need(o, 'Choisissez un jeu de données enregistré (onglet « Jeux de données »).');
        needCol(d, p.leftKey, 'clé du jeu actuel'); needCol(o, p.rightKey, 'clé de l\'autre jeu');
        const norm = v => (isMissing(v) ? null : p.loose ? String(v).trim().toLowerCase() : String(v));
        const rename = {};
        const rightCols = [];
        for (const c of o.columns) {
          if (c === p.rightKey && p.rightKey === p.leftKey) continue;
          const n = d.columns.includes(c) || rightCols.includes(c) ? uniqueName([...d.columns, ...rightCols], c + '_2') : c;
          rename[c] = n; rightCols.push(n);
        }
        const index = new Map();
        o.rows.forEach((r, i) => { const k = norm(r[p.rightKey]); if (k === null) return; if (!index.has(k)) index.set(k, []); index.get(k).push(i); });
        const used = new Set(), rows = [];
        const merge = (l, r) => { const x = l ? { ...l } : {}; if (!l) for (const c of d.columns) x[c] = null; if (!l && p.rightKey === p.leftKey) x[p.leftKey] = r[p.rightKey];
          for (const c in rename) x[rename[c]] = r ? r[c] : null; return x; };
        for (const l of d.rows) {
          const m = index.get(norm(l[p.leftKey]));
          if (p.how === 'anti') { if (!m) rows.push(l); continue; }
          if (m) for (const i of m) { used.add(i); rows.push(merge(l, o.rows[i])); }
          else if (p.how === 'left' || p.how === 'full') rows.push(merge(l, null));
        }
        if (p.how === 'anti') return ds(d.columns.slice(), rows);
        if (p.how === 'right' || p.how === 'full') o.rows.forEach((r, i) => { if (!used.has(i)) rows.push(merge(null, r)); });
        return ds([...d.columns, ...rightCols], rows);
      },
    },
    {
      id: 'append', name: 'Ajouter les lignes d\'un autre jeu', desc: 'Empile un jeu enregistré sous le jeu actuel (union, colonnes alignées par nom).',
      params: [{ name: 'other', label: 'Jeu de données', type: 'dataset' }, P.chk('source', 'Ajouter une colonne « source »')],
      run(d, p, ctx) {
        const o = ctx && ctx.datasets && ctx.datasets[p.other];
        need(o, 'Choisissez un jeu de données enregistré.');
        const cols = [...d.columns, ...o.columns.filter(c => !d.columns.includes(c))];
        const src = p.source ? uniqueName(cols, 'source') : null;
        const fill = (r, name) => { const x = {}; for (const c of cols) x[c] = r[c] ?? null; if (src) x[src] = name; return x; };
        return ds(src ? [...cols, src] : cols, [...d.rows.map(r => fill(r, 'actuel')), ...o.rows.map(r => fill(r, p.other))]);
      },
    },
  ]);

  // ======================= ANALYSE (résultats affichés à part)
  cat('Analyse', '📊', [
    {
      id: 'describe', name: 'Statistiques descriptives', desc: 'Tableau récapitulatif : type, manquants, distinctes, moyenne, écart-type, quartiles…',
      params: [P.cols()],
      run(d, p) {
        const rows = colsOrAll(d, p.columns).map(c => {
          const vals = d.rows.map(r => r[c]);
          const type = inferType(vals);
          const miss = vals.filter(isMissing).length;
          const s = describeNums(numericValues(d.rows, c));
          const top = valueCounts(vals)[0];
          const num = type === 'nombre';
          const f = x => (num && Number.isFinite(x) ? round(x, 4) : null);
          return { colonne: c, type, valeurs: vals.length - miss, manquantes: miss, pct_manquantes: vals.length ? round((miss / vals.length) * 100, 1) : 0,
            distinctes: new Set(vals.filter(v => !isMissing(v)).map(String)).size, moyenne: f(s.mean), ecart_type: f(s.std), min: f(s.min), q1: f(s.q1),
            mediane: f(s.median), q3: f(s.q3), max: f(s.max), somme: f(s.sum), asymetrie: f(s.skew), plus_frequente: top ? top[0] : null, frequence: top ? top[1] : null };
        });
        return result('Statistiques descriptives', ds(['colonne', 'type', 'valeurs', 'manquantes', 'pct_manquantes', 'distinctes', 'moyenne', 'ecart_type', 'min', 'q1', 'mediane', 'q3', 'max', 'somme', 'asymetrie', 'plus_frequente', 'frequence'], rows));
      },
    },
    {
      id: 'valueCounts', name: 'Fréquences (comptage des valeurs)', desc: 'Nombre et pourcentage de chaque valeur d\'une colonne.',
      params: [P.col(), P.chk('includeMissing', 'Inclure les valeurs vides'), P.num('limit', 'Limiter aux N premières (0 = toutes)', 0)],
      run(d, p) {
        needCol(d, p.column);
        let vc = valueCounts(d.rows.map(r => r[p.column]));
        const miss = d.rows.filter(r => isMissing(r[p.column])).length;
        if (p.includeMissing && miss) vc.push(['(vide)', miss]);
        const tot = vc.reduce((a, b) => a + b[1], 0);
        if (+p.limit > 0) vc = vc.slice(0, +p.limit);
        let cum = 0;
        return result(`Fréquences — ${p.column}`, ds([p.column, 'effectif', 'pourcentage', 'pct_cumule'], vc.map(([v, n]) => { cum += n; return { [p.column]: literal(v), effectif: n, pourcentage: round((n / tot) * 100, 2), pct_cumule: round((cum / tot) * 100, 2) }; })));
      },
    },
    {
      id: 'crosstab', name: 'Tableau de contingence', desc: 'Effectifs croisés de deux variables qualitatives, avec test du khi² d\'indépendance.',
      params: [P.col('a', 'Variable en lignes'), P.col('b', 'Variable en colonnes'), P.sel('norm', 'Affichage', [['count', 'Effectifs'], ['row', '% en ligne'], ['col', '% en colonne'], ['total', '% du total']])],
      run(d, p) {
        needCol(d, p.a, 'variable en lignes'); needCol(d, p.b, 'variable en colonnes');
        const key = v => (isMissing(v) ? '(vide)' : String(v));
        const A = [...new Set(d.rows.map(r => key(r[p.a])))].sort(collator.compare), B = [...new Set(d.rows.map(r => key(r[p.b])))].sort(collator.compare);
        const m = new Map();
        for (const r of d.rows) { const k = key(r[p.a]) + '\u0000' + key(r[p.b]); m.set(k, (m.get(k) || 0) + 1); }
        const n = d.rows.length;
        const rowTot = A.map(a => B.reduce((s, b) => s + (m.get(a + '\u0000' + b) || 0), 0));
        const colTot = B.map(b => A.reduce((s, a) => s + (m.get(a + '\u0000' + b) || 0), 0));
        let chi2 = 0;
        A.forEach((a, i) => B.forEach((b, j) => { const e = (rowTot[i] * colTot[j]) / n; if (e) chi2 += ((m.get(a + '\u0000' + b) || 0) - e) ** 2 / e; }));
        const dof = (A.length - 1) * (B.length - 1);
        const cramer = n && Math.min(A.length, B.length) > 1 ? Math.sqrt(chi2 / (n * (Math.min(A.length, B.length) - 1))) : NaN;
        const val = (c, i, j) => { if (p.norm === 'row') return round((c / rowTot[i]) * 100, 2); if (p.norm === 'col') return round((c / colTot[j]) * 100, 2); if (p.norm === 'total') return round((c / n) * 100, 2); return c; };
        const first = `${p.a} \\ ${p.b}`;
        const bn = B.map(b => (b === first || b === 'Total' ? b + '_' : b));
        const rows = A.map((a, i) => { const o = { [first]: a }; B.forEach((b, j) => { o[bn[j]] = val(m.get(a + '\u0000' + b) || 0, i, j); }); o.Total = p.norm === 'count' ? rowTot[i] : p.norm === 'total' ? round((rowTot[i] / n) * 100, 2) : 100; return o; });
        if (p.norm === 'count' || p.norm === 'total') { const t = { [first]: 'Total' }; B.forEach((b, j) => { t[bn[j]] = p.norm === 'count' ? colTot[j] : round((colTot[j] / n) * 100, 2); }); t.Total = p.norm === 'count' ? n : 100; rows.push(t); }
        return result(`Contingence ${p.a} × ${p.b} — khi² = ${round(chi2, 3)}, ddl = ${dof}, p ≈ ${chi2pValue(chi2, dof).toPrecision(3)}, V de Cramér = ${round(cramer, 3)}`, ds([first, ...bn, 'Total'], rows));
      },
    },
    {
      id: 'correlation', name: 'Matrice de corrélation', desc: 'Corrélations de Pearson ou de Spearman entre colonnes numériques.',
      params: [P.cols('columns', 'Colonnes (vide = toutes les numériques)'), P.sel('method', 'Méthode', [['pearson', 'Pearson (linéaire)'], ['spearman', 'Spearman (rangs)']])],
      run(d, p) {
        const cols = p.columns && p.columns.length ? p.columns.filter(c => d.columns.includes(c)) : d.columns.filter(c => inferType(d.rows.map(r => r[c])) === 'nombre');
        need(cols.length >= 2, 'Il faut au moins deux colonnes numériques.');
        const rows = cols.map(a => {
          const o = { variable: a };
          for (const b of cols) {
            let [xs, ys] = pairs(d.rows, a, b);
            if (p.method === 'spearman') { xs = ranks(xs); ys = ranks(ys); }
            const r = pearson(xs, ys);
            o[b] = Number.isFinite(r) ? round(r, 4) : null;
          }
          return o;
        });
        return result(`Corrélations (${p.method === 'spearman' ? 'Spearman' : 'Pearson'})`, ds(['variable', ...cols], rows));
      },
    },
    {
      id: 'regression', name: 'Régression linéaire', desc: 'Y = a·X + b : pente, ordonnée, R², et colonne de prédiction optionnelle.',
      params: [P.col('x', 'Variable explicative X'), P.col('y', 'Variable à expliquer Y'), P.chk('addPred', 'Ajouter les colonnes prédiction et résidu au jeu de données')],
      run(d, p) {
        needCol(d, p.x, 'variable X'); needCol(d, p.y, 'variable Y');
        const [xs, ys] = pairs(d.rows, p.x, p.y);
        need(xs.length >= 3, 'Pas assez de paires de valeurs numériques (min. 3).');
        const m = linearRegression(xs, ys);
        if (p.addPred) {
          const out = withColumn(d, uniqueName(d.columns, `${p.y}_pred`), r => { const x = toNum(r[p.x]); return Number.isNaN(x) ? null : cleanNum(round(m.slope * x + m.intercept, 6)); });
          const pn = out.columns[out.columns.length - 1];
          return withColumn(out, uniqueName(out.columns, `${p.y}_residu`), r => { const y = toNum(r[p.y]); return Number.isNaN(y) || r[pn] === null ? null : cleanNum(round(y - r[pn], 6)); });
        }
        return result(`Régression ${p.y} ~ ${p.x}`, ds(['indicateur', 'valeur'], [
          { indicateur: 'Équation', valeur: `${p.y} = ${round(m.slope, 6)} × ${p.x} ${m.intercept < 0 ? '−' : '+'} ${round(Math.abs(m.intercept), 6)}` },
          { indicateur: 'Pente (a)', valeur: round(m.slope, 6) }, { indicateur: 'Ordonnée à l\'origine (b)', valeur: round(m.intercept, 6) },
          { indicateur: 'Coefficient de corrélation r', valeur: round(m.r, 6) }, { indicateur: 'R²', valeur: round(m.r2, 6) }, { indicateur: 'Observations', valeur: m.n },
        ]));
      },
    },
    {
      id: 'outliers', name: 'Valeurs aberrantes', desc: 'Détecte les valeurs extrêmes (méthode IQR de Tukey ou z-score) : signaler, supprimer ou isoler.',
      params: [P.col('column', 'Colonne numérique'), P.sel('method', 'Méthode', [['iqr', 'IQR (Q1 − k·IQR, Q3 + k·IQR)'], ['z', 'z-score (|z| > k)']]), P.num('k', 'Seuil k', 1.5),
        P.sel('action', 'Action', [['flag', 'Ajouter une colonne indicatrice'], ['remove', 'Supprimer les lignes aberrantes'], ['only', 'Ne garder que les lignes aberrantes'], ['null', 'Vider les valeurs aberrantes']])],
      run(d, p) {
        needCol(d, p.column);
        const s = describeNums(numericValues(d.rows, p.column));
        need(s.count, 'La colonne ne contient pas de nombres.');
        const k = +p.k;
        const lo = p.method === 'iqr' ? s.q1 - k * (s.q3 - s.q1) : s.mean - k * s.std;
        const hi = p.method === 'iqr' ? s.q3 + k * (s.q3 - s.q1) : s.mean + k * s.std;
        const out = r => { const n = toNum(r[p.column]); return !Number.isNaN(n) && (n < lo || n > hi); };
        if (p.action === 'remove') return ds(d.columns.slice(), d.rows.filter(r => !out(r)));
        if (p.action === 'only') return ds(d.columns.slice(), d.rows.filter(out));
        if (p.action === 'null') return mapCols(d, [p.column], (v, r) => (out(r) ? null : v));
        return withColumn(d, uniqueName(d.columns, `${p.column}_aberrant`), out, p.column);
      },
    },
    {
      id: 'missingReport', name: 'Rapport des valeurs manquantes', desc: 'Nombre et pourcentage de cellules vides par colonne.', params: [],
      run(d) {
        const n = d.rows.length;
        return result('Valeurs manquantes', ds(['colonne', 'manquantes', 'pourcentage', 'remplies'], d.columns.map(c => {
          const m = d.rows.filter(r => isMissing(r[c])).length;
          return { colonne: c, manquantes: m, pourcentage: n ? round((m / n) * 100, 2) : 0, remplies: n - m };
        }).sort((a, b) => b.manquantes - a.manquantes)));
      },
    },
    {
      id: 'duplicatesReport', name: 'Afficher les doublons', desc: 'Liste les lignes en double avec leur nombre d\'occurrences.',
      params: [P.cols('columns', 'Colonnes de comparaison (vide = toutes)')],
      run(d, p) {
        const cols = colsOrAll(d, p.columns);
        const g = groupIndex(d.rows, cols);
        const rows = [];
        for (const idx of g.values()) if (idx.length > 1) { const o = { occurrences: idx.length, lignes: idx.map(i => i + 1).join(', ') }; for (const c of cols) o[c] = d.rows[idx[0]][c]; rows.push(o); }
        rows.sort((a, b) => b.occurrences - a.occurrences);
        return result(`Doublons (${rows.length} groupe${rows.length > 1 ? 's' : ''})`, ds(['occurrences', 'lignes', ...cols], rows));
      },
    },
    {
      id: 'groupCompare', name: 'Comparer des groupes', desc: 'Moyenne, médiane, écart-type d\'une variable numérique selon les modalités d\'une variable qualitative (+ test ANOVA).',
      params: [P.col('value', 'Variable numérique'), P.col('group', 'Variable de groupe')],
      run(d, p) {
        needCol(d, p.value, 'variable numérique'); needCol(d, p.group, 'variable de groupe');
        const groups = [];
        for (const idx of groupIndex(d.rows, [p.group]).values()) {
          const vals = idx.map(i => toNum(d.rows[i][p.value])).filter(x => !Number.isNaN(x));
          groups.push({ name: d.rows[idx[0]][p.group], vals, s: describeNums(vals) });
        }
        const all = groups.flatMap(g => g.vals), N = all.length, k = groups.filter(g => g.vals.length).length;
        const gm = all.reduce((a, b) => a + b, 0) / N;
        const ssb = groups.reduce((a, g) => a + (g.vals.length ? g.vals.length * (g.s.mean - gm) ** 2 : 0), 0);
        const ssw = groups.reduce((a, g) => a + g.vals.reduce((x, v) => x + (v - g.s.mean) ** 2, 0), 0);
        const F = k > 1 && N > k ? (ssb / (k - 1)) / (ssw / (N - k)) : NaN;
        const rows = groups.map(g => ({ [p.group]: isMissing(g.name) ? '(vide)' : g.name, effectif: g.s.count, moyenne: g.s.count ? round(g.s.mean, 4) : null,
          mediane: g.s.count ? round(g.s.median, 4) : null, ecart_type: g.s.count > 1 ? round(g.s.std, 4) : null, min: g.s.count ? g.s.min : null, max: g.s.count ? g.s.max : null }))
          .sort((a, b) => compareValues(a[p.group], b[p.group]));
        const pv = Number.isFinite(F) ? fPValue(F, k - 1, N - k) : NaN;
        return result(`${p.value} par ${p.group} — ANOVA : F = ${Number.isFinite(F) ? round(F, 3) : 'n/a'}, p ≈ ${Number.isFinite(pv) ? pv.toPrecision(3) : 'n/a'}`, ds([p.group, 'effectif', 'moyenne', 'mediane', 'ecart_type', 'min', 'max'], rows));
      },
    },
  ]);

  // ------------------------------------------------------------------ lois statistiques (p-valeurs)
  function gammaln(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const k of c) ser += k / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  }
  function gammaincUpper(a, x) { // Q(a, x)
    if (x <= 0) return 1;
    if (x < a + 1) {
      let sum = 1 / a, del = sum, ap = a;
      for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
    }
    let b = x + 1 - a, c = 1e300, dd = 1 / b, h = dd;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      dd = an * dd + b; if (Math.abs(dd) < 1e-300) dd = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      dd = 1 / dd; const del = dd * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  }
  function chi2pValue(x, k) { return k > 0 ? gammaincUpper(k / 2, x / 2) : NaN; }
  function betacf(a, b, x) {
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, dd = 1 - (qab * x) / qap;
    if (Math.abs(dd) < 1e-300) dd = 1e-300; dd = 1 / dd; let h = dd;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      dd = 1 + aa * dd; if (Math.abs(dd) < 1e-300) dd = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; dd = 1 / dd; h *= dd * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      dd = 1 + aa * dd; if (Math.abs(dd) < 1e-300) dd = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; dd = 1 / dd;
      const del = dd * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
  function fPValue(F, d1, d2) { return ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2); }

  // Affichage conditionnel des champs dans l'interface : { outil: { paramètre: p => visible } }
  const WHEN = {
    fillMissing: { value: p => p.method === 'const' },
    renameAll: { text: p => p.mode === 'prefix' || p.mode === 'suffix' },
    standardizeDates: { custom: p => p.fmt === 'custom' },
    moveCol: { ref: p => p.pos === 'before' || p.pos === 'after' },
    conditional: { value: p => !['empty', 'notempty'].includes(p.op), value2: p => p.op === 'between' },
    filter: { value: p => !['empty', 'notempty'].includes(p.op), value2: p => p.op === 'between', column2: p => p.combine !== 'none',
      op2: p => p.combine !== 'none', value3: p => p.combine !== 'none' && !['empty', 'notempty'].includes(p.op2) },
    sort: { d2: p => !!p.c2, c3: p => !!p.c2, d3: p => !!p.c3 },
    sample: { seed: p => p.method === 'random' || p.method === 'pct' },
    math: { value: p => ['add', 'sub', 'mul', 'div', 'pow', 'mod'].includes(p.op) },
    bin: { bins: p => p.method !== 'custom', edges: p => p.method === 'custom' },
    validate: { pattern: p => p.kind === 'regex' },
    groupBy: { aggs: p => p.values && p.values.length > 0 },
    pivot: { agg: p => !!p.values },
  };
  for (const t of TOOLS) for (const def of t.params) if (WHEN[t.id] && WHEN[t.id][def.name]) def.when = WHEN[t.id][def.name];

  const toolById = Object.fromEntries(TOOLS.map(t => [t.id, t]));
  function runTool(id, data, params, ctx) {
    const t = toolById[id];
    if (!t) throw new Error('Outil inconnu : ' + id);
    const p = {};
    for (const def of t.params) p[def.name] = params && params[def.name] !== undefined ? params[def.name] : def.default ?? (def.type === 'columns' || def.type === 'multiselect' ? [] : '');
    return t.run(data, p, ctx || {});
  }

  // ------------------------------------------------------------------ import JSON
  function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? (v.every(x => typeof x !== 'object') ? v.join(', ') : JSON.stringify(v)) : v;
    }
    return out;
  }
  function fromJSON(json) {
    let arr = json;
    if (!Array.isArray(arr)) {
      if (arr && typeof arr === 'object') {
        const k = Object.keys(arr).find(key => Array.isArray(arr[key]));
        arr = k ? arr[k] : [arr];
      } else throw new Error('JSON non tabulaire.');
    }
    if (arr.length && Array.isArray(arr[0])) { // tableau de tableaux : 1re ligne = en-têtes
      const header = arr[0].map((h, i) => String(h ?? `colonne_${i + 1}`));
      return fromRecords(arr.slice(1).map(a => Object.fromEntries(header.map((h, i) => [h, a[i] ?? null]))));
    }
    return fromRecords(arr.map(x => (x && typeof x === 'object' ? flatten(x) : { valeur: x })));
  }
  function fromRecords(records) {
    const columns = [];
    const seen = new Set();
    for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
    return ds(columns, records.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? null]))));
  }
  /** Tableau de tableaux (1re ligne = en-têtes) → jeu de données, noms dédoublonnés. */
  function fromMatrix(matrix, hasHeader = true) {
    const width = Math.max(0, ...matrix.map(r => r.length));
    const names = [];
    const head = hasHeader ? matrix[0] || [] : [];
    for (let i = 0; i < width; i++) {
      const h = hasHeader && !isMissing(head[i]) ? String(head[i]).trim() : `colonne_${i + 1}`;
      names.push(uniqueName(names, h));
    }
    const body = hasHeader ? matrix.slice(1) : matrix;
    return ds(names, body.filter(r => r.some(v => !isMissing(v))).map(r => Object.fromEntries(names.map((n, i) => [n, r[i] === undefined || r[i] === '' ? null : r[i]]))));
  }

  // ------------------------------------------------------------------ export
  function csvCell(v, sep) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : String(v);
    return /["\n\r]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCSV(d, sep = ',', header = true, decimalComma = false) {
    const cell = v => csvCell(decimalComma && typeof v === 'number' ? String(v).replace('.', ',') : v, sep);
    const lines = d.rows.map(r => d.columns.map(c => cell(r[c])).join(sep));
    if (header) lines.unshift(d.columns.map(c => cell(c)).join(sep));
    return lines.join('\r\n');
  }
  function toJSONText(d, pretty = true) { return JSON.stringify(d.rows.map(r => Object.fromEntries(d.columns.map(c => [c, r[c] ?? null]))), null, pretty ? 2 : 0); }
  function toMarkdown(d) {
    const esc = v => (isMissing(v) ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '));
    return [`| ${d.columns.map(esc).join(' | ')} |`, `| ${d.columns.map(() => '---').join(' | ')} |`, ...d.rows.map(r => `| ${d.columns.map(c => esc(r[c])).join(' | ')} |`)].join('\n');
  }
  function toSQL(d, table = 'donnees') {
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const types = d.columns.map(c => { const t = inferType(d.rows.map(r => r[c])); return t === 'nombre' ? 'NUMERIC' : t === 'booléen' ? 'BOOLEAN' : t === 'date' ? 'DATE' : 'TEXT'; });
    const lit = (v, t) => { if (isMissing(v)) return 'NULL'; if (t === 'NUMERIC') { const n = toNum(v); return Number.isNaN(n) ? 'NULL' : String(n); } if (t === 'BOOLEAN') { const b = toBool(v); return b === null ? 'NULL' : b ? 'TRUE' : 'FALSE'; } return `'${String(v).replace(/'/g, "''")}'`; };
    const out = [`CREATE TABLE ${q(table)} (\n  ${d.columns.map((c, i) => `${q(c)} ${types[i]}`).join(',\n  ')}\n);`];
    for (const r of d.rows) out.push(`INSERT INTO ${q(table)} (${d.columns.map(q).join(', ')}) VALUES (${d.columns.map((c, i) => lit(r[c], types[i])).join(', ')});`);
    return out.join('\n');
  }
  function toHTML(d) {
    const e = v => (isMissing(v) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    return `<table>\n<thead><tr>${d.columns.map(c => `<th>${e(c)}</th>`).join('')}</tr></thead>\n<tbody>\n${d.rows.map(r => `<tr>${d.columns.map(c => `<td>${e(r[c])}</td>`).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`;
  }
  function toXML(d) {
    const e = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tag = c => { const t = toSnake(c); return /^[a-z_]/.test(t) ? t : '_' + t; };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<donnees>\n${d.rows.map(r => `  <ligne>${d.columns.map(c => (isMissing(r[c]) ? `<${tag(c)}/>` : `<${tag(c)}>${e(r[c])}</${tag(c)}>`)).join('')}</ligne>`).join('\n')}\n</donnees>`;
  }

  // ------------------------------------------------------------------ jeux de démonstration
  function sampleSales(n = 240, seed = 7) {
    const rng = mulberry32(seed);
    const pick = a => a[Math.floor(rng() * a.length)];
    const regions = ['Nord', 'Sud', 'Est', 'Ouest', 'Île-de-France'];
    const products = [['Clavier', 49], ['Souris', 25], ['Écran 24"', 179], ['Casque', 89], ['Webcam', 65], ['Ordinateur portable', 899], ['Tablette', 329]];
    const vendeurs = ['Alice Martin', 'bruno petit', 'Chloé Durand ', 'DAVID LEROY', 'Emma Bernard', 'Farid Haddad'];
    const rows = [];
    for (let i = 0; i < n; i++) {
      const [prod, prix] = pick(products);
      const d = new Date(Date.UTC(2025, 0, 1) + Math.floor(rng() * 365) * 86400000);
      const fmt = rng();
      const date = fmt < 0.7 ? formatDate(d) : fmt < 0.9 ? formatDate(d, 'DD/MM/YYYY') : formatDate(d, 'DD-MM-YYYY');
      const qte = 1 + Math.floor(rng() * 8);
      const remise = rng() < 0.3 ? pick([5, 10, 15, 20]) : 0;
      rows.push({
        id_commande: 1000 + i, date, region: rng() < 0.04 ? null : pick(regions), vendeur: pick(vendeurs), produit: prod,
        prix_unitaire: rng() < 0.03 ? null : prix, quantite: rng() < 0.01 ? 250 : qte, remise_pct: remise,
        client_email: rng() < 0.05 ? 'invalide@' : `client${Math.floor(rng() * 90) + 10}@exemple.fr`, satisfaction: rng() < 0.1 ? null : 1 + Math.floor(rng() * 5),
      });
      if (rng() < 0.03) rows.push({ ...rows[rows.length - 1] }); // doublons volontaires
    }
    return fromRecords(rows);
  }
  function sampleSellers() {
    return fromRecords([
      { vendeur: 'Alice Martin', equipe: 'A', embauche: '2019-03-01', objectif_annuel: 60000, date_naissance: '1988-06-12' },
      { vendeur: 'Bruno Petit', equipe: 'A', embauche: '2021-09-15', objectif_annuel: 45000, date_naissance: '1995-01-30' },
      { vendeur: 'Chloé Durand', equipe: 'B', embauche: '2017-01-10', objectif_annuel: 70000, date_naissance: '1983-11-05' },
      { vendeur: 'David Leroy', equipe: 'B', embauche: '2022-05-02', objectif_annuel: 40000, date_naissance: '1999-08-21' },
      { vendeur: 'Emma Bernard', equipe: 'C', embauche: '2020-11-23', objectif_annuel: 55000, date_naissance: '1991-04-17' },
      { vendeur: 'Gaëlle Robert', equipe: 'C', embauche: '2024-02-01', objectif_annuel: 35000, date_naissance: '2000-12-02' },
    ]);
  }

  return {
    // utilitaires
    isMissing, toNum, isNum, toDate, formatDate, toBool, inferType, removeAccents, toSnake, compareValues, uniqueName, round, template,
    // stats
    numericValues, quantile, describeNums, valueCounts, aggregate, pearson, linearRegression, chi2pValue, fPValue, AGGS, OPS, makeTest,
    // outils
    TOOLS, CATEGORIES, toolById, runTool, compileExpr,
    // import / export
    ds, fromJSON, fromRecords, fromMatrix, toCSV, toJSONText, toMarkdown, toSQL, toHTML, toXML, sampleSales, sampleSellers,
  };
});
