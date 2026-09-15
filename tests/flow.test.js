/* ==========================================================================
   tests/flow.test.js —— 阶段 3 验收：整条经营链路真的能走通
   做法：在 jsdom 里用**真实点击 / 真实调用**把一局从「地图」打到「结算」：
       地图 → 选地区 → 开一关 → 顾客上门 → 点食材 → 点锅开火 → 出锅
       → 点锅装盘 → 上菜 → 打满 → 结算落地 → 解锁下一关
   注意：本文件测的是**模块之间接好了没有**（UI ↔ Level ↔ Scene ↔ Save）；
        单条规则的正确性由 level.test.js / calc.test.js 负责，这里不重复。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, ne, no, section, gt, gte, lt, includes } = H;

section('链路 · 阶段 3');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI, L = TC.Level, SC = TC.Scene;
const D = TC.DATA, C = TC.Calc, S = TC.Save, U = TC.Util;

if (!UI.ready) TC.boot();

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

function click(el) {
  ok(el, '要点击的元素不存在');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** 用户最后看到的那条 toast */
function lastToast() {
  const list = $$('#toastHost .toast');
  return list.length ? list[list.length - 1].textContent : '';
}

function emptySave() {
  const s = S.blank();
  S.checkDaily(s, U.today());
  return s;
}

/** 回到地图页，并清掉上一局的所有残留状态 */
function toMap(save) {
  UI.save = save || emptySave();
  UI.run = null;
  UI.result = null;
  UI._settled = false;
  UI.holdClear();
  SC.stop();
  TC.Router.go('map', { force: true, silent: true });
  UI.onRoute('map', null, {});
  return UI.save;
}

/**
 * 开一局。loop:false —— 不排 rAF，测试自己用 SC.step 手动推进，结果才确定。
 * run.rand 固定成「永远取第 0 个」，顾客类型与菜品都确定。
 */
function startRun(levelId) {
  toMap();
  const started = UI.openLevel(levelId || 'A1', { loop: false, skipGuest: true });
  if (!started) return null;
  const run = UI.run;
  run.rand = () => 0;
  return run;
}

/** 把耐心顶到很高：本文件不测耐心，只测链路，避免顾客中途跑掉 */
function freezePatience(run) {
  run.customers.forEach((c) => {
    c.patienceMax = 900000;
    c.patienceLeft = 900000;
  });
}

/** 让第一位顾客上门（不依赖真实时间） */
function firstCustomer(run) {
  run.spawnTimer = 0;
  SC.step(1, run);
  freezePatience(run);
  return run.customers[0] || null;
}

/** 按 100ms 一帧推进，直到条件成立；返回推进的毫秒数，超时返回 -1 */
function advanceUntil(run, pred, capMs) {
  let t = 0;
  const cap = capMs || 30000;
  while (t < cap) {
    SC.step(100, run);
    t += 100;
    freezePatience(run);
    if (pred()) return t;
  }
  return -1;
}

/** 点齐当前订单的食材并开火，一直推进到出锅 */
function cookToReady(run, customer) {
  const dish = D.dish(customer.dishId);
  dish.steps.forEach((id) => UI.tapIngredient(id));
  ok(UI.tapPot(0), '备料齐了应该能开火');
  const t = advanceUntil(run, () => run.pots[0] && run.pots[0].state === 'ready', 30000);
  gt(t, 0, '应该在 30s 内出锅（实际超时）');
  return run.pots[0];
}

/** 点锅装盘：走 canvas 命中这条真实路径（jsdom 量不到布局，用等价的 2 倍布局） */
function pluckPotIntoHand(run) {
  const lay = SC.layout(320, 180, run);
  const pr = lay.pots[0];
  const s = SC.toScreen(lay, pr.x + pr.w / 2, pr.y + pr.h / 2);
  UI.sceneDown({ clientX: s.x, clientY: s.y, preventDefault() {} });
  return s;
}

