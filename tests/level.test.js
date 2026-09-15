/* ==========================================================================
   tests/level.test.js —— 对应模块 TC.Level（关卡状态机）
   覆盖：倒计时、顾客生成与耐心、点食材→点锅→装盘→上菜全链路、连击、Perfect、
        三个道具、帮厨/服务员自动行为、出餐台保鲜、结算落地与解锁
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, deepEq, gt, gte, lte, includes } = H;

section('TC.Level');
const { TC } = loadGame();
const L = TC.Level;
const S = TC.Save;
const C = TC.Calc;
const D = TC.DATA;

const zrand = () => 0;
const blank = () => S.blank();

function mk(levelId, save, opts) {
  return L.create(save || blank(), levelId, Object.assign({ rand: zrand, firstSpawn: 0 }, opts || {}));
}

/** 手动安插一位指定菜品的顾客，绕开随机，专测下游玩法逻辑 */
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

/** 把一个 ready 的锅直接放进某个锅位（用于测装盘/上菜的边界） */
function readyPot(run, idx, dishId) {
  const d = D.dish(dishId);
  run.pots[idx] = {
    dishId: dishId, steps: d.steps.slice(), done: d.steps.slice(),
    state: 'ready', cookLeft: 0,
    cookTotal: C.cookTime(dishId, run.save), readyAt: run.runtime
  };
  return run.pots[idx];
}

function plateOf(dishId, since) {
  const ct = C.cookTime(dishId, blank());
  return {
    dishId: dishId, name: D.dish(dishId).name, sprite: D.dish(dishId).sprite,
    lifeMax: 12000, lifeLeft: 12000, cookTotal: ct,
    perfectWindow: ct * 0.6, since: since || 0
  };
}

/** 完整走一遍「点食材 → 点锅 → 等出锅 → 装盘 → 上菜」 */
function cookAndServe(run, uid, delayMs) {
  const c = L.customer(run, uid) || L.currentCustomer(run);
  const dish = D.dish(c.dishId);
  dish.steps.forEach((s) => L.tapIngredient(run, s));
  let potIdx = -1;
  for (let i = 0; i < run.pots.length; i++) if (run.pots[i]) { potIdx = i; break; }
  L.tapPot(run, potIdx);
  L.tick(run, run.pots[potIdx].cookTotal);
  L.toPlate(run, potIdx);
  if (delayMs) L.tick(run, delayMs);
  return L.serve(run, run.plates.length - 1, c.uid);
}

/* ==========================================================================
   创建与时间推进
   ========================================================================== */
test('create：时长、锅位、座位、订单池都来自存档与关卡配置', () => {
  const save = blank();
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 0 });
  eq(run.levelId, 'A1');
  eq(run.regionId, 'asia_street');
  eq(run.duration, 90000, 'A1 时长 90s');
  eq(run.timeLeft, 90000);
  eq(run.slots, 2, '默认 2 个锅位');
  eq(run.seats, 2);
  eq(run.spawnInterval, 6800);
  eq(run.customers.length, 0);
  eq(run.pots.length, 2);
  eq(run.plates.length, 0);
  eq(run.over, false);
  eq(run.combo, 0);
  eq(run.served, 0);
  deepEq(run.toolCd, { speed: 0, warm: 0, serve: 0 });
});

test('create：升级过的存档会给出更多锅位与座位', () => {
  const save = blank();
  save.upgrades.stove_slots = 3;
  save.upgrades.seats = 1;
  const run = L.create(save, 'A1', { rand: zrand });
  eq(run.slots, 4);
  eq(run.seats, 3, 'A1 的 2 座 + 加座 1');
});

test('create：不存在的关卡返回 null', () => {
  eq(L.create(blank(), 'ZZ'), null);
});

test('tick 递减剩余时间与耐心，并按间隔生成顾客', () => {
  const run = mk('A1');
  eq(run.customers.length, 0);
  const ev1 = L.tick(run, 16);
  eq(run.customers.length, 1, 'firstSpawn=0 时第一帧就有人上门');
  includes(ev1.map((e) => e.type), 'spawn');
  eq(run.timeLeft, 90000 - 16);
  const first = run.customers[0];
  const firstBase = D.customer(first.id).patience * 2 * D.level('A1').patienceScale;
  eq(first.patienceLeft, Math.round(firstBase), '刚上门的这一帧还没开始掉耐心（基础耐心 ×2）');
  L.tick(run, 100);
  eq(run.customers[0].patienceLeft, Math.round(firstBase) - 100, '之后每帧同步递减');
  eq(run.timeLeft, 90000 - 116);
});

