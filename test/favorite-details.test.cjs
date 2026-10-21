const {test}=require('node:test'), assert=require('node:assert/strict');
const T=require('../js/search-tools'),C=require('../js/convenience-core'),{load}=require('../scripts/data-tool.cjs');
const raw=load(), a=T.stopId(raw[0]), b=T.stopId(raw.find(r=>r.sourceFile!==raw[0].sourceFile));
const details=(entries)=>({version:1,entries});
test('old localStorage is retained; versioned metadata is bounded, pruned by identity and never changes identity',()=>{
 const old={version:1,favorites:[a,b],recent:[]};
 assert.deepEqual(T.readPreferences({getItem:()=>JSON.stringify(old)},[]),{favorites:[a,b],recent:[]});
 const prefs=T.readPreferences({getItem:()=>JSON.stringify({...old,favoriteDetails:details({[a]:{name:'家附近',pinned:true},[b]:{name:'bad',pinned:'true'},orphan:{name:'unused',pinned:true}})})},[]);
 assert.deepEqual(prefs.favorites,[a,b]);assert.deepEqual(prefs.favoriteDetails,details({[a]:{name:'家附近',pinned:true}}));
 assert.deepEqual(T.cleanFavoriteDetails([b],prefs.favoriteDetails),details({}));
 assert.ok(T.validFavoriteDetail({name:'🚛'.repeat(30),pinned:false}));
 assert.ok(!T.validFavoriteDetail({name:'🚛'.repeat(31),pinned:false}));
 assert.ok(!T.validFavoriteDetail({name:'line\nbreak',pinned:true}));
});
test('v2 backups roundtrip labels/pins, v1 imports default preferences, and duplicate merges always preserve local settings',()=>{
 const state={favorites:[a],favoriteDetails:details({[a]:{name:'<b>家附近</b>',pinned:true}})}, snapshot=structuredClone(state);
 const backup=C.exportFavoriteBackup(state.favorites,state.favoriteDetails);
 assert.equal(backup.version,2);assert.deepEqual(Object.keys(backup.favorites[0]).sort(),[...C.fields,'name','pinned'].sort());
 const parsed=C.parseFavoriteBackup(JSON.stringify(backup));assert.deepEqual(parsed,state);
 const v1=C.parseFavoriteBackup(JSON.stringify(C.exportFavorites([b])));
 assert.deepEqual(v1,{favorites:[b],favoriteDetails:details({})});
 const incoming={favorites:[a,b],favoriteDetails:details({[a]:{name:'remote',pinned:false},[b]:{name:'學校旁',pinned:true}})};
 const merged=C.mergeFavoriteState(state,incoming);
 assert.deepEqual(merged.favorites,[a,b]);assert.deepEqual(merged.favoriteDetails.entries[a],state.favoriteDetails.entries[a]);assert.deepEqual(merged.favoriteDetails.entries[b],incoming.favoriteDetails.entries[b]);assert.deepEqual(state,snapshot);
 const blankLocal=C.mergeFavoriteState({favorites:[a]},incoming);assert.deepEqual(blankLocal.favoriteDetails.entries[a],{name:'',pinned:false});
});
test('v2 rejects invalid, oversized, incompatible, conflicting, incomplete, extra data and over-capacity backups atomically',()=>{
 const valid=C.exportFavoriteBackup([a],details({})), entry=valid.favorites[0], current={favorites:[a],favoriteDetails:details({})}, before=structuredClone(current);
 for(const invalid of [null,[],{...valid,version:3},{...valid,history:[]},{...valid,favorites:[{...entry,name:'x'.repeat(31)}]},{...valid,favorites:[{...entry,pinned:1}]},{...valid,favorites:[{...entry,latitude:22}]},{...valid,favorites:[{...entry,sourceFile:'../unknown.csv'}]},{...valid,favorites:[{...entry,trip:null}]},{...valid,favorites:[entry,{...entry,name:'conflict'}]},{...valid,favorites:Array(201).fill(entry)}])assert.throws(()=>C.parseFavoriteBackup(JSON.stringify(invalid)));
 assert.throws(()=>C.parseFavoriteBackup('{bad'));assert.throws(()=>C.parseFavoriteBackup(' '.repeat(C.MAX_BYTES+1)));assert.throws(()=>C.parseFavoriteBackup(JSON.stringify(valid),C.MAX_BYTES+1));
 const many=Array.from({length:200},(_,i)=>T.stopId({...raw[0],停留地點:'test'+i}));
 assert.throws(()=>C.mergeFavoriteState({favorites:many},{favorites:[a]}));assert.deepEqual(current,before);
 assert.deepEqual(C.parseFavoriteBackup(JSON.stringify({...valid,favorites:[entry,entry]})).favorites,[a]);
});
