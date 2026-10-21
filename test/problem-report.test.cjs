const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../js/convenience-core'),T=require('../js/search-tools'),{load}=require('../scripts/data-tool.cjs');
const row=load().find(r=>r.sourceFile==='sanmin-west.csv');
test('every report type includes full immutable identity and recycling without exposing or altering general-garbage rules',()=>{
 const before=structuredClone(row);
 for(const type of Object.keys(C.reportTypes)){
  const text=C.reportText(row,type,'請核對表定時間');assert.ok(text.includes('問題類型：'+C.reportTypes[type]));
  for(const value of JSON.parse(T.stopId(row)))assert.ok(text.includes(value));
  assert.ok(text.includes('完整站點識別：'+T.stopId(row)));assert.ok(text.includes('尚未送出'));assert.ok(text.includes('資源回收日：'+row.recycleDay));assert.ok(!text.includes('一般垃圾日：'));
 }
 assert.deepEqual(row,before);assert.throws(()=>C.reportText(row,'__proto__'));assert.throws(()=>C.reportText(row,'other','長'.repeat(301)));assert.throws(()=>C.reportText(row,'other','\u0000'));
 assert.ok(C.reportText(row,'other','🚛'.repeat(300)).includes('🚛'));
});
