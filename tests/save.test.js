/* ==========================================================================
   tests/save.test.js —— 对应模块 TC.Save（存档读写 / 迁移 / 损坏兜底 / 状态变更）
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, deepEq, gt, gte } = H;

section('TC.Save');
const { TC } = loadGame();
const S = TC.Save;
const D = TC.DATA;

/** 独立的假 storage，避免用例之间互相污染 */
function fakeStore(initial) {
  const mem = Object.assign({}, initial || {});
  return {
    mem,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
}

/* ------------------------------ blank ------------------------------ */
test('blank 存档包含方案要求的全部字段', () => {
  const s = S.blank();
  eq(s.version, 2);
  eq(s.coins, 0);
  eq(s.gems, 0);
  eq(s.level, 1);
  eq(s.exp, 0);
  ['regions', 'decor', 'upgrades', 'stats', 'achievements', 'daily', 'easter', 'settings']
    .forEach((k) => ok(s[k], '缺少 ' + k));
  eq(Object.keys(s.regions).length, 5, '5 个地区都要有星级表');
  eq(Object.keys(s.decor).length, 5, '5 个地区都要有装饰表');
});

test('blank 的升级等级取自每项的 start', () => {
  const s = S.blank();
  eq(s.upgrades.stove_slots, 1, '灶台工位 Lv.1');
  eq(s.upgrades.stove_speed, 0);
  eq(s.upgrades.menu_margherita, 1);
  D.UPGRADES.forEach((u) => eq(s.upgrades[u.id], u.start, u.id + ' 初始等级应为 ' + u.start));
});

test('blank 的地区装饰都是空数组', () => {
  const s = S.blank();
  D.REGIONS.forEach((r) => deepEq(s.decor[r.id], []));
});

/* ------------------------------ 归一化 ------------------------------ */
test('normalize 对垃圾输入返回一份干净存档', () => {
  [null, undefined, 0, '', [], 'x'].forEach((bad) => {
    const s = S.normalize(bad);
    eq(s.coins, 0);
    eq(s.version, 2);
  });
});

test('normalize 保留合法值、剔除非法值', () => {
  const s = S.normalize({
    coins: 500, gems: -3, level: 0, exp: 'abc',
    regions: { asia_street: { A1: 5, A2: -1, A3: 'x', Z9: 2 } },
    upgrades: { stove_speed: 99, stove_slots: 0, ghost: 5 },
    stats: { customers: 12, maxCombo: 3.9, coinsTotal: -50 },
    settings: { sound: false }
  });
  eq(s.coins, 500);
  eq(s.gems, 0, '负数钻石夹到 0');
  eq(s.level, 1, '等级最低 1');
  eq(s.exp, 0, '非法经验回落 0');
  eq(s.regions.asia_street.A1, 3, '星级夹到 0–3');
  eq(s.regions.asia_street.A2, 0, '负数星级夹到 0');
  eq(s.regions.asia_street.A3, undefined, '非数字星级视为无效');
  eq(s.regions.asia_street.Z9, undefined, '不存在的关卡被丢弃');
  eq(s.upgrades.stove_speed, 5, '超过上限夹到 5');
  eq(s.upgrades.stove_slots, 1, '低于 start 夹回 1');
  eq(s.upgrades.ghost, undefined, '不存在的升级被丢弃');
  eq(s.stats.customers, 12);
  eq(s.stats.maxCombo, 3, '小数取整');
  eq(s.stats.coinsTotal, 0, '负数归零');
  eq(s.settings.sound, false);
  eq(s.settings.vibrate, true, '未提供的设置用默认值');
});

test('normalize 只保留本地区真实存在的装饰', () => {
  const s = S.normalize({ decor: { asia_street: ['lantern_string', 'fake_thing'], paris_cafe: ['lantern_string'] } });
  deepEq(s.decor.asia_street, ['lantern_string']);
  deepEq(s.decor.paris_cafe, [], '串到别的地区的装饰应被剔除');
});

test('normalize 过滤非法成就与任务 id', () => {
  const s = S.normalize({
    achievements: { first_step: '2026-09-15T00:00:00Z', nope: 1 },
    daily: { date: '2026-09-15', tasks: [{ id: 'd_plays' }, { id: 'ghost' }, null], claimed: ['d_plays', 5] }
  });
  eq(s.achievements.first_step, '2026-09-15T00:00:00Z');
  eq(s.achievements.nope, undefined);
  eq(s.daily.tasks.length, 1);
  eq(s.daily.tasks[0].id, 'd_plays');
  deepEq(s.daily.claimed, ['d_plays']);
});

test('normalize 补齐彩蛋 1 的每日字段（老存档没有 globeDay / globeFiredDay）', () => {
  // 老存档里的 easter 只有 globe / globeFired 两个字段
  const s = S.normalize({ easter: { globe: 4, globeFired: true, rainbow: true } });
  eq(s.easter.globe, 4, '已有计数保留');
  eq(s.easter.globeDay, '', '缺的日期补空串 → 下次打开按跨天处理，当天还能再飞一次');
  eq(s.easter.globeFiredDay, '', '缺的闸门日期同样补空串');
  eq(s.easter.globeFired, true, '永久触发记录保留（成就用）');
  eq(s.easter.rainbow, true);
  eq(s.easter.penguin, false);

  // 非法值兜底
  const bad = S.normalize({ easter: { globe: -5, globeDay: 123, globeFiredDay: null } });
  eq(bad.easter.globe, 0, '负计数归零');
  eq(bad.easter.globeDay, '', '非字符串日期丢弃');
  eq(bad.easter.globeFiredDay, '', '非字符串闸门日期丢弃');
});

/* ------------------------------ 迁移与损坏兜底 ------------------------------ */
test('migrate 把 v1 存档搬到 v2 且不丢货币', () => {
  const s = S.migrate({ version: 1, coins: 640, gems: 2, exp: 30, level: 4 });
  eq(s.version, 2);
  eq(s.coins, 640);
  eq(s.gems, 2);
  eq(s.level, 4);
  eq(s.migratedFrom, 1);
});

test('migrate 对 v2 原样返回', () => {
  const raw = { version: 2, coins: 1 };
  eq(S.migrate(raw), raw);
});

test('parse 对损坏 JSON 返回 null，不抛异常', () => {
  eq(S.parse('{ 坏掉的 json'), null);
  eq(S.parse('[]'), null, '数组不是合法存档');
  eq(S.parse('"字符串"'), null);
  eq(S.parse(null), null);
  eq(S.parse('null'), null);
  const good = S.parse(JSON.stringify({ version: 2, coins: 88 }));
  eq(good.coins, 88);
});

test('load：空存储返回默认存档', () => {
  const s = S.load(fakeStore());
  eq(s.coins, 0);
  eq(s.version, 2);
});

test('load：损坏存档不炸，回落默认值', () => {
  const s = S.load(fakeStore({ [D.CONFIG.saveKey]: '{{{坏' }));
  eq(s.coins, 0);
  eq(S.load(null).coins, 0, 'store 为 null 也要有兜底');
});

test('write / load 往返一致', () => {
  const store = fakeStore();
  const s = S.blank();
  s.coins = 999;
  s.gems = 7;
  s.regions.asia_street.A1 = 3;
  s.upgrades.stove_speed = 4;
  s.decor.asia_street.push('lantern_string');
  eq(S.write(s, store), true);
  const back = S.load(store);
  eq(back.coins, 999);
  eq(back.gems, 7);
  eq(back.regions.asia_street.A1, 3);
  eq(back.upgrades.stove_speed, 4);
  deepEq(back.decor.asia_street, ['lantern_string']);
});

test('storage() 在没有 localStorage 时回落到内存实现', () => {
  const st = S.storage();
  ok(st && typeof st.getItem === 'function');
});

/* ------------------------------ 货币 ------------------------------ */
test('addCoins 累加并同步累计收益，负数不越界', () => {
  const s = S.blank();
  S.addCoins(s, 120);
  eq(s.coins, 120);
  eq(s.stats.coinsTotal, 120);
  S.addCoins(s, 30);
  eq(s.coins, 150);
  eq(s.stats.coinsTotal, 150);
  S.addCoins(s, -1000);
  eq(s.coins, 0, '不能变成负金币');
  eq(s.stats.coinsTotal, 150, '累计收益不受扣款影响');
});

test('spendCoins 钱不够就原样返回 false', () => {
  const s = S.blank();
  S.addCoins(s, 100);
  eq(S.spendCoins(s, 300), false);
  eq(s.coins, 100, '失败的扣款不能改数值');
  eq(S.spendCoins(s, 100), true);
  eq(s.coins, 0);
});

test('award 同时发金币与钻石', () => {
  const s = S.blank();
  const got = S.award(s, { coins: 150, gems: 1 });
  eq(got.coins, 150);
  eq(got.gems, 1);
  eq(s.coins, 150);
  eq(s.gems, 1);
  const none = S.award(s, null);
  eq(none.coins, 0);
});

test('addExp 返回升级结果', () => {
  const s = S.blank();
  const r = S.addExp(s, 250);
  eq(r.level, 2);
  eq(r.leveledFrom, 1);
  eq(r.gained, 1);
});

/* ------------------------------ 关卡进度 ------------------------------ */
test('setLevelStars 只升不降', () => {
  const s = S.blank();
  eq(S.setLevelStars(s, 'A1', 2), 2);
  eq(S.setLevelStars(s, 'A1', 1), 2, '重玩拿 1 星不覆盖 2 星');
  eq(S.setLevelStars(s, 'A1', 3), 3, '拿更高星可以覆盖');
  eq(S.setLevelStars(s, '不存在', 3), 0);
  eq(S.setLevelStars(s, 'A1', 99), 3, '星级夹到 3');
});

/* ------------------------------ 购买 ------------------------------ */
test('buyUpgrade：没钱 / 满级 / 成功 三种结果', () => {
  const s = S.blank();
  eq(S.buyUpgrade(s, 'stove_slots').reason, 'poor');
  eq(S.buyUpgrade(s, 'ghost').reason, 'no-such-upgrade');

  S.addCoins(s, 300);
  const r = S.buyUpgrade(s, 'stove_slots');
  eq(r.ok, true);
  eq(r.cost, 260);
  eq(r.level, 2);
  eq(s.coins, 40);
  eq(s.upgrades.stove_slots, 2);

  eq(S.buyUpgrade(s, 'stove_slots').reason, 'poor', '还差 600');

  S.addCoins(s, 1000);
  eq(S.buyUpgrade(s, 'stove_slots').ok, true);
  eq(s.upgrades.stove_slots, 3);
  eq(S.buyUpgrade(s, 'stove_slots').reason, 'max');
});

test('buyUpgrade 成功会记一次今日升级（每日任务用）', () => {
  const s = S.blank();
  S.addCoins(s, 500);
  eq(s.daily.metrics.upgrades, 0);
  S.buyUpgrade(s, 'stove_slots');
  eq(s.daily.metrics.upgrades, 1);
});

test('buyDecor：每件 260，重复购买被拒，且提升小费', () => {
  const s = S.blank();
  eq(S.buyDecor(s, 'asia_street', 'lantern_string').reason, 'poor');
  S.addCoins(s, 300);
  const r = S.buyDecor(s, 'asia_street', 'lantern_string');
  eq(r.ok, true);
  eq(r.price, 260);
  eq(s.coins, 40);
  eq(S.hasDecor(s, 'asia_street', 'lantern_string'), true);
  eq(S.buyDecor(s, 'asia_street', 'lantern_string').reason, 'owned');
  eq(S.buyDecor(s, 'asia_street', 'ghost').reason, 'no-such-decor');
  eq(TC.Calc.decorTipMul(s, 'asia_street'), 1.08);
});

/* ------------------------------ 每日任务 ------------------------------ */
test('checkDaily 首次会抽 3 条任务并清空进度', () => {
  const s = S.blank();
  eq(S.checkDaily(s, '2026-09-15'), true);
  eq(s.daily.date, '2026-09-15');
  eq(s.daily.tasks.length, 3);
  eq(S.checkDaily(s, '2026-09-15'), false, '同一天不重复抽');
});

test('checkDaily 跨天会重抽并清空已领与进度', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  s.daily.metrics.plays = 2;
  s.daily.claimed.push(s.daily.tasks[0].id);
  eq(S.checkDaily(s, '2026-09-16'), true);
  eq(s.daily.date, '2026-09-16');
  eq(s.daily.metrics.plays, 0, '跨天清空今日进度');
  deepEq(s.daily.claimed, []);
});