test('tick：dt <= 0 或已结束时不产生任何事件', () => {
  const run = mk('A1');
  eq(L.tick(run, 0).length, 0);
  eq(L.tick(run, -100).length, 0);
  run.over = true;
  eq(L.tick(run, 1000).length, 0);
});

test('在场顾客数不会超过座位数', () => {
  const run = mk('A1');
  L.tick(run, 16);
  L.tick(run, 30000);
  lte(L.waiting(run).length, run.seats, '座位只有 2 个');
});

test('顾客类型不重复出现（同屏不会有两个同款顾客）', () => {
  let seed = 7;
  const lcg = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const save = blank();
  save.upgrades.seats = 3; // A5 的 3 座 + 3 = 6 座，能同时站 6 位（同屏上限）
  const run = L.create(save, 'A5', { rand: lcg, firstSpawn: 0 });
  L.tick(run, 16);
  for (let i = 0; i < 6; i++) L.tick(run, 4300);
  const wait = L.waiting(run);
  gt(wait.length, 2, '应该攒下好几位顾客');
  const ids = wait.map((c) => c.id);
  eq(new Set(ids).size, ids.length, '同屏顾客类型应互不相同，实际 ' + ids.join(','));
});

test('关卡时间走完会结束并抛出 end 事件', () => {
  const run = mk('A1');
  const ev = L.tick(run, 90001);
  eq(run.over, true);
  eq(run.timeLeft, 0);
  includes(ev.map((e) => e.type), 'end');
  eq(L.tick(run, 1000).length, 0, '结束后不再推进');
});

/* ==========================================================================
   耐心与流失
   ========================================================================== */
test('耐心耗尽 → 顾客流失、连击清零、取消选中', () => {
  const run = mk('A1');
  L.tick(run, 16);
  const c = run.customers[0];
  run.combo = 5;
  run.perfectStreak = 3;
  const ev = L.tick(run, c.patienceMax + 1);
  eq(c.state, 'lost');
  eq(c.patienceLeft, 0);
  eq(run.lost, 1);
  eq(run.combo, 0, '流失会清空连击');
  eq(run.perfectStreak, 0, 'Perfect 连击也会断');
  no(run.selected === c.uid, '流失的顾客应被取消选中');
  includes(ev.map((e) => e.type), 'lost');
});

test('不同顾客的耐心受关卡 patienceScale 影响', () => {
  const run = mk('A5');
  L.tick(run, 16);
  const c = run.customers[0];
  const base = D.customer(c.id).patience;
  eq(c.patienceMax, Math.round(base * 0.8 * 2), 'A5 耐心 ×0.8 ×2');
  gt(c.patienceMax, 0);
});

test('select 只能选中在等的顾客', () => {
  const run = mk('A1');
  L.tick(run, 16);
  const c = run.customers[0];
  eq(L.select(run, c.uid).ok, true);
  eq(run.selected, c.uid);
  eq(L.select(run, 'nobody').reason, 'not-waiting');
  c.state = 'served';
  eq(L.select(run, c.uid).reason, 'not-waiting');
});

test('currentCustomer 默认退回最急的一位', () => {
  const run = mk('A1');
  const slow = place(run, 'chowmein', { uid: 'a', patience: 24000 });
  const urgent = place(run, 'chowmein', { uid: 'b', patience: 18000 });
  run.selected = null;
  urgent.patienceLeft = 5000;
  eq(L.currentCustomer(run).uid, 'b', '应选中耐心最少的那位');
  run.selected = 'a';
  eq(L.currentCustomer(run).uid, 'a', '显式选中优先');
  slow.state = 'served';
  urgent.state = 'served';
  eq(L.currentCustomer(run), null, '没人等单时应返回 null');
});

/* ==========================================================================
   步骤 2：点击食材
   ========================================================================== */
