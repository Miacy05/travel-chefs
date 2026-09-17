/* ==========================================================================
   tests/codex.test.js —— 图鉴页的二级标签（菜谱 / 顾客 / 徽章 / 明信片）
   覆盖用户提的两个问题：
     1) 图鉴内不能再"所有内容堆在一条长滚动列表里"，必须能按分类切换；
     2) 顶栏中间那句"美食图鉴"要去掉，且不影响金币/钻石与返回按钮。
   另外守住一条容易踩的坑：分类拆开后，DOM 结构不能被别的模块误伤 ——
   例如徽章卡片不能再叫 .book-cell，否则菜谱/顾客的格子计数就串了。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, section, gt, includes } = H;

section('图鉴 · 二级标签');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI, D = TC.DATA, C = TC.Calc, S = TC.Save, U = TC.Util;

if (!UI.ready) TC.boot();

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

function click(el) {
  ok(el, '要点击的元素不存在');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function openBook(save) {
  UI.save = save || S.blank();
  S.checkDaily(UI.save, U.today());
  UI.run = null;
  TC.Router.go('map', { force: true, silent: true });
  UI.onRoute('map', null, {});
  TC.Router.go('codex', { force: true, tab: 'book' });
  return UI.save;
}

/* ------------------------------ 结构 ------------------------------ */
test('图鉴页有四个二级标签：菜谱 / 顾客 / 徽章 / 明信片', () => {
  openBook();
  const bar = $('bookTabs');
  ok(bar, '缺少二级标签栏 #bookTabs');
  const btns = $$('#bookTabs .sub-tab');
  eq(btns.length, 4, '二级标签数');
  eq(btns.map((b) => b.textContent.trim()).join(','), '菜谱,顾客,徽章,明信片');
  eq(btns.map((b) => b.getAttribute('data-subtab')).join(','), 'dish,cust,badge,card');
});

test('四个分类各自渲染到独立面板，不是堆在一条长列表里', () => {
  openBook();
  ['sub-dish', 'sub-cust', 'sub-badge', 'sub-card'].forEach((id) => {
    ok($(id), '缺少面板 #' + id);
  });
  /* 四个面板都在 #panel-book 里（这样"图鉴"总览仍然是一块），
     但同一时刻只有一个 is-active —— 这才是"不堆叠"的判据 */
  eq($$('#panel-book .sub-panel').length, 4);
  eq($$('#panel-book .sub-panel.is-active').length, 1, '同一时刻只应显示一个分类');
});

test('默认停在「菜谱」，只显示菜谱面板', () => {
  openBook();
  eq(UI.bookTab, 'dish');
  ok($('sub-dish').classList.contains('is-active'));
  no($('sub-cust').classList.contains('is-active'));
  no($('sub-badge').classList.contains('is-active'));
  no($('sub-card').classList.contains('is-active'));
});

/* ------------------------------ 切换 ------------------------------ */
test('点二级标签切换分类，一次只显示一个', () => {
  openBook();
  const btns = $$('#bookTabs .sub-tab');
  const pairs = [['cust', 1], ['badge', 2], ['card', 3], ['dish', 0]];

  pairs.forEach(([tab, idx]) => {
    click(btns[idx]);
    eq(UI.bookTab, tab, '点第 ' + idx + ' 个应切到 ' + tab);
    eq($$('#panel-book .sub-panel.is-active').length, 1, '仍应只有一个面板显示');
    ok($('sub-' + tab).classList.contains('is-active'), tab + ' 面板应显示');
    ok(btns[idx].classList.contains('is-active'), '按钮应高亮');
    eq($$('#bookTabs .sub-tab.is-active').length, 1, '只能有一个按钮高亮');
  });
});

test('二级标签栏只在「图鉴」主标签下出现，切到成就/任务就收起', () => {
  openBook();
  const sec = $('view-codex');
  eq(sec.getAttribute('data-codex-tab'), 'book', '主标签为图鉴时应带 data-codex-tab=book');
  UI.setCodexTab('ach');
  eq(sec.getAttribute('data-codex-tab'), 'ach');
  UI.setCodexTab('daily');
  eq(sec.getAttribute('data-codex-tab'), 'daily');
  UI.setCodexTab('book');
  eq(sec.getAttribute('data-codex-tab'), 'book');
});

