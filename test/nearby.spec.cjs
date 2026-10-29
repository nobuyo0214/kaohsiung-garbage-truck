const {test,expect}=require('@playwright/test'),J=require('../js/journey-core'),T=require('../js/search-tools'),L=require('../js/location-quality'),C=require('../js/convenience-core'),{load}=require('../scripts/data-tool.cjs');
const rows=load(),audit=L.analyze(rows,require('../data/geo/kaohsiung.topo.json')),sample=audit.records.find(r=>r.eligible&&r.row.searchDistrict==='三民區'),origin=[sample.point[0]+0.00001,sample.point[1]+0.00001];
const expected=J.nearbyIndex(T.createIndex(rows).search({district:'all'}),audit);
async function ready(page){await page.goto('/');await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});}
async function geo(page,mode='success'){
 await page.addInitScript(({origin,mode})=>{
  window.geoCalls=0;window.geoOptions=null;window.permissionHandle={state:'granted',onchange:null};
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>window.permissionHandle}});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:()=>{throw Error('must never watch');},getCurrentPosition:(success,error,options)=>{
   window.geoCalls++;window.geoOptions=options;window.delayedPosition=()=>success({timestamp:Date.now(),coords:{longitude:origin[0],latitude:origin[1],accuracy:15}});
   if(mode==='success')window.delayedPosition();else if(mode==='denied')error({code:1});else if(mode==='timeout')error({code:3});else if(mode==='unavailable')error({code:2});
  }}});
 },{origin,mode});
}
test('explicit click alone obtains position; distances, radii, page size, actions and original filters stay correct without downloads or persisted location',async({page})=>{
 await geo(page);await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLink=text;}}}));
 const requests=[];page.on('request',r=>requests.push(r.url()));await ready(page);expect(await page.evaluate(()=>window.geoCalls)).toBe(0);
 await page.selectOption('#district','all');await page.fill('#keyword','中山');await page.selectOption('#weekday','一');await page.selectOption('#period','afternoon');await page.selectOption('#sortOrder','desc');await page.click('#searchButton');
 const prefs=await page.evaluate(()=>localStorage.getItem('garbage-search-v1')),count=requests.length;
 await page.click('#nearbyButton');await expect(page.locator('#resultsHeading')).toHaveText('附近可靠停靠站');
 for(const radius of [500,1000,3000,5000]){
  await page.selectOption('#nearbyRadius',String(radius));const result=expected.search(origin,radius);
  await expect(page.locator('#resultStatus')).toContainText(result.length.toLocaleString('zh-TW'));
  expect(await page.locator('.card h3').allTextContents()).toEqual(result.slice(0,30).map(r=>r.row.停留地點));
  expect(await page.locator('.stop-distance').allTextContents()).toEqual(result.slice(0,30).map(r=>J.formatDistance(r.distance)));
 }
 expect(requests.length).toBe(count);expect(await page.evaluate(()=>window.geoCalls)).toBe(1);expect(await page.evaluate(()=>window.geoOptions)).toEqual({enableHighAccuracy:true,timeout:10000,maximumAge:0});
 await expect(page.locator('.map-link')).toHaveCount(30);await page.click('#moreButton');await expect(page.locator('.card')).toHaveCount(60);
 expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(prefs);
 await page.locator('.save-button').first().click();await page.locator('.share-button:not([disabled])').first().click();expect(C.sharedId(await page.evaluate(()=>window.copiedLink))).toBeTruthy();
 await page.locator('.report-button').first().click();await expect(page.locator('#reportText')).not.toHaveValue(new RegExp(String(origin[0])));await page.keyboard.press('Escape');
 await page.click('#viewAllButton');for(const [id,value]of Object.entries({district:'all',keyword:'中山',weekday:'一',period:'afternoon',sortOrder:'desc'}))await expect(page.locator('#'+id)).toHaveValue(value);
 await page.click('#quickSavedButton');const download=page.waitForEvent('download');await page.click('#exportFavorites');const fs=require('node:fs'),backup=fs.readFileSync(await(await download).path(),'utf8');expect(backup).not.toContain(String(origin[0]));expect(backup).not.toContain(String(origin[1]));
 expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain(String(origin[0]));await page.reload();await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});await expect(page.locator('#resultsHeading')).toHaveText('停靠資訊');expect(await page.evaluate(()=>window.geoCalls)).toBe(0);
});
for(const [mode,message]of [['denied','權限未開放'],['timeout','定位逾時'],['unavailable','無法取得位置']])test(`geolocation ${mode} preserves ordinary search and never retries automatically`,async({page})=>{
 await geo(page,mode);await ready(page);await page.click('#nearbyButton');await expect(page.locator('#nearbyStatus')).toContainText(message);await expect(page.locator('#nearbyButton')).toBeEnabled();expect(await page.evaluate(()=>window.geoCalls)).toBe(1);await page.click('#searchButton');await expect(page.locator('.card').first()).toBeVisible();expect(await page.evaluate(()=>window.geoCalls)).toBe(1);
});
test('unsupported location, permission revocation and late callbacks safely restore regular mode',async({page})=>{
 await geo(page,'delay');await ready(page);await page.click('#nearbyButton');await page.click('#searchButton');await page.evaluate(()=>window.delayedPosition());await expect(page.locator('#resultsHeading')).toHaveText('停靠資訊');
 await page.click('#nearbyButton');await page.evaluate(()=>window.delayedPosition());await expect(page.locator('#resultsHeading')).toHaveText('附近可靠停靠站');
 await page.evaluate(()=>{window.permissionHandle.state='denied';window.permissionHandle.onchange();});await expect(page.locator('#resultsHeading')).toHaveText('停靠資訊');await expect(page.locator('.stop-distance')).toHaveCount(0);await expect(page.locator('#nearbyStatus')).toContainText('權限已變更');
 await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined}));await page.click('#nearbyButton');await expect(page.locator('#nearbyStatus')).toContainText('無法使用定位');
});
test('no reliable nearby matches offers text search; partial source failure never relaxes the navigation gate',async({page})=>{
 await geo(page);await page.route('**/maolin.csv',r=>r.fulfill({status:503,body:'failed'}));await ready(page);await page.click('#nearbyButton');await expect(page.locator('#nearbyStatus')).toContainText('附近結果可能不完整');expect(await page.evaluate(()=>window.geoCalls)).toBe(0);await page.unroute('**/maolin.csv');await page.click('#retryButton');await expect(page.locator('#dataStatus')).toContainText('39 / 39');
 await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=success=>success({timestamp:Date.now(),coords:{longitude:121.5654,latitude:25.033,accuracy:10}});});await page.click('#nearbyButton');await expect(page.locator('.empty-state')).toContainText('目前範圍內沒有通過位置品質檢查');await page.getByRole('button',{name:'改用地點文字搜尋',exact:true}).click();await expect(page.locator('#resultsHeading')).toHaveText('停靠資訊');
});
test('silent providers time out, stale or inaccurate positions are rejected, background and offline clear all distances',async({page})=>{
 await geo(page,'delay');await ready(page);await page.clock.install();await page.click('#nearbyButton');await page.clock.runFor(12001);await expect(page.locator('#nearbyStatus')).toContainText('定位逾時');await page.evaluate(()=>window.delayedPosition());await expect(page.locator('.stop-distance')).toHaveCount(0);
 await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=success=>success({timestamp:Date.now()-61000,coords:{longitude:120.3,latitude:22.6,accuracy:1500}});});await page.click('#nearbyButton');await expect(page.locator('#nearbyStatus')).toContainText('足夠精確的新位置');
 await page.evaluate(origin=>{navigator.geolocation.getCurrentPosition=success=>success({timestamp:Date.now(),coords:{longitude:origin[0],latitude:origin[1],accuracy:15}});},origin);await page.click('#nearbyButton');await expect(page.locator('.stop-distance').first()).toBeVisible();await page.clock.runFor(300001);await expect(page.locator('.stop-distance')).toHaveCount(0);await expect(page.locator('#nearbyStatus')).toContainText('超過5分鐘');await page.click('#nearbyButton');await expect(page.locator('.stop-distance').first()).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.locator('.stop-distance')).toHaveCount(0);
 await page.click('#nearbyButton');await expect(page.locator('.stop-distance').first()).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await expect(page.locator('.stop-distance')).toHaveCount(0);await expect(page.locator('#nearbyButton')).toBeDisabled();
});