test('没有顾客时点食材 → no-order', () => {
  const run = mk('A1');
  eq(L.tapIngredient(run, 'noodle').reason, 'no-order');
});

test('点错食材不惩罚：不建锅、不改状态', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  const r = L.tapIngredient(run, 'sushi_rice');
  eq(r.ok, false);
  eq(r.reason, 'not-needed');
  eq(run.pots.filter(Boolean).length, 0, '不该产生锅');
  eq(L.currentOrder(run).steps.filter((s) => s.done).length, 0);
});

test('点齐食材会建锅并标记完成，不要求顺序', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  const a = L.tapIngredient(run, 'sauce');
  eq(a.ok, true);
  eq(a.potIdx, 0, '进第一个空锅位');
  eq(a.prepDone, false, '3 步只点了 1 步');
  const b = L.tapIngredient(run, 'noodle');
  eq(b.potIdx, 0, '同一道菜继续用同一个锅');
  const c = L.tapIngredient(run, 'veg');
  eq(c.prepDone, true, '点齐 3 步');
  eq(run.pots[0].done.length, 3);
});

test('重复点同一种食材 → dup', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  L.tapIngredient(run, 'noodle');
  eq(L.tapIngredient(run, 'noodle').reason, 'dup');
  eq(run.pots[0].done.length, 1, '不能重复计数');
});

test('锅位占满后无法再开新菜 → no-pot', () => {
  const save = blank();
  const run = L.create(save, 'A3', { rand: zrand, firstSpawn: 99999 }); // 2 个锅位
  const c1 = place(run, 'chowmein', { uid: 'u1' });
  const c2 = place(run, 'dumpling', { uid: 'u2' });
  const c3 = place(run, 'milktea', { uid: 'u3' });

  run.selected = 'u1';
  L.tapIngredient(run, 'noodle');
  run.selected = 'u2';
  L.tapIngredient(run, 'wrapper');
  run.selected = 'u3';
  const r = L.tapIngredient(run, 'tea');
  eq(r.ok, false);
  eq(r.reason, 'no-pot', '2 个锅都占着，做不了第三道菜');
  ok(c1 && c2 && c3);
});

test('pantry / currentOrder 反映当前订单与完成进度', () => {
  const run = mk('A1');
  place(run, 'dumpling');
  let p = L.pantry(run);
  eq(p.length, 4, '饺子 4 步');
  eq(p.map((x) => x.done).join(','), 'false,false,false,false');
  ok(p[0].art && p[0].art.tpl, '备料按钮需要像素图参数');
  L.tapIngredient(run, 'filling');
  p = L.pantry(run);
  eq(p.filter((x) => x.done).length, 1);
  eq(p.filter((x) => x.done)[0].id, 'filling');
  const o = L.currentOrder(run);
  eq(o.dish.id, 'dumpling');
  eq(o.price, 24);
  eq(L.pantry(run).length, 4);
});

/* ==========================================================================
   步骤 3：点锅烹饪
   ========================================================================== */
test('备料没齐就点锅 → not-prepared，并告知还差几步', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  L.tapIngredient(run, 'noodle');
  const r = L.tapPot(run, 0);
  eq(r.ok, false);
  eq(r.reason, 'not-prepared');
  eq(r.missing, 2);
  eq(run.pots[0].state, 'prep');
});

test('点空锅位 → empty', () => {
  const run = mk('A1');
  eq(L.tapPot(run, 0).reason, 'empty');
});

test('备齐后点锅开始烹饪，时间到变 ready', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  const r = L.tapPot(run, 0);
  eq(r.ok, true);
  eq(run.pots[0].state, 'cooking');
  eq(run.pots[0].cookLeft, 3000, '炒面 3.0s');
  eq(L.tapPot(run, 0).reason, 'cooking', '重复点锅不该重置进度');

  L.tick(run, 2999);
  eq(run.pots[0].state, 'cooking');
  const ev = L.tick(run, 1);
  eq(run.pots[0].state, 'ready');
  includes(ev.map((e) => e.type), 'ready');
  eq(L.tapPot(run, 0).reason, 'ready');
});

test('猛火灶升级会缩短烹饪时间', () => {
  const save = blank();
  save.upgrades.stove_speed = 5;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  L.tapPot(run, 0);
  eq(run.pots[0].cookLeft, 1800);
});

