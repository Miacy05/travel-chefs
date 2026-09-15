/* ==========================================================================
   tests/difficulty.test.js —— 第三优先级：普通关卡难度曲线
   需求是「等待时间 ×2，但三星依然有挑战，不能变成无脑过关」。
   这条需求有两个方向相反的风险，本文件各用一组断言守住：

     ① 调过头 → 三星打不出来（到场人数还不够三星要求的服务量）
     ② 调太松 → 三星白送（门槛低于「随便玩玩」的水平）

   纯数值断言，不依赖任何 DOM。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gt, gte, lte } = H;

section('难度曲线（第三优先级）');
const { TC } = loadGame();
const D = TC.DATA, C = TC.Calc, L = TC.Level, S = TC.Save;

const blank = () => S.blank();

/** 这一关在给定时间内最多能等到几位顾客（每次 tick 最多上门一位） */
function arrivals(levelId, save) {
  const lv = D.level(levelId);
  const interval = C.spawnInterval(levelId, save);
  return Math.floor((lv.duration * 1000) / interval) + 1;   // 第 0 毫秒就有一位
}

/** 最抠门的顾客给的小费（用来算收入下限） */
function minTip(dishId, regionId) {
  let min = Infinity;
  D.CUSTOMERS.forEach((c) => { min = Math.min(min, C.tip(dishId, c.id, regionId, blank())); });
  return min;
}

/* ------------------------------ 等待时间 ×2 ------------------------------ */
test('等待时间倍率是 2，且真的作用在每一关、每一位顾客身上', () => {
  eq(D.CONFIG.patienceMul, 2);
  D.CUSTOMERS.forEach((c) => {
    D.LEVELS.forEach((lv) => {
      const got = C.patience(c.id, lv.id);
      const want = Math.round(c.patience * lv.patienceScale * 2);
      eq(got, want, lv.id + ' 的 ' + c.name + ' 耐心');
      gte(got, Math.round(16000 * 0.8 * 2), '最短的等待也不该低于 25.6s');
    });
  });
});

test('翻倍之后最急的顾客也有 25 秒以上，新手不会被时间逼死', () => {
  let min = Infinity;
  D.LEVELS.forEach((lv) => {
    D.CUSTOMERS.forEach((c) => { min = Math.min(min, C.patience(c.id, lv.id)); });
  });
  gte(min, 25000, '全局最短等待时间');
});

test('困难关卡可以自带更短的等待（同一位顾客压到 55%）', () => {
  const normal = C.patience('office', 'A1');
  const hard = C.patience('office', 'A1', { hard: { patienceMul: 0.55 } });
  gt(normal, hard, '困难模式必须比普通模式更急');
  eq(hard, Math.round(24000 * 1 * 0.55));
});

test('教学局耐心走得极慢（8%），但倍率只作用于消耗速度', () => {
  gt(L.TUTORIAL_PATIENCE_MUL, 0);
  lte(L.TUTORIAL_PATIENCE_MUL, 0.2, '教学局要慢到「来得及看完引导」');
});

/* ------------------------------ 三星可达（别调过头） ------------------------------ */
test('每一关的三星都打得出来：到场人数足够覆盖服务量 + 允许流失', () => {
  D.LEVELS.forEach((lv) => {
    const n = arrivals(lv.id, blank());
    gte(n - lv.stars.maxLost, lv.stars.served,
      lv.id + '（' + lv.name + '）只剩 ' + n + ' 位顾客，达不到三星要求的 ' + lv.stars.served + ' 单');
  });
});

test('服务量门槛留了余量：不用「一单不落地全做完」才给三星', () => {
  D.LEVELS.forEach((lv) => {
    const n = arrivals(lv.id, blank());
    gt(n - lv.stars.served, lv.stars.maxLost,
      lv.id + ' 的服务量门槛贴得太死，等于全场零失误');
  });
});

