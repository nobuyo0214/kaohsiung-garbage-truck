const { test } = require('node:test'), assert = require('node:assert/strict');
const J = require('../js/journey-core'), L = require('../js/location-quality'), T = require('../js/search-tools');
const { load } = require('../scripts/data-tool.cjs');
const rows = load(), topology = require('../data/geo/kaohsiung.topo.json'), audit = L.analyze(rows, topology);
const eligible = audit.records.find(r => r.eligible);
test('Haversine is finite at zero, poles, antipodes and dateline; strict invalid values never coerce', () => {
  assert.equal(J.haversine([0, 0], [0, 0]), 0);
  assert.ok(Math.abs(J.haversine([0, 0], [0, 1]) - 111195.08) < 1);
  assert.ok(Math.abs(J.haversine([0, 0], [180, 0]) - Math.PI * 6371008.8) < 1);
  assert.ok(J.haversine([180, 89], [-180, 89]) < 0.001);
  for (const p of [null, [], [0], [0, 91], [181, 0], [NaN, 0], [Infinity, 0], ['120', 22], [0, 0, 1]]) assert.equal(J.haversine(p, [0, 0]), null);
});
test('nearby reuses navigation eligibility, excludes all failed quality reasons and preserves source rows and time order', () => {
  const before = structuredClone(rows), display = T.createIndex(rows).search({ district: 'all' }),
    index = J.nearbyIndex(display, audit);
  assert.equal(index.size, 9022);
  assert.equal(J.nearbyIndex(display, null).size, 0);
  const result = index.search(eligible.point, 5000);
  assert.ok(result.length);
  assert.ok(result.every((r, i) => L.navigationURL(audit.byRow.get(r.row)) && r.distance <= 5000 && (!i || r.distance >= result[i - 1].distance)));
  const rejected = new Set(audit.records.filter(r => !r.eligible).map(r => r.row));
  assert.ok(result.every(r => !rejected.has(r.row)));
  assert.deepEqual(rows, before);
});
test('radius thresholds 500/1000/3000/5000, same-place distinct trips and display distance precision', () => {
  const [lon, lat] = eligible.point, p = [lon, lat];
  const sample = [0, 499, 501, 999, 1001, 2999, 3001, 4999, 5001].map((metres, i) => ({ ...eligible.row, 車次: String(i), 經度: String(lon), 緯度: String(lat + metres / 111195.08) }));
  const checked = L.analyze(sample, topology);
  // Synthetic points use the real quality policy; the changing place coordinates are deliberately
  // a conflict, and must ALL be excluded instead of being accepted as nearby suggestions.
  assert.equal(J.nearbyIndex(sample, checked).size, 0);
  // Known reference distances independently exercise thresholds after an explicit audited record.
  const records = sample.map((row, i) => ({row,point:[lon,lat + [0,499,501,999,1001,2999,3001,4999,5001][i]/111195.08],eligible:true,reasons:[]}));
  const byRow = new WeakMap(records.map(r=>[r.row,r]));
  const index = J.nearbyIndex(sample, {byRow});
  for (const [radius, count] of [[500,2],[1000,4],[3000,6],[5000,8]]) assert.equal(index.search(p,radius).length,count);
  assert.deepEqual(index.search(p,2000),[]); assert.deepEqual(index.search([NaN,0],1000),[]);
  assert.match(J.formatDistance(350),/350公尺.*直線距離/);assert.match(J.formatDistance(1400),/1.40公里/);assert.equal(J.formatDistance(NaN),'距離尚未提供');
});
test('position freshness, accuracy and numeric bounds are validated without altering input', () => {
  const now=Date.now(),p={timestamp:now,coords:{longitude:120.3,latitude:22.6,accuracy:25}}, before=structuredClone(p);
  assert.deepEqual(J.positionValue(p,now),{point:[120.3,22.6],accuracy:25,obtainedAt:now});
  for(const bad of [{...p,timestamp:now-60001},{...p,timestamp:now+5001},{...p,coords:{...p.coords,accuracy:1001}},{...p,coords:{...p.coords,latitude:NaN}},{...p,coords:{...p.coords,accuracy:-1}},{coords:p.coords},null]) assert.equal(J.positionValue(bad,now),null);
  assert.deepEqual(p,before);
});