/* ==========================================================================
   步骤 4：装盘
   ========================================================================== */
test('没出锅就装盘 → not-ready', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  eq(L.toPlate(run, 0).reason, 'not-ready');
  eq(L.toPlate(run, 1).reason, 'empty');
});

test('出锅后装盘：锅位清空、盘子上架、带保鲜时间', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  L.tapPot(run, 0);
  L.tick(run, 3000);
  const r = L.toPlate(run, 0);
  eq(r.ok, true);
  eq(r.plateIdx, 0);
  eq(run.plates.length, 1);
  eq(run.plates[0].dishId, 'chowmein');
  eq(run.plates[0].lifeLeft, 12000, '基础保鲜 12s');
  eq(run.plates[0].perfectWindow, 1800, '3.0s × 0.6');
  eq(run.pots[0], null, '装盘后锅位空出来');
});

test('出餐台最多放 3 盘', () => {
  const save = blank();
  save.upgrades.stove_slots = 3;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  place(run, 'chowmein');
  run.plates = [plateOf('chowmein', 0), plateOf('chowmein', 0), plateOf('chowmein', 0)];
  readyPot(run, 0, 'chowmein');
  eq(L.toPlate(run, 0).reason, 'plate-full');
  eq(run.plates.length, 3);
});

test('盘子保鲜到期会消失', () => {
  const run = mk('A1');
  run.plates = [plateOf('chowmein', 0)];
  const ev = L.tick(run, 12001);
  eq(run.plates.length, 0);
  includes(ev.map((e) => e.type), 'plate-expired');
});

test('保温台升级会延长保鲜时间', () => {
  const save = blank();
  save.upgrades.warmer = 5;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  L.tapPot(run, 0);
  L.tick(run, 3000);
  L.toPlate(run, 0);
  eq(run.plates[0].lifeLeft, 22000);
});

/* ==========================================================================
   步骤 5：上菜
   ========================================================================== */
test('菜不对口 → dish-mismatch，什么都不发生', () => {
  const run = mk('A1');
  const c = place(run, 'dumpling');
  run.plates = [plateOf('chowmein', run.runtime)];
  const r = L.serve(run, 0, c.uid);
  eq(r.ok, false);
  eq(r.reason, 'dish-mismatch');
  eq(run.served, 0);
  eq(run.plates.length, 1, '盘子还在');
  eq(c.state, 'waiting');
});

test('上菜成功：金币、小费、连击、Perfect 全部生效', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  const r = cookAndServe(run, c.uid);
  eq(r.ok, true);
  eq(r.perfect, true, '出锅立刻送 → Perfect');
  eq(r.combo, 1);
  eq(r.coins, 18);
  eq(r.tips, 4);
  eq(run.served, 1);
  eq(run.coins, 18);
  eq(run.tips, 4);
  eq(run.perfect, 1);
  eq(run.maxCombo, 1);
  eq(c.state, 'served');
  eq(run.plates.length, 0, '送出去的盘子要消失在出餐台');
});

test('超时上菜：不算 Perfect，连击清零，计入超时次数', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  run.combo = 4;
  run.maxCombo = 4;
  const r = cookAndServe(run, c.uid, 2000); // 1800 窗口，等 2000 再送
  eq(r.perfect, false);
  eq(r.combo, 0);
  eq(run.timeouts, 1);
  eq(run.maxCombo, 4, '历史最高连击保留');
  eq(run.served, 1, '照样收钱，只是没 Perfect');
});

test('连击随 Perfect 连续累加，最高连击被记录', () => {
  const run = mk('A1');
  for (let i = 0; i < 3; i++) {
    const c = place(run, 'chowmein', { uid: 'x' + i });
    run.selected = c.uid;
    cookAndServe(run, c.uid);
  }
  eq(run.served, 3);
  eq(run.combo, 3);
  eq(run.maxCombo, 3);
});

