const test = require('node:test');
const assert = require('node:assert/strict');
const DT = require('../js/core.js');

const small = () => DT.fromRecords([
  { nom: ' alice ', ville: 'Paris', age: '30', ventes: 100, date: '15/01/2024' },
  { nom: 'Bob', ville: 'Lyon', age: 45, ventes: null, date: '2024-02-20' },
  { nom: 'bob', ville: 'lyon', age: 45, ventes: 300, date: '2024-03-05' },
  { nom: 'Chloé', ville: null, age: '1 234,5', ventes: 50, date: 'n/a' },
]);
const run = (id, d, p, ctx) => DT.runTool(id, d, p, ctx);

test('toNum gère les formats français et anglais', () => {
  assert.equal(DT.toNum('1 234,5'), 1234.5);
  assert.equal(DT.toNum('1,5'), 1.5);
  assert.equal(DT.toNum('1,234,567.8'), 1234567.8);
  assert.equal(DT.toNum('1.234.567,8'), 1234567.8);
  assert.equal(DT.toNum('12 €'), 12);
  assert.ok(Number.isNaN(DT.toNum('abc')));
  assert.ok(Number.isNaN(DT.toNum('')));
});

test('toDate reconnaît plusieurs formats', () => {
  assert.equal(DT.formatDate(DT.toDate('15/01/2024')), '2024-01-15');
  assert.equal(DT.formatDate(DT.toDate('2024-02-20')), '2024-02-20');
  assert.equal(DT.formatDate(DT.toDate(45306)), '2024-01-15');
  assert.equal(DT.toDate('31/02/2024'), null);
  assert.equal(DT.inferType(['2024-01-01', '02/03/2024']), 'date');
  assert.equal(DT.inferType(['1', 2, '3,5']), 'nombre');
});

test('chaque outil s\'exécute avec ses paramètres par défaut ou échoue proprement', () => {
  const d = DT.sampleSales(60);
  const ctx = { datasets: { vendeurs: DT.sampleSellers() } };
  for (const t of DT.TOOLS) {
    const p = {};
    for (const def of t.params) {
      if (def.type === 'column') p[def.name] = def.optional ? '' : d.columns[1];
      if (def.type === 'columns') p[def.name] = [d.columns[5], d.columns[6]];
      if (def.type === 'dataset') p[def.name] = 'vendeurs';
      if (def.type === 'datasetColumn') p[def.name] = 'vendeur';
    }
    if (t.id === 'join') p.leftKey = 'vendeur';
    try {
      const out = run(t.id, d, p, ctx);
      const data = out.result ? out.data : out;
      assert.ok(Array.isArray(data.columns) && Array.isArray(data.rows), t.id);
      for (const r of data.rows.slice(0, 5)) for (const c of data.columns) assert.ok(c in r, `${t.id}: colonne ${c} absente`);
    } catch (e) {
      // seules les erreurs de validation (messages utilisateur) sont acceptables
      assert.ok(!(e instanceof TypeError || e instanceof ReferenceError), `${t.id}: ${e.stack}`);
    }
  }
});

test('nettoyage', () => {
  const d = small();
  assert.equal(run('trim', d, {}).rows[0].nom, 'alice');
  assert.equal(run('dedupe', d, { columns: ['nom', 'ville'] }).rows.length, 4);
  assert.equal(run('dedupe', run('case', d, { mode: 'lower' }), { columns: ['nom', 'ville'] }).rows.length, 3);
  assert.equal(run('dedupe', d, { columns: ['nom', 'ville'], loose: true }).rows.length, 3);
  assert.deepEqual(run('fillMissing', d, { columns: ['ventes'], method: 'mean' }).rows.map(r => r.ventes), [100, 150, 300, 50]);
  assert.deepEqual(run('fillMissing', d, { columns: ['ventes'], method: 'interp' }).rows.map(r => r.ventes), [100, 200, 300, 50]);
  assert.deepEqual(run('convert', d, { columns: ['age'], type: 'number' }).rows.map(r => r.age), [30, 45, 45, 1234.5]);
  assert.deepEqual(run('standardizeDates', d, { columns: ['date'], fmt: 'YYYY-MM-DD', keepInvalid: false }).rows.map(r => r.date), ['2024-01-15', '2024-02-20', '2024-03-05', null]);
  assert.equal(run('replace', d, { columns: ['ville'], find: 'l(y)on', repl: 'L$1ON', regex: true }).rows[1].ville, 'LyON');
  assert.equal(run('dropMissing', d, {}).rows.length, 2);
});

