/* ==========================================================================
   tests/data.test.js —— 对应模块 TC.DATA（全部静态配置）
   校验 5 地区 / 25 关卡 / 15 菜品 / 45 食材 / 5 顾客 / 25 升级 / 10 成就 / 6 任务 / 3 彩蛋
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, hasKeys, gte, gt, lte } = H;

section('TC.DATA');
const { TC } = loadGame();
const D = TC.DATA;

const COLORS = ['k', 'w', 'y', 'r', 'm'];
const TPLS = ['bowl', 'cup', 'bottle', 'leaf', 'powder', 'ball', 'slab', 'bread', 'coil', 'fan'];

/* ------------------------------ 地区 ------------------------------ */
test('地区共 5 个，order 连续且 id 唯一', () => {
  eq(D.REGIONS.length, 5);
  const ids = D.REGIONS.map((r) => r.id);
  eq(new Set(ids).size, 5, 'id 不能重复');
  eq(D.REGIONS.map((r) => r.order).join(','), '1,2,3,4,5');
});

test('地区解锁星数递增，第一个默认解锁（0 星）', () => {
  const s = D.REGIONS.map((r) => r.unlockStars);
  eq(s[0], 0, '首个地区必须默认解锁');
  for (let i = 1; i < s.length; i++) gt(s[i], s[i - 1], '解锁门槛应递增');
  eq(s.join(','), '0,6,14,22,30');
});

test('每个地区都有 5 关 / 3 道菜 / 3 件装饰 / 明信片 / 配色', () => {
  D.REGIONS.forEach((r) => {
    hasKeys(r, ['id', 'name', 'icon', 'prefix', 'levels', 'dishes', 'decor', 'floor', 'wall', 'priceMul', 'postcard'], r.id);
    eq(r.levels.length, 5, r.id + ' 应有 5 关');
    eq(r.dishes.length, 3, r.id + ' 应有 3 道菜');
    eq(r.decor.length, 3, r.id + ' 应有 3 件装饰');
    eq(r.decorName.length, 3, r.id + ' 装饰名数量对不上');
    [r.floor, r.wall, r.accent].forEach((c) => {
      ok(COLORS.indexOf(c) !== -1, r.id + ' 的配色 ' + c + ' 不在 5 色板内');
    });
    gt(r.priceMul, 0, r.id + ' priceMul 应为正');
  });
});

test('地区前缀唯一，且 levels 与 LEVELS 里的关卡一致', () => {
  const prefixes = D.REGIONS.map((r) => r.prefix);
  eq(new Set(prefixes).size, 5, '前缀不能重复');
  D.REGIONS.forEach((r) => {
    r.levels.forEach((id, i) => {
      eq(id, r.prefix + (i + 1), r.id + ' 关卡编号应连续');
    });
  });
});

test('地区装饰 id 全局唯一', () => {
  const all = D.REGIONS.reduce((a, r) => a.concat(r.decor), []);
  eq(all.length, 15);
  eq(new Set(all).size, 15, '装饰 id 不能重复');
});

/* ------------------------------ 菜品 ------------------------------ */
test('菜品共 15 道，id 唯一，每地区正好 3 道', () => {
  eq(D.DISHES.length, 15);
  eq(new Set(D.DISHES.map((d) => d.id)).size, 15);
  D.REGIONS.forEach((r) => {
    eq(D.dishesOf(r.id).length, 3, r.name + ' 应有 3 道菜');
  });
});

test('每道菜的字段完整且数值合理', () => {
  D.DISHES.forEach((d) => {
    hasKeys(d, ['id', 'regionId', 'name', 'en', 'sprite', 'price', 'tipBase', 'cookTime', 'steps', 'unlockAt'], d.id);
    ok(D.region(d.regionId), d.id + ' 的地区应存在');
    gt(d.price, 0, d.id + ' 价格应为正');
    gt(d.tipBase, 0, d.id + ' 小费基数应为正');
    gt(d.cookTime, 1000, d.id + ' 烹饪时间应大于 1s');
    lte(d.cookTime, 6000, d.id + ' 烹饪时间不该超过 6s（单局 60–120 秒要做得完）');
    ok(d.steps.length >= 3 && d.steps.length <= 4, d.id + ' 备料步骤应为 3–4 步，实际 ' + d.steps.length);
    eq(new Set(d.steps).size, d.steps.length, d.id + ' 同一道菜的步骤不能重复');
    d.steps.forEach((s) => ok(D.ingredient(s), d.id + ' 的步骤 ' + s + ' 找不到对应食材'));
    ok(d.unlockAt >= 1 && d.unlockAt <= 5, d.id + ' 解锁关卡应在 1–5 之间');
    ok(d.sprite && d.sprite.indexOf('dish_') === 0, d.id + ' 的 sprite key 应以 dish_ 开头');
  });
});