/* ============================== 进入经营页 ============================== */
test('点「开始营业」进经营页：首帧的顶栏 / 食材台 / 订单卡 / 道具都到位', () => {
  const run = startRun('A1');
  ok(run, '应该建出一局');
  eq(TC.Router.current, 'cook');
  ok($('view-cook').classList.contains('is-active'));
  eq($('bottomnav').hidden, true, '经营页隐藏底部导航');
  eq($('tbTrack').hidden, false, '倒计时进度条要显示出来');
  ok(UI.topbarCenter.indexOf('⏱') === 0, '顶栏中央变成倒计时：' + UI.topbarCenter);
  eq(UI._action, 'pause', '顶栏右侧按钮变成暂停');
  eq($$('#toolBar [data-tool]').length, 3, '三个道具都要有');
  includes($('orderCard').textContent, '等待顾客点单');
  includes($('pantryBand').textContent, '食材台');
  eq(UI.run.levelId, 'A1');
});

test('顾客上门：顾客带 / 订单卡 / 食材台三处同时联动', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  ok(c, '第一位顾客应该上门');
  const dish = D.dish(c.dishId);
  const income = C.orderIncome(c.dishId, c.id, run.regionId, run.save);

  eq($$('#custBand .cust').length, 1);
  const card = $$('#custBand .cust')[0];
  eq(card.getAttribute('data-uid'), c.uid);
  ok(card.classList.contains('is-sel'), '第一位顾客自动选中');
  includes(card.textContent, c.name);
  includes(card.textContent, dish.name);
  eq($$('#custBand .cust-sprite canvas').length, 1, '顾客立绘 canvas 要在');
  eq(card.querySelector('.cust-wait > i').style.width, '100%', '耐心条初始满格');

  includes($('orderCard').textContent, dish.name);
  includes($('orderCard').textContent, c.name);
  includes($('orderCard').textContent, '+' + (income.coins + income.tips));

  const pantry = $$('#pantryBand .pantry-btn');
  eq(pantry.length, dish.steps.length, '食材台摆出这道菜的全部配料');
  dish.steps.forEach((id, i) => {
    eq(pantry[i].getAttribute('data-ing'), id);
    no(pantry[i].classList.contains('is-done'), '一开始都没下锅');
  });
});

test('点食材进锅：不要求顺序，点错不惩罚，点重了会提示', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  const dish = D.dish(c.dishId);

  // 点一个这道菜不需要的食材
  const notNeeded = D.INGREDIENTS.map((i) => i.id)
    .filter((id) => dish.steps.indexOf(id) === -1)[0];
  ok(notNeeded, '总能找到一个用不上的食材');
  eq(UI.tapIngredient(notNeeded), false);
  includes(lastToast(), '不用它');
  eq(run.pots.filter(Boolean).length, 0, '点错不会白占一口锅');

  // 倒着点也能备料成功（不要求顺序）
  dish.steps.slice().reverse().forEach((id) => {
    const r = UI.tapIngredient(id);
    ok(r && r.ok, id + ' 应该能下锅');
  });
  const pot = run.pots[0];
  ok(pot, '应该占用第 0 口锅');
  eq(pot.state, 'prep');
  eq(pot.dishId, dish.id);
  eq(pot.done.length, pot.steps.length);

  $$('#pantryBand .pantry-btn').forEach((b) => {
    ok(b.classList.contains('is-done'), '备料齐了每个按钮都应是已下锅态');
  });

  // 重复点：提示但不扣东西
  eq(UI.tapIngredient(dish.steps[0]), false);
  includes(lastToast(), '已经下过');
  eq(pot.done.length, pot.steps.length, '重复点不会多算一份');
});

