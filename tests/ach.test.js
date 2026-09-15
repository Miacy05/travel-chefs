/* ==========================================================================
   tests/ach.test.js —— 对应模块 TC.Ach（成就进度与发放）
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gte } = H;

section('TC.Ach');
const { TC } = loadGame();
const A = TC.Ach;
const S = TC.Save;
const D = TC.DATA;

test('成就共 10 个，rows() 逐行给出名称 / 描述 / 进度 / 奖励文案', () => {
  const s = S.blank();
  const rows = A.rows(s);
  eq(rows.length, 10);
  eq(A.total(), 10);
  rows.forEach((r) => {
    ok(r.name && r.icon && r.desc, r.id + ' 缺少展示字段');
    eq(r.done, false);
    gte(r.cur, 0);
    gte(r.target, 1);
    ok(r.rewardText.indexOf('🪙') === 0 || r.rewardText.indexOf('💎') === 0);
  });
  eq(rows.filter((r) => r.cur === 0).length, 9, '只有「收藏家」在新存档里就有 2 点进度');
  eq(rows.filter((r) => r.id === 'collector')[0].cur, 2, '1 地区 + 1 道菜');
  eq(A.doneCount(s), 0);
});

test('metrics 覆盖全部成就引用到的指标', () => {
  const m = A.metrics(S.blank());
  D.ACHIEVEMENTS.forEach((a) => {
    no(m[a.metric] === undefined, '成就 ' + a.id + ' 的指标 ' + a.metric + ' 缺失');
  });
});

test('新存档检查一遍，不会有任何成就被误判达成', () => {
  const s = S.blank();
  eq(A.evaluate(s).length, 0);
  eq(Object.keys(s.achievements).length, 0);
});

test('初来乍到：通关第 1 关即达成，发 100 金币', () => {
  const s = S.blank();
  s.regions.asia_street.A1 = 1;
  const got = A.evaluate(s);
  eq(got.length, 1);
  eq(got[0].id, 'first_step');
  eq(got[0].name, '初来乍到');
  eq(s.coins, 100);
});

test('旅行家：累计通关 5 个关卡', () => {
  const s = S.blank();
  ['A1', 'A2', 'A3', 'A4', 'A5'].forEach((id) => { s.regions.asia_street[id] = 1; });
  const ids = A.evaluate(s).map((a) => a.id);
  ok(ids.indexOf('traveler') !== -1, '应解锁旅行家');
  ok(ids.indexOf('first_step') !== -1, '同时也该解锁初来乍到');
  eq(s.coins, 100 + 200, '两次奖励都到账');
  eq(A.doneCount(s), 2);
});

test('完美主厨：单局 3 星且 0 流失', () => {
  const s = S.blank();
  s.stats.perfectRuns = 1;
  const got = A.evaluate(s);
  eq(got.length, 1);
  eq(got[0].id, 'perfect_chef');
  eq(s.gems, 1);
});

test('收藏家：图鉴解锁 12 项', () => {
  const s = S.blank();
  eq(A.progress(s, 'collector').cur, 2, '初始 1 地区 + 1 道菜');
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 3;
  s.regions.asia_street.A3 = 3;
  s.regions.asia_street.A4 = 3;
  s.regions.asia_street.A5 = 3;   // 15 星 → 解锁巴黎
  D.CUSTOMERS.forEach((c) => { s.stats.seenCustomers[c.id] = 1; });
  gte(A.progress(s, 'collector').cur, 12);
  const ids = A.evaluate(s).map((a) => a.id);
  ok(ids.indexOf('collector') !== -1);
});

test('连击大师：单局最高连击 ≥ 10', () => {
  const s = S.blank();
  s.stats.maxCombo = 9;
  eq(A.progress(s, 'combo_master').done, false);
  s.stats.maxCombo = 10;
  eq(A.evaluate(s).map((a) => a.id).indexOf('combo_master') !== -1, true);
});

test('财源滚滚：累计赚取 1000 金币，发 1 钻石', () => {
  const s = S.blank();
  s.stats.coinsTotal = 1000;
  const got = A.evaluate(s);
  eq(got.map((a) => a.id).join(','), 'rich');
  eq(s.gems, 1);
  eq(s.coins, 0, '成就奖励是钻石，不该给金币');
});

test('快刀手：单局 5 秒内连续上菜 3 次', () => {
  const s = S.blank();
  s.stats.quickRuns = 1;
  eq(A.evaluate(s).map((a) => a.id).join(','), 'quick_hand');
  eq(s.coins, 120);
});

test('五星好评：累计 3 星通关 5 次', () => {
  const s = S.blank();
  ['A1', 'A2', 'A3', 'A4', 'A5'].forEach((id) => { s.regions.asia_street[id] = 3; });
  const ids = A.evaluate(s).map((a) => a.id);
  ok(ids.indexOf('five_star') !== -1, '应解锁五星好评');
  eq(s.coins, 100 + 200 + 250, '初来乍到 + 旅行家 + 五星好评');
});

test('铁杆粉丝：累计接待 100 位顾客', () => {
  const s = S.blank();
  s.stats.customers = 99;
  eq(A.progress(s, 'super_fan').cur, 99);
  s.stats.customers = 100;
  eq(A.evaluate(s).map((a) => a.id).join(','), 'super_fan');
  eq(s.gems, 1);
});

test('彩蛋猎人：三个彩蛋全部触发', () => {
  const s = S.blank();
  s.easter.globeFired = true;
  s.easter.rainbow = true;
  eq(A.progress(s, 'egg_hunter').cur, 2);
  s.easter.penguin = true;
  eq(A.evaluate(s).map((a) => a.id).join(','), 'egg_hunter');
  eq(s.coins, 300);
});

test('同一个成就不会被重复发奖', () => {
  const s = S.blank();
  s.stats.coinsTotal = 5000;
  const first = A.evaluate(s);
  eq(first.length, 1);
  eq(s.gems, 1);
  eq(A.evaluate(s).length, 0, '第二次不应再解锁');
  eq(s.gems, 1, '奖励不能重复发');
});

test('progress：进度被 target 截断，pct 落在 [0,1]', () => {
  const s = S.blank();
  s.stats.customers = 500;
  const p = A.progress(s, 'super_fan');
  eq(p.cur, 100, '进度条不溢出');
  eq(p.raw, 500, '原始值仍可读');
  eq(p.pct, 1);
  const p2 = A.progress(s, 'traveler');
  eq(p2.cur, 0);
  eq(p2.pct, 0);
});

test('progress 对不存在的成就返回安全默认值', () => {
  const p = A.progress(S.blank(), 'ghost');
  eq(p.cur, 0);
  eq(p.target, 1);
  eq(p.done, false);
});

test('evaluate 可以注入时间戳，便于测试与回放', () => {
  const s = S.blank();
  s.regions.asia_street.A1 = 1;
  A.evaluate(s, '2026-09-15T21:00:00.000Z');
  eq(s.achievements.first_step, '2026-09-15T21:00:00.000Z');
});

test('Save.checkAchievements 与 Ach.evaluate 行为一致（同一份实现）', () => {
  const s1 = S.blank();
  const s2 = S.blank();
  s1.regions.asia_street.A1 = 1;
  s2.regions.asia_street.A1 = 1;
  eq(S.checkAchievements(s1).length, A.evaluate(s2).length);
  eq(s1.coins, s2.coins);
});