test('5 秒内连续上菜 3 次会置位快刀手标记', () => {
  const run = mk('A1');
  ['q0', 'q1', 'q2'].forEach((uid) => place(run, 'chowmein', { uid: uid }));
  run.plates = [plateOf('chowmein', 0), plateOf('chowmein', 0), plateOf('chowmein', 0)];
  L.serve(run, 0, 'q0');
  L.tick(run, 1000);
  L.serve(run, 0, 'q1');
  L.tick(run, 1000);
  L.serve(run, 0, 'q2');
  eq(run.served, 3);
  eq(run.quickStreak, true, '3 次上菜都落在 5 秒窗口里');
  eq(run.servedLog.length, 3);
});

test('上菜间隔超过 5 秒不算快刀手', () => {
  const run = mk('A1');
  ['w0', 'w1', 'w2'].forEach((uid) => place(run, 'chowmein', { uid: uid }));
  run.plates = [plateOf('chowmein', 0), plateOf('chowmein', 0), plateOf('chowmein', 0)];
  L.serve(run, 0, 'w0');
  L.tick(run, 4000);
  L.serve(run, 0, 'w1');
  L.tick(run, 4000);
  L.serve(run, 0, 'w2');
  eq(run.served, 3);
  eq(run.quickStreak, false, '总跨度 8 秒，超出窗口');
});

test('连续 5 次 Perfect 会触发彩虹糖（彩蛋 2）', () => {
  const run = mk('A1');
  let rainbow = false;
  for (let i = 0; i < 5; i++) {
    const c = place(run, 'chowmein', { uid: 'r' + i });
    run.selected = c.uid;
    const r = cookAndServe(run, c.uid);
    if (r.rainbow) rainbow = true;
  }
  eq(run.perfectStreak, 5);
  eq(rainbow, true, '第 5 次 Perfect 时应抛出 rainbow');
  eq(run.save.easter.rainbow, true, '写进存档');
  eq(run.rainbow, true);
});

test('中途一次超时会打断 Perfect 连击', () => {
  const run = mk('A1');
  const c1 = place(run, 'chowmein', { uid: 'k1' });
  run.selected = 'k1';
  cookAndServe(run, 'k1');
  eq(run.perfectStreak, 1);
  const c2 = place(run, 'chowmein', { uid: 'k2' });
  run.selected = 'k2';
  cookAndServe(run, 'k2', 2000);
  eq(run.perfectStreak, 0, '超时应把 Perfect 连击清零');
  ok(c1 && c2);
});

test('给不在等的顾客上菜 → not-waiting', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  run.plates = [plateOf('chowmein', run.runtime)];
  c.state = 'lost';
  eq(L.serve(run, 0, c.uid).reason, 'not-waiting');
  eq(L.serve(run, 5, c.uid).reason, 'no-plate');
});

test('matchingPlate 找出与顾客匹配的那盘菜', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  eq(L.matchingPlate(run, c.uid), null);
  run.plates = [plateOf('dumpling', 0), plateOf('chowmein', 0)];
  eq(L.matchingPlate(run, c.uid).dishId, 'chowmein');
});

/* ==========================================================================
   道具
   ========================================================================== */
test('道具·加速：把当前锅剩余时间砍半并进入冷却', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  ['noodle', 'veg', 'sauce'].forEach((s) => L.tapIngredient(run, s));
  L.tapPot(run, 0);
  const r = L.useTool(run, 'speed');
  eq(r.ok, true);
  eq(r.potIdx, 0);
  eq(run.pots[0].cookLeft, 1500, '3000 → 1500');
  eq(run.toolCd.speed, 30000);
  eq(L.useTool(run, 'speed').reason, 'cooldown');
  L.tick(run, 30000);
  eq(run.toolCd.speed, 0);
});

test('道具·加速：没有在煮的锅时不可用', () => {
  const run = mk('A1');
  eq(L.useTool(run, 'speed').reason, 'no-cooking');
  eq(run.toolCd.speed, 0, '失败不该进冷却');
});

test('道具·保温：给最急的顾客回复 50% 耐心', () => {
  const run = mk('A1');
  const a = place(run, 'chowmein', { uid: 'a', patience: 20000 });
  const b = place(run, 'chowmein', { uid: 'b', patience: 24000 });
  a.patienceLeft = 2000;
  b.patienceLeft = 20000;
  const r = L.useTool(run, 'warm');
  eq(r.ok, true);
  eq(r.customer.uid, 'a', '应救最急的那位');
  eq(a.patienceLeft, 12000, '2000 + 20000×0.5');
  eq(b.patienceLeft, 20000, '别人的耐心不受影响');
  eq(run.toolCd.warm, 45000);
});

