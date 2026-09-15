/* ==========================================================================
   tests/guest.test.js —— 对应第六优先级「特殊顾客系统」
   覆盖：4 种特殊顾客数据自洽、触发判定 G.pick、一生一次的 markSeen、
        每日首登的旅行博主、30 秒入场道具（guestBuff）的计时与结算加成、
        作为额外顾客加入（不替换普通顾客）。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, section, gt, gte, lte, includes } = H;

section('TC.Guest · 特殊顾客');
const { TC } = loadGame();
const L = TC.Level;
const S = TC.Save;
const C = TC.Calc;
const D = TC.DATA;
const G = TC.Guest;
const U = TC.Util;

const blank = () => S.blank();

/* ------------------------------ 数据表 ------------------------------ */

test('4 种特殊顾客：id 唯一、都带 special 标记与专属 buff', () => {
  eq(D.SPECIAL_GUESTS.length, 4);
  const ids = D.SPECIAL_GUESTS.map((g) => g.id);
  eq(new Set(ids).size, 4, 'id 不能重复');
  D.SPECIAL_GUESTS.forEach((g) => {
    eq(g.special, true, g.id + ' 应标记 special');
    ok(g.arch && g.name && g.icon && g.desc, g.id + ' 缺字段');
    ok(g.buff && g.buff.type && g.buff.ms === 30000, g.id + ' 应有 30 秒 buff');
    ok(g.trigger, g.id + ' 应有触发条件');
  });
  /* 动物（流浪猫）非人形、小费低 */
  eq(D.specialGuest('cat').tipMul, 0.5);
  /* 评论家小费最高 */
  eq(D.specialGuest('critic').tipMul, 2.0);
});

/* ------------------------------ 触发判定 ------------------------------ */

test('G.pick：新档不触发任何特殊顾客（服务数 0、没玩过）', () => {
  const s = blank();
  eq(G.pick(s, () => 0.5), null, '新档不触发');
});

test('G.pick：累计服务 50 位触发神秘老人，150 位触发评论家（一生一次）', () => {
  const s = blank();
  s.stats.customers = 50;
  const g50 = G.pick(s, () => 0.5);
  ok(g50 && g50.id === 'elder', '服务 50 位应来神秘老人，实际：' + (g50 && g50.id));
  // 标记见过后，不再重复触发
  G.markSeen(s, 'elder');
  eq(G.pick(s, () => 0.5), null, '见过老人后不再重复触发');

  const s2 = blank();
  s2.stats.customers = 150;
  const g150 = G.pick(s2, () => 0.5);
  ok(g150 && g150.id === 'critic', '服务 150 位应来评论家');
});

test('G.pick：每日首登触发旅行博主（已玩过 + 今天还没来过）', () => {
  const s = blank();
  s.stats.plays = 3;                      // 老玩家
  s.guest = { seen: {}, lastDay: '' };    // 今天还没来
  const g = G.pick(s, () => 0.5);
  ok(g && g.id === 'blogger', '每日首登应来旅行博主');
  // 标记今天来过 → 不再触发
  G.markSeen(s, 'blogger');
  eq(G.pick(s, () => 0.5), null, '今天来过博主后不再触发');
});

test('G.pick：随机流浪猫按概率触发（徽章越多概率越高）', () => {
  const s = blank();
  // 服务数足够大（避免确定性触发抢跑），用 rand 控制
  s.guest = { seen: { elder: true, critic: true, blogger: true }, lastDay: U.today() };
  // rand() = 0 → 一定命中猫
  const g = G.pick(s, () => 0);
  ok(g && g.id === 'cat', 'rand=0 应命中流浪猫');
  // rand() = 0.99 → 不命中
  eq(G.pick(s, () => 0.99), null, 'rand=0.99 不该命中猫');
});

test('G.pick：确定性触发优先于随机猫', () => {
  const s = blank();
  s.stats.customers = 50;                 // 老人可触发
  // rand=0 会让猫也命中，但老人（确定性）应优先
  const g = G.pick(s, () => 0);
  eq(g.id, 'elder', '确定性触发的老人应优先于随机猫');
});

/* ------------------------------ buff 计时 ------------------------------ */

test('applyBuff / tickBuff：30 秒道具正常计时、归零清空', () => {
  const s = blank();
  const run = L.create(s, 'A1', { skipGuest: true });
  const guest = D.specialGuest('critic');
  const buf = G.applyBuff(run, guest);
  ok(buf, '应挂上 buff');
  eq(buf.type, 'coin');
  eq(buf.left, 30000);
  // 推进 30 秒
  G.tickBuff(run, 30000);
  eq(run.guestBuff, null, '30 秒后 buff 应清空');
});

test('cookMul：speed buff 加速烹饪，其余类型不影响', () => {
  const run = { guestBuff: { type: 'speed', mul: 0.5 } };
  eq(G.cookMul(run), 0.5);
  run.guestBuff = { type: 'coin', mul: 1.1 };
  eq(G.cookMul(run), 1, 'coin buff 不加速烹饪');
  eq(G.cookMul({}), 1);
});

/* ------------------------------ 作为额外顾客加入 ------------------------------ */

test('L.create 命中特殊顾客时，作为额外顾客加入且不替换普通顾客', () => {
  const s = blank();
  s.stats.customers = 50;   // 触发老人
  const run = L.create(s, 'A1', { rand: () => 0.5, firstSpawn: 0 });
  ok(run.guest, '应命中特殊顾客');
  eq(run.guest.id, 'elder');
  eq(run.customers.length, 1, '特殊顾客开局就作为额外顾客加入');
  eq(run.customers[0].special, true);
  eq(run.customers[0].id, 'elder');
  ok(run.guestBuff, '应同时激活 30 秒道具');
  // 普通顾客照常会上门
  L.tick(run, 16);
  ok(run.customers.length >= 1, '普通顾客之后会照常上门');
});

test('L.create skipGuest:true 时不注入特殊顾客', () => {
  const s = blank();
  s.stats.customers = 50;
  const run = L.create(s, 'A1', { rand: () => 0.5, firstSpawn: 0, skipGuest: true });
  eq(run.guest, null);
  eq(run.guestBuff, null);
});

/* ------------------------------ 结算加成 ------------------------------ */

test('coin buff 让每单金币 +10%', () => {
  const s = blank();
  const run = L.create(s, 'A1', { skipGuest: true, firstSpawn: 0, rand: () => 0 });
  // 手动放一位顾客 + 一盘匹配的菜
  const d = D.dish('chowmein');
  const c = {
    uid: 'x', id: 'office', name: '上班族', dishId: 'chowmein',
    patienceMax: 99999, patienceLeft: 99999, state: 'waiting', bornAt: 0
  };
  run.customers.push(c);
  run.selected = 'x';
  run.plates.push({ dishId: 'chowmein', name: d.name, since: 0, cookTotal: 8000, lifeMax: 99999, lifeLeft: 99999 });
  const base = C.orderIncome('chowmein', 'office', run.regionId, run.save);
  // 激活 coin buff
  run.guestBuff = { type: 'coin', mul: 1.10 };
  const res = L.serve(run, 0, 'x');
  ok(res.ok);
  eq(res.coins, Math.round(base.coins * 1.10), 'coin buff 应让金币 +10%');
});