test('点锅开火 → 烹饪 → 出锅；顶栏进度条一直在动', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  D.dish(c.dishId).steps.forEach((id) => UI.tapIngredient(id));

  const fired = UI.tapPot(0);
  ok(fired && fired.ok);
  eq(run.pots[0].state, 'cooking');
  gt(run.pots[0].cookLeft, 0);

  const t = advanceUntil(run, () => run.pots[0] && run.pots[0].state === 'ready', 30000);
  gt(t, 0, '应该能出锅');
  lt(t, 30000, '不应该拖到超时');
  eq(run.pots[0].state, 'ready');
  ok(/^\d+%$/.test(UI.els.trackBar.style.width), '进度条宽度应是百分比：' + UI.els.trackBar.style.width);

  eq(UI.tapPot(0), false, '已经出锅了再点锅：只提示');
  includes(lastToast(), '出锅');
});

test('点锅装盘：菜离开锅、落到出餐台、端在手里', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  eq(run.plates.length, 0);

  pluckPotIntoHand(run);

  eq(run.pots[0], null, '菜应该离开锅');
  eq(run.plates.length, 1, '出餐台上多了一盘');
  eq(run.plates[0].dishId, c.dishId);
  eq(UI._held, 0, '盘子端在手里');
  eq(UI.isDragging(), true);
  eq($$('#flyLayer .drag-ghost').length, 1, '拖拽虚影应该挂在舞台上');
  UI.cancelDrag();
  UI.holdClear();
  eq(UI.isDragging(), false);
});

test('点顾客上菜：Perfect 判定 + 连击 + 金币入账 + 顾客离场', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);

  const coins0 = run.coins;
  const res = UI.pickCustomer(c.uid);          // 「点盘子 → 点顾客」这条路

  ok(res && res.ok, '上菜应该成功');
  eq(run.served, 1);
  eq(run.plates.length, 0, '盘子被送出去了');
  eq(UI._held, null, '手空了');
  gt(run.coins, coins0, '金币要涨');
  eq(c.state, 'served');
  eq(res.perfect, true, '出锅后立刻送出 → dt=0 → 必是 Perfect');
  eq(run.perfect, 1);
  eq(run.combo, 1);

  const card = $$('#custBand .cust').filter((n) => n.getAttribute('data-uid') === c.uid)[0];
  ok(card, '服务完的顾客卡片还在（走离场动画）');
  ok(card.classList.contains('is-leaving'));
});

test('上错菜会被挡回来，并给一句人话提示', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  const other = D.DISHES.filter((d) => d.id !== c.dishId)[0];
  run.plates.push({
    dishId: other.id, name: other.name, sprite: other.sprite,
    lifeMax: 99999, lifeLeft: 99999, cookTotal: 1000, perfectWindow: 600, since: 0,
  });

  const res = UI.servePlateTo(0, c.uid);
  eq(res, false);
  includes(lastToast(), '不是这道菜');
  eq(run.served, 0);
  eq(run.plates.length, 1, '上错菜不会把盘子吞掉');
  eq(c.state, 'waiting');
});

test('拖拽上菜：把菜拖到顾客身上就出餐（custRects 命中）', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);

  // jsdom 算不出布局，给顾客卡一个明确的屏幕矩形
  const card = $$('#custBand .cust')[0];
  card.getBoundingClientRect = () => ({ left: 30, top: 10, width: 40, height: 80, right: 70, bottom: 90 });
  const rects = UI.custRects();
  eq(rects.length, 1);
  eq(rects[0].uid, c.uid);

  UI.dragMove({ clientX: 50, clientY: 40 });
  ok(card.classList.contains('is-hover'), '拖到顾客身上要高亮');

  const res = UI.dragUp({ clientX: 50, clientY: 40 });
  ok(res && res.ok);
  eq(run.served, 1);
  eq(UI._held, null);
  eq(UI.isDragging(), false);
  no(card.classList.contains('is-hover'), '松手后高亮要清掉');
});

test('拖到空白处松手：菜还在手里，不会凭空消失', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);
  const card = $$('#custBand .cust')[0];
  card.getBoundingClientRect = () => ({ left: 30, top: 10, width: 40, height: 80, right: 70, bottom: 90 });

  eq(UI.dragUp({ clientX: 500, clientY: 500 }), false);
  eq(run.served, 0);
  eq(run.plates.length, 1, '盘子还在出餐台');
  eq(UI._held, 0, '还端在手里');
  eq(UI.isDragging(), false);
  UI.holdClear();
});

