const {test,expect}=require('@playwright/test');
async function ready(page){await page.goto('/');await expect(page.locator('#searchButton')).toBeEnabled({timeout:15000});}
for(const width of [320,390,768,1280]) test(`large text ${width}px keeps search, saved and copy usable without overflow and persists separately`,async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
 await page.setViewportSize({width,height:900});await ready(page);await page.selectOption('#district','all');await page.fill('#keyword','河北二路102號');await page.click('#searchButton');
 await page.locator('.save-button').click();const old=await page.evaluate(()=>localStorage.getItem('garbage-search-v1'));
 const normal=await page.locator('.card h3').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 await page.locator('#largeTextButton').click();await expect(page.locator('#largeTextButton')).toHaveAttribute('aria-pressed','true');
 expect(await page.locator('.card h3').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(normal);
 await expect(page.locator('#keyword')).toHaveValue('河北二路102號');expect(await page.evaluate(()=>localStorage.getItem('garbage-search-v1'))).toBe(old);
 await page.click('#searchButton');await page.click('#quickSavedButton');await expect(page.locator('.card h3')).toHaveText('河北二路102號');
 await page.locator('.copy-button').click();await expect(page.locator('#copyDialog')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const sizes=await page.locator('button:visible, .stop-actions a:visible, input:visible, select:visible').evaluateAll(els=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
 expect(sizes.every(r=>r.w>=44&&r.h>=44)).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('#copyDialog')).toBeHidden();
 await page.locator('.share-button').click();await expect(page.locator('#copyHeading')).toHaveText('複製站點連結');expect(await page.locator('#copyText').inputValue()).toContain('#stop=1.');await page.keyboard.press('Escape');
 await page.reload();await expect(page.locator('#searchButton')).toBeEnabled();await expect(page.locator('#largeTextButton')).toHaveAttribute('aria-pressed','true');
 await page.locator('#largeTextButton').focus();await page.keyboard.press('Enter');await expect(page.locator('#largeTextButton')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#favoriteCount')).toHaveText('1');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('blocked display storage warns without clearing in-memory favorites or search',async({page})=>{
 await ready(page);await page.locator('.save-button').first().click();await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('blocked');};});
 await page.click('#largeTextButton');await expect(page.locator('#toast')).toContainText('無法保存大字模式');await expect(page.locator('#favoriteCount')).toHaveText('1');await expect(page.locator('#searchButton')).toBeEnabled();
});
test('large text also respects a larger browser base font without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:320,height:900});await ready(page);await page.selectOption('#district','all');await page.fill('#keyword','河北二路102號');await page.click('#searchButton');await page.click('#largeTextButton');
 const initial=await page.locator('.card h3').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 await page.evaluate(()=>{document.documentElement.style.fontSize='20px';});
 const scaled=await page.locator('.card h3').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));expect(scaled).toBe(initial*1.25);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
