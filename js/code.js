/*
 * DataLab — exécution de code sur les données : SQL, Python, R et JavaScript, directement dans le navigateur.
 *   SQL        AlaSQL (embarqué)
 *   Python     Pyodide (CPython WebAssembly) + pandas, numpy, matplotlib, scipy, scikit-learn…
 *   R          webR (R WebAssembly), paquets installables avec webr::install("dplyr")
 *   JavaScript fonction asynchrone du navigateur
 * Chaque moteur reçoit le jeu actuel (df / data) et les jeux enregistrés (datasets), et renvoie
 * { table: {columns, rows} | null, text, output, images: [dataURL] }.
 */
(function (root) {
  'use strict';
  // Adresses surchargeables (tests, auto-hébergement) via window.DATALAB_RUNTIMES
  const CFG = Object.assign({
    pyodide: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/',
    webr: 'https://cdn.jsdelivr.net/npm/webr@0.6.0/dist/',
  }, root.DATALAB_RUNTIMES || {});

  const cellOut = v => (v === undefined ? null : v);
  const toMatrix = d => ({ columns: d.columns, rows: d.rows.map(r => d.columns.map(c => cellOut(r[c]))) });

  // ------------------------------------------------------------------ SQL (AlaSQL)
  const sqlName = n => n.replace(/[[\]]/g, '');
  async function runSQL(code, { data, datasets }) {
    if (!root.alasql) throw new Error('Le moteur SQL n\'est pas chargé.');
    const reg = (name, d) => {
      const t = sqlName(name);
      alasql(`CREATE TABLE IF NOT EXISTS [${t}]`);
      alasql.tables[t].data = d.rows;
    };
    reg('data', data);
    for (const [n, d] of Object.entries(datasets)) reg(n, d);
    let res = alasql(code);
    if (Array.isArray(res) && res.length && Array.isArray(res[0])) res = res[res.length - 1];
    if (!Array.isArray(res)) return { table: null, text: JSON.stringify(res), output: '', images: [] };
    const records = res.map(r => (r && typeof r === 'object' ? r : { valeur: r }));
    const cols = [];
    for (const r of records) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
    return { table: { columns: cols, rows: records.map(r => cols.map(c => cellOut(r[c]))) }, text: null, output: '', images: [] };
  }

  // ------------------------------------------------------------------ JavaScript
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function tableFromJS(v) {
    if (v && Array.isArray(v.columns) && Array.isArray(v.rows)) return toMatrix(v);
    if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const cols = [];
      for (const r of v) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
      return { columns: cols, rows: v.map(r => cols.map(c => cellOut(r[c]))) };
    }
    return null;
  }
  async function runJS(code, { data, datasets }) {
    const lines = [];
    const fmt = a => a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 2); } catch (e) { return String(x); } })())).join(' ');
    const con = { log: (...a) => lines.push(fmt(a)), info: (...a) => lines.push(fmt(a)), warn: (...a) => lines.push('⚠ ' + fmt(a)), error: (...a) => lines.push('✖ ' + fmt(a)), table: v => lines.push(fmt([v])) };
    const df = data.rows.map(r => ({ ...r }));
    const ds = Object.fromEntries(Object.entries(datasets).map(([k, d]) => [k, d.rows.map(r => ({ ...r }))]));
    const fn = new AsyncFunction('df', 'datasets', 'DT', 'console', code);
    const ret = await fn(df, ds, root.DT, con);
    let table = tableFromJS(ret), text = null;
    if (ret !== undefined && !table) text = typeof ret === 'string' ? ret : fmt([ret]);
    if (!table) table = tableFromJS(df) || (df.length ? null : { columns: data.columns, rows: [] });
    return { table, text, output: lines.join('\n'), images: [] };
  }

  // ------------------------------------------------------------------ Python (Pyodide)
  let pyPromise = null;
  const PY_PRELUDE = `
import os, sys, json, io, base64
os.environ.setdefault("MPLBACKEND", "AGG")
try:
    import pandas as pd
    import numpy as np
except ImportError:
    pd = None

def _dl_make(d):
    if pd is not None:
        return pd.DataFrame(d["rows"], columns=d["columns"])
    return [dict(zip(d["columns"], r)) for r in d["rows"]]

def _dl_load(payload):
    p = json.loads(payload)
    g = globals()
    g["df"] = _dl_make(p["data"])
    g["datasets"] = {k: _dl_make(v) for k, v in p["datasets"].items()}
    g.pop("result", None)

def _dl_table(o):
    if pd is not None:
        if isinstance(o, pd.Series):
            o = o.reset_index() if not isinstance(o.index, pd.RangeIndex) else o.to_frame(o.name if o.name is not None else "valeur")
        if isinstance(o, pd.DataFrame):
            if not isinstance(o.index, pd.RangeIndex) or o.index.name is not None:
                o = o.reset_index()
            return {"columns": [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in o.columns],
                    "rows": json.loads(o.to_json(orient="values", date_format="iso", default_handler=str))}
    if isinstance(o, list) and o and all(isinstance(x, dict) for x in o):
        clean = lambda v: None if isinstance(v, float) and v != v else v
        cols = []
        for x in o:
            for k in x:
                if k not in cols:
                    cols.append(k)
        return {"columns": [str(c) for c in cols], "rows": [[clean(x.get(c)) for c in cols] for x in o]}
    return None

def _dl_finish(last):
    table = _dl_table(last) if last is not None else None
    text = repr(last) if last is not None and table is None else None
    g = globals()
    if table is None and "result" in g:
        table = _dl_table(g["result"])
    if table is None:
        table = _dl_table(g.get("df"))
    figs = []
    if "matplotlib.pyplot" in sys.modules:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format="png", bbox_inches="tight", dpi=110)
            figs.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    return json.dumps({"table": table, "text": text, "figs": figs}, default=str, allow_nan=False)
`;
  function loadPython(onStatus) {
    if (!pyPromise) {
      pyPromise = (async () => {
        onStatus('Chargement de Python (≈ 15 Mo, première fois seulement)…');
        const { loadPyodide } = await import(CFG.pyodide + 'pyodide.mjs');
        const py = await loadPyodide({ indexURL: CFG.pyodide });
        onStatus('Chargement de pandas…');
        try { await py.loadPackage(['numpy', 'pandas']); } catch (e) { console.warn('pandas indisponible', e); }
        await py.runPythonAsync(PY_PRELUDE);
        return py;
      })().catch(e => { pyPromise = null; throw new Error('Impossible de charger Python : ' + e.message); });
    }
    return pyPromise;
  }
  async function runPython(code, { data, datasets }, onStatus) {
    const py = await loadPython(onStatus);
    const lines = [];
    py.setStdout({ batched: s => lines.push(s) });
    py.setStderr({ batched: s => lines.push(s) });
    try {
      onStatus('Préparation des paquets…');
      try { await py.loadPackagesFromImports(code); } catch (e) { lines.push('⚠ ' + e.message); }
      const payload = JSON.stringify({ data: toMatrix(data), datasets: Object.fromEntries(Object.entries(datasets).map(([k, d]) => [k, toMatrix(d)])) });
      py.globals.get('_dl_load')(payload);
      onStatus('Exécution…');
      let last;
      try { last = await py.runPythonAsync(code); } catch (e) { throw new Error(cleanPyError(e.message)); }
      const finish = py.globals.get('_dl_finish');
      const res = JSON.parse(finish(last));
      if (last && typeof last.destroy === 'function') last.destroy();
      finish.destroy();
      return { table: res.table, text: res.text, output: lines.join('\n'), images: res.figs };
    } finally {
      py.setStdout(); py.setStderr();
    }
  }
  function cleanPyError(msg) {
    // Ne garde que la partie utile du traceback (après les lignes internes de Pyodide)
    const lines = String(msg).split('\n');
    const i = lines.findIndex(l => l.includes('File "<exec>"'));
    return (i >= 0 ? ['Traceback :', ...lines.slice(i)] : lines).join('\n').trim();
  }

  // ------------------------------------------------------------------ R (webR)
  let rPromise = null;
  function loadR(onStatus) {
    if (!rPromise) {
      rPromise = (async () => {
        onStatus('Chargement de R (≈ 30 Mo, première fois seulement)…');
        const { WebR } = await import(CFG.webr + 'webr.js'); // version navigateur (webr.mjs vise Node)
        const webR = new WebR({ baseUrl: CFG.webr, interactive: false });
        await webR.init();
        await webR.evalRVoid('options(width = 100, warn = 1)');
        return webR;
      })().catch(e => { rPromise = null; throw new Error('Impossible de charger R : ' + e.message); });
    }
    return rPromise;
  }
  // CSV pour R : booléens en TRUE/FALSE, séparateur virgule
  function rCSV(d) {
    const rows = d.rows.map(r => { const o = {}; for (const c of d.columns) o[c] = typeof r[c] === 'boolean' ? (r[c] ? 'TRUE' : 'FALSE') : r[c]; return o; });
    return root.DT.toCSV(root.DT.ds(d.columns, rows), ',');
  }
  const rStr = s => JSON.stringify(String(s)); // littéral de chaîne compatible R
  async function runR(code, { data, datasets }, onStatus) {
    const webR = await loadR(onStatus);
    onStatus('Préparation des données…');
    const enc = new TextEncoder();
    const read = p => `read.csv(${rStr(p)}, check.names = FALSE, stringsAsFactors = FALSE, na.strings = c("", "NA"), encoding = "UTF-8")`;
    await webR.FS.writeFile('/home/web_user/.dl_data.csv', enc.encode(rCSV(data)));
    const dsNames = Object.keys(datasets);
    for (let i = 0; i < dsNames.length; i++) await webR.FS.writeFile(`/home/web_user/.dl_ds${i}.csv`, enc.encode(rCSV(datasets[dsNames[i]])));
    await webR.evalRVoid(`df <- ${read('/home/web_user/.dl_data.csv')}
datasets <- list(${dsNames.map((n, i) => `${rStr(n)} = ${read(`/home/web_user/.dl_ds${i}.csv`)}`).join(', ')})
if (exists("result", envir = globalenv(), inherits = FALSE)) rm("result", envir = globalenv())`);

    onStatus('Exécution…');
    const shelter = await new webR.Shelter();
    try {
      const cap = await shelter.captureR(code, { withAutoprint: true, captureStreams: true, captureConditions: true, captureGraphics: { width: 760, height: 480 } });
      const lines = [];
      for (const o of cap.output) {
        if (o.type === 'stdout' || o.type === 'stderr') { lines.push(o.data); continue; }
        const msg = (await webR.evalRString('conditionMessage(c)', { env: { c: o.data } })).trim();
        if (o.type === 'error') throw new Error([...lines, 'Erreur : ' + msg].join('\n'));
        lines.push(o.type === 'warning' ? `Avertissement : ${msg}` : msg);
      }
      const output = lines.join('\n');
      const images = (cap.images || []).map(img => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      });
      await webR.objs.globalEnv.bind('.dl_last', cap.result);
      const hasTable = await webR.evalRBoolean(`local({
        g <- globalenv()
        o <- if (is.data.frame(g$.dl_last) || is.matrix(g$.dl_last) || is.table(g$.dl_last)) g$.dl_last
             else if (exists("result", envir = g, inherits = FALSE)) get("result", envir = g)
             else if (exists("df", envir = g, inherits = FALSE)) get("df", envir = g) else NULL
        tab <- function(x) tryCatch(if (is.data.frame(x)) x else if (is.matrix(x) || is.table(x)) as.data.frame(x, stringsAsFactors = FALSE) else NULL, error = function(e) NULL)
        o <- tab(o)
        if (is.null(o) && exists("result", envir = g, inherits = FALSE)) o <- tab(get("result", envir = g))
        if (is.null(o) && exists("df", envir = g, inherits = FALSE)) o <- tab(get("df", envir = g))
        if (is.null(o)) return(FALSE)
        o <- as.data.frame(o, check.names = FALSE, stringsAsFactors = FALSE)
        if (is.character(attr(o, "row.names"))) o <- cbind(nom = rownames(o), o, stringsAsFactors = FALSE)
        write.csv(o, "/home/web_user/.dl_out.csv", row.names = FALSE, na = "", fileEncoding = "UTF-8")
        TRUE
      })`);
      let table = null;
      if (hasTable) {
        const csv = new TextDecoder().decode(await webR.FS.readFile('/home/web_user/.dl_out.csv'));
        const parsed = root.Papa.parse(csv.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
        table = { columns: parsed[0] || [], rows: parsed.slice(1).map(r => r.map(v => (v === '' ? null : v))), fromCSV: true };
      }
      return { table, text: null, output, images };
    } catch (e) {
      throw new Error(String(e.message || e).replace(/^Error in [^:]*:\s*/, 'Erreur : '));
    } finally {
      shelter.purge();
    }
  }

  // ------------------------------------------------------------------ langages, aide et exemples
  const LANGS = {
    sql: { name: 'SQL', run: runSQL, help: 'Le jeu actuel est la table <code>data</code>, les jeux enregistrés sont disponibles sous leur nom (ex. <code>[mon jeu]</code>). Mettez entre crochets les noms contenant des espaces ou réservés (<code>[total]</code>, <code>[date]</code>…).' },
    python: { name: 'Python', run: runPython, help: 'Python 3 dans le navigateur (Pyodide). <code>df</code> est un DataFrame pandas des données actuelles, <code>datasets["nom"]</code> les jeux enregistrés. Le résultat affiché est la dernière expression (DataFrame), sinon <code>result</code>, sinon <code>df</code>. Les graphiques matplotlib s\'affichent. numpy, scipy, scikit-learn, statsmodels… se chargent automatiquement à l\'import.' },
    r: { name: 'R', run: runR, help: 'R dans le navigateur (webR). <code>df</code> est un data.frame des données actuelles, <code>datasets$nom</code> ou <code>datasets[["nom"]]</code> les jeux enregistrés. Le résultat est la dernière valeur si c\'est un data.frame, sinon <code>result</code>, sinon <code>df</code>. Les graphiques s\'affichent. Paquets : <code>webr::install("dplyr")</code> puis <code>library(dplyr)</code>.' },
    js: { name: 'JavaScript', run: runJS, help: '<code>df</code> est un tableau d\'objets (une ligne = un objet), <code>datasets.nom</code> les jeux enregistrés, <code>DT</code> le moteur DataLab. Le résultat est la valeur renvoyée par <code>return</code> (tableau d\'objets), sinon <code>df</code> après modification. <code>await</code> est autorisé.' },
  };

  function examples(lang, d, types, datasets) {
    const nums = d.columns.filter(c => types[c] === 'nombre');
    const num = nums.find(c => !/(^id|id$|^id_|_id)/i.test(c)) || nums[0] || d.columns[0] || 'valeur';
    const cat = d.columns.find(c => types[c] === 'texte') || d.columns[0] || 'categorie';
    const date = d.columns.find(c => types[c] === 'date');
    const other = Object.keys(datasets)[0];
    const shared = other && d.columns.find(c => datasets[other].columns.includes(c));
    const py = c => JSON.stringify(c), rq = c => (/^[A-Za-z.][A-Za-z0-9._]*$/.test(c) ? c : '`' + c.replace(/`/g, '\\`') + '`');
    const sq = c => `[${c}]`, js = c => (/^[A-Za-z_$][\w$]*$/.test(c) ? '.' + c : `[${JSON.stringify(c)}]`);
    const ex = {
      sql: [
        ['Aperçu', 'SELECT * FROM data LIMIT 20'],
        ['Nombre de lignes', 'SELECT COUNT(*) AS nb FROM data'],
        [`Comptage par ${cat}`, `SELECT ${sq(cat)}, COUNT(*) AS nb\nFROM data\nGROUP BY ${sq(cat)}\nORDER BY nb DESC`],
        [`Stats de ${num} par ${cat}`, `SELECT ${sq(cat)}, COUNT(*) AS nb, SUM(${sq(num)}) AS somme, AVG(${sq(num)}) AS moyenne, MIN(${sq(num)}) AS mini, MAX(${sq(num)}) AS maxi\nFROM data\nGROUP BY ${sq(cat)}\nORDER BY somme DESC`],
        [`Top 10 par ${num}`, `SELECT * FROM data\nWHERE ${sq(num)} IS NOT NULL\nORDER BY ${sq(num)} DESC\nLIMIT 10`],
        ['Valeurs distinctes', `SELECT DISTINCT ${sq(cat)} FROM data ORDER BY ${sq(cat)}`],
      ],
      python: [
        ['Aperçu et types', 'print(df.dtypes)\ndf.head(20)'],
        ['Statistiques descriptives', 'df.describe(include="all").T'],
        [`Moyenne de ${num} par ${cat}`, `(df.groupby(${py(cat)})[${py(num)}]\n   .agg(["count", "sum", "mean", "median"])\n   .sort_values("sum", ascending=False))`],
        ['Nettoyage + nouvelle colonne', `df = df.drop_duplicates()\ndf.columns = df.columns.str.strip()\ndf[${py(num + '_z')}] = (df[${py(num)}] - df[${py(num)}].mean()) / df[${py(num)}].std()\ndf`],
        [`Histogramme de ${num} (matplotlib)`, `import matplotlib.pyplot as plt\n\ndf[${py(num)}].plot(kind="hist", bins=20, title=${py(num)})\nplt.xlabel(${py(num)})\nplt.show()`],
        ['Corrélations', 'df.select_dtypes("number").corr().round(3)'],
        ['Régression linéaire (scikit-learn)', `from sklearn.linear_model import LinearRegression\n\nnum = df.select_dtypes("number").dropna()\nX, y = num.iloc[:, :-1], num.iloc[:, -1]\nmodel = LinearRegression().fit(X, y)\nprint("R² =", round(model.score(X, y), 4))\npd.DataFrame({"variable": X.columns, "coefficient": model.coef_})`],
        ...(date ? [[`Série mensuelle (${date})`, `df[${py(date)}] = pd.to_datetime(df[${py(date)}], dayfirst=True, errors="coerce")\ndf.set_index(${py(date)}).resample("MS")[${py(num)}].sum().reset_index()`]] : []),
        ...(shared ? [[`Jointure avec « ${other} »`, `df.merge(datasets[${py(other)}], on=${py(shared)}, how="left")`]] : []),
      ],
      r: [
        ['Aperçu et structure', 'str(df)\nhead(df, 20)'],
        ['Résumé statistique', 'summary(df)'],
        [`Moyenne de ${num} par ${cat}`, `aggregate(${rq(num)} ~ ${rq(cat)}, data = df, FUN = function(x) c(n = length(x), moyenne = mean(x), total = sum(x)))`],
        [`Tableau de fréquences de ${cat}`, `as.data.frame(sort(table(df[[${py(cat)}]]), decreasing = TRUE))`],
        [`Histogramme et boîte de ${num}`, `par(mfrow = c(1, 2))\nhist(df[[${py(num)}]], main = ${py(num)}, col = "steelblue", xlab = "")\nboxplot(df[[${py(num)}]] ~ df[[${py(cat)}]], las = 2, xlab = "", ylab = ${py(num)})`],
        ['Régression linéaire', `num <- df[sapply(df, is.numeric)]\nmodele <- lm(num[[ncol(num)]] ~ ., data = num[-ncol(num)])\nsummary(modele)`],
        [`Test du khi² (${cat})`, `chisq.test(table(df[[${py(cat)}]]))`],
        ['dplyr (installe le paquet)', `webr::install("dplyr")\nlibrary(dplyr)\n\ndf |>\n  group_by(${rq(cat)}) |>\n  summarise(n = n(), moyenne = mean(${rq(num)}, na.rm = TRUE)) |>\n  arrange(desc(n))`],
        ...(shared ? [[`Jointure avec « ${other} »`, `merge(df, datasets[[${py(other)}]], by = ${py(shared)}, all.x = TRUE)`]] : []),
      ],
      js: [
        ['Aperçu', 'console.log(df.length, "lignes");\nreturn df.slice(0, 20);'],
        [`Filtrer ${num} > moyenne`, `const vals = df.map(r => DT.toNum(r${js(num)})).filter(n => !isNaN(n));\nconst moyenne = vals.reduce((a, b) => a + b, 0) / vals.length;\nconsole.log("moyenne :", moyenne);\nreturn df.filter(r => DT.toNum(r${js(num)}) > moyenne);`],
        [`Total de ${num} par ${cat}`, `const totaux = {};\nfor (const r of df) {\n  const k = r${js(cat)} ?? "(vide)";\n  totaux[k] = (totaux[k] || 0) + (DT.toNum(r${js(num)}) || 0);\n}\nreturn Object.entries(totaux).map(([cle, total]) => ({ ${JSON.stringify(cat)}: cle, total }));`],
        ['Ajouter une colonne', `for (const r of df) r.longueur = Object.values(r).join(" ").length;\n// sans return : df modifié est le résultat`],
        ['Utiliser un outil DataLab', `const out = DT.runTool("describe", DT.fromRecords(df), {});\nreturn out.data;`],
      ],
    };
    return ex[lang] || [];
  }

  function defaultCode(lang, d, types, datasets) { return (examples(lang, d, types, datasets)[0] || ['', ''])[1]; }

  root.DLCode = {
    LANGS, examples, defaultCode,
    run: (lang, code, ctx, onStatus = () => {}) => LANGS[lang].run(code, ctx, onStatus),
    isLoaded: lang => (lang === 'python' ? !!pyPromise : lang === 'r' ? !!rPromise : true),
  };
})(typeof self !== 'undefined' ? self : this);
