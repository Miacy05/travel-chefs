/* ==========================================================================
   tests/hard.test.js —— 对应第四优先级「困难模式 / 挑战关卡」
   覆盖：解锁判定 hardUnlocked、困难星级独立存储、L.create 的困难修正
        （耐心更短 / 上客更密 / 可选菜更多）、灶台随机故障、结算写独立星级、
        困难徽章真实判定。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, section, gt, gte, lte, lt, includes } = H;

section('TC · 困难模式');
const G = loadGame();
const { TC, document, window } = G;
const L = TC.Level;
const S = TC.Save;
const C = TC.Calc;
const D = TC.DATA;
const U = TC.Util;
const UI = TC.UI;

const zrand = () => 0;
const blank = () => S.blank();

function mk(levelId, save, opts) {
  return L.create(save || blank(), levelId, Object.assign({ rand: zrand, firstSpawn: 0, skipGuest: true }, opts || {}));
}

/** 把某地区的普通关卡全部打通（每关至少 1 星） */
function clearRegion(s, regionId, stars) {
  D.levelsOf(regionId).forEach((lv) => { s.regions[regionId][lv.id] = stars || 2; });
  return s;
}

/* ------------------------------ 解锁判定 ------------------------------ */

test('hardUnlocked：普通 5 关全通才解锁挑战模式', () => {
  const s = blank();
  const rg = D.REGIONS[0];
  eq(C.hardUnlocked(s, rg.id), false, '没通关不解锁');
  D.levelsOf(rg.id).forEach((lv, i) => {
    if (i < 4) s.regions[rg.id][lv.id] = 2;   // 只通 4 关
  });
  eq(C.hardUnlocked(s, rg.id), false, '缺 1 关不解锁');
  s.regions[rg.id][D.levelsOf(rg.id)[4].id] = 2;
  eq(C.hardUnlocked(s, rg.id), true, '5 关全通解锁');
});

test('hardUnlocked：0 星不算通关', () => {
  const s = blank();
  const rg = D.REGIONS[0];
  D.levelsOf(rg.id).forEach((lv) => { s.regions[rg.id][lv.id] = 0; });
  eq(C.hardUnlocked(s, rg.id), false);
});

/* ------------------------------ 困难星级独立存储 ------------------------------ */

test('setHardStars / hardStars：困难星级独立于普通星级', () => {
  const s = blank();
  const lid = 'A1';
  S.setHardStars(s, lid, 3);
  eq(C.hardStars(s, lid), 3);
  eq(C.levelStars(s, lid), 0, '普通星级不受影响');
  eq(s.regions[D.region('asia_street').id][lid] || 0, 0);
});

test('setHardStars：只升不降', () => {
  const s = blank();
  S.setHardStars(s, 'A1', 2);
  S.setHardStars(s, 'A1', 1);
  eq(C.hardStars(s, 'A1'), 2, '困难星级不降级');
});

test('hardClearedCount：统计该地区困难通关数', () => {
  const s = blank();
  const rg = D.REGIONS[0];
  eq(C.hardClearedCount(s, rg.id), 0);
  S.setHardStars(s, rg.levels[0], 3);
  S.setHardStars(s, rg.levels[1], 1);
  eq(C.hardClearedCount(s, rg.id), 2);
});

/* ------------------------------ 困难修正 ------------------------------ */

test('L.create(hard:true)：上客更密、可选菜更多、挂上 hard 修正', () => {
  const s = blank();
  const normal = mk('A1', s);
  const hard = mk('A1', s, { hard: true });

  eq(normal.hard, null, '普通关 hard 为空');
  ok(hard.hard, '困难关应挂 hard 修正');
  eq(hard.hard.patienceMul, D.CONFIG.hard.patienceMul);
  lt(hard.spawnInterval, normal.spawnInterval, '困难关顾客来得更勤');
  gte(hard.spawnInterval, 2000, '但不能密到离谱');
  gte(hard.level.dishPool.length, normal.level.dishPool.length, '困难关可选菜不少于普通关');
});

