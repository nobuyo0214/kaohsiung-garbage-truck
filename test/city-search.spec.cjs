const {test,expect}=require('@playwright/test'), {load}=require('../scripts/data-tool.cjs'), T=require('../js/search-tools');
const index=T.createIndex(load());
async function ready(page){await page.goto('/');await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});}
test('city filters, pagination, qualified suggestions, switch and persisted history use one download per CSV',async({page})=>{
 const counts=new Map();page.on('request',r=>{if(r.url().endsWith('.csv'))counts.set(r.url(),(counts.get(r.url())||0)+1);});
 await ready(page);await page.selectOption('#district','all');
 await expect(page.locator('#village')).toBeDisabled();
 await expect(page.locator('#resultStatus')).toContainText('13,868');await expect(page.locator('.card')).toHaveCount(30);
 await page.click('#moreButton');await expect(page.locator('.card')).toHaveCount(60);
 for(const sortOrder of ['asc','desc']){
  await page.selectOption('#weekday','一');await page.selectOption('#period','afternoon');await page.selectOption('#sortOrder',sortOrder);await page.click('#searchButton');
  const result=index.search({district:'all',weekday:'一',period:'afternoon',sortOrder});
  await expect(page.locator('#resultStatus')).toContainText(result.length.toLocaleString('zh-TW'));
  expect(await page.locator('.card h3').allTextContents()).toEqual(result.slice(0,30).map(r=>r.停留地點));
  expect(await page.locator('.location-meta span').allTextContents()).toEqual(result.slice(0,30).map(r=>r.searchDistrict));
 }
 await page.reload();await expect(page.locator('#searchButton')).toBeEnabled();await page.locator('#recentSearches button').first().click();
 await expect(page.locator('#district')).toHaveValue('all');await expect(page.locator('#sortOrder')).toHaveValue('desc');
 await page.click('#resetButton');await page.fill('#keyword','中山');
 await expect(page.locator('#keywordSuggestions option').first()).toHaveAttribute('value',/區｜.*中山/);
 const label=await page.locator('#keywordSuggestions option').first().getAttribute('value'), [district,place]=label.split('｜');
 await page.fill('#keyword',label);await page.click('#searchButton');
 await expect(page.locator('#district')).toHaveValue(district);await expect(page.locator('#keyword')).toHaveValue(place);
 expect(await page.locator('.location-meta span').allTextContents()).toEqual(Array(await page.locator('.card').count()).fill(district));
 await page.selectOption('#district','all');await expect(page.locator('#keyword')).toHaveValue(place);await expect(page.locator('#village')).toHaveValue('');
 // Reload above legitimately downloads each CSV again; changing scope/search never does.
 for(const count of counts.values())expect(count).toBe(2);expect(counts.size).toBe(40);
});
test('city partial CSV failure discloses incomplete results including zero matches and retries only the failed file',async({page})=>{
 let fail=true,requests=0;await page.route('**/maolin.csv',route=>{requests++;return fail?route.fulfill({status:503,body:'unavailable'}):route.continue();});
 await ready(page);await page.selectOption('#district','all');await page.fill('#keyword','不存在的站點測試');await page.click('#searchButton');
 await expect(page.locator('#filterNotice')).toContainText('全市部分路線尚未載入');await expect(page.locator('#filterNotice')).toContainText('未找到不代表沒有該地點');
 fail=false;await page.click('#retryButton');await expect(page.locator('#dataStatus')).toContainText('39 / 39');await expect(page.locator('#filterNotice')).not.toContainText('不完整');expect(requests).toBe(2);
});
test('same city place in different districts and trips stays distinct in cards, qualified suggestions, favorites and sharing',async({page})=>{
 const Papa=require('papaparse'),{mockSnapshot}=require('./snapshot-fixture.cjs');
 const fields=['責任區','車次','停留地點','停留時間','行政區','村里','回收日'];
 const name='跨區測試路100號';
 const data=(district,trips)=>Papa.unparse({fields,data:trips.map(trip=>['測試責任區',trip,name,'18:00-18:02',district,'測試里','一、四'])});
 await mockSnapshot(page,{'sanmin-east.csv':data('三民區',['1','2']),'lingya.csv':data('苓雅區',['1'])});
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.cityLink=text;}}}));
 await ready(page);await page.selectOption('#district','all');await page.fill('#keyword',name);await page.click('#searchButton');await expect(page.locator('.card')).toHaveCount(3);
 await expect(page.locator('#keywordSuggestions option')).toHaveCount(2);
 const names=await page.locator('.location-meta span').allTextContents();expect(names.sort()).toEqual(['三民區','三民區','苓雅區']);
 for(const button of await page.locator('.save-button').all())await button.click();await expect(page.locator('#favoriteCount')).toHaveText('3');
 const C=require('../js/convenience-core'),ids=[];for(const button of await page.locator('.share-button').all()){await button.click();ids.push(C.sharedId(await page.evaluate(()=>window.cityLink)));}expect(new Set(ids).size).toBe(3);
 await page.fill('#keyword','苓雅區｜'+name);await page.click('#searchButton');await expect(page.locator('#district')).toHaveValue('苓雅區');await expect(page.locator('#keyword')).toHaveValue(name);await expect(page.locator('.card')).toHaveCount(1);
});
