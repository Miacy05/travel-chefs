/* ==========================================================================
   tests/calc.test.js —— 对应模块 TC.Calc（全部规则计算）
   星级 / 金币 / 小费 / 连击 / Perfect / 经验 / 解锁 / 结算
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, approx, gt, gte, lte } = H;

section('TC.Calc');
const { TC } = loadGame();
const C = TC.Calc;
const S = TC.Save;

const blank = (over) => {
  const s = S.blank();
  if (over) Object.keys(over).forEach((k) => { s[k] = over[k]; });
  return s;
};
/** 只改某个升级等级 */
const withUp = (id, lv, over) => {
  const s = blank(over);
  s.upgrades[id] = lv;
  return s;
};

/* ------------------------------ 升级数值 ------------------------------ */
test('upLv 缺省回落到 start，并夹在 [start, maxLevel]', () => {
  const s = blank();
  eq(C.upLv(s, 'stove_slots'), 1, '灶台工位起始 Lv.1');
  eq(C.upLv(s, 'stove_speed'), 0, '猛火灶起始 Lv.0');
  eq(C.upLv(s, 'menu_chowmein'), 1);
  s.upgrades.stove_speed = 99;
  eq(C.upLv(s, 'stove_speed'), 5, '超过上限应被夹住');
  s.upgrades.stove_speed = -3;
  eq(C.upLv(s, 'stove_speed'), 0, '低于下限应被夹住');
});

test('upVal 按等级直接索引', () => {
  eq(C.upVal(withUp('stove_slots', 1), 'stove_slots'), 2);
  eq(C.upVal(withUp('stove_slots', 3), 'stove_slots'), 4);
  eq(C.upVal(withUp('stove_speed', 0), 'stove_speed'), 0);
  eq(C.upVal(withUp('stove_speed', 5), 'stove_speed'), 0.40);
  eq(C.upVal(withUp('menu_chowmein', 3), 'menu_chowmein'), 0.24);
});

test('upCost 给出下一级花费，满级返回 null', () => {
  eq(C.upCost(blank(), 'stove_slots'), 260, 'Lv.1→2 花 260');
  eq(C.upCost(withUp('stove_slots', 2), 'stove_slots'), 640, 'Lv.2→3 花 640');
  eq(C.upCost(withUp('stove_slots', 3), 'stove_slots'), null, '满级应为 null');
  eq(C.upCost(withUp('stove_speed', 0), 'stove_speed'), 180, 'Lv.0→1 花 180');
  eq(C.upCost(withUp('stove_speed', 4), 'stove_speed'), 1100);
  eq(C.upCost(blank(), '不存在的升级'), null);
});

test('upEffect / upNextEffect 的文案语义正确', () => {
  eq(C.upEffect(blank(), 'stove_slots'), '尚未升级', '起始等级还没有升过');
  eq(C.upNextEffect(blank(), 'stove_slots'), '同时开 3 个锅');
  eq(C.upEffect(withUp('stove_slots', 2), 'stove_slots'), '同时开 3 个锅');
  eq(C.upNextEffect(withUp('stove_slots', 2), 'stove_slots'), '同时开 4 个锅');
  eq(C.upEffect(withUp('stove_slots', 3), 'stove_slots'), '同时开 4 个锅（已满级）');
  eq(C.upNextEffect(withUp('stove_slots', 3), 'stove_slots'), '已满级');
});

/* ------------------------------ 售价 / 小费 / 收益 ------------------------------ */
test('售价含地区倍率与菜单等级加成', () => {
  eq(C.sellPrice('chowmein', 'asia_street', blank()), 18, '18 × 1.00 × 1.0');
  eq(C.sellPrice('chowmein', 'asia_street', withUp('menu_chowmein', 3)), 22, '18 × 1.24 = 22.32 → 22');
  eq(C.sellPrice('chowmein', 'asia_street', withUp('menu_chowmein', 5)), 27, '18 × 1.48 = 26.64 → 27');
  eq(C.sellPrice('chowmein', 'paris_cafe', blank()), 21, '18 × 1.15 = 20.7 → 21');
  eq(C.sellPrice('margherita', 'pizza_house', blank()), 38, '26 × 1.45 = 37.7 → 38');
  eq(C.sellPrice('guacamole', 'taco_stand', blank()), 21, '13 × 1.60 = 20.8 → 21');
});

