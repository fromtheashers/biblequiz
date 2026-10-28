const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '/tmp/claude-0/e2e/state'],
    { cwd: '/home/user/biblequiz', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, detached: true });
  let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(500); }
  const fails = []; const errors = [];
  const check = (c, m) => { if (!c) fails.push(m); };
  const browser = await chromium.launch();
  try {
    const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    host.on('pageerror', (e) => errors.push('host: ' + e.message));
    host.on('console', (m) => m.type() === 'error' && errors.push('host console: ' + m.text()));
    await host.goto(BASE + '/host?key=change-me');
    await host.click('body');
    await host.waitForSelector('text=/Start/', { timeout: 10000 });
    const phones = []; const leaks = [];
    for (const name of ['Alice', 'Bob', 'Cara']) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
      p.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
      p.on('websocket', (ws) => ws.on('framereceived', (f) => {
        try { const m = JSON.parse(f.payload); if (m.type === 'state' && m.view.phase === 'question' && /"(isBible|source|note|correctAnswer)"\s*:/.test(f.payload)) leaks.push(name); } catch {}
      }));
      await p.goto(BASE + '/');
      await p.fill('input', name);
      await p.keyboard.press('Enter');
      await p.waitForSelector('text=/in!/i', { timeout: 10000 });
      phones.push({ name, p });
    }
    await host.screenshot({ path: '/tmp/claude-0/e2e/host-lobby.png' });
    const hostSend = async (key) => { await host.keyboard.press(key); await sleep(400); };
    await hostSend('Space'); // start -> intro
    await hostSend('Space'); // question 1
    for (let round = 1; round <= 15; round++) {
      // each phone taps its first visible answer button (Alice first = fastest)
      for (const { p, name } of phones) {
        const btn = p.locator('button:visible').filter({ hasNotText: /✏️|Join/ });
        await p.waitForTimeout(200);
        const sel = round <= 6 ? (name === 'Cara' ? 1 : 0) : (name === 'Bob' ? 2 : 0);
        const answerBtns = p.locator('section:not([hidden]) button:not([disabled])');
        const n = await answerBtns.count();
        if (n === 0) { fails.push(`r${round} ${name}: no answer buttons`); continue; }
        await answerBtns.nth(Math.min(sel, n - 1)).tap();
      }
      await sleep(800);
      const phase = await host.locator('body').innerText();
      if (round === 7) await host.screenshot({ path: '/tmp/claude-0/e2e/host-r7-reveal.png' });
      if (round === 1) { await phones[0].p.screenshot({ path: '/tmp/claude-0/e2e/phone-r1-reveal.png' }); await host.screenshot({ path: '/tmp/claude-0/e2e/host-r1-reveal.png' }); }
      await hostSend('Space'); // leaderboard
      await hostSend('Space'); // next question / section / podium
      if (round === 6) { await host.screenshot({ path: '/tmp/claude-0/e2e/host-section.png' }); await hostSend('Space'); }
    }
    await sleep(9000);
    await host.screenshot({ path: '/tmp/claude-0/e2e/host-podium.png' });
    for (const { p, name } of phones) { const t = await p.locator('body').innerText(); check(/finished/i.test(t), name + ' podium text: ' + t.slice(0, 120)); await p.screenshot({ path: `/tmp/claude-0/e2e/phone-${name}-podium.png` }); }
    const ht = await host.locator('body').innerText();
    check(/Alice|Bob|Cara/.test(ht), 'host podium shows names');
    check(leaks.length === 0, 'secret leak to ' + leaks.join(','));
    // refresh rejoin
    await phones[1].p.reload(); await sleep(2000);
    check(/finished/i.test(await phones[1].p.locator('body').innerText()), 'Bob rejoined after refresh at podium');
  } catch (e) { fails.push('EXC ' + e.message); }
  await browser.close();
  try { process.kill(-dev.pid); } catch {}
  console.log(JSON.stringify({ fails, errors }, null, 1));
})();