test('C.patience：困难关耐心 = 基础 × scale × hard.patienceMul（比普通关短）', () => {
  const s = blank();
  const hard = mk('A1', s, { hard: true });
  const cid = 'office';   // 基础耐心 24000
  const expected = Math.round(24000 * 1.0 * hard.hard.patienceMul);
  eq(C.patience(cid, 'A1', hard), expected);
  // 普通关耐心 = 24000 × 1.0 × 2（CONFIG.patienceMul），困难关要明显更短
  const normalPat = C.patience(cid, 'A1', null);
  lt(C.patience(cid, 'A1', hard), normalPat, '困难关耐心必须比普通关短');
});

/* ------------------------------ 灶台故障 ------------------------------ */

test('困难关灶台会随机故障：烹饪进度回退、有冷却保护', () => {
  const s = blank();
  const run = mk('A1', s, { hard: true, rand: () => 0.0000001 }); // 每次 rand() 都 < breakChance*dt
  // 手动放一口正在煮、已煮了一半的锅（cookTotal 8000，剩 4000）
  const d = D.dish('chowmein');
  run.pots[0] = { dishId: 'chowmein', steps: d.steps.slice(), done: d.steps.slice(), state: 'cooking', cookLeft: 4000, cookTotal: 8000 };
  const before = run.pots[0].cookLeft;
  const ev = L.tick(run, 16);
  ok(run.breakers.length > 0, '应记录一次故障');
  ok(run.pots[0].cookLeft > before, '烹饪进度应回退（cookLeft 变大）');
  ok(ev.some((e) => e.type === 'breaker'), '应抛出 breaker 事件');
  eq(run.breakCd, run.hard.breakCooldownMs, '故障后进入冷却');
});

test('普通关灶台不会故障', () => {
  const s = blank();
  const run = mk('A1', s, { rand: () => 0.0000001 });
  const d = D.dish('chowmein');
  run.pots[0] = { dishId: 'chowmein', steps: d.steps.slice(), done: d.steps.slice(), state: 'cooking', cookLeft: 8000, cookTotal: 8000 };
  L.tick(run, 16);
  eq(run.breakers.length, 0, '普通关不该有故障');
  eq(run.pots[0].cookLeft, 8000 - 16, '普通关照常推进');
});

/* ------------------------------ 结算与徽章 ------------------------------ */

test('L.finish：困难关写独立星级、不解锁下一关', () => {
  const s = blank();
  clearRegion(s, 'asia_street');   // 普通全通（每关 2 星），解锁困难模式
  const run = mk('A1', s, { hard: true });
  run.served = 7; run.coins = 200; run.tips = 50; run.maxCombo = 8; run.lost = 0;
  const res = L.finish(s, run);
  ok(res.cleared, '7 单 / 250 收入 / 0 流失 8 连击应通关');
  eq(C.hardStars(s, 'A1'), res.stars, '困难星级应写入 save.hard');
  eq(C.levelStars(s, 'A1'), 2, '普通星级不被困难局覆盖（保持原来的 2 星）');
  eq(res.unlockedLevelId, null, '困难局不解锁下一关');
});

test('困难徽章：困难全通才发（不再"开发中"）', () => {
  const s = blank();
  const rg = D.REGIONS[0];
  const hardId = 'bd_' + rg.id + '_hard';
  clearRegion(s, rg.id);   // 普通全通 → 解锁资格
  let st = C.badgeState(s, hardId);
  eq(st.obtained, false, '只通普通不发困难徽章');
  eq(st.state, 'locked');
  // 困难全通
  rg.levels.forEach((lid) => S.setHardStars(s, lid, 3));
  st = C.badgeState(s, hardId);
  eq(st.obtained, true);
  eq(st.state, 'got');
});

/* ------------------------------ UI：挑战模式入口 ------------------------------ */

test('地区关卡列表：普通全通后出现「挑战模式」入口', () => {
  const s = S.blank();
  S.checkDaily(s, U.today());
  UI.save = s;
  UI.renderLevels('asia_street');
  const before = document.querySelectorAll('#levelList [data-hard]').length;
  eq(before, 0, '没全通时不该有挑战入口');
  // 全通
  clearRegion(s, 'asia_street');
  UI.renderLevels('asia_street');
  const entry = document.querySelector('#levelList [data-hard]');
  ok(entry, '全通后应出现挑战模式入口');
  includes(entry.textContent, '挑战模式');
});