test('bumpDaily 支持累加与取最大两种模式', () => {
  const s = S.blank();
  S.bumpDaily(s, 'plays', 1, 'add');
  S.bumpDaily(s, 'plays', 1, 'add');
  eq(s.daily.metrics.plays, 2);
  S.bumpDaily(s, 'maxCombo', 5, 'max');
  S.bumpDaily(s, 'maxCombo', 3, 'max');
  eq(s.daily.metrics.maxCombo, 5, '取最大模式不会被更小的值覆盖');
});

test('claimTask：未完成不给领，领过不能重复领', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  const t = TC.Daily.rows(s)[0];
  eq(S.claimTask(s, t.id).reason, 'unfinished');
  eq(S.claimTask(s, 'ghost').reason, 'no-such-task');

  s.daily.metrics[t.task.metric] = t.target;
  const r = S.claimTask(s, t.id);
  eq(r.ok, true);
  const before = s.coins + s.gems;
  eq(S.claimTask(s, t.id).reason, 'claimed');
  eq(s.coins + s.gems, before, '重复领取不能加钱');
});

/* ------------------------------ 成就 ------------------------------ */
test('checkAchievements 只在首次达成时发奖', () => {
  const s = S.blank();
  eq(S.checkAchievements(s).length, 0, '新存档不该有已完成成就');

  s.regions.asia_street.A1 = 1;
  const first = S.checkAchievements(s);
  eq(first.length, 1);
  eq(first[0].id, 'first_step');
  eq(s.coins, 100, '初来乍到奖励 100 金币');
  eq(S.checkAchievements(s).length, 0, '不能重复发奖');
  eq(s.coins, 100);
});