/* ============================== 道具 ============================== */
test('道具：加速只在有锅在煮时可用，用完进入冷却', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);

  eq(UI.useTool('speed'), false, '没有锅在煮时用不了');
  includes(lastToast(), '没有正在煮的锅');

  D.dish(c.dishId).steps.forEach((id) => UI.tapIngredient(id));
  UI.tapPot(0);
  const left0 = run.pots[0].cookLeft;

  const r = UI.useTool('speed');
  ok(r && r.ok);
  lt(run.pots[0].cookLeft, left0, '剩余时间应该被砍掉一半');
  gt(run.toolCd.speed, 0, '应该进入冷却');
  gte($$('#toolBar .tool-btn.is-cd').length, 1, '道具按钮要显示冷却遮罩');

  eq(UI.useTool('speed'), false);
  includes(lastToast(), '冷却');
});

test('道具：保温能救回快要不耐烦的顾客', () => {
  const run = startRun('A1');
  firstCustomer(run);
  const c = run.customers[0];
  c.patienceMax = 20000;
  c.patienceLeft = 1000;
  UI.syncCustBars(run);

  const r = UI.useTool('warm');
  ok(r && r.ok);
  gt(c.patienceLeft, 1000, '耐心应该回升');
  gt(run.toolCd.warm, 0);
});

test('道具：一键上菜把出餐台上最老的一盘送给匹配顾客', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);
  UI.holdClear();
  eq(run.plates.length, 1);

  const r = UI.useTool('serve');
  ok(r && r.ok);
  eq(run.served, 1);
  eq(run.plates.length, 0);
  ok(r.auto, '自动上菜要打上 auto 标记');
  gt(run.toolCd.serve, 0);
});

/* ============================== 彩蛋 ============================== */
test('冰箱彩蛋：点满 5 次冰箱 → 企鹅厨师 + 1 钻石', () => {
  startRun('A1');
  const gems0 = UI.save.gems;

  for (let i = 1; i <= 4; i++) {
    const r = UI.tapFridge();
    eq(r.ok, false, '第 ' + i + ' 次还不该触发');
    eq(UI.save.gems, gems0, '没触发就不给钻石');
  }
  const last = UI.tapFridge();
  ok(last.ok && last.penguin, '第 5 次应该触发企鹅');
  eq(UI.save.gems, gems0 + 1);
  eq(UI.save.easter.penguin, true);
  includes($('tbGems').textContent, String(UI.save.gems));
  ok($('fxPenguin').classList.contains('is-on'), '企鹅动画要播');
});

/* ============================== 暂停 / 放弃 ============================== */
test('暂停 / 继续：暂停时对局不再推进', () => {
  const run = startRun('A1');
  firstCustomer(run);

  ok(UI.openPause());
  eq(run.paused, true);
  ok($('overlayPause').classList.contains('is-on'));
  includes($('pauseInfo').textContent, '已服务');

  const t0 = run.timeLeft;
  SC.step(500, run);
  eq(run.timeLeft, t0, '暂停时时间不该走');

  ok(UI.closePause());
  eq(run.paused, false);
  SC.step(500, run);
  lt(run.timeLeft, t0, '继续后时间恢复流动');
});

test('放弃本局：仍按已产出结算，然后回地图并停掉画布循环', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);
  UI.pickCustomer(c.uid);
  eq(run.served, 1);

  const coins0 = UI.save.coins;
  const res = UI.quitRun();

  ok(res, '应该拿到结算结果');
  eq(TC.Router.current, 'map');
  eq(SC.isRunning(), false, '离开经营页必须停掉 rAF');
  eq(UI.run, null);
  eq(UI.save.stats.plays, 1);
  gt(UI.save.coins, coins0, '已产出的收入要落袋');
});

