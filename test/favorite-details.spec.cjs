const {test,expect}=require('@playwright/test'),fs=require('node:fs');
const T=require('../js/search-tools'),C=require('../js/convenience-core'),{load}=require('../scripts/data-tool.cjs');
const rows=load(), index=C.identityIndex(rows), samples=rows.filter(r=>r.searchDistrict==='三民區'&&C.shareable(T.stopId(r),index)).slice(0,2),ids=samples.map(T.stopId);
const file=data=>({name:'favorites.json',mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});
async function ready(page){await page.goto('/');await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});}
async function seed(page){await page.addInitScript(value=>{if(!localStorage.getItem('garbage-search-v1'))localStorage.setItem('garbage-search-v1',JSON.stringify(value));},{version:1,favorites:ids,recent:[]});}
async function edit(page,card,name,pinned){await card.locator('.favorite-edit').click();await page.fill('#favoriteName',name);await page.locator('#favoritePinned').setChecked(pinned);await page.getByRole('button',{name:'儲存收藏設定',exact:true}).click();}
test('legacy favorites gain safe private names and pins, persist and export/import v2 across browsers while v1 still merges',async({page,browser})=>{
 await seed(page);await ready(page);await page.click('#quickSavedButton');await expect(page.locator('.card')).toHaveCount(2);
 const label='<b>家附近</b>';const card=page.locator('.card').filter({has:page.getByRole('heading',{name:samples[1].停留地點,exact:true})});
 await edit(page,card,label,true);await expect(page.locator('.card').first().locator('.favorite-label')).toHaveText('已置頂・自訂名稱：'+label);await expect(page.locator('.favorite-label b')).toHaveCount(0);
 await expect(page.locator('.card').first().locator('h3')).toHaveText(samples[1].停留地點);
 await page.reload();await expect(page.locator('#searchButton')).toBeEnabled();await page.click('#quickSavedButton');await expect(page.locator('.card').first().locator('.favorite-label')).toContainText(label);
 const download=page.waitForEvent('download');await page.click('#exportFavorites');const backup=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));expect(backup.version).toBe(2);expect(backup.favorites[1]).toMatchObject({name:label,pinned:true});
 const ctx=await browser.newContext({serviceWorkers:'block'}),other=await ctx.newPage();await ready(other);await other.click('#quickSavedButton');await other.setInputFiles('#favoritesFile',file(backup));await expect(other.locator('#favoritesPreviewText')).toContainText('新增 2');await other.click('#confirmFavoritesImport');await expect(other.locator('.card').first().locator('.favorite-label')).toContainText(label);
 const conflict=structuredClone(backup);conflict.favorites[1].name='different';conflict.favorites[1].pinned=false;
 await other.setInputFiles('#favoritesFile',file(conflict));await expect(other.locator('#favoritesPreviewText')).toContainText('重複 2');await expect(other.locator('#favoritesPreviewText')).toContainText('保留本機設定');await other.click('#confirmFavoritesImport');await expect(other.locator('.favorite-label')).toContainText(label);
 const unknown=T.stopId({...samples[0],停留地點:'已變更測試站點'});await other.setInputFiles('#favoritesFile',file(C.exportFavorites([unknown])));await expect(other.locator('#favoritesPreviewText')).toContainText('新增 1');await other.click('#confirmFavoritesImport');await expect(other.locator('#favoriteCount')).toHaveText('3');await expect(other.locator('#resultStatus')).toContainText('1 個收藏目前未載入');
 await other.reload();await expect(other.locator('#searchButton')).toBeEnabled();await other.click('#quickSavedButton');await expect(other.locator('#favoriteCount')).toHaveText('3');await ctx.close();
 // Clear the name/unpin, then delete. No orphan preference survives removal.
 await edit(page,page.locator('.card').first(),'',false);await expect(page.locator('.favorite-label')).toHaveCount(0);
 await page.locator('.card .save-button').first().click();const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('garbage-search-v1')));expect(Object.keys(prefs.favoriteDetails.entries).every(id=>prefs.favorites.includes(id))).toBe(true);
});
test('favorite changes apply only to saved order; malformed imports, cancelled previews and long names preserve data',async({page})=>{
 await seed(page);await ready(page);await page.click('#quickSavedButton');const before=await page.evaluate(()=>localStorage.getItem('garbage-search-v1'));
 await page.locator('.favorite-edit').first().click();await page.fill('#favoriteName','長'.repeat(31));await page.getByRole('button',{name:'儲存收藏設定',exact:true}).click();await expect(page.locator('#favoriteEditStatus')).toContainText('最多30');expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(before);await page.keyboard.press('Escape');
 for(const data of ['{bad',{...C.exportFavoriteBackup(ids),version:99},{...C.exportFavoriteBackup(ids),favorites:[{...C.exportFavoriteBackup(ids).favorites[0],pinned:'true'}]},' '.repeat(C.MAX_BYTES+1)]){
  await page.setInputFiles('#favoritesFile',file(data));await expect(page.locator('#favoritesPreview')).toBeHidden();expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(before);
 }
 await page.setInputFiles('#favoritesFile',file(C.exportFavorites(ids)));await page.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(before);
 await edit(page,page.locator('.card').last(),'家附近',true);await page.click('#viewAllButton');await expect(page.locator('.favorite-label')).toHaveCount(0);await expect(page.locator('.favorite-edit')).toHaveCount(0);
});
for(const width of [320,390,768])test(`favorite dialog works in large mode at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await seed(page);await ready(page);await page.click('#largeTextButton');await page.click('#quickSavedButton');await page.locator('.favorite-edit').first().click();await page.fill('#favoriteName','家附近');await page.locator('#favoritePinned').check();
 expect(await page.locator('#favoriteDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.getByRole('button',{name:'儲存收藏設定',exact:true}).click();await expect(page.locator('.favorite-label')).toContainText('已置頂');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
