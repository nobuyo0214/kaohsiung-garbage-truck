const {test}=require('node:test'),assert=require('node:assert/strict'),J=require('../js/journey-core'),T=require('../js/search-tools'),{load}=require('../scripts/data-tool.cjs');
const rows=load(),base=rows[0];
test('Taipei date and minute are independent of host timezone and handle midnight and invalid dates',()=>{
 assert.deepEqual(J.taipeiClock(new Date('2026-10-18T16:00:00Z')),{date:'2026-10-19',day:'一',minute:0,time:'00:00'});
 assert.equal(J.taipeiClock(new Date('2026-10-18T15:59:00Z')).day,'日');assert.equal(J.taipeiClock(new Date('2026-10-18T15:59:00Z')).minute,1439);assert.equal(J.taipeiClock(new Date('bad')),null);
});
test('timeline uses only known recycling weekdays, ascending start times, unknown last; no mutation or garbage-date fallback',()=>{
 const fixture=[{...base,停留地點:'later',停留時間:'18:00-18:02',recycleDay:'一',garbageDay:'二'},
 {...base,停留地點:'missing',停留時間:'16:20',recycleDay:'',garbageDay:'一'},
 {...base,停留地點:'invalid',停留時間:'18:57-28:57',recycleDay:'一'},
 {...base,停留地點:'early',停留時間:'16:20',recycleDay:'一'},
 {...base,停留地點:'cross',停留時間:'23:58-00:03',recycleDay:'一'},
 {...base,停留地點:'other',停留時間:'19:00',recycleDay:'四',garbageDay:'一'}];
 const before=structuredClone(fixture),now=new Date('2026-10-19T08:20:00Z');
 assert.deepEqual(J.todayRows(fixture,{now}).map(r=>r.停留地點),['early','later','cross','invalid']);
 assert.deepEqual(J.todayRows(fixture,{now,remaining:true}).map(r=>r.停留地點),['early','later']);
 assert.deepEqual(J.todayRows(fixture,{now:new Date('2026-10-19T08:21:00Z'),remaining:true}).map(r=>r.停留地點),['later']);
 assert.equal(J.schedule(fixture[4]).crossesMidnight,true);assert.equal(J.schedule(fixture[2]).start,null);assert.deepEqual(fixture,before);
});
test('real timeline keeps district/keyword identity and supports all-city recycling semantics including Taiwan rollover',()=>{
 const index=T.createIndex(rows),now=new Date('2026-10-19T08:20:00Z');
 for(const district of ['all',...index.districts.keys()]){
  const filtered=index.search({district,keyword:'',weekday:'一',dayType:'recycle',sortOrder:'asc'});
  const today=J.todayRows(filtered,{now});assert.deepEqual(today,filtered);
  assert.ok(J.todayRows(filtered,{now,remaining:true}).every(r=>J.schedule(r).start>=980&&!J.schedule(r).crossesMidnight));
 }
 assert.ok(J.todayRows(index.search({district:'all',keyword:'中山'}),{now}).every(r=>(r.停留地點+' '+r.villageName).includes('中山')));
});
