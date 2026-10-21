const { test } = require('node:test'), assert = require('node:assert/strict');
const { load } = require('../scripts/data-tool.cjs'), T = require('../js/search-tools'), D = require('../js/data-core');
const rows = load(), index = T.createIndex(rows);
test('city index retains all 38 districts, distinct trips and globally sorts both directions with recycling and time filters', () => {
  const all = index.search({district:'all'});
  assert.equal(all.length, 13868);
  assert.equal(new Set(all.map(r=>r.searchDistrict)).size,38);
  assert.equal(new Set(all.map(r=>JSON.stringify([T.stopId(r),r.villageName,r.recycleDay,r.garbageDay]))).size,all.length);
  for (const sortOrder of ['asc','desc']) for (const weekday of ['',...'一二三四五六日']) {
    const result = index.search({district:'all',sortOrder,weekday,period:'afternoon',village:'ignored in city'});
    const expected = all.filter(r=>D.matchesWeekday(r.recycleDay,weekday)&&D.matchesPeriod(r.startMinute,'afternoon'));
    assert.equal(result.length,expected.length);
    const times = result.map(r=>r.startMinute);
    assert.deepEqual(times,[...times].sort((a,b)=>sortOrder==='asc'?a-b:b-a));
  }
  for(const district of index.districts.keys()) assert.deepEqual(all.filter(r=>r.searchDistrict===district).map(T.stopId),index.search({district}).map(T.stopId));
});
test('city suggestions distinguish same names across districts and do not change identities or legacy history', () => {
  const first=rows[0], name='中山路100號';
  const sample=T.createIndex([{...first,停留地點:name},{...first,searchDistrict:'三民區',停留地點:name}]);
  assert.deepEqual(new Set(sample.suggestStops('中山').map(s=>s.district)),new Set([first.searchDistrict,'三民區']));
  assert.ok(sample.suggestStops('中山').every(s=>s.label===s.district+'｜'+s.place && s.place===name));
  const filter={district:'all',village:'',keyword:'中山',dayType:'recycle',weekday:'一',period:'',sortOrder:'desc'};
  assert.deepEqual(T.readPreferences({getItem:()=>JSON.stringify({version:1,favorites:[],recent:[filter]})},[...index.districts.keys()]).recent,[filter]);
});