test('achievementProgress 给出进度与完成态', () => {
  const s = S.blank();
  const p = S.achievementProgress(s, 'super_fan');
  eq(p.target, 100);
  eq(p.cur, 0);
  eq(p.done, false);
  s.stats.customers = 100;
  S.checkAchievements(s);
  const p2 = S.achievementProgress(s, 'super_fan');
  eq(p2.cur, 100);
  eq(p2.done, true);
  eq(s.gems, 1, '铁杆粉丝奖励 1 钻石');
});

/* ------------------------------ 一局结束 ------------------------------ */
test('recordRun 累加统计并更新今日计数', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  const run = { served: 8, perfect: 6, lost: 1, maxCombo: 7, quickStreak: true };
  const settleData = { income: 260, stars: 3 };
  S.recordRun(s, run, settleData, { customerIds: ['office', 'kid'] });

  eq(s.stats.plays, 1);
  eq(s.stats.customers, 8);
  eq(s.stats.perfect, 6);
  eq(s.stats.lostTotal, 1);
  eq(s.stats.maxCombo, 7);
  eq(s.stats.bestCoins, 260);
  eq(s.stats.quickRuns, 1);
  eq(s.stats.perfectRuns, 0, '完美主厨要求 3 星且 0 流失 —— 这里流失 1 位，不应置位');
  eq(s.stats.seenCustomers.office, 1);
  eq(s.stats.seenCustomers.kid, 1);
  eq(s.stats.seenCustomers.foodie, undefined);

  eq(s.daily.metrics.plays, 1);
  eq(s.daily.metrics.customers, 8);
  eq(s.daily.metrics.maxCombo, 7);
  eq(s.daily.metrics.bestCoins, 260);
});