test('道具·保温：耐心不会被加到超过上限', () => {
  const run = mk('A1');
  const a = place(run, 'chowmein', { patience: 20000 });
  a.patienceLeft = 19000;
  L.useTool(run, 'warm');
  eq(a.patienceLeft, 20000, '封顶在上限');
});

test('道具·上菜：一键把最老的一盘送给匹配顾客', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  run.plates = [plateOf('chowmein', run.runtime)];
  const r = L.useTool(run, 'serve');
  eq(r.ok, true);
  eq(r.auto, true);
  eq(run.served, 1);
  eq(c.state, 'served');
  eq(run.toolCd.serve, 60000);
});

test('道具·上菜：没有匹配的顾客或盘子时失败', () => {
  const run = mk('A1');
  eq(L.useTool(run, 'serve').reason, 'no-plate');
  const c = place(run, 'dumpling');
  run.plates = [plateOf('chowmein', 0)];
  eq(L.useTool(run, 'serve').reason, 'no-match');
  ok(c);
});

test('不存在道具 → no-such-tool', () => {
  const run = mk('A1');
  eq(L.useTool(run, 'ghost').reason, 'no-such-tool');
});

/* ==========================================================================
   员工自动行为
   ========================================================================== */
test('帮厨：每 6s 自动完成一个备料步骤', () => {
  const save = blank();
  save.upgrades.helper = 1;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  eq(run.helperInterval, 6000);
  place(run, 'dumpling');
  L.tapIngredient(run, 'wrapper');
  eq(run.pots[0].done.length, 1);

  L.tick(run, 5999);
  eq(run.pots[0].done.length, 1, '还没到 6s');
  const ev = L.tick(run, 1);
  eq(run.pots[0].done.length, 2, '自动补了 1 步');
  includes(ev.map((e) => e.type), 'helper-prep');
});

test('帮厨：备齐最后一步时会抛出 prep-done', () => {
  const save = blank();
  save.upgrades.helper = 1;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  place(run, 'dumpling');
  ['wrapper', 'filling', 'veg'].forEach((s) => L.tapIngredient(run, s));
  const ev = L.tick(run, 6000);
  eq(run.pots[0].done.length, 4);
  includes(ev.map((e) => e.type), 'prep-done');
});

test('没雇帮厨时不会有自动备料', () => {
  const run = mk('A1', undefined, { firstSpawn: 99999 });
  eq(run.helperInterval, 0);
  place(run, 'dumpling');
  L.tapIngredient(run, 'wrapper');
  L.tick(run, 30000);
  eq(run.pots[0].done.length, 1);
});

test('服务员：每 8s 自动上菜一次', () => {
  const save = blank();
  save.upgrades.waiter = 1;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  eq(run.waiterInterval, 8000);
  const c = place(run, 'chowmein');
  run.plates = [plateOf('chowmein', run.runtime)];
  L.tick(run, 7999);
  eq(run.served, 0, '还没到 8s');
  const ev = L.tick(run, 1);
  eq(run.served, 1, '自动送出去了');
  eq(c.state, 'served');
  includes(ev.map((e) => e.type), 'auto-serve');
});

test('服务员：没有可配对的盘子时不动手', () => {
  const save = blank();
  save.upgrades.waiter = 1;
  const run = L.create(save, 'A1', { rand: zrand, firstSpawn: 99999 });
  place(run, 'dumpling');
  run.plates = [plateOf('chowmein', run.runtime)];
  const ev = L.tick(run, 8000);
  eq(run.served, 0);
  no(ev.map((e) => e.type).indexOf('auto-serve') !== -1);
});

test('autoServe 直接把结果返回，便于 UI 复用', () => {
  const run = mk('A1');
  const c = place(run, 'chowmein');
  eq(L.autoServe(run).reason, 'no-plate');
  run.plates = [plateOf('chowmein', run.runtime)];
  const r = L.autoServe(run);
  eq(r.ok, true);
  eq(r.auto, true);
  eq(r.customer.uid, c.uid);
});

/* ==========================================================================
   HUD
   ========================================================================== */
