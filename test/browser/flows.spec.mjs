import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async({page,request})=>{
  await request.post('/__test/reset');
  await page.goto('/');
  await page.locator('#loginUser').fill('admin');await page.locator('#loginPass').fill('browser-test-password');await page.locator('#loginBtn').click();
  await expect(page.locator('#content h1')).toBeVisible();
});
test('paper review cancels without trades, confirms once and replays safely',async({page})=>{
  await page.locator('.nav-btn[data-section="aimirror"]').click();
  await page.locator('#applyMirrorWalletBtn').click();
  const dialog=page.getByRole('dialog',{name:'Review simulated purchases'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('table')).toContainText('AAPL');await expect(dialog.getByRole('table')).toContainText('$100.00');
  const empty=await page.request.get('/.netlify/functions/state');expect((await empty.json()).portfolio.transactions).toHaveLength(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.locator('#applyMirrorWalletBtn').click();await expect(dialog).toBeVisible();
  const responsePromise=page.waitForResponse(r=>r.url().includes('/portfolio-build')&&r.request().postDataJSON().action==='confirmBuild');
  await dialog.getByRole('button',{name:'Confirm paper purchases'}).click();
  const response=await responsePromise;expect(response.ok()).toBeTruthy();const confirmed=await response.json();
  await expect(dialog).toHaveCount(0);
  const replay=await page.request.post('/.netlify/functions/portfolio-build',{data:{action:'confirmBuild',planId:confirmed.planId}});expect((await replay.json()).idempotent).toBe(true);
  const result=await page.request.get('/.netlify/functions/state');const wallet=(await result.json()).portfolio;expect(wallet.transactions).toHaveLength(2);expect(wallet.derived.positions.find(p=>p.symbol==='AAPL').quantity).toBe(2);
});
test('review and profile controls satisfy accessibility rules and keyboard focus',async({page})=>{
  await page.locator('.nav-btn[data-section="settings"]').click();
  const profile=await new AxeBuilder({page}).include('#content').withTags(['wcag2a','wcag21a']).analyze();expect(profile.violations).toEqual([]);
  await page.locator('#sName').fill('Preserved profile');await page.locator('[data-risk="Conservative"]').press('Enter');await expect(page.locator('#sName')).toHaveValue('Preserved profile');
  await page.locator('.nav-btn[data-section="aimirror"]').click();await page.locator('#applyMirrorWalletBtn').click();
  const dialog=page.getByRole('dialog',{name:'Review simulated purchases'});await expect(dialog).toBeVisible();
  const a11y=await new AxeBuilder({page}).include('#runtimeModal').withTags(['wcag2a','wcag21a']).analyze();expect(a11y.violations).toEqual([]);
  await dialog.getByRole('button',{name:'Confirm paper purchases'}).focus();await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#runtimeModal'))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.locator('#applyMirrorWalletBtn')).toBeFocused();
});
test('all seven screens work on desktop and mobile without overflow or JS errors',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    for(const section of ['home','broker','wallet','aimirror','performance','insight','settings']){
      const nav=width<600?page.locator(`.footer-btn[data-section="${section}"]`):page.locator(`.nav-btn[data-section="${section}"]`);
      if(await nav.count()&&await nav.first().isVisible())await nav.first().click();
      else await page.locator(`.nav-btn[data-section="${section}"]`).evaluate(el=>el.click());
      await expect(page.locator('#content')).not.toBeEmpty();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    if(width===390)await expect(page.locator('#lockBtn')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