test('离开经营页会停掉画布循环（不会留着 rAF 空转）', () => {
  const run = startRun('A1');
  eq(SC.run(), run);
  eq(SC.isRunning(), true);
  TC.Router.go('map', { force: true });
  eq(SC.isRunning(), false);
});

/* ============================== 结算 ============================== */
test('打满一局 → 自动跳到结算页，并把成绩写进存档', () => {
  const run = startRun('A1');
  const c = firstCustomer(run);
  cookToReady(run, c);
  pluckPotIntoHand(run);
  UI.pickCustomer(c.uid);

  run.timeLeft = 1;                       // 直接把这局耗完
  SC.step(50, run);

  eq(TC.Router.current, 'result', '应该自动进结算页');
  eq(SC.isRunning(), false, '结算后画布循环要停');
  ok(UI.result, '结算数据要挂在 UI 上');

  const r = UI.result;
  eq(r.levelId, 'A1');
  eq(r.regionId, 'asia_street');
  eq(r.served, 1);
  eq(r.stars, 0, '只服务 1 位，够不着 A1 的 3 星条件');
  eq(r.halved, true, '没星星时收入打折');
  gt(r.totalGain, 0);

  // 存档落地
  eq(UI.save.stats.plays, 1);
  gt(UI.save.stats.coinsTotal, 0);
  eq(UI.save.coins, r.totalGain);
  eq(UI.save.regions.asia_street.A1, undefined, '没通关就不该写星级');
  eq(C.isLevelUnlocked(UI.save, 'A2'), false, '0 星不能解锁下一关');
  eq(UI.result.unlockedLevelId, null);

  // 结算页 DOM
  ok($('view-result').classList.contains('is-active'));
  eq($$('#resStars .rs').length, 3);
  eq($$('#resStars .rs.on').length, 0, '0 星不该亮');
  eq($$('#resConds .res-cond').length, 3, '三条星级条件都要逐条列出来');
  eq($$('#resConds .res-cond.is-fail').length, 3);
  includes($('resTitle').textContent, '再');
  includes($('resExp').textContent, 'Lv.');
  gt($('resMoney').textContent.length, 0);
  includes($('resSub').textContent, '服务 1 位');
});

test('三星通关 → 写星级 + 首通奖励 + 解锁下一关，「再来一次」能重开', () => {
  const run = startRun('A1');
  const lv = D.level('A1');

  // 直接把对局数据摆成「三条条件全达成」的样子
  run.served = lv.stars.served;
  run.coins = lv.stars.coins;
  run.tips = 0;
  run.maxCombo = lv.stars.minCombo;
  run.lost = 0;
  run.timeLeft = 1;
  SC.step(50, run);

  eq(TC.Router.current, 'result');
  const r = UI.result;
  eq(r.stars, 3);
  eq(r.cleared, true);
  eq(r.firstClear, true);
  gt(r.firstBonus, 0, '首通要给额外金币');
  eq($$('#resStars .rs.on').length, 3);
  eq($$('#resConds .res-cond.is-ok').length, 3);
  eq($$('#resConds .res-cond.is-fail').length, 0);

  // 存档：星级 + 下一关解锁
  eq(UI.save.regions.asia_street.A1, 3);
  eq(r.unlockedLevelId, 'A2');
  eq(C.isLevelUnlocked(UI.save, 'A2'), true);
  includes($('resUnlock').textContent, '解锁');
  includes($('resUnlock').textContent, '首次通关');
  eq(UI.save.stats.perfectRuns, 1, '3 星且 0 流失要记一次完美局');

  // 「再来一次」
  click($('btnResultRetry'));
  SC.stop();
  eq(TC.Router.current, 'cook');
  ok(UI.run);
  eq(UI.run.levelId, 'A1');
  eq(UI.result, null, '重开后旧结算要清掉');
  eq(UI.run.over, false);
  eq(UI.run.plates.length, 0);
});

