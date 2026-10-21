const {test,expect}=require('@playwright/test'),C=require('../js/convenience-core'),T=require('../js/search-tools'),{load}=require('../scripts/data-tool.cjs');
const rows=load(),row=rows.find(r=>r.sourceFile==='sanmin-west.csv'&&C.shareable(T.stopId(r),C.identityIndex(rows))),url=C.shareURL(T.stopId(row),'http://127.0.0.1:4173/');
async function ready(page){await page.goto(url);await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});}
test('problem report copies full identity for every type and supports editing and manual fallback without network submission',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.reportCopy=value;}}}));await ready(page);
 const before=await page.evaluate(()=>localStorage.getItem('garbage-search-v1'));const submissions=[];page.on('request',r=>{if(r.method()!=='GET')submissions.push(r.url());});
 await page.locator('.report-button').click();await expect(page.locator('#reportType')).toBeFocused();await expect(page.locator('#reportDisclaimer')).toContainText('不會自動送出');await expect(page.locator('#reportText')).toBeHidden();
 for(const type of Object.keys(C.reportTypes)){
  await page.selectOption('#reportType',type);await page.fill('#reportNote','<img src=x onerror=alert(1)> 請核對');await page.click('#copyReport');
  expect(await page.evaluate(()=>window.reportCopy)).toBe(C.reportText(row,type,'<img src=x onerror=alert(1)> 請核對'));
  await expect(page.locator('#reportStatus')).toContainText('尚未送出');await expect(page.locator('#reportDialog img')).toHaveCount(0);
 }
 await page.fill('#reportNote','修改後的補充');await expect(page.locator('#reportText')).toHaveValue(C.reportText(row,'other','修改後的補充'));
 await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('denied');};});await page.click('#copyReport');await expect(page.locator('#reportStatus')).toContainText('手動複製');await expect(page.locator('#reportText')).toBeFocused();await expect(page.locator('#reportPreview')).toHaveAttribute('open','');
 expect(await page.locator('#reportText').evaluate(el=>el.selectionEnd-el.selectionStart)).toBe((await page.locator('#reportText').inputValue()).length);
 await page.fill('#reportNote','長'.repeat(301));await expect(page.locator('#copyReport')).toBeDisabled();await page.fill('#reportNote','');await expect(page.locator('#copyReport')).toBeEnabled();
 await page.keyboard.press('Escape');await expect(page.locator('#reportDialog')).toBeHidden();await expect(page.locator('.report-button')).toBeFocused();expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(before);expect(submissions).toEqual([]);
});
for(const width of [320,390,768,1280])test(`report ${width}px is usable in large mode and can close using keyboard or button`,async({page})=>{
 await page.setViewportSize({width,height:900});await ready(page);await page.click('#largeTextButton');await page.locator('.report-button').click();await page.selectOption('#reportType','time');await page.fill('#reportNote','請協助查核');
 expect(await page.locator('#reportDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.click('#closeReport');await expect(page.locator('#reportDialog')).toBeHidden();await page.locator('.report-button').focus();await page.keyboard.press('Enter');await expect(page.locator('#reportDialog')).toBeVisible();await page.keyboard.press('Escape');
});
