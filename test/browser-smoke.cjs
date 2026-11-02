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
    // Deterministic speech events: verifies application lifecycle, not speaker output.
    await page.addInitScript(() => {
      window.__spoken = [];
      window.__utterance = null;
      window.speechSynthesis.speak = u => { window.__spoken.push(u.text); window.__utterance = u; };
      window.speechSynthesis.cancel = () => { window.__utterance = null; };
    });
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
    // Issue #1: start immediately in listening modes and expose cancellable state.
    await page.evaluate(() => startPlayer('en2en'));
    assert.equal(await page.evaluate(() => window.__spoken.at(-1)), 'sun');
    assert.equal(await page.locator('#btn-play').getAttribute('aria-pressed'), 'true');
    await page.locator('#btn-play').click();
    assert.equal(await page.locator('#btn-play').getAttribute('aria-pressed'), 'false');
    await page.locator('#btn-play').click();
    assert.equal(await page.locator('#btn-play').getAttribute('aria-pressed'), 'true');
    await page.locator('#btn-next').click();
    assert.equal(await page.locator('#btn-play').getAttribute('aria-pressed'), 'false');
    // Natural completion resets the button.
    await page.evaluate(() => { S.player.auto = false; S.player.repeat = 1; });
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.__utterance.onend());
    await page.waitForFunction(() => document.querySelector('#btn-play').getAttribute('aria-pressed') === 'false');
    // Failure is visible and retryable, not silent success.
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.__utterance.onerror({error:'not-allowed'}));
    await page.waitForFunction(() => document.querySelector('#btn-play').getAttribute('aria-pressed') === 'false');
    assert.match(await page.locator('#toast').innerText(), /无法播放/);
    // Auto-next cannot be reset by the preceding item's finally block.
    await page.evaluate(() => { S.player.idx=0; S.player.auto=true; S.player.repeat=1; S.player.interval=0; });
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.__utterance.onend());
    await page.waitForFunction(() => S.player.idx === 1 && S.player.playing);
    assert.equal(await page.locator('#btn-play').getAttribute('aria-pressed'),'true');
    await page.locator('#btn-play').click();
    // A stale end event after hash navigation cannot resume playback.
    await page.locator('#btn-play').click();
    await page.evaluate(() => { window.__staleEnd=window.__utterance.onend; location.hash=''; });
    await page.waitForFunction(() => S.view === 'home');
    const afterLeave = await page.evaluate(() => window.__spoken.length);
    await page.evaluate(() => window.__staleEnd());
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__spoken.length),afterLeave);
    // No audio mode does not speak, while Chinese listening starts in the gesture.
    await page.evaluate(() => {
      S.batch.entries = [normalizeEntry({zh:'长大',pinyin:'zhǎng dà'},0)];
      startPlayer('zh_dictation');
    });
    assert.equal(await page.evaluate(() => window.__spoken.at(-1)), '长大');
    await page.locator('#btn-play').click();
    const spokenBefore = await page.evaluate(() => window.__spoken.length);
    await page.evaluate(() => startPlayer('pinyin2hanzi'));
    assert.equal(await page.evaluate(() => window.__spoken.length), spokenBefore);
    assert.equal(await page.locator('#btn-play').isDisabled(), true);
    // Issue #5: word table detects supplied wrong reading, missing reading, preserves data.
    const validation = await page.evaluate(() => {
      const entries = [
        {zh:'勉强',pinyin:'miǎn qiáng'}, {zh:'长大',pinyin:'cháng dà'},
        {zh:'音乐',pinyin:'yīn lè'}, {zh:'银行',pinyin:'yín háng'},
        {zh:'长大',pinyin:''}, {zh:'苹果',pinyin:'píng guǒ'},
        {zh:'音乐',pinyin:'yīn yuè'}, {zh:'长',pinyin:'cháng'}
      ].map(normalizeEntry);
      const before = JSON.stringify(entries);
      const issues = validateEntries(entries);
      return {issues, unchanged:before === JSON.stringify(entries)};
    });
    assert.equal(validation.unchanged,true);
    for (const i of [0,1,2,4]) assert.ok(validation.issues.some(x => x.i===i && x.msg.includes('词级读音')));
    assert.ok(validation.issues.some(x => x.i===3 && x.msg.includes('含多音字')));
    for (const i of [5,6]) assert.ok(!validation.issues.some(x => x.i===i && x.msg.includes('词级读音')));
    assert.ok(validation.issues.some(x => x.i===7 && x.msg.includes('含多音字')));
    // Playback speed: select renders, applies to device speech, persists per batch.
    await page.evaluate(() => { S.batch.entries = [normalizeEntry({zh:'太阳',en:'sun'},0)]; startPlayer('en2en'); });
    assert.equal(await page.locator('#set-speed').count(), 1);
    await page.locator('#set-speed').selectOption('0.5');
    assert.equal(await page.evaluate(() => S.player.speed), 0.5);
    assert.equal(await page.evaluate(() => localStorage.getItem('dictation.speed.demo1')), '0.5');
    await page.locator('#btn-play').click();
    await page.locator('#btn-play').click();
    assert.equal(await page.evaluate(() => Math.round(window.__utterance.rate * 100) / 100), 0.45);
    await page.locator('#set-speed').selectOption('2');
    await page.locator('#btn-play').click();
    await page.locator('#btn-play').click();
    assert.equal(await page.evaluate(() => Math.round(window.__utterance.rate * 100) / 100), 1.8);
    console.log('PASS playback speed: select renders, speech rate follows 0.5x/2x, choice persisted per batch.');
    console.log('PASS issues #1/#5: immediate English/Chinese speech, stop/replay, next cancels, natural completion, speech failure reset, silent pinyin mode, word readings/missing/unknown/single-character validation without mutation.');
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
