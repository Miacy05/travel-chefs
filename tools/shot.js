/* ==========================================================================
   tools/shot.js —— 真机截图（无头 Chromium + CDP），用来生成 docs/ 下的截图
   为什么要自己写：项目零依赖，不想为了截图引入 playwright/puppeteer。
   Node 22 自带 WebSocket，于是直接用 DevTools 协议就够了。

   用法：
     node tools/shot.js --page=map    --out=docs/map.png
     node tools/shot.js --page=codex  --out=docs/codex.png
     node tools/shot.js --page=custom --out=x.png --js="TC.Router.go('map')"
   参数：--size=390x844（默认） --dpr=2（默认） --wait=900（毫秒）
   注：脚本自己起一个只服务本项目目录的本地 http 服务 —— file:// 下 localStorage 受限。
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8731;
const CDP_PORT = 9333;

/* ---------------------------- 参数 ---------------------------- */
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
}
const PAGE = arg('page', 'map');
const OUT = path.resolve(ROOT, arg('out', 'docs/shot.png'));
const SIZE = arg('size', '390x844').split('x').map(Number);
const DPR = Number(arg('dpr', 2));
const WAIT = Number(arg('wait', 900));
const SEED = arg('seed', '') === '1';
/** 指定 --url= 就直接截那个线上地址（用来验收部署后的线上效果），否则截本地 index.html */
const REMOTE_URL = arg('url', '');

/**
 * 造一份"玩过一阵子"的存档，让截图不是全 0 的空壳。
 * 只用公开 API（TC.Calc / TC.Save）改数据，不改 DOM。
 */
const SEED_JS = `(function(){
  var s = TC.UI.save;
  s.coins = 1280; s.gems = 6;
  /* 第 1 区全通（这样徽章是"已获得"、菜谱解锁也够多），第 2 区通两关 */
  ['A1','A2','A3','A4','A5'].forEach(function(id, i){ s.regions.asia_street[id] = i === 4 ? 2 : 3; });
  s.regions.paris_cafe.B1 = 3; s.regions.paris_cafe.B2 = 2;
  s.stats.customers = 42;
  TC.DATA.CUSTOMERS.forEach(function(c){ s.stats.seenCustomers[c.id] = 1; });
  TC.UI.persist();
})()`;

/** 每个页面怎么走到位（都是真实调用，不是伪造 DOM） */
const PAGES = {
  map: { js: 'TC.Router.go("map",{force:true})', wait: 1200 },
  codex: { js: 'TC.Router.go("codex",{force:true,tab:"book"})', wait: 700 },
  badges: { js: 'TC.Router.go("codex",{force:true,tab:"book"}); TC.UI.setBookTab("badge");', wait: 700 },
  custs: { js: 'TC.Router.go("codex",{force:true,tab:"book"}); TC.UI.setBookTab("cust");', wait: 700 },
  levels: { js: 'TC.UI.openRegion("asia_street")', wait: 700 },
  custom: { js: arg('js', ''), wait: WAIT }
};

/* ---------------------------- 找浏览器 ---------------------------- */
function findBrowser() {
  const cands = [
    process.env.TC_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到浏览器，可用 TC_BROWSER=... 指定');
}

/* ---------------------------- 本地静态服务 ---------------------------- */
function serve() {
  const MIME = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

/* ---------------------------- 小工具 ---------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url) {
  const res = await fetch(url);
  return res.json();
}

/* ---------------------------- 主流程 ---------------------------- */
(async () => {
  const browser = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-shot-'));
  const srv = REMOTE_URL ? { close() {} } : await serve();   // 截线上地址时不用起本地服务

  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = async () => {
    try { child.kill(); } catch (e) { /* ignore */ }
    try { srv.close(); } catch (e) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };

  try {
    /* 等 CDP 起来 */
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { ver = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break; } catch (e) { await sleep(250); }
    }
    if (!ver) throw new Error('浏览器 CDP 端口没起来');

    const targets = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用的页面 target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const send = (method, params) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: SIZE[0], height: SIZE[1], deviceScaleFactor: DPR, mobile: true
    });

    const url = REMOTE_URL || ('http://127.0.0.1:' + PORT + '/index.html');
    await send('Page.navigate', { url });
    await sleep(1200);                                  // 等 boot + 首帧

    if (SEED) {
      await send('Runtime.evaluate', { expression: SEED_JS, returnByValue: true });
      await sleep(120);
    }

    const recipe = PAGES[PAGE] || PAGES.custom;
    if (recipe.js) {
      const r = await send('Runtime.evaluate', { expression: recipe.js, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        throw new Error('页面脚本报错：' + JSON.stringify(r.result.exceptionDetails));
      }
    }
    await sleep(recipe.wait || WAIT);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result || !shot.result.data) throw new Error('截图失败：' + JSON.stringify(shot).slice(0, 200));

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('已截图 ' + OUT + '  (' + SIZE[0] + 'x' + SIZE[1] + ' @' + DPR + 'x, page=' + PAGE + ')');

    await send('Browser.close');
    ws.close();
  } finally {
    await cleanup();
  }
})().catch(async (e) => {
  console.error('截图失败：' + e.message);
  process.exit(1);
});
