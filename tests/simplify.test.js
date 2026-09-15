/* ==========================================================================
   tests/simplify.test.js —— 对应第二优先级「简化操作复杂度」
   覆盖：一键下锅 prepAll、多灶台逐步点亮 activeSlots/nextStoveIn、
        道具栏折叠 toggleTools、食材旁的「可做菜」小字 ingredientDishes
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gt, gte, lte, includes } = H;

section('TC.Level · 简化操作');
const G = loadGame();
const { TC, document, window } = G;
const L = TC.Level;
const S = TC.Save;
const C = TC.Calc;
const D = TC.DATA;
const UI = TC.UI;

if (!UI.ready) TC.boot();

const zrand = () => 0;
const blank = () => S.blank();

function mk(levelId, save, opts) {
  return L.create(save || blank(), levelId, Object.assign({ rand: zrand, firstSpawn: 0 }, opts || {}));
}

/** 安插一位指定菜品的顾客，返回顾客对象 */
function place(run, dishId, opts) {
  opts = opts || {};
  const c = {
    uid: opts.uid || ('m' + (run.customers.length + 1)),
    id: opts.type || 'office',
    name: '上班族',
    sprite: 'cust_office_asia_street',
    dishId: dishId,
    patienceMax: opts.patience || 24000,
    patienceLeft: opts.patience || 24000,
    state: 'waiting',
    bornAt: run.runtime
  };
  run.customers.push(c);
  if (!run.selected) run.selected = c.uid;
  run.encounterIds[c.id] = 1;
  return c;
}

/* ------------------------------ 一键下锅 ------------------------------ */

test('prepAll：把当前订单的配料一次点完，规则与逐一点一致', () => {
  const run = mk('A1');
  const dish = D.dish('chowmein');                 // A1 只有炒面
  place(run, 'chowmein');
  const res = L.prepAll(run);
  ok(res.ok, '应成功');
  eq(res.tapped.length, dish.steps.length, '一次性下完所有配料');
  eq(res.prepDone, true, '配料齐了');
  // 逐一点与一键下锅的最终状态应一致：锅里 done 长度 = steps 长度
  const pot = run.pots.filter((p) => p && p.dishId === 'chowmein')[0];
  ok(pot, '锅应已就位');
  eq(pot.done.length, pot.steps.length);
  eq(pot.state, 'prep', '还处于备料态，等点锅开火');
});

test('prepAll：没有顾客时返回 no-order，且不产生副作用', () => {
  const run = mk('A1');
  const res = L.prepAll(run);
  eq(res.ok, false);
  eq(res.reason, 'no-order');
  eq(run.pots.filter(Boolean).length, 0, '不该偷偷开锅');
});

test('prepAll：有重复配料时不会超点（守卫限制在 steps 长度内）', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  const dish = D.dish('chowmein');
  const res = L.prepAll(run);
  eq(res.tapped.length, dish.steps.length);
  // 再来一次：配料已齐，不该再点出新的
  const again = L.prepAll(run);
  ok(again.tapped.length === 0 || again.ok === false, '配料齐了之后不该重复下');
  const pot = run.pots.filter((p) => p && p.dishId === 'chowmein')[0];
  eq(pot.done.length, dish.steps.length, 'done 长度不能超过 steps');
});

/* ------------------------------ 多灶台逐步点亮 ------------------------------ */

test('activeSlots：一局开始时只亮 1 口锅，随服务量逐步点亮到上限', () => {
  const save = blank();
  const run = mk('A1', save);
  eq(run.slots, 2, 'A1 默认 2 口锅');
  eq(L.activeSlots(run), 1, '开局只亮 1 口');
  run.served = 4;
  eq(L.activeSlots(run), 1, '4 单还不够（每 5 单 +1）');
  run.served = 5;
  eq(L.activeSlots(run), 2, '第 5 单点亮第 2 口');
  run.served = 100;
  eq(L.activeSlots(run), 2, '不能超过锅位上限');
});