/* ------------------------------ 各分类的内容 ------------------------------ */
test('菜谱分类：15 道菜；未解锁显示问号与"未解锁"', () => {
  const s = openBook();
  const cells = $$('#sub-dish .book-cell');
  eq(cells.length, D.DISHES.length, '菜谱格子数');
  const locked = $$('#sub-dish .book-cell.is-locked').length;
  eq(locked, D.DISHES.length - C.unlockedDishIds(s).length);
  includes($('sub-dish').textContent, '？？？');
  includes($('sub-dish').textContent, '未解锁');
  includes($('sub-dish').textContent, '菜 谱');
});

test('顾客分类：普通 8 种 + 特殊 4 种；未遇见的画成剪影并标注"未遇见"', () => {
  openBook();
  const cells = $$('#sub-cust .book-cell');
  eq(cells.length, D.CUSTOMERS.length + D.SPECIAL_GUESTS.length, '顾客格子数 = 普通 + 特殊');
  const locked = $$('#sub-cust .book-cell.is-locked').length;
  eq(locked, D.CUSTOMERS.length + D.SPECIAL_GUESTS.length, '新档一位都没遇见');
  includes($('sub-cust').textContent, '未遇见');
  /* 特殊顾客即使没遇见也带金框（is-special） */
  eq($$('#sub-cust .book-cell.is-special').length, D.SPECIAL_GUESTS.length);
});

test('顾客分类：每位顾客都有"胶囊标签"（脾气/身份），未解锁显示"未解锁"', () => {
  openBook();
  const pills = $$('#sub-cust .book-cell .bc-pill');
  eq(pills.length, D.CUSTOMERS.length + D.SPECIAL_GUESTS.length, '普通 + 特殊顾客都要有胶囊标签');
  let locked = 0;
  pills.forEach(function (p) { if (p.textContent.indexOf('未解锁') >= 0) locked++; });
  eq(locked, D.CUSTOMERS.length + D.SPECIAL_GUESTS.length, '新档里所有顾客都还没遇见 → 都标未解锁');
  /* 解锁后：普通顾客显示脾气标签，特殊顾客显示「神秘来客」标签 */
  const s = UI.save;
  D.CUSTOMERS.forEach(function (c) { s.stats.seenCustomers[c.id] = 1; });
  D.SPECIAL_GUESTS.forEach(function (g) { s.stats.seenCustomers[g.id] = 1; });
  UI.renderBookCust();
  const pills2 = $$('#sub-cust .book-cell .bc-pill');
  eq(pills2.filter(function (p) { return p.textContent.indexOf('未解锁') >= 0; }).length, 0, '遇见后不该再标未解锁');
  includes($('sub-cust').textContent, D.CUSTOMERS[0].note, '普通顾客应显示脾气标签');
  includes($('sub-cust').textContent, '神秘来客', '特殊顾客应显示神秘来客标签');
  /* 复原 */
  s.stats.seenCustomers = {};
  UI.renderBookCust();
});

test('顾客分类：特殊顾客带金色边框类名，遇见过才点亮', () => {
  const s = openBook();
  const cells = $$('#sub-cust .book-cell');
  const firstGuest = D.SPECIAL_GUESTS[0];
  // 没遇见：金框 + 灰显
  const idx = D.CUSTOMERS.length;   // 特殊顾客排在普通顾客之后
  ok(cells[idx].classList.contains('is-special'), '特殊顾客应带 is-special（金色边框）');
  ok(cells[idx].classList.contains('is-locked'), '没遇见过应灰显');
  // 遇见过：点亮（去掉 is-locked）
  s.stats.seenCustomers[firstGuest.id] = 1;
  UI.renderBookCust();
  const cells2 = $$('#sub-cust .book-cell');
  ok(cells2[idx].classList.contains('is-special'));
  no(cells2[idx].classList.contains('is-locked'), '遇见过就不该灰显');
  /* 复原 */
  delete s.stats.seenCustomers[firstGuest.id];
  UI.renderBookCust();
});