test('拿到 1 星也算通关：解锁下一关，但星级只记 1 颗', () => {
  const run = startRun('A1');
  run.served = D.level('A1').stars.served;    // 只达成第一条
  run.timeLeft = 1;
  SC.step(50, run);

  // 规则：stars > 0 即视为通关（下一关开放），星级按达成条数记
  eq(UI.result.stars, 1);
  eq(UI.result.cleared, true);
  eq(UI.result.unlockedLevelId, 'A2');
  eq(UI.save.regions.asia_street.A1, 1);
  eq(C.isLevelUnlocked(UI.save, 'A2'), true);
  ne(C.totalStars(UI.save), 3, '只拿了 1 颗星');
  eq($$('#resStars .rs.on').length, 1);
  eq($$('#resConds .res-cond.is-ok').length, 1);
  eq($$('#resConds .res-cond.is-fail').length, 2);
});

test('结算页的「升级店铺」能直接打开升级弹窗，「回地图」能回地图', () => {
  const run = startRun('A1');
  run.timeLeft = 1;
  SC.step(50, run);
  eq(TC.Router.current, 'result');

  click($('btnResultUpgrade'));
  eq(UI.isModalOpen('modalUpgrade'), true);
  gt($$('#upList .up-row').length, 0, '弹窗里要有升级项');
  UI.closeModal('modalUpgrade');

  click($('btnResultMap'));
  eq(TC.Router.current, 'map');
});

/* ============================== 升级弹窗 ============================== */
test('升级弹窗：分页切换 + 买得起的能买、买不起只提示', () => {
  toMap(emptySave());
  UI.save.coins = 2000;
  UI.upTab = null;

  ok(UI.openUpgrade());
  eq(UI.isModalOpen('modalUpgrade'), true);
  const tabs = TC.Upgrade.tabs();
  eq(tabs.length, 4);
  eq($$('#upTabs .tab').length, tabs.length);
  gt($$('#upList .up-row').length, 0);
  includes($('upCoinTxt').textContent, '🪙');

  // 买第一项买得起的
  const btn = $$('#upList .up-buy').filter((b) => !b.getAttribute('aria-disabled'))[0];
  ok(btn, '2000 金币应该至少买得起一项');
  const id = btn.getAttribute('data-up');
  const lv0 = C.upLv(UI.save, id);
  click(btn);
  eq(C.upLv(UI.save, id), lv0 + 1, '等级 +1');
  lt(UI.save.coins, 2000, '要扣钱');
  eq($('tbCoins').querySelector('b').textContent, String(UI.save.coins), '顶栏金币同步');
  includes(lastToast(), 'Lv.');

  // 切标签
  click($$('#upTabs .tab')[1]);
  eq(UI.upTab, tabs[1].id);
  ok($$('#upTabs .tab')[1].classList.contains('is-active'));
  no($$('#upTabs .tab')[0].classList.contains('is-active'));
  gt($$('#upList .up-row').length, 0, '菜单研发页也要有内容');

  // 买不起
  UI.save.coins = 0;
  UI.renderUpList();
  const poor = $$('#upList .up-buy')[0];
  if (poor) {
    eq(UI.buyUpgrade(poor.getAttribute('data-up')), false);
    includes(lastToast(), '还差');
  }
  UI.closeModal('modalUpgrade');
  eq(UI.isModalOpen('modalUpgrade'), false);
});

test('升级弹窗：非法标签自动回落到第一个分类（不会白屏）', () => {
  toMap(emptySave());
  UI.save.coins = 5000;
  UI.openUpgrade('不存在的标签');
  eq(UI.upTab, TC.Upgrade.tabs()[0].id);
  gt($$('#upList .up-row').length, 0);
  UI.closeModal('modalUpgrade');
});