test('colonnes, lignes et numérique', () => {
  const d = small();
  assert.deepEqual(run('split', DT.fromRecords([{ a: 'x-y-z' }, { a: 'u-v' }]), { column: 'a', sep: '-' }).columns, ['a', 'a_1', 'a_2', 'a_3']);
  assert.deepEqual(run('formula', d, { name: 'double', expr: 'num(age) * 2' }).rows.map(r => r.double), [60, 90, 90, 2469]);
  assert.equal(run('filter', d, { column: 'age', op: 'gt', value: '40' }).rows.length, 3);
  assert.equal(run('filter', d, { column: 'ville', op: 'eq', value: 'lyon', combine: 'and', column2: 'ventes', op2: 'gte', value3: '300' }).rows.length, 1);
  assert.deepEqual(run('sort', d, { c1: 'ventes', d1: 'desc' }).rows.map(r => r.ventes), [300, 100, 50, null]);
  assert.deepEqual(run('sort', d, { c1: 'date', d1: 'asc' }).rows.map(r => r.date), ['15/01/2024', '2024-02-20', '2024-03-05', 'n/a']);
  assert.deepEqual(run('cumulative', d, { column: 'ventes', fn: 'sum' }).rows.map(r => r.ventes_cumul), [100, 100, 400, 450]);
  assert.deepEqual(run('rank', d, { column: 'age', dir: 'asc', method: 'dense' }).rows.map(r => r.age_rang), [1, 2, 2, 3]);
  assert.deepEqual(run('minmax', d, { columns: ['ventes'], inPlace: true }).rows.map(r => r.ventes), [0.2, null, 1, 0]);
  const b = run('bin', DT.fromRecords([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(x => ({ x }))), { column: 'x', method: 'custom', edges: '0,5,10', labels: 'bas,haut' });
  assert.deepEqual(b.rows.map(r => r.classe), ['bas', 'bas', 'bas', 'bas', 'haut', 'haut', 'haut', 'haut', 'haut', 'haut']);
});

test('restructuration', () => {
  const d = run('case', run('trim', small(), {}), { columns: ['ville'], mode: 'title' });
  const g = run('groupBy', d, { by: ['ville'], values: ['ventes'], aggs: ['sum', 'count'] });
  assert.deepEqual(g.columns, ['ville', 'nb_lignes', 'ventes_sum', 'ventes_count']);
  assert.deepEqual(g.rows.find(r => r.ville === 'Lyon'), { ville: 'Lyon', nb_lignes: 2, ventes_sum: 300, ventes_count: 1 });
  const pv = run('pivot', d, { index: 'ville', columns: 'nom', values: '', totals: true });
  assert.equal(pv.rows[pv.rows.length - 1].Total, 4);
  const m = run('melt', DT.fromRecords([{ id: 1, a: 2, b: 3 }]), { ids: ['id'] });
  assert.deepEqual(m.rows, [{ id: 1, variable: 'a', valeur: 2 }, { id: 1, variable: 'b', valeur: 3 }]);
  const other = DT.fromRecords([{ ville: 'paris', pays: 'FR' }, { ville: 'Berlin', pays: 'DE' }]);
  const j = run('join', d, { other: 'o', leftKey: 'ville', rightKey: 'ville', how: 'left', loose: true }, { datasets: { o: other } });
  assert.equal(j.rows[0].pays, 'FR');
  assert.equal(j.rows.length, 4);
  const full = run('join', d, { other: 'o', leftKey: 'ville', rightKey: 'ville', how: 'full', loose: true }, { datasets: { o: other } });
  assert.equal(full.rows.length, 5);
  assert.equal(full.rows[4].ville, 'Berlin');
});

test('analyse', () => {
  const d = DT.fromRecords([1, 2, 3, 4, 5].map(x => ({ x, y: 2 * x + 1, g: x % 2 ? 'impair' : 'pair' })));
  const reg = run('regression', d, { x: 'x', y: 'y' });
  assert.equal(reg.data.rows.find(r => r.indicateur === 'R²').valeur, 1);
  const cor = run('correlation', d, {});
  assert.equal(cor.data.rows[0].y, 1);
  assert.ok(run('describe', d, {}).data.rows.length === 3);
  assert.ok(Math.abs(DT.chi2pValue(3.841, 1) - 0.05) < 0.001);
  assert.ok(Math.abs(DT.fPValue(4.0, 2, 20) - 0.0345) < 0.002);
  const out = run('outliers', DT.fromRecords([1, 2, 2, 3, 2, 100].map(v => ({ v }))), { column: 'v', action: 'remove' });
  assert.equal(out.rows.length, 5);
});

test('export', () => {
  const d = DT.fromRecords([{ a: 'x,y', b: 1.5 }, { a: 'dit "oui"', b: null }]);
  assert.equal(DT.toCSV(d), 'a,b\r\n"x,y",1.5\r\n"dit ""oui""",');
  assert.equal(DT.toCSV(d, ';', true, true).split('\r\n')[1], 'x,y;1,5');
  assert.ok(DT.toSQL(d).includes('INSERT INTO "donnees" ("a", "b") VALUES (\'x,y\', 1.5);'));
  assert.deepEqual(DT.fromJSON({ data: [{ a: { b: 1 } }] }).columns, ['a.b']);
});