test('小费＝(基础小费 + 加料台) × 顾客倍率 × 升级加成 × 地区装饰加成', () => {
  eq(C.tip('chowmein', 'office', 'asia_street', blank()), 4, '4 × 1.0');
  eq(C.tip('chowmein', 'tourist', 'asia_street', blank()), 5, '4 × 1.35 = 5.4 → 5');
  eq(C.tip('chowmein', 'office', 'asia_street', withUp('spice', 3)), 7, '(4+3) × 1.0');
  const s1 = withUp('decor_bonus', 5);
  eq(C.tip('chowmein', 'office', 'asia_street', s1), 5, '4 × 1.25 = 5');
  const s2 = blank();
  s2.decor.asia_street = ['lantern_string', 'cloth_banner'];
  approx(C.decorTipMul(s2, 'asia_street'), 1.16, 1e-9);
  eq(C.tip('chowmein', 'office', 'asia_street', s2), 5, '4 × 1.16 = 4.64 → 5');
});

test('收银员加成乘在订单金币上，不影响小费', () => {
  const s = withUp('cashier', 3);
  eq(C.coinMul(s), 1.18);
  const inc = C.orderIncome('chowmein', 'office', 'asia_street', s);
  eq(inc.coins, 21, '18 × 1.18 = 21.24 → 21');
  eq(inc.tips, 4, '小费不受收银员影响');
  eq(inc.total, 25);
});

/* ------------------------------ 设备与场景 ------------------------------ */
test('cookTime 随猛火灶递减，且有 300ms 地板', () => {
  eq(C.cookTime('chowmein', blank()), 3000);
  eq(C.cookTime('chowmein', withUp('stove_speed', 5)), 1800, '3000 × 0.6');
  eq(C.cookTime('matcha', blank()), 1400);
  eq(C.cookTime('matcha', withUp('stove_speed', 5)), 840);
});

test('plateLife 随保温台增加', () => {
  eq(C.plateLife(blank()), 12000);
  eq(C.plateLife(withUp('warmer', 5)), 22000);
});

test('stoveSlots 为 2/3/4', () => {
  eq(C.stoveSlots(blank()), 2);
  eq(C.stoveSlots(withUp('stove_slots', 2)), 3);
  eq(C.stoveSlots(withUp('stove_slots', 3)), 4);
});

test('seats = 关卡基础座位 + 加座，上限 6（第六优先级：同屏最多 6 位）', () => {
  eq(C.seats('A1', blank()), 2, 'A1 基础 2 座');
  eq(C.seats('A4', blank()), 3, 'A4 基础 3 座');
  eq(C.seats('A1', withUp('seats', 1)), 3);
  eq(C.seats('A1', withUp('seats', 2)), 4);
  eq(C.seats('A4', withUp('seats', 3)), 6, '3 + 3 = 6，正好到同屏上限');
  eq(C.seats('A1', withUp('seats', 3)), 5, '2 + 3 = 5，没到上限就不夹');
  eq(C.SEAT_CAP, 6);
});

test('spawnInterval 随招牌灯箱拉长（减压）', () => {
  eq(C.spawnInterval('A1', blank()), 6800);
  eq(C.spawnInterval('A1', withUp('signboard', 3)), 8000, '6.8 + 1.2 = 8.0s');
  eq(C.spawnInterval('A5', blank()), 4200);
});

test('patience = 顾客基础耐心 × 关卡 patienceScale × 2（第三优先级把等待时间翻倍）', () => {
  eq(TC.DATA.CONFIG.patienceMul, 2, '等待时间倍率必须是 2');
  eq(C.patience('office', 'A1'), 48000, '24000 × 2');
  eq(C.patience('office', 'A5'), 38400, '24000 × 0.80 × 2');
  eq(C.patience('student', 'A5'), 28800, '18000 × 0.80 × 2');
  eq(C.patience('granny', 'A1'), 80000);
  /* 困难关卡用自己的倍率把等待时间压回去 —— 这才是「难」的来源之一 */
  eq(C.patience('office', 'A1', { hard: { patienceMul: 0.55 } }), 13200);
  eq(C.patience('nobody', 'A1'), 40000, '查不到的顾客回落到 20s × 2');
});

/* ------------------------------ Perfect 与连击 ------------------------------ */
test('isPerfect：出锅后 ≤ 烹饪时间 × 0.6 内送出', () => {
  eq(C.isPerfect(0, 3000), true);
  eq(C.isPerfect(1800, 3000), true, '正好 0.6 倍仍算 Perfect');
  eq(C.isPerfect(1801, 3000), false);
  eq(C.isPerfect(-5, 3000), true, '负数按 0 处理');
  eq(C.isPerfect(1799, 3000), true);
});

test('comboNext：Perfect 累加，否则清零', () => {
  eq(C.comboNext(0, true), 1);
  eq(C.comboNext(4, true), 5);
  eq(C.comboNext(9, false), 0);
  eq(C.comboNext(0, false), 0);
});

/* ------------------------------ 解锁 ------------------------------ */
test('totalStars / regionStars 汇总正确', () => {
  const s = blank();
  eq(C.totalStars(s), 0);
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 2;
  eq(C.totalStars(s), 5);
  eq(C.regionStars(s, 'asia_street'), 5);
  eq(C.regionStars(s, 'paris_cafe'), 0);
});

