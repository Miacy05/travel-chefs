/* ==========================================================================
   tests/upgrade.test.js —— 对应模块 TC.Upgrade（升级页取数 / 购买 / 属性聚合）
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, approx } = H;

section('TC.Upgrade');
const { TC } = loadGame();
const G = TC.Upgrade;
const S = TC.Save;
const C = TC.Calc;

const blank = () => S.blank();

test('四个标签与方案一致', () => {
  eq(G.tabs().length, 4);
  eq(G.tabs().map((t) => t.id).join(','), 'equipment,menu,decor,staff');
  eq(G.tabName('equipment'), '厨房设备');
  eq(G.tabName('staff'), '员工雇佣');
});

test('未解锁地区的菜品菜单不出现在升级页', () => {
  const s = blank();
  eq(G.visibleOf(s, 'equipment').length, 3, '设备 3 项');
  eq(G.visibleOf(s, 'decor').length, 3, '装修 3 项');
  eq(G.visibleOf(s, 'staff').length, 1, '员工简化后只剩服务员 1 项');
  eq(G.visibleOf(s, 'menu').length, 4, '亚洲 3 道菜 + 加料台');

  // 攒够 6 星解锁巴黎后，菜单多出 3 项
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 3;
  eq(C.isRegionUnlocked(s, 'paris_cafe'), true);
  eq(G.visibleOf(s, 'menu').length, 7, '巴黎 3 道菜也出现了');
});

test('row() 给出等级 / 花费 / 差多少钱 / 效果文案', () => {
  const s = blank();
  const r = G.row(s, 'stove_slots');
  eq(r.name, '灶台工位');
  eq(r.level, 1);
  eq(r.maxLevel, 3);
  eq(r.maxed, false);
  eq(r.cost, 260);
  eq(r.affordable, false, '0 金币买不起');
  eq(r.short, 260);
  eq(r.currentEffect, '尚未升级');
  eq(r.nextEffect, '同时开 3 个锅');
  eq(r.progress.level, 1);
});

test('row() 满级时 cost 为 null、nextEffect 为「已满级」', () => {
  const s = blank();
  s.upgrades.stove_slots = 3;
  const r = G.row(s, 'stove_slots');
  eq(r.maxed, true);
  eq(r.cost, null);
  eq(r.affordable, false);
  eq(r.currentEffect, '同时开 4 个锅（已满级）');
  eq(r.nextEffect, '已满级');
});

test('rows() 按标签返回全部行且顺序与数据表一致', () => {
  const s = blank();
  const ids = G.rows(s, 'equipment').map((r) => r.id);
  eq(ids.join(','), 'stove_slots,stove_speed,warmer');
  const menuIds = G.rows(s, 'menu').map((r) => r.id);
  eq(menuIds.join(','), 'spice,menu_chowmein,menu_dumpling,menu_milktea');
});

test('row() 对不存在的升级返回 null', () => {
  eq(G.row(blank(), 'ghost'), null);
});

test('buy：钱不够时给出还差多少，且不动存档', () => {
  const s = blank();
  const r = G.buy(s, 'stove_slots');
  eq(r.ok, false);
  eq(r.reason, 'poor');
  eq(r.short, 260);
  eq(s.coins, 0);
  eq(s.upgrades.stove_slots, 1);
});

test('buy：钱够时扣费、升级、并返回新的一行', () => {
  const s = blank();
  S.addCoins(s, 300);
  const r = G.buy(s, 'stove_slots');
  eq(r.ok, true);
  eq(r.cost, 260);
  eq(r.level, 2);
  eq(s.coins, 40);
  eq(r.row.level, 2);
  eq(r.row.cost, 640, '下一级要 640');
  eq(r.row.currentEffect, '同时开 3 个锅');
  eq(r.row.short, 600);
});

test('buy：满级后拒绝', () => {
  const s = blank();
  S.addCoins(s, 5000);
  G.buy(s, 'stove_slots');
  G.buy(s, 'stove_slots');
  eq(s.upgrades.stove_slots, 3);
  const r = G.buy(s, 'stove_slots');
  eq(r.ok, false);
  eq(r.reason, 'max');
});

test('buy：不存在的升级被拒', () => {
  eq(G.buy(blank(), 'ghost').reason, 'no-such-upgrade');
});

test('canBuy 与 row().affordable 一致', () => {
  const s = blank();
  eq(G.canBuy(s, 'stove_slots'), false);
  S.addCoins(s, 260);
  eq(G.canBuy(s, 'stove_slots'), true);
  s.upgrades.stove_slots = 3;
  eq(G.canBuy(s, 'stove_slots'), false, '满级不能再买');
});

test('summary 汇总所有会影响玩法的属性', () => {
  const s = blank();
  const a = G.summary(s);
  eq(a.stoveSlots, 2);
  eq(a.cookTimeMul, 1);
  eq(a.plateLife, 12000);
  eq(a.seatsBonus, 0);
  eq(a.tipAdd, 0);
  approx(a.tipMul, 1);
  approx(a.coinMul, 1, undefined, '收银员已下线，金币倍率恒为 1');
  eq(a.waiterInterval, 0, '没雇服务员就没有自动上菜');
  eq(a.ownedDecor, 0);
  eq(a.decorLv.asia_street, 0, '每个地区各自一份装饰等级');

  s.upgrades.stove_speed = 5;
  s.upgrades.warmer = 5;
  s.upgrades.seats = 2;
  s.upgrades.spice = 3;
  s.upgrades.waiter = 2;
  /* 无地区上下文的全局口径：装饰布置的老字段仍能读出来（兼容旧调用点） */
  s.upgrades.decor_bonus = 5;
  /* 有地区上下文的真实口径：每地区独立 */
  s.decorLv.asia_street = 3;
  s.decorLv.paris_cafe = 1;
  const b = G.summary(s);
  approx(b.cookTimeMul, 0.6);
  eq(b.plateLife, 22000);
  eq(b.seatsBonus, 2);
  eq(b.tipAdd, 3);
  approx(b.tipMul, 1.25);
  approx(b.coinMul, 1);
  eq(b.waiterInterval, 3000, '服务员 Lv2：每 3 秒一次');
  eq(b.ownedDecor, 3 + 1, '各地区已解锁装饰件数跨地区累加');
  eq(b.decorLv.asia_street, 3);
  eq(b.decorLv.paris_cafe, 1);
  eq(b.decorLv.ramen_shop, 0, '没升过的地区还是毛坯');
});

test('升级后的属性真的会被 Calc 用上（不是只显示）', () => {
  const s = blank();
  const before = C.cookTime('chowmein', s);
  S.addCoins(s, 200);
  G.buy(s, 'stove_speed');
  const after = C.cookTime('chowmein', s);
  eq(before, 3000);
  eq(after, 2760, '3000 × (1 − 0.08)');
});