test('hud() 汇总顶栏需要的全部数字', () => {
  const run = mk('A1');
  place(run, 'chowmein');
  run.coins = 36;
  run.tips = 8;
  run.combo = 2;
  run.served = 2;
  readyPot(run, 0, 'chowmein');
  run.plates = [plateOf('chowmein', run.runtime)];
  const h = L.hud(run);
  eq(h.timeText, '01:30');
  eq(h.combo, 2);
  eq(h.coins, 36);
  eq(h.served, 2);
  eq(h.waiting, 1);
  eq(h.ready, 1, '有 1 个锅已出锅待装盘');
  eq(h.plates, 1);
  eq(h.low, false);
  run.timeLeft = 12000;
  eq(L.hud(run).low, true, '最后 15 秒要变红');
  eq(L.hud(run).timeText, '00:12');
});

/* ==========================================================================
   结算落地
   ========================================================================== */
test('finish：3 星通关会写星级、发钱发经验、解锁下一关与新菜品', () => {
  const save = blank();
  const run = mk('A1', save);
  run.served = 7;
  run.coins = 120;
  run.tips = 40;
  run.maxCombo = 7;
  run.perfect = 7;
  run.lost = 0;

  const res = L.finish(save, run);
  eq(res.stars, 3);
  eq(res.cleared, true);
  eq(res.totalGain, 160 + 40 + 80);
  eq(save.coins, 380, '结算 280 + 成就「初来乍到」奖励 100');
  eq(save.regions.asia_street.A1, 3);
  eq(save.exp, 57, '7×3 + 3×8 + 12');
  eq(save.level, 1, '57 经验还升不了级');
  ok(save.stats.plays === 1);
  eq(res.unlockedLevelId, 'A2');
  ok(C.isLevelUnlocked(save, 'A2'), '第 2 关应可进入');
  eq(res.unlockedDishIds.join(','), 'dumpling', '饺子图鉴解锁');
  ok(save.achievements.first_step, '通关第 1 关应解锁「初来乍到」');
});

test('finish：星级只在更高时覆盖，重玩不降级', () => {
  const save = blank();
  const run1 = mk('A1', save);
  Object.assign(run1, { served: 7, coins: 120, tips: 40, maxCombo: 7, lost: 0 });
  L.finish(save, run1);
  eq(save.regions.asia_street.A1, 3);

  const run2 = mk('A1', save);
  Object.assign(run2, { served: 7, coins: 40, tips: 10, maxCombo: 7, lost: 0 });
  const res2 = L.finish(save, run2);
  eq(res2.stars, 1);
  eq(res2.firstBonus, 0, '不是首通了');
  eq(save.regions.asia_street.A1, 3, '不能把 3 星覆盖成 1 星');
});

test('finish：0 星不给通关奖励、不解锁，金币减半', () => {
  const save = blank();
  const run = mk('A1', save);
  Object.assign(run, { served: 1, coins: 40, tips: 10, maxCombo: 1, lost: 4 });
  const res = L.finish(save, run);
  eq(res.stars, 0);
  eq(res.cleared, false);
  eq(res.coins, 20);
  eq(res.clearBonus, 0);
  eq(res.unlockedLevelId, null);
  eq(save.coins, 30);
  eq(save.regions.asia_street.A1, undefined, '0 星不写进度');
  eq(C.isLevelUnlocked(save, 'A2'), false);
});

test('finish：会累加今日任务与统计、记录见过的顾客', () => {
  const save = blank();
  S.checkDaily(save, '2026-09-15');
  const run = mk('A1', save);
  run.encounterIds = { office: 1, kid: 1 };
  Object.assign(run, { served: 7, coins: 120, tips: 40, maxCombo: 7, lost: 0, perfect: 5 });

  L.finish(save, run);
  eq(save.stats.plays, 1);
  eq(save.stats.customers, 7);
  eq(save.stats.perfect, 5);
  eq(save.stats.maxCombo, 7);
  eq(save.stats.bestCoins, 160);
  eq(save.stats.seenCustomers.office, 1);
  eq(save.stats.seenCustomers.kid, 1);
  eq(save.daily.metrics.plays, 1);
  eq(save.daily.metrics.customers, 7);
  eq(save.daily.metrics.maxCombo, 7);
});