test('nextStoveIn：报出距离下一口锅还差几单，全亮后归 0', () => {
  const run = mk('A1');
  run.served = 2;
  eq(L.nextStoveIn(run), 3, '5 - 2 = 3');
  run.served = 5;
  eq(L.nextStoveIn(run), 0, '2 口都亮 → 0');
});

test('activeSlots：教学局永远只用一口锅', () => {
  const run = mk('A1', blank(), { tutorial: true });
  eq(run.tutorial, true);
  eq(L.activeSlots(run), 1);
  run.served = 50;
  eq(L.activeSlots(run), 1, '教学局不因服务量解锁更多灶');
});

test('tapPot：点没点亮的灶返回 locked 并给出还差几单', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  // 先手动在 2 号位放一口 ready 的锅，模拟「想偷用第二口锅」
  const d = D.dish('chowmein');
  run.pots[1] = { dishId: 'chowmein', steps: d.steps.slice(), done: d.steps.slice(), state: 'ready', cookLeft: 0 };
  const res = L.tapPot(run, 1);
  eq(res.ok, false);
  eq(res.reason, 'locked');
  eq(res.need, 5, '还差 5 单才点亮第 2 口');
  // 1 号位（已点亮）可以正常用
  run.pots[0] = { dishId: 'chowmein', steps: d.steps.slice(), done: d.steps.slice(), state: 'prep', cookLeft: 0 };
  const okRes = L.tapPot(run, 0);
  eq(okRes.ok, true);
});

/* ------------------------------ 食材「可做菜」小字 ------------------------------ */

test('ingredientDishes：只返回本关可做、且真的用到该配料的菜', () => {
  const run = mk('A1');
  // A1 的 dishPool 里只有炒面，炒面用到的配料都应命中
  const pool = run.level.dishPool;
  ok(pool.length >= 1, 'A1 有菜可选');
  const firstIng = D.dish(pool[0]).steps[0];
  const hits = UI.ingredientDishes(run, firstIng);
  ok(hits.indexOf(pool[0]) !== -1, '本关那道菜应命中');
  // 一个本关根本不用的配料（找个不在任何本关菜的 steps 里的）
  const allUsed = {};
  pool.forEach((id) => D.dish(id).steps.forEach((s) => { allUsed[s] = 1; }));
  const unused = D.INGREDIENTS.find((i) => !allUsed[i.id]);
  if (unused) {
    eq(UI.ingredientDishes(run, unused.id).length, 0, '本关用不到的配料不该有命中');
  }
});

/* ------------------------------ 道具栏折叠 ------------------------------ */

test('toggleTools：默认收起，点开关展开/再点收起', () => {
  const run = mk('A1');
  UI.run = run;
  UI._toolOpen = false;
  UI._toolBuilt = false;
  UI._toolSig = null;
  // 打开
  const on = UI.toggleTools(true);
  eq(on, true);
  eq(UI._toolOpen, true);
  // 再收起来
  const off = UI.toggleTools(false);
  eq(off, false);
  eq(UI._toolOpen, false);
  // 无参翻转
  const flip = UI.toggleTools();
  eq(flip, true, '无参应翻转（false → true）');
  UI.run = null;
});

test('syncTools：道具栏渲染成「开关 + 二级菜单」，三个道具带文字名', () => {
  const run = mk('A1');
  UI.run = run;
  UI._toolBuilt = false;
  UI._toolSig = null;
  UI.syncTools(run);
  const host = document.getElementById('toolBar');
  ok(host, 'toolBar 存在');
  const toggle = host.querySelector('.tool-toggle');
  ok(toggle, '应有折叠开关');
  const btns = host.querySelectorAll('.tool-sheet [data-tool]');
  eq(btns.length, 3, '三个道具都在二级菜单里');
  includes(host.textContent, '道具', '开关上有「道具」标签');
  includes(host.textContent, '加速');
  includes(host.textContent, '保温');
  includes(host.textContent, '上菜');
  UI.run = null;
});