/* ============================== 图鉴 / 成就 / 任务 ============================== */
test('图鉴页：菜谱 / 顾客 / 明信片三段都渲染，未解锁的显示问号', () => {
  const save = emptySave();
  toMap(save);
  TC.Router.go('codex', { force: true, tab: 'book' });
  eq(TC.Router.current, 'codex');
  eq(UI.codexTab, 'book');
  ok($('panel-book').classList.contains('is-active'));

  const totalCust = D.CUSTOMERS.length + D.SPECIAL_GUESTS.length;
  const seenSpecial = D.SPECIAL_GUESTS.filter((g) => (save.stats.seenCustomers || {})[g.id]).length;
  const unlockedCells = C.unlockedDishIds(save).length + C.seenCustomers(save).length + seenSpecial;
  eq($$('#panel-book .book-cell').length, D.DISHES.length + totalCust);
  eq($$('#panel-book .book-cell.is-locked').length,
     (D.DISHES.length + totalCust) - unlockedCells);
  eq($$('#panel-book .postcard').length, D.REGIONS.length);
  eq($$('#panel-book .postcard.is-locked').length,
     D.REGIONS.length - C.unlockedRegionIds(save).length);
  includes($('panel-book').textContent, '？？？');
  includes($('panel-book').textContent, '菜 谱');
  includes($('panel-book').textContent, '旅 行 明 信 片');
});

test('图鉴会随存档解锁：通关第一关后多解锁菜谱，锁着的格子变少', () => {
  const save = emptySave();
  const dishes0 = C.unlockedDishIds(save).length;
  toMap(save);
  TC.Router.go('codex', { force: true, tab: 'book' });
  const locked0 = $$('#panel-book .book-cell.is-locked').length;

  save.regions.asia_street.A1 = 3;                       // 通关第一关
  TC.Router.go('codex', { force: true, tab: 'book' });   // 重新渲染

  gt(C.unlockedDishIds(save).length, dishes0, '通关后应多解锁菜谱');
  lt($$('#panel-book .book-cell.is-locked').length, locked0, '锁着的格子应该变少');
  gte(C.unlockedRegionIds(save).length, 1, '第一个地区默认就是开的（unlockStars 0）');
});

test('成就页：10 条全渲染，达成后高亮 + 徽标同步', () => {
  const save = emptySave();
  save.regions.asia_street.A1 = 1;               // clears = 1 → 解锁「初来乍到」
  const got = TC.Ach.evaluate(save);
  gt(got.length, 0, '应该至少解锁一个成就');
  eq(save.achievements.first_step !== undefined, true);
  gt(save.coins, 0, '成就奖励要发');

  toMap(save);
  TC.Router.go('codex', { force: true, tab: 'ach' });
  eq($$('#panel-ach .ach-row').length, D.ACHIEVEMENTS.length);
  const row = $$('#panel-ach .ach-row').filter((r) => r.textContent.indexOf('初来乍到') !== -1)[0];
  ok(row, '应该能看到「初来乍到」');
  ok(row.classList.contains('is-done'));
  eq(row.querySelector('.ach-val').textContent, '1/1');

  const badge = $('achBadge');
  eq(badge.hidden, false);
  eq(badge.textContent, String(TC.Ach.doneCount(UI.save)));
});

test('每日任务页：三条任务都渲染，达标后能领奖且不能重复领', () => {
  const save = emptySave();
  S.DAILY_METRIC_KEYS.forEach((k) => { save.daily.metrics[k] = 99; });   // 三条全部达标
  toMap(save);
  TC.Router.go('codex', { force: true, tab: 'daily' });

  eq(TC.Daily.rows(UI.save).length, 3, '每天固定 3 条任务');
  eq($$('#panel-daily .daily-row').length, 3);
  includes($('panel-daily').textContent, '今 日 任 务');

  const btn = $('panel-daily').querySelector('[data-claim]');
  ok(btn, '应该有可领取的任务');
  const id = btn.getAttribute('data-claim');
  const coins0 = UI.save.coins, gems0 = UI.save.gems;

  click(btn);
  ok(UI.save.coins > coins0 || UI.save.gems > gems0, '奖励要到账');
  ok(UI.save.daily.claimed.indexOf(id) !== -1, '要记进已领取');
  eq(TC.Save.isTaskClaimed(UI.save, id), true);

  eq(UI.claimTask(id), false, '同一任务不能领两次');
  includes(lastToast(), '已经领过');
  eq($('dailyBadge').textContent, String(TC.Daily.claimableCount(UI.save)));
});