test('每个地区第 1/2/3 道菜的解锁关卡分别是 1/2/3', () => {
  D.REGIONS.forEach((r) => {
    D.dishesOf(r.id).forEach((d, i) => {
      eq(d.unlockAt, i + 1, r.id + ' 第 ' + (i + 1) + ' 道菜应在第 ' + (i + 1) + ' 关解锁');
    });
  });
});

/* ------------------------------ 食材 ------------------------------ */
test('食材共 45 种且 id 唯一', () => {
  eq(D.INGREDIENTS.length, 45, '实际 ' + D.INGREDIENTS.length);
  eq(new Set(D.INGREDIENTS.map((i) => i.id)).size, 45);
});

test('每个食材都有合法模板与调色板颜色', () => {
  eq(TPLS.length, 10, '参数化形状应该是 10 种（与 TC.Pixel.SHAPES 一致）');
  D.INGREDIENTS.forEach((i) => {
    hasKeys(i, ['id', 'name', 'regionId', 'art'], i.id);
    ok(D.region(i.regionId), i.id + ' 的地区应存在');
    ok(TPLS.indexOf(i.art.tpl) !== -1, i.id + ' 模板 ' + i.art.tpl + ' 不存在');
    ok(COLORS.indexOf(i.art.c1) !== -1, i.id + ' c1 颜色非法');
    ok(COLORS.indexOf(i.art.c2) !== -1, i.id + ' c2 颜色非法');
  });
});

test('所有菜品的步骤食材都被真正用到，且每个地区食材数 ≥ 8', () => {
  const used = new Set();
  D.DISHES.forEach((d) => d.steps.forEach((s) => used.add(s)));
  eq(used.size, 45, '有食材定义了但没被任何菜用到：' + D.INGREDIENTS.filter((i) => !used.has(i.id)).map((i) => i.id).join(','));
  D.REGIONS.forEach((r) => {
    gte(D.ingredientsOf(r.id).length, 8, r.name + ' 的食材种类偏少');
  });
});

/* ------------------------------ 顾客 ------------------------------ */
test('顾客共 8 种职业（第五优先级），耐心/小费/权重都为正', () => {
  eq(D.CUSTOMERS.length, 8);
  eq(new Set(D.CUSTOMERS.map((c) => c.id)).size, 8);
  eq(new Set(D.CUSTOMERS.map((c) => c.arch)).size, 8, '职业补丁不许重复');
  let totalWeight = 0;
  D.CUSTOMERS.forEach((c) => {
    hasKeys(c, ['id', 'arch', 'name', 'sprite', 'patience', 'tipMul', 'weight'], c.id);
    gt(c.patience, 0, c.id + ' 耐心应为正');
    gt(c.tipMul, 0, c.id + ' 小费倍率应为正');
    gt(c.weight, 0, c.id + ' 权重应为正');
    ok(c.sprite.indexOf('cust_') === 0, c.id + ' sprite 应以 cust_ 开头');
    totalWeight += c.weight;
  });
  eq(totalWeight, 100, '权重合计应为 100，便于理解');
});

test('顾客耐心有梯度：最急 16s、最耐心 40s', () => {
  const arr = D.CUSTOMERS.map((c) => c.patience).sort((a, b) => a - b);
  eq(arr[0], 16000, '快递员最急');
  eq(arr[7], 40000, '老奶奶最耐心');
});

/* ------------------------------ 关卡 ------------------------------ */
test('关卡共 25 个，编号 A1…E5 且唯一', () => {
  eq(D.LEVELS.length, 25);
  eq(new Set(D.LEVELS.map((l) => l.id)).size, 25);
  eq(D.LEVELS[0].id, 'A1');
  eq(D.LEVELS[24].id, 'E5');
  D.REGIONS.forEach((r) => {
    eq(D.levelsOf(r.id).map((l) => l.id).join(','), r.levels.join(','), r.name + ' 关卡列表对不上');
  });
});

