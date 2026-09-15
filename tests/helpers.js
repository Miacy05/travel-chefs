/* ==========================================================================
   tests/helpers.js —— jsdom 装载器
   把 travel-chefs/index.html 真实加载进 jsdom，取回 window.TC。
   jsdom 定位顺序：本地 node_modules → 环境变量 → WorkBuddy 托管 node 工作区。
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const INDEX = path.join(__dirname, '..', 'index.html');

let JSDOM = null;
let VCONSOLE = null;
let jsdomFrom = null;

/** 在多个候选位置里找到 jsdom */
function resolveJsdom() {
  if (JSDOM) return { JSDOM, VirtualConsole: VCONSOLE, from: jsdomFrom };

  const candidates = [];
  if (process.env.TC_JSDOM) candidates.push(process.env.TC_JSDOM);
  candidates.push('jsdom');
  candidates.push(path.join(__dirname, 'node_modules', 'jsdom'));
  const home = os.homedir();
  candidates.push(path.join(home, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'jsdom'));

  // 托管 node 的各版本 node_modules
  const versionsDir = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
  if (fs.existsSync(versionsDir)) {
    for (const v of fs.readdirSync(versionsDir)) {
      candidates.push(path.join(versionsDir, v, 'lib', 'node_modules', 'jsdom'));
      candidates.push(path.join(versionsDir, v, 'node_modules', 'jsdom'));
    }
  }

  for (const c of candidates) {
    try {
      const mod = require(c);
      if (mod && mod.JSDOM) {
        JSDOM = mod.JSDOM;
        VCONSOLE = mod.VirtualConsole || null;
        jsdomFrom = c;
        return { JSDOM, VirtualConsole: VCONSOLE, from: c };
      }
    } catch (e) { /* 继续找下一个候选 */ }
  }

  throw new Error(
    '找不到 jsdom。请任选一种方式安装后重跑：\n' +
    '  1) 在 travel-chefs/ 下执行：npm i -D jsdom\n' +
    '  2) 设置环境变量 TC_JSDOM=<jsdom 模块的绝对路径>\n' +
    '  3) 把 jsdom 安装到托管工作区：' +
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace') + '\n' +
    '（测试只需要 jsdom，不需要 jest/mocha 等任何测试框架）'
  );
}

/** 需要忽略的 jsdom 噪音（无 canvas 时 getContext 会报 not implemented） */
const NOISE = [
  'Not implemented: HTMLCanvasElement.prototype.getContext',
  'Not implemented: HTMLCanvasElement',
  'Not implemented: window.scrollTo',
  'Could not parse CSS stylesheet',
];

function isNoise(msg) {
  const s = String(msg == null ? '' : msg);
  return NOISE.some((n) => s.indexOf(n) !== -1);
}

/**
 * 加载游戏
 * @param {object} [opts]
 *   @param {boolean} [opts.fresh]  为 true 时每次都新建 DOM（默认复用单例，快）
 * @returns {{ window, document, TC, dom, errors, html }}
 */
let SINGLETON = null;

function loadGame(opts) {
  opts = opts || {};
  if (SINGLETON && !opts.fresh) return SINGLETON;

  const { JSDOM: J } = resolveJsdom();
  const VC = (resolveJsdom().VirtualConsole) || null;

  const html = fs.readFileSync(INDEX, 'utf8');
  const errors = [];
  const virtualConsole = VC ? new VC() : undefined;

  if (virtualConsole) {
    virtualConsole.on('jsdomError', (e) => { if (!isNoise(e && e.message)) errors.push(e); });
    virtualConsole.on('error', (...a) => { const m = a.join(' '); if (!isNoise(m)) errors.push(new Error(m)); });
    virtualConsole.on('warn', () => {});
    virtualConsole.on('log', () => {});
    virtualConsole.on('info', () => {});
  }

  const dom = new J(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole,
  });

  const window = dom.window;
  const TC = window.TC;
  if (!TC) throw new Error('index.html 中没有挂载 window.TC，检查 <script> 是否被内联执行');

  const game = { dom, window, document: window.document, TC, errors, html, jsdom: jsdomFrom };
  SINGLETON = game;
  return game;
}

/** 丢弃单例，下次 loadGame 重新解析 HTML（用于 reset 存档等场景） */
function dropGame() { SINGLETON = null; }

/** 生成一个干净存档对象（不落盘） */
function freshSave(TC, over) {
  const s = TC.Save.blank();
  if (over) TC.Util.assign(s, over);
  return s;
}

/** 还原一个确定性随机源，供顾客 / 每日任务等场景复现 */
function seeded(seed) { return { TC: null, rand: null }; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待条件成立（轮询，默认 2s 超时） */
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  const cap = timeout == null ? 2000 : timeout;
  for (;;) {
    let v;
    try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > cap) return null;
    await sleep(10);
  }
}

module.exports = { loadGame, dropGame, freshSave, sleep, waitFor, resolveJsdom, INDEX, seeded };