test('徽章分类：10 枚徽章；未获得显示问号 + 解锁条件', () => {
  const s = openBook();
  const cells = $$('#sub-badge .badge-cell');
  eq(cells.length, D.BADGES.length, '徽章格子数');
  eq($$('#sub-badge .badge-cell.is-got').length, C.badgesObtained(s));
  eq($$('#sub-badge .badge-cell.is-locked').length, D.BADGES.length - C.badgesObtained(s), '未获得的都灰显');
  includes($('sub-badge').textContent, '先通关', '困难徽章应提示先通关普通');
  includes($('sub-badge').textContent, '全部 5 关解锁');
  includes($('sub-badge').textContent, '徽 章');
});

test('徽章分类：全通一个地区后，对应徽章变金色已获得', () => {
  const s = S.blank();
  S.checkDaily(s, U.today());
  const rg = D.REGIONS[0];
  D.levelsOf(rg.id).forEach((lv) => { s.regions[rg.id][lv.id] = 3; });
  openBook(s);
  eq($$('#sub-badge .badge-cell.is-got').length, 1, '应恰好有 1 枚到手');
  includes($('sub-badge').textContent, rg.name, '到手后应直接写出徽章名');
  includes($('sub-badge').textContent, '1 / 10');
});

test('明信片分类：5 张，未解锁显示问号', () => {
  const s = openBook();
  eq($$('#sub-card .postcard').length, D.REGIONS.length);
  eq($$('#sub-card .postcard.is-locked').length, D.REGIONS.length - C.unlockedRegionIds(s).length);
  includes($('sub-card').textContent, '旅 行 明 信 片');
});

test('明信片大图：未解锁地区点不开，已解锁地区开全屏深色弹窗（且清掉残留淡出态）', () => {
  const s = openBook();
  const rg1 = D.REGIONS[0];
  const rg2 = D.REGIONS[1];
  eq(C.isRegionUnlocked(s, rg1.id), true, '第 1 区默认解锁');
  eq(C.isRegionUnlocked(s, rg2.id), false, '第 2 区需星数，新档未开');

  /* 没解锁：点下去只弹提示，大图弹窗不开 */
  const r2 = UI.tapPostcard(rg2.id);
  eq(r2, false, '没解锁不该打开大图');
  eq(UI.isModalOpen('modalPostcard'), false, '弹窗应保持关闭');

  /* 已解锁：打开全屏弹窗，并清掉残留的 is-closing（保证是淡入而非淡出） */
  $('modalPostcard').classList.add('is-closing');
  const r1 = UI.tapPostcard(rg1.id);
  eq(r1, true, '已解锁能打开大图');
  eq(UI.isModalOpen('modalPostcard'), true, '弹窗应打开');
  eq($('modalPostcard').classList.contains('is-closing'), false, '打开时要清掉淡出态');
  UI.closeModal('modalPostcard');
});

/* ------------------------------ 不能串味 ------------------------------ */
test('徽章卡片不叫 .book-cell，否则菜谱/顾客的计数会串', () => {
  openBook();
  eq($$('#sub-badge .book-cell').length, 0, '徽章卡片必须用独立类名');
  eq($$('#panel-book .book-cell').length, D.DISHES.length + D.CUSTOMERS.length + D.SPECIAL_GUESTS.length,
    '图鉴总book-cell 数应仍等于 菜谱 + 普通顾客 + 特殊顾客');
});

/* ------------------------------ 顶栏标题 ------------------------------ */
test('顶栏中间的"美食图鉴"已经去掉，且金币/钻石/返回按钮都还在', () => {
  openBook();
  const center = $('tbCenter');
  ok(center, '缺少顶栏中间容器');
  eq(center.textContent.trim(), '', '顶栏中间应当是空的');
  eq(center.innerHTML, '', '顶栏中间不该留残留节点');

  ok($('tbCoins'), '金币还在');
  ok($('tbGems'), '钻石还在');
  const act = $('tbAction');
  ok(act, '右上角操作按钮还在');
  eq(UI._action, 'back', '图鉴页右上角应该是返回');
  eq(act.textContent, '‹', '返回按钮应当是 ‹');
  eq(act.hidden, false, '返回按钮不该被隐藏');

  /* 切回地图页时，顶栏文案要能恢复 —— 说明只是"这一页不写"，不是把能力删了 */
  TC.Router.go('map', { force: true });
  eq($('tbCenter').textContent.trim(), 'Travel Chefs');
});

test('路由表里 codex 的顶栏配置就是"中间留空 + 返回"', () => {
  const t = TC.Router.topbarFor('codex');
  eq(t.center, '');
  eq(t.action, 'back');
});