test('每关字段完整，难度曲线随关卡递增', () => {
  D.REGIONS.forEach((r) => {
    const lv = D.levelsOf(r.id);
    lv.forEach((l, i) => {
      hasKeys(l, ['id', 'regionId', 'index', 'name', 'duration', 'seats', 'spawnInterval', 'patienceScale', 'dishPool', 'stars', 'reward', 'unlockOnClear'], l.id);
      eq(l.index, i + 1, l.id + ' index 应为 ' + (i + 1));
      eq(l.regionId, r.id);
      gte(l.duration, 60, l.id + ' 时长至少 60s');
      lte(l.duration, 180, l.id + ' 时长不该超过 180s');
      ok(l.seats === 2 || l.seats === 3, l.id + ' 在场顾客应为 2 或 3');
      gte(l.dishPool.length, 1);
      lte(l.dishPool.length, 3);
      l.dishPool.forEach((d) => ok(r.dishes.indexOf(d) !== -1, l.id + ' 的菜品池应属于本地区'));
      hasKeys(l.stars, ['served', 'coins', 'maxLost', 'minCombo'], l.id + '.stars');
      gt(l.stars.coins, 0);
      gt(l.reward.exp, 0);
    });
    // 时长不减、生成变快、耐心变紧
    for (let i = 1; i < 5; i++) {
      gte(lv[i].duration, lv[i - 1].duration, r.name + ' 第' + (i + 1) + '关时长不应变短');
      lte(lv[i].spawnInterval, lv[i - 1].spawnInterval, r.name + ' 第' + (i + 1) + '关生成间隔应变紧');
      lte(lv[i].patienceScale, lv[i - 1].patienceScale, r.name + ' 第' + (i + 1) + '关耐心应更紧');
      gte(lv[i].stars.served, lv[i - 1].stars.served, r.name + ' 第' + (i + 1) + '关目标不应变松');
    }
  });
});

test('关卡 unlockOnClear 串成链，第 5 关为 null（靠星星解锁下一地区）', () => {
  D.REGIONS.forEach((r) => {
    const lv = D.levelsOf(r.id);
    for (let i = 0; i < 4; i++) eq(lv[i].unlockOnClear, lv[i + 1].id);
    eq(lv[4].unlockOnClear, null, r.id + ' 第 5 关不应有下一关');
  });
});

test('关卡金币目标按地区 priceMul 缩放', () => {
  D.REGIONS.forEach((r) => {
    const lv = D.levelsOf(r.id);
    eq(lv[0].stars.coins, Math.round(150 * r.priceMul), r.name + ' 第 1 关金币目标');
    eq(lv[4].stars.coins, Math.round(500 * r.priceMul), r.name + ' 第 5 关金币目标');
  });
});

/* ------------------------------ 升级 ------------------------------ */
test('升级项共 25 项且 id 唯一', () => {
  eq(D.UPGRADES.length, 25, '3 设备 + 16 菜单(15 菜 + 加料台) + 3 装修 + 3 员工 = 25');
  eq(new Set(D.UPGRADES.map((u) => u.id)).size, 25);
});

test('四个标签的项目数符合方案', () => {
  eq(D.UP_TABS.length, 4);
  eq(D.upgradesOf('equipment').length, 3, '厨房设备 3 项');
  eq(D.upgradesOf('decor').length, 3, '餐厅装修 3 项');
  eq(D.upgradesOf('staff').length, 3, '员工雇佣 3 项');
  eq(D.upgradesOf('menu').length, 16, '菜单研发 = 15 道菜 + 加料台');
});

test('每项升级：等级区间合法、cost 长度 = maxLevel、value 长度 = maxLevel + 1', () => {
  D.UPGRADES.forEach((u) => {
    hasKeys(u, ['id', 'tab', 'name', 'icon', 'start', 'maxLevel', 'cost', 'value', 'effect'], u.id);
    ok(u.start >= 0 && u.start < u.maxLevel, u.id + ' start 应在 [0, maxLevel)');
    eq(u.cost.length, u.maxLevel, u.id + ' cost 长度应等于 maxLevel');
    eq(u.value.length, u.maxLevel + 1, u.id + ' value 长度应等于 maxLevel + 1');
    eq(u.effect.length, u.maxLevel - u.start, u.id + ' effect 条数应等于可升级次数');
    for (let L = u.start; L < u.maxLevel; L++) {
      ok(typeof u.cost[L] === 'number' && u.cost[L] > 0, u.id + ' Lv.' + L + ' 的升级花费应为正数');
    }
    for (let L = u.start; L <= u.maxLevel; L++) {
      ok(typeof u.value[L] === 'number', u.id + ' Lv.' + L + ' 应有数值效果');
    }
    if (u.start === 1) eq(u.value[0], null, u.id + ' start=1 时 value[0] 应为 null');
    ok(D.UP_TABS.some((t) => t.id === u.tab), u.id + ' 的 tab 非法');
  });
});