test('地区解锁按星星门槛；首个地区默认解锁', () => {
  const s = blank();
  eq(C.isRegionUnlocked(s, 'asia_street'), true);
  eq(C.isRegionUnlocked(s, 'paris_cafe'), false);
  eq(C.unlockedRegionIds(s).join(','), 'asia_street');
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 3;
  eq(C.totalStars(s), 6);
  eq(C.isRegionUnlocked(s, 'paris_cafe'), true, '6 星应解锁巴黎');
  eq(C.unlockedRegionIds(s).join(','), 'asia_street,paris_cafe');
});

test('关卡解锁：第 1 关默认开，之后需前一关通关', () => {
  const s = blank();
  eq(C.isLevelUnlocked(s, 'A1'), true);
  eq(C.isLevelUnlocked(s, 'A2'), false);
  s.regions.asia_street.A1 = 1;
  eq(C.isLevelUnlocked(s, 'A2'), true, '1 星也算通关');
  eq(C.isLevelUnlocked(s, 'A3'), false);
  eq(C.isLevelUnlocked(s, 'B1'), false, '地区没解锁时关卡也进不去');
});

test('clearedCount / threeStarCount 统计正确', () => {
  const s = blank();
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 1;
  eq(C.clearedCount(s), 2);
  eq(C.threeStarCount(s), 1);
});

test('nextLevel 指向已解锁地区里第一关未通关的关卡', () => {
  const s = blank();
  eq(C.nextLevel(s).id, 'A1');
  s.regions.asia_street.A1 = 3;
  eq(C.nextLevel(s).id, 'A2');
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 3;
  s.regions.asia_street.A3 = 3;
  s.regions.asia_street.A4 = 3;
  s.regions.asia_street.A5 = 3;
  eq(C.totalStars(s), 15);
  eq(C.nextLevel(s).id, 'B1', '亚洲全通后应指向巴黎第 1 关');
});

test('nextLevel 在全通后回到最后一个地区的第 5 关', () => {
  const s = blank();
  TC.DATA.LEVELS.forEach((l) => { s.regions[l.regionId][l.id] = 3; });
  eq(C.nextLevel(s).id, 'E5');
});

/* ------------------------------ 图鉴 ------------------------------ */
test('dishUnlocked 跟随地区与解锁关卡推进', () => {
  const s = blank();
  eq(C.dishUnlocked(s, 'chowmein'), true, '第 1 关的菜默认可见');
  eq(C.dishUnlocked(s, 'dumpling'), false);
  eq(C.dishUnlocked(s, 'milktea'), false);
  eq(C.dishUnlocked(s, 'croissant'), false, '巴黎没解锁');
  s.regions.asia_street.A1 = 3;
  eq(C.dishUnlocked(s, 'dumpling'), true);
  eq(C.dishUnlocked(s, 'milktea'), false);
  s.regions.asia_street.A2 = 3;
  eq(C.dishUnlocked(s, 'milktea'), true);
});

test('collectionCount = 已解锁菜谱 + 见过的顾客 + 已解锁地区', () => {
  const s = blank();
  eq(C.collectionCount(s), 2, '1 地区 + 1 道菜（chowmein）');
  s.stats.seenCustomers.office = 1;
  s.stats.seenCustomers.kid = 1;
  eq(C.collectionCount(s), 4);
  eq(C.collectionTotal(), 28, '15 菜 + 8 顾客 + 5 明信片');
});

test('eggCount 统计已触发的彩蛋', () => {
  const s = blank();
  eq(C.eggCount(s), 0);
  s.easter.globeFired = true;
  eq(C.eggCount(s), 1);
  s.easter.rainbow = true;
  s.easter.penguin = true;
  eq(C.eggCount(s), 3);
});

/* ------------------------------ 星级 ------------------------------ */
/* A1 的三星门槛（第三优先级调过）：服务 7 位 / 收入 150 / 流失 ≤1 且连击 ≥6 */
test('starConditions 逐条给出达成情况与差值', () => {
  const run = { served: 7, coins: 120, tips: 40, lost: 0, maxCombo: 7 };
  const conds = C.starConditions('A1', run);
  eq(conds.length, 3);
  eq(conds[0].key, 'served');
  eq(conds[0].ok, true);
  eq(conds[1].ok, true, '120+40=160 ≥ 150');
  eq(conds[2].ok, true, '流失 0 ≤ 1 且连击 7 ≥ 6');
  eq(conds[1].val, 160, '收入应把订单金币与小费都算上');
  eq(conds[1].goal, 150);
});