test('finish：达成条件时会一并抛出成就', () => {
  const save = blank();
  const run = mk('A1', save);
  Object.assign(run, { served: 7, coins: 120, tips: 40, maxCombo: 7, lost: 0, perfect: 7 });
  const res = L.finish(save, run);
  const ids = res.newAchievements.map((a) => a.id);
  includes(ids, 'first_step');
  includes(ids, 'perfect_chef', '3 星 + 0 流失');
  eq(save.gems, 1, '完美主厨奖励 1 钻石');
  eq(res.levelState.level, save.level);
  eq(res.levelState.expToNext, C.expToNext(save.level));
});

test('finish：连续通关到 15 星会解锁下一个地区', () => {
  const save = blank();
  ['A1', 'A2', 'A3', 'A4', 'A5'].forEach((id) => {
    const run = L.create(save, id, { rand: zrand, firstSpawn: 99999 });
    const lv = D.level(id);
    Object.assign(run, {
      served: lv.stars.served, coins: lv.stars.coins, tips: 200,
      maxCombo: lv.stars.minCombo, lost: 0
    });
    L.finish(save, run);
  });
  eq(C.totalStars(save), 15);
  eq(C.isRegionUnlocked(save, 'paris_cafe'), true);
  eq(C.isLevelUnlocked(save, 'B1'), true);
  eq(C.isLevelUnlocked(save, 'B2'), false, 'B2 还要先过 B1');
});

test('quit：放弃本局也会正常结算（不给通关奖励）', () => {
  const save = blank();
  const run = mk('A1', save);
  Object.assign(run, { served: 2, coins: 36, tips: 8, maxCombo: 2, lost: 0 });
  const res = L.quit(save, run);
  eq(res.cleared, false);
  eq(res.stars, 0);
  eq(save.stats.plays, 1);
  eq(run.over, true);
});

test('finish 之后 run 被标记结束，不再接受操作', () => {
  const save = blank();
  const run = mk('A1', save);
  Object.assign(run, { served: 6, coins: 100, tips: 30, maxCombo: 6, lost: 0 });
  L.finish(save, run);
  eq(run.over, true);
  eq(L.tick(run, 1000).length, 0);
  ok(run.settled, '应把结算结果挂在 run 上');
});

/* ==========================================================================
   端到端：一局从头打到尾
   ========================================================================== */
test('端到端：完整做满 7 单 → 3 星 → 解锁第 2 关', () => {
  const save = blank();
  const run = mk('A1', save);
  // 7 位顾客依次上门，全部完美上菜
  for (let i = 0; i < 7; i++) {
    const c = place(run, 'chowmein', { uid: 'e' + i });
    run.selected = c.uid;
    const r = cookAndServe(run, c.uid);
    eq(r.ok, true, '第 ' + (i + 1) + ' 单应成功');
    eq(r.perfect, true);
  }
  eq(run.served, 7);
  eq(run.combo, 7);
  eq(run.coins, 7 * 18);
  eq(run.tips, 7 * 4);
  eq(run.lost, 0);

  const res = L.finish(save, run);
  eq(res.stars, 3, '7 单 / 154 收入 / 0 流失 7 连击');
  eq(save.regions.asia_street.A1, 3);
  ok(C.isLevelUnlocked(save, 'A2'));
  gt(save.coins, 0);
  gt(save.exp, 0);
  gte(C.totalStars(save), 3);
});

test('端到端：全程不管顾客 → 全部流失 → 0 星', () => {
  const save = blank();
  const run = mk('A1', save);
  L.tick(run, 16);
  L.tick(run, 6801);                       // 每次 tick 最多上门一位，多推一次凑够两位
  eq(L.waiting(run).length, 2, '应有两位顾客在等');
  // 耐心最长的顾客也扛不住这么久（第三优先级把等待时间翻倍，取上限 ×2 再加一毫秒）
  const worst = Math.max.apply(null, D.CUSTOMERS.map((c) => c.patience)) * 2 + 1;
  L.tick(run, worst);
  eq(run.lost, 2);
  eq(run.served, 0);
  const res = L.finish(save, run);
  eq(res.stars, 0);
  eq(save.coins, 0);
});
