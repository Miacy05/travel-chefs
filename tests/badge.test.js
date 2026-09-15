/* ==========================================================================
   tests/badge.test.js —— 徽章（普通徽章：每地区 通关 / 困难 各一枚）
   规则都在 TC.Calc 里，这里守的是「数值表 + 判定」两头：
   数据必须自洽（10 枚、id 唯一、挂在真实地区上），判定必须只在"该地区全通"时才给。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, ne, section } = H;

section('徽章');

const { TC } = loadGame();
const D = TC.DATA;
const C = TC.Calc;
const S = TC.Save;

function save() { return S.blank(); }
/** 把某地区的关卡全部打成星星 */
function clearRegion(s, regionId, stars) {
  D.levelsOf(regionId).forEach((lv) => { s.regions[regionId][lv.id] = stars || 2; });
  return s;
}

/* ------------------------------ 数据表 ------------------------------ */
test('徽章表：每地区 2 枚（通关 + 困难），共 10 枚，id 唯一', () => {
  eq(D.BADGES.length, D.REGIONS.length * 2, '徽章总数');
  eq(D.BADGES.length, 10);
  const ids = D.BADGES.map((b) => b.id);
  eq(new Set(ids).size, ids.length, 'id 不能重复');
  eq(ids.filter((id) => /_clear$/.test(id)).length, D.REGIONS.length, '通关徽章数');
  eq(ids.filter((id) => /_hard$/.test(id)).length, D.REGIONS.length, '困难徽章数');
});

test('每个徽章都挂在真实存在的地区上，并且有名字 / 图标 / 类型', () => {
  D.BADGES.forEach((b) => {
    ok(D.region(b.regionId), b.id + ' 的地区不存在：' + b.regionId);
    eq(b.regionId, D.region(b.regionId).id);
    ok(b.name && b.name.length > 0, b.id + ' 缺名字');
    ok(b.icon && b.icon.length > 0, b.id + ' 缺图标');
    eq(['clear', 'hard'].indexOf(b.kind) !== -1, true, b.id + ' 的 kind 非法：' + b.kind);
  });
});

test('D.badge() / D.badgesOf() 能按 id 与地区查到', () => {
  eq(D.badge(D.BADGES[0].id).id, D.BADGES[0].id);
  eq(D.badge('不存在'), null);
  const first = D.REGIONS[0].id;
  eq(D.badgesOf(first).length, 2);
  D.badgesOf(first).forEach((b) => eq(b.regionId, first));
});

/* ------------------------------ 状态判定 ------------------------------ */
test('新存档：所有徽章都未获得，且都给"完成 XX 全部 N 关解锁"的提示', () => {
  const s = save();
  eq(C.badgesObtained(s), 0);
  const rows = C.badgeStates(s);
  eq(rows.length, D.BADGES.length);
  rows.forEach((b) => {
    eq(b.obtained, false, b.id + ' 新档不该已获得');
    ok(b.state === 'locked' || b.state === 'soon', b.id + ' 状态应为 locked/soon，实际 ' + b.state);
  });
  const firstClear = rows[0];
  eq(firstClear.state, 'locked');
  eq(firstClear.progress, 0);
  eq(firstClear.need, 5, '该地区 5 关');
  eq(firstClear.text, '完成 ' + D.region(firstClear.regionId).name + ' 全部 5 关解锁');
});

test('只打通一部分关卡不算获得，进度会跟着涨', () => {
  const s = save();
  const rg = D.REGIONS[0];
  const bid = 'bd_' + rg.id + '_clear';
  s.regions[rg.id][rg.levels[0]] = 3;
  eq(C.regionClearedCount(s, rg.id), 1);
  eq(C.badgeState(s, bid).obtained, false, '只通 1 关不能给徽章');
  eq(C.badgeState(s, bid).progress, 1);

  s.regions[rg.id][rg.levels[1]] = 1;
  eq(C.badgeState(s, bid).progress, 2);
  eq(C.badgeState(s, bid).obtained, false);
});

test('全通一个地区 → 该地区通关徽章到手，其余仍锁着', () => {
  const s = save();
  const rg = D.REGIONS[0];
  clearRegion(s, rg.id);

  const st = C.badgeState(s, 'bd_' + rg.id + '_clear');
  eq(st.obtained, true);
  eq(st.state, 'got');
  eq(st.progress, st.need);
  eq(st.text, rg.tagline, '获得后展示地区格言');
  eq(C.badgesObtained(s), 1, '只该有 1 枚');
  eq(C.isRegionCleared(s, rg.id), true);

  /* 别的地区不受影响 */
  const other = D.REGIONS[1];
  eq(C.badgeState(s, 'bd_' + other.id + '_clear').obtained, false);
});

test('0 星不算通关：全 0 星地区不给徽章', () => {
  const s = save();
  const rg = D.REGIONS[0];
  rg.levels.forEach((lid) => { s.regions[rg.id][lid] = 0; });
  eq(C.isRegionCleared(s, rg.id), false, '0 星不等于通关');
  eq(C.badgeState(s, 'bd_' + rg.id + '_clear').obtained, false);
  eq(C.regionClearedCount(s, rg.id), 0);
});

test('困难徽章保持"未开放"状态（困难模式还没做）', () => {
  const s = save();
  /* 先把所有地区全部打通，困难徽章也不该因此变成已获得 */
  D.REGIONS.forEach((rg) => clearRegion(s, rg.id));
  const hard = D.BADGES.filter((b) => b.kind === 'hard');
  eq(hard.length, 5);
  hard.forEach((b) => {
    const st = C.badgeState(s, b.id);
    eq(st.obtained, false, b.id + ' 困难模式没做就不该发');
    eq(st.state, 'soon');
    eq(st.text, '困难模式开发中');
    eq(st.progress, 0, '未开放的不显示进度，避免错误期待');
  });
  /* 普通徽章则应当全到手 = 5 枚 */
  eq(C.badgesObtained(s), 5);
});

test('徽章不计入"图鉴解锁项"（那是收藏家成就的口径，不能偷偷变容易）', () => {
  const s = save();
  D.REGIONS.forEach((rg) => clearRegion(s, rg.id));
  const before = C.collectionCount(s);
  eq(C.badgesObtained(s), 5, '前提：徽章确实到手了');
  eq(C.collectionCount(s), before, '拿徽章不该改变 collectionCount');
});

test('未知 id / 空存档不炸', () => {
  eq(C.badgeState(save(), '不存在'), null);
  eq(C.badgeState(null, D.BADGES[0].id) === null, false, '空存档也应能算出状态（走兜底）');
  eq(C.isRegionCleared(save(), '不存在'), false);
  eq(C.regionClearedCount(save(), '不存在'), 0);
});