test('星级按顺序累加，第二条不达标就停在 1 星', () => {
  eq(C.stars('A1', { served: 7, coins: 40, tips: 10, lost: 0, maxCombo: 9 }), 1, '收入 50 < 150');
  eq(C.stars('A1', { served: 6, coins: 200, tips: 50, lost: 0, maxCombo: 9 }), 0, '服务数不够 → 0 星');
  eq(C.stars('A1', { served: 7, coins: 100, tips: 60, lost: 2, maxCombo: 9 }), 2, '流失 2 > 1 → 2 星');
  eq(C.stars('A1', { served: 7, coins: 100, tips: 60, lost: 0, maxCombo: 5 }), 2, '连击 5 < 6 → 2 星');
  eq(C.stars('A4', { served: 12, coins: 400, tips: 100, lost: 2, maxCombo: 10 }), 3, 'A4 允许流失 2、连击 10');
});

/* ------------------------------ 经验 ------------------------------ */
test('expToNext = levelExpBase × 当前等级', () => {
  eq(C.expToNext(1), 100);
  eq(C.expToNext(3), 300);
});

test('applyExp 逐级扣除，支持连续升级', () => {
  const s = blank();
  const r = C.applyExp(s, 250);
  eq(s.level, 2, '250 - 100 = 150 < 200，只能升到 2 级');
  eq(s.exp, 150);
  eq(r.gained, 1);
  const r2 = C.applyExp(s, 1000);
  eq(s.level, 5, '150+1000 = 1150：还需 200+300+400 = 900，正好升到 5 级');
  eq(s.exp, 250, '1150 - 900 = 250，离 6 级还差 250');
  eq(r2.gained, 3);
});

test('expFor = 每单 3 + 每星 8 + 通关奖励', () => {
  const run = { served: 6, coins: 130, tips: 0, lost: 0, maxCombo: 6 };
  eq(C.expFor('A1', run, 3), 6 * 3 + 3 * 8 + 12, '18 + 24 + 12 = 54');
  eq(C.expFor('A1', run, 1), 18 + 8 + 12, '1 星只给 1 星的星经验');
  eq(C.expFor('A1', run, 0), 18, '0 星没有星经验也没有通关奖励');
});

/* ------------------------------ 结算 ------------------------------ */
test('settle：3 星通关，含通关奖励与首通奖励', () => {
  const s = blank();
  const run = { served: 7, coins: 120, tips: 40, lost: 0, maxCombo: 7, perfect: 7 };
  const r = C.settle({ levelId: 'A1', save: s, run, firstClear: true });
  eq(r.stars, 3);
  eq(r.cleared, true);
  eq(r.coins, 120);
  eq(r.tips, 40);
  eq(r.income, 160);
  eq(r.clearBonus, 40, 'A1 reward.coins = 40');
  eq(r.firstBonus, 80, '首通奖励');
  eq(r.totalGain, 160 + 40 + 80);
  eq(r.exp, 7 * 3 + 3 * 8 + 12, '21 + 24 + 12 = 57');
  eq(r.unlockLevelId, 'A2');
  eq(r.regionName, '亚洲街边摊');
});

test('settle：重玩已通关关卡不再给首通奖励', () => {
  const s = blank();
  const run = { served: 7, coins: 120, tips: 40, lost: 0, maxCombo: 7 };
  const r = C.settle({ levelId: 'A1', save: s, run, firstClear: false });
  eq(r.firstBonus, 0);
  eq(r.clearBonus, 40);
});

test('settle：0 星金币减半，且没有通关奖励', () => {
  const s = blank();
  const run = { served: 1, coins: 40, tips: 10, lost: 3, maxCombo: 1 };
  const r = C.settle({ levelId: 'A1', save: s, run, firstClear: true });
  eq(r.stars, 0);
  eq(r.cleared, false);
  eq(r.halved, true);
  eq(r.coins, 20, '40 × 0.5');
  eq(r.clearBonus, 0);
  eq(r.firstBonus, 0);
  eq(r.totalGain, 30, '20 + 10');
  eq(r.unlockLevelId, null);
});

/* ------------------------------ 指标 ------------------------------ */
test('metrics 汇总所有成就/任务需要的指标', () => {
  const s = blank();
  s.stats.coinsTotal = 1234;
  s.stats.customers = 7;
  s.stats.maxCombo = 9;
  s.daily.metrics.plays = 2;
  const m = C.metrics(s);
  eq(m.coinsTotal, 1234);
  eq(m.customers, 7);
  eq(m.maxCombo, 9);
  eq(m.d_plays, 2);
  eq(m.clears, 0);
  eq(m.collection, 2);
  no(m.eggs === undefined);
  TC.DATA.ACHIEVEMENTS.forEach((a) => {
    no(m[a.metric] === undefined, '成就 ' + a.id + ' 的指标 ' + a.metric + ' 缺失');
  });
});