test('三星的钱门槛够得到：第 1 关零升级就行，后期关卡靠菜单升级补上', () => {
  // 第 1 关是新手关，必须「一点升级都没有」也凑得出三星的钱
  const a1 = D.level('A1');
  const worst = C.sellPrice('chowmein', 'asia_street', blank()) + minTip('chowmein', 'asia_street', blank());
  gte(worst * a1.stars.served, a1.stars.coins, 'A1 零升级就该凑得出三星的钱');

  // 其余关卡允许（也确实应该）依赖升级，但必须有解 —— 不能出现数学上打不到的关卡
  D.LEVELS.filter((lv) => lv.id !== 'A1').forEach((lv) => {
    const save = blank();
    lv.dishPool.forEach((id) => { save.upgrades['menu_' + id] = 5; });
    save.upgrades.spice = 3;
    let best = 0;
    lv.dishPool.forEach((id) => {
      best = Math.max(best, C.sellPrice(id, lv.regionId, save) + C.tip(id, 'office', lv.regionId, save));
    });
    const capacity = best * Math.min(lv.stars.served, arrivals(lv.id, save));
    gte(capacity, lv.stars.coins,
      lv.id + ' 就算菜单升满，单均 ' + best + ' 也够不到 ' + lv.stars.coins + '，三星无解');
  });
});

/* ------------------------------ 三星有挑战（别调太松） ------------------------------ */
test('三星门槛逐关递增：服务量 / 收入 / 连击都不许倒退', () => {
  D.REGIONS.forEach((rg) => {
    const lv = D.levelsOf(rg.id);
    for (let i = 1; i < lv.length; i++) {
      gte(lv[i].stars.served, lv[i - 1].stars.served, rg.name + ' 第 ' + (i + 1) + ' 关服务量倒退了');
      gte(lv[i].stars.coins, lv[i - 1].stars.coins, rg.name + ' 第 ' + (i + 1) + ' 关收入门槛倒退了');
      gte(lv[i].stars.minCombo, lv[i - 1].stars.minCombo, rg.name + ' 第 ' + (i + 1) + ' 关连击门槛倒退了');
      lte(lv[i].patienceScale, lv[i - 1].patienceScale, rg.name + ' 第 ' + (i + 1) + ' 关耐心不该变宽');
      lte(lv[i].spawnInterval, lv[i - 1].spawnInterval, rg.name + ' 第 ' + (i + 1) + ' 关节奏不该变慢');
    }
  });
});

test('五关都咬人：三星至少要求 6 连击，且不允许「全场流失还通关」', () => {
  D.LEVELS.forEach((lv) => {
    gte(lv.stars.minCombo, 6, lv.id + ' 的三星连击门槛太低');
    gte(lv.stars.served, 7, lv.id + ' 的三星服务量门槛太低');
    lte(lv.stars.maxLost, 2, lv.id + ' 允许流失太多了');
  });
});

test('第一关就是最松的一关：后面的关卡不会比它更好过', () => {
  const first = D.level('A1');
  D.LEVELS.forEach((lv) => {
    gte(lv.stars.served, first.stars.served);
    gte(lv.stars.minCombo, first.stars.minCombo);
    gte(lv.reward.coins, 0);
  });
});

/* ------------------------------ 与节奏参数的一致性 ------------------------------ */
test('到场节奏足够密：为了攒出三星的连击，顾客得连续不断地来', () => {
  D.LEVELS.forEach((lv) => {
    const n = arrivals(lv.id, blank());
    gte(n, lv.stars.minCombo, lv.id + ' 到场人数还不到连击门槛，连击根本刷不起来');
  });
});

test('招牌灯箱（减压升级）确实能把节奏拉长', () => {
  const base = C.spawnInterval('A1', blank());
  const save = blank();
  save.upgrades.signboard = 3;
  gt(C.spawnInterval('A1', save), base, '灯箱应该让顾客来得更慢');
});