test('底部导航三个按钮：从地图分别进到图鉴 / 成就 / 任务', () => {
  const nav = $$('#bottomnav .nav-btn');
  eq(nav.length, 3);
  eq(nav[0].getAttribute('data-tab'), 'book');
  eq(nav[1].getAttribute('data-tab'), 'ach');
  eq(nav[2].getAttribute('data-tab'), 'daily');

  // 底部导航只在地图页显示，所以每次都从地图出发
  [[0, 'book'], [1, 'ach'], [2, 'daily']].forEach(([i, tab]) => {
    toMap(emptySave());
    click(nav[i]);
    eq(TC.Router.current, 'codex');
    eq(UI.codexTab, tab);
    ok($('panel-' + tab).classList.contains('is-active'), 'panel-' + tab + ' 应是当前页');
    eq($('bottomnav').hidden, true, 'codex 页隐藏底部导航');
  });
});

test('已经在图鉴页时换标签：不会因为「视图没变」被路由吞掉', () => {
  toMap(emptySave());
  TC.Router.go('codex', { force: true, tab: 'book' });
  eq(UI.codexTab, 'book');
  click($$('#codexTabs .tab')[2]);
  eq(UI.codexTab, 'daily');
  ok($('panel-daily').classList.contains('is-active'));
  // 再走一次底部导航的「同一视图换标签」这条路
  click($$('#bottomnav .nav-btn')[1]);
  eq(UI.codexTab, 'ach');
  ok($('panel-ach').classList.contains('is-active'));
});

/* ============================== 整条链路（验收） ============================== */
test('验收：地图 → 地区 → 开一关 → 做单 → 上菜 → 结算 全链路走通', () => {
  toMap();
  eq(TC.Router.current, 'map');

  // 1) 地图上点第一个地区
  const cards = $$('#regionList .region-card');
  gte(cards.length, 5, '5 个地区卡都要在');
  click(cards[0]);
  eq(TC.Router.current, 'levels');
  eq(UI.regionId, D.REGIONS[0].id);

  // 2) 点第一关
  const rows = $$('#levelList .level-row');
  eq(rows.length, 5, '每个地区 5 关');
  click(rows[0]);
  eq(TC.Router.current, 'cook');
  SC.stop();
  const run = UI.run;
  ok(run, '应该开出一局');
  eq(run.levelId, D.REGIONS[0].prefix + '1');
  run.rand = () => 0;

  // 3) 顾客上门
  const c = firstCustomer(run);
  ok(c, '顾客要上门');

  // 4) 点齐食材
  D.dish(c.dishId).steps.forEach((id) => ok(UI.tapIngredient(id), '配料 ' + id + ' 要能下锅'));

  // 5) 开火 → 出锅
  ok(UI.tapPot(0).ok);
  gt(advanceUntil(run, () => run.pots[0] && run.pots[0].state === 'ready', 30000), 0);

  // 6) 点锅装盘（走 canvas 命中这条路）
  pluckPotIntoHand(run);
  eq(run.plates.length, 1);

  // 7) 上菜
  const served = UI.pickCustomer(c.uid);
  ok(served && served.ok);
  eq(run.served, 1);
  eq(UI._held, null);

  // 8) 打满 → 结算
  run.timeLeft = 1;
  SC.step(50, run);
  eq(TC.Router.current, 'result');
  eq(UI.result.served, 1);
  gt(UI.result.income, 0);
  eq(UI.save.stats.plays, 1);
  gt(UI.save.coins, 0);

  // 收尾：回地图，别把状态留给别的用例
  toMap();
  eq(TC.Router.current, 'map');
  eq(SC.isRunning(), false);
});
