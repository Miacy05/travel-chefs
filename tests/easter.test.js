/* ==========================================================================
   tests/easter.test.js —— 对应模块 TC.Easter（三个彩蛋）
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section } = H;

section('TC.Easter');
const { TC } = loadGame();
const E = TC.Easter;
const S = TC.Save;

/* ------------------------------ 彩蛋 1：地球仪 ------------------------------ */
test('地球仪点 9 次不触发，第 10 次触发并给 50 金币', () => {
  const s = S.blank();
  for (let i = 1; i <= 9; i++) {
    const r = E.tapGlobe(s);
    eq(r.fired, false, '第 ' + i + ' 次不该触发');
    eq(r.taps, i);
    eq(r.need, 10 - i);
  }
  eq(s.coins, 0);
  const tenth = E.tapGlobe(s);
  eq(tenth.fired, true);
  eq(tenth.reward.coins, 50);
  eq(s.coins, 50, '触发后立刻到账');
  eq(s.easter.globe, 0, '计数清零，可以重复刷');
  eq(s.easter.globeFired, true, '记录已触发（彩蛋猎人成就用）');
});

test('地球仪可以反复触发', () => {
  const s = S.blank();
  for (let i = 0; i < 10; i++) E.tapGlobe(s);
  eq(s.coins, 50);
  for (let i = 0; i < 10; i++) E.tapGlobe(s);
  eq(s.coins, 100, '第二次 10 连点应再给 50');
  eq(E.globeTapCount(s), 0);
});

test('globeTapCount 反映当前累计点击（供角标显示）', () => {
  const s = S.blank();
  eq(E.globeTapCount(s), 0);
  E.tapGlobe(s);
  E.tapGlobe(s);
  eq(E.globeTapCount(s), 2);
  eq(E.GLOBE_TAPS, 10);
});

test('地球仪在空存档上也能工作（自愈 easter 字段）', () => {
  const s = S.blank();
  delete s.easter;
  const r = E.tapGlobe(s);
  eq(r.taps, 1);
  ok(s.easter, 'easter 字段应被补回来');
});

/* ------------------------------ 彩蛋 3：企鹅厨师 ------------------------------ */
test('冰箱点 4 次不触发，第 5 次跳出企鹅并给 1 钻石', () => {
  const s = S.blank();
  const run = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  for (let i = 1; i <= 4; i++) {
    const r = E.tapPenguin(run);
    eq(r.penguin, false, '第 ' + i + ' 次不该触发');
    eq(r.need, 5 - i);
  }
  const fifth = E.tapPenguin(run);
  eq(fifth.penguin, true);
  eq(fifth.reward.gems, 1);
  eq(s.gems, 1);
  eq(s.easter.penguin, true);
});

test('一局之内企鹅只送一次钻石', () => {
  const s = S.blank();
  const run = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  for (let i = 0; i < 5; i++) E.tapPenguin(run);
  eq(s.gems, 1);
  for (let i = 0; i < 10; i++) {
    const r = E.tapPenguin(run);
    eq(r.penguin, false, '本局已用过，不能再触发');
    eq(r.used, true);
  }
  eq(s.gems, 1, '钻石不能变多');
});

test('新的一局可以再触发一次', () => {
  const s = S.blank();
  const run1 = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  for (let i = 0; i < 5; i++) E.tapPenguin(run1);
  eq(s.gems, 1);
  const run2 = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  for (let i = 0; i < 5; i++) E.tapPenguin(run2);
  eq(s.gems, 2, '换一局应能再拿一次');
});

test('Level.tapFridge 委托给 Easter（规则只有一份）', () => {
  const s = S.blank();
  const run = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  for (let i = 0; i < 5; i++) TC.Level.tapFridge(run);
  eq(s.gems, 1);
  eq(run.fridgeTaps, 5);
});

/* ------------------------------ 彩蛋 2：彩虹糖 ------------------------------ */
test('连续 Perfect 达到 5 次触发彩虹糖', () => {
  const s = S.blank();
  const run = TC.Level.create(s, 'A1', { rand: () => 0, firstSpawn: 99999 });
  run.perfectStreak = 4;
  eq(E.checkRainbow(run), false, '4 连还不够');
  run.perfectStreak = 5;
  eq(E.checkRainbow(run), true, '5 连应触发');
  eq(run.rainbow, true);
  eq(s.easter.rainbow, true, '写进存档（彩蛋猎人成就用）');
  eq(E.checkRainbow(run), false, '同一局不重复触发');
});

test('RAINBOW_STREAK 与数据表一致', () => {
  eq(E.RAINBOW_STREAK, 5);
  eq(TC.DATA.EASTER.rainbow.perfectStreak, 5);
});

/* ------------------------------ 列表与统计 ------------------------------ */
test('list() 给出 3 个彩蛋的完成态', () => {
  const s = S.blank();
  const list = E.list(s);
  eq(list.length, 3);
  eq(list.map((x) => x.id).join(','), 'globe,rainbow,penguin');
  list.forEach((x) => {
    ok(x.name && x.icon && x.desc, x.id + ' 缺少展示字段');
    eq(x.done, false);
  });
  eq(E.total(), 3);
  eq(E.count(s), 0);
});

test('count() 随彩蛋逐个触发而增加', () => {
  const s = S.blank();
  for (let i = 0; i < 10; i++) E.tapGlobe(s);
  eq(E.count(s), 1);
  s.easter.rainbow = true;
  eq(E.count(s), 2);
  eq(E.list(s).filter((x) => x.done).length, 2);
});