test('每道菜都有一项对应的菜单等级升级，且 start=1 / maxLevel=5', () => {
  D.DISHES.forEach((d) => {
    const u = D.upgrade('menu_' + d.id);
    ok(u, d.id + ' 缺少菜单等级升级');
    eq(u.start, 1);
    eq(u.maxLevel, 5);
    eq(u.dishId, d.id);
    eq(u.regionId, d.regionId);
  });
});

/* ------------------------------ 成就 / 任务 / 彩蛋 / 道具 ------------------------------ */
test('成就共 10 个，条件与奖励完整', () => {
  eq(D.ACHIEVEMENTS.length, 10);
  eq(new Set(D.ACHIEVEMENTS.map((a) => a.id)).size, 10);
  const names = D.ACHIEVEMENTS.map((a) => a.name);
  ['初来乍到', '旅行家', '完美主厨', '收藏家'].forEach((n) => ok(names.indexOf(n) !== -1, '缺少成就「' + n + '」'));
  D.ACHIEVEMENTS.forEach((a) => {
    hasKeys(a, ['id', 'name', 'icon', 'desc', 'metric', 'target', 'reward'], a.id);
    gt(a.target, 0, a.id + ' target 应为正');
    ok(a.metric, a.id + ' 缺少 metric');
  });
});

test('成就引用的 metric 都能在 Calc.metrics 里取到', () => {
  const m = TC.Calc.metrics(TC.Save.blank());
  D.ACHIEVEMENTS.forEach((a) => {
    no(m[a.metric] === undefined, '成就 ' + a.id + ' 引用了不存在的指标 ' + a.metric);
  });
});

test('每日任务池 6 条，指标与今日计数键一致', () => {
  eq(D.DAILY_POOL.length, 6);
  eq(D.DAILY_COUNT, 3);
  D.DAILY_POOL.forEach((t) => {
    hasKeys(t, ['id', 'name', 'metric', 'target', 'reward'], t.id);
    ok(TC.Save.DAILY_METRIC_KEYS.indexOf(t.metric) !== -1, t.id + ' 的 metric ' + t.metric + ' 不是今日计数键');
    gt(t.target, 0);
  });
});

test('彩蛋 3 个，参数符合方案（10 次 / 5 连 / 5 次）', () => {
  eq(D.EASTER.globe.taps, 10);
  eq(D.EASTER.rainbow.perfectStreak, 5);
  eq(D.EASTER.penguin.fridgeTaps, 5);
  eq(D.EASTER.globe.reward.coins, 50);
  eq(D.EASTER.penguin.reward.gems, 1);
});

test('道具 3 个：加速 / 保温 / 上菜，都有冷却', () => {
  eq(D.TOOLS.length, 3);
  eq(D.TOOLS.map((t) => t.id).join(','), 'speed,warm,serve');
  D.TOOLS.forEach((t) => {
    gt(t.cd, 0, t.id + ' 应有冷却');
    ok(t.name && t.icon, t.id + ' 缺少名称或图标');
  });
});

test('CONFIG 参数与方案一致', () => {
  eq(D.CONFIG.saveKey, 'travel-chefs:v2');
  eq(D.CONFIG.saveVersion, 2);
  eq(D.CONFIG.perfectWindow, 0.6);
  eq(D.CONFIG.expPerOrder, 3);
  eq(D.CONFIG.expPerStar, 8);
  eq(D.CONFIG.firstClearCoinBonus, 80);
  eq(D.CONFIG.decorTipBonus, 0.08);
});

/* ------------------------------ 索引与辅助 ------------------------------ */
test('索引函数能按 id 取回对象', () => {
  eq(D.region('asia_street').name, '亚洲街边摊');
  eq(D.dish('chowmein').name, '炒面');
  eq(D.level('C3').regionId, 'ramen_shop');
  eq(D.customer('tourist').tipMul, 1.35);
  eq(D.upgrade('stove_slots').maxLevel, 3);
  eq(D.achievement('egg_hunter').target, 3);
  eq(D.task('d_perfect').reward.gems, 1);
  eq(D.tool('warm').cd, 45);
  eq(D.region('nope'), null);
});

test('maxStars = 75（25 关 × 3 星），最后一个地区门槛 30 ≤ 75', () => {
  eq(D.maxStars(), 75);
  eq(D.totalLevels(), 25);
  lte(D.REGIONS[4].unlockStars, D.maxStars(), '最后一个地区的门槛必须可达');
});
