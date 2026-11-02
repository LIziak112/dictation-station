const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-ui-'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(dir, 'server.js'));
  fs.cpSync(path.join(__dirname, '..', 'public'), path.join(dir, 'public'), { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {cwd:dir, env:{...process.env,PORT:'0',WRITE_TOKEN:'synthetic-ui-only',ALLOW_UNSAFE_WRITES:'false'},stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    const base = await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('startup timeout')),5000);
      let text=''; child.stdout.on('data',d=>{text+=d;const m=text.match(/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve('http://'+m[0]);}});
      child.on('error',reject);
    });
    const response = await fetch(base+'/api/batches',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-ui-only'},body:JSON.stringify({id:'demo1',title:'合成分享测试',entries:[{zh:'太阳',en:'sun'},{zh:'月亮',en:'moon'}]})});
    assert.equal(response.status,200);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[]; const external=[]; const writes=[]; let dialogs=0;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(!r.url().startsWith(base)) external.push(r.url()); if(r.method()==='POST')writes.push(r.url());});
    page.on('dialog',async d=>{dialogs++;await d.dismiss();});
    await page.goto(base+'/#batch=demo1');
    await page.locator('#share-batch').waitFor({timeout:5000}).catch(async e => { console.error({errors, body:await page.locator('body').innerText()}); throw e; });
    await page.locator('#share-batch').click();
    await page.locator('.qr-preview svg').waitFor();
    assert.equal(await page.locator('input[aria-label="分享链接"]').inputValue(),base+'/#batch=demo1');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('writeToken')),null);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.mode-btn').first().click();
    await page.locator('#btn-finish').click();
    await page.locator('#mark-all-no').click();
    assert.match(await page.locator('#mark-summary').innerText(),/错误 2/);
    assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('dictation.wrong.demo1'))).length,2);
    await page.locator('#mark-all-ok').click();
    assert.equal(await page.locator('[aria-pressed="true"]').count(),2);
    assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('dictation.wrong.demo1'))),[]);
    await page.locator('#mark-clear').click();
    assert.match(await page.locator('#mark-summary').innerText(),/已核对 0\/2/);
    await page.locator('#mark-all-no').click();
    await page.reload();
    await page.locator('#retry-wrong').waitFor();
    await page.evaluate(()=>location.hash='batch=missing123');
    await page.locator('#new-batch').waitFor();
    await page.evaluate(()=>location.hash='batch=demo1');
    await page.locator('#share-batch').waitFor();
    assert.equal(dialogs,0,'public playback must not request a password');
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    assert.deepEqual(writes,[],'public playback must not invoke paid TTS');
    console.log('PASS mobile viewport: deep link, offline QR SVG, safe URL, public playback without password/paid API, bulk correct/incorrect/clear, wrong persistence, hash navigation, missing-batch fallback, no uncaught errors/external requests.');
  } finally {
    if(browser)await browser.close();
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