test('recordRun：3 星且 0 流失才置位完美主厨', () => {
  const s = S.blank();
  S.recordRun(s, { served: 6, perfect: 6, lost: 0, maxCombo: 6 }, { income: 200, stars: 3 }, { customerIds: [] });
  eq(s.stats.perfectRuns, 1);
});

test('recordRun：单局收入只记录更高的那次', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  S.recordRun(s, { served: 6, lost: 1, maxCombo: 3 }, { income: 300, stars: 2 }, {});
  S.recordRun(s, { served: 4, lost: 2, maxCombo: 2 }, { income: 120, stars: 1 }, {});
  eq(s.stats.bestCoins, 300);
  eq(s.daily.metrics.bestCoins, 300);
  eq(s.stats.plays, 2);
});

/* ------------------------------ 端到端：改完能存回去 ------------------------------ */
test('改档 → 落盘 → 重新读入，进度一致', () => {
  const store = fakeStore();
  let s = S.load(store);
  S.addCoins(s, 1000);
  S.buyUpgrade(s, 'stove_speed');
  S.setLevelStars(s, 'A1', 3);
  S.buyDecor(s, 'asia_street', 'cloth_banner');
  S.write(s, store);

  const back = S.load(store);
  eq(back.upgrades.stove_speed, 1);
  eq(back.regions.asia_street.A1, 3);
  eq(back.coins, 1000 - 180 - 260);
  deepEq(back.decor.asia_street, ['cloth_banner']);
  gte(TC.Calc.totalStars(back), 3);
});
