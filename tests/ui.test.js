/* ==========================================================================
   tests/ui.test.js —— 对应模块 TC.UI（页面渲染 + 事件翻译）
   做法：把真实 index.html 塞进 jsdom，派发真实点击事件，
        断言「DOM 渲染对不对」+「点击后有没有正确调用逻辑层」。
   注意：TC.UI 自己不算规则，所以这里的断言都是「渲染结果是否忠实反映存档」。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, ne, no, section, gt, gte, includes, includesNot } = H;

section('TC.UI');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI;

// jsdom 里 DOMContentLoaded 可能晚于 loadGame() 返回，这里确保一定已经启动（boot 是幂等的）
if (!UI.ready) TC.boot();

/* ------------------------------ 测试用工具 ------------------------------ */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

/** 把存档换成干净的一份，并把界面退回地图页 */
function reset(over) {
  UI.save = TC.Save.blank();
  if (over) TC.Util.assign(UI.save, over);
  TC.Save.checkDaily(UI.save, TC.Util.today());
  UI.run = null;
  UI.regionId = null;
  TC.Router.go('map', { force: true, silent: true });
  TC.UI.onRoute('map', null, {});
  return UI.save;
}

function click(el) {
  ok(el, '要点击的元素不存在');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** 给某关写上星级（存档结构是 地区 → 关卡 → 星数） */
function setStars(save, regionId, levelId, n) {
  save.regions[regionId][levelId] = n;
  return save;
}

/** 顶栏金币 / 钻石的数字节点 */
const coinTxt = () => $('tbCoins').querySelector('b').textContent;
const gemTxt = () => $('tbGems').querySelector('b').textContent;

/* ------------------------------ 启动 ------------------------------ */
test('index.html 在 jsdom 里能正常启动，没有 boot 报错', () => {
  eq(TC.bootError, null, 'boot 抛异常了：' + (TC.bootError && TC.bootError.message));
  ok(UI.ready, 'UI.init 没有执行');
  ok(UI.save, 'UI 没有拿到存档');
  ok(TC.Router.current, 'boot 后应停在某个视图上');
});

test('启动后加载遮罩被关掉', () => {
  eq($('boot').getAttribute('data-off'), '1');
  ok($('boot').classList.contains('is-off'));
});

test('初始存档是一份完整可用的 v2 存档', () => {
  const s = reset();
  eq(s.version, 2);
  eq(s.coins, 0);
  eq(s.level, 1);
  eq(Object.keys(s.upgrades).length, TC.DATA.UPGRADES.length);
});

/* ------------------------------ 页面 1 · 世界地图 ------------------------------ */
test('地图页统计条反映存档：通关数 / 星数 / 等级', () => {
  const s = reset();
  eq($('mapCleared').textContent, '0');
  eq($('mapStars').textContent, '0');
  eq($('mapLevel').textContent, '1');

  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 2;
  s.level = 4;
  UI.renderMap();

  eq($('mapCleared').textContent, '2', '通关 2 关');
  eq($('mapStars').textContent, '5', '3 + 2 = 5 星');
  eq($('mapLevel').textContent, '4');
});

test('5 个地区全部渲染成卡片，只有第一个默认解锁', () => {
  reset();
  const cards = $$('#regionList .region-card');
  eq(cards.length, 5);
  eq(cards.filter((c) => !c.classList.contains('is-locked')).length, 1, '默认只解锁亚洲街边摊');
  eq(cards[0].getAttribute('data-region'), 'asia_street');
  includes(cards[0].textContent, '亚洲街边摊');
  includes(cards[0].textContent, '炒面');
});

test('未解锁地区显示锁图标 + 还差多少星', () => {
  reset();
  const paris = $$('#regionList .region-card')[1];
  ok(paris.classList.contains('is-locked'), '巴黎应该还锁着');
  includes(paris.textContent, '🔒');
  includes(paris.textContent, '还差 6 ★', '巴黎门槛 6 星，0 星时还差 6');
  eq(paris.getAttribute('data-region'), 'paris_cafe');
});

test('已解锁地区的星级槽按「已通关关卡数」点亮', () => {
  const s = reset();
  let card = $$('#regionList .region-card')[0];
  eq(card.querySelectorAll('.rc-stars .st').length, 5, '一个地区 5 关 → 5 个星槽');
  eq(card.querySelectorAll('.rc-stars .st.on').length, 0);

  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 1;
  UI.renderMap();
  card = $$('#regionList .region-card')[0];
  eq(card.querySelectorAll('.rc-stars .st.on').length, 2, '通关 2 关 → 亮 2 颗');
  includes(card.textContent, '2 / 5 关');
  includes(card.textContent, '4 / 15 ★');
});

test('集齐星数后地区自动解锁（解锁规则来自 TC.Calc，不由 UI 决定）', () => {
  const s = reset();
  s.regions.asia_street.A1 = 3;
  s.regions.asia_street.A2 = 3;   // 共 6 星 = 巴黎门槛
  UI.renderMap();
  const paris = $$('#regionList .region-card')[1];
  no(paris.classList.contains('is-locked'), '6 星后巴黎应解锁');
  eq(TC.Calc.isRegionUnlocked(s, 'paris_cafe'), true);
});

test('顶栏金币 / 钻石跟着存档走', () => {
  const s = reset({ coins: 1280, gems: 3 });
  UI.updateTopbar('map');
  eq(coinTxt(), '1280');
  eq(gemTxt(), '3');
});

/* ------------------------------ 彩蛋 1 · 地球仪 ------------------------------ */
test('地球仪点 9 次不触发，第 10 次给 50 金币并计数清零', () => {
  const s = reset();
  eq($('globeTaps').textContent, '0');
  no($('globeTaps').classList.contains('is-on'), '0 次时角标不显示');

  for (let i = 1; i <= 9; i++) {
    const res = UI.tapGlobe();
    eq(res.fired, false, '第 ' + i + ' 次不该触发');
    eq(s.easter.globe, i);
  }
  eq($('globeTaps').textContent, '9');
  ok($('globeTaps').classList.contains('is-on'), '有计数时角标应显示');

  const tenth = UI.tapGlobe();
  eq(tenth.fired, true, '第 10 次触发彩蛋 1');
  eq(s.coins, 50, '彩蛋 1 奖励 50 金币');
  eq(s.easter.globe, 0, '触发后计数清零');
  eq(s.easter.globeFired, true);
  eq($('globeTaps').textContent, '0');
  ne($('mapFoot').textContent.indexOf('厨 房'), -1, '触发后底部文案应变化');
});

test('彩蛋 1 每天只给一次：同一天再点 10 次不加金币，并弹提示', () => {
  const s = reset();
  for (let i = 0; i < 10; i++) UI.tapGlobe();
  eq(s.coins, 50);

  const host = $('toastHost');
  const before = host.querySelectorAll('.toast').length;
  for (let i = 0; i < 10; i++) {
    const res = UI.tapGlobe();
    eq(res.locked, true, '今天已触发过，应处于锁定态');
    eq(res.fired, false, '同一天不该再触发');
  }
  eq(s.coins, 50, '同一天内拿不到第二份（原来能无限刷）');
  eq($('globeTaps').textContent, '0', '锁住后角标保持 0');

  const all = host.querySelectorAll('.toast');
  gt(all.length - before, 0, '点下去应该给个提示，而不是毫无反应');
  includes(all[all.length - 1].textContent, '明天', '提示要告诉玩家明天再来');
});

test('地球仪点击写进存档（刷新不丢）', () => {
  const s = reset();
  UI.tapGlobe();
  UI.tapGlobe();
  const reloaded = TC.Save.load();
  eq(reloaded.easter.globe, 2, '点击计数应已落盘');
  eq(reloaded.easter.globeDay, TC.Util.today(), '计数所属的日期也应落盘');
});

/* ------------------------------ 地区跳转 ------------------------------ */
test('点未解锁地区：不跳转 + 卡片抖动 + 给出提示', () => {
  reset();
  TC.Router.go('map', { force: true, silent: true });
  const paris = $$('#regionList .region-card')[1];
  click(paris.querySelector('.rc-name'));

  eq(TC.Router.current, 'map', '不该跳转');
  ok(paris.classList.contains('is-shake'), '卡片应抖动');
  gt($$('#toastHost .toast').length, 0, '应给出提示');
  includes($$('#toastHost .toast').pop().textContent, '还差 6 ★');
});

test('点已解锁地区：进关卡页并渲染地区头', () => {
  reset();
  const asia = $$('#regionList .region-card')[0];
  click(asia.querySelector('.rc-name'));

  eq(TC.Router.current, 'levels');
  eq(UI.regionId, 'asia_street');
  includes($('regionHead').textContent, '亚洲街边摊');
  includes($('regionHead').textContent, '一口锅，一条街');
  includes($('tbCenter').textContent, '亚洲街边摊', '顶栏中间显示地区名');
});

test('切到关卡页时底部导航隐藏，顶栏出现返回键', () => {
  reset();
  eq($('bottomnav').hidden, false, '地图页显示底部导航');

  UI.regionId = 'asia_street';
  TC.Router.go('levels', { silent: true });
  TC.UI.onRoute('levels', 'map', {});
  eq($('bottomnav').hidden, true, '关卡页隐藏底部导航');
  eq($('tbAction').textContent, '‹', '关卡页顶栏是返回键');
  eq($('tbAction').hidden, false);

  TC.Router.go('map', { force: true, silent: true });
  TC.UI.onRoute('map', 'levels', {});
  eq($('bottomnav').hidden, false);
  eq($('tbAction').textContent, '⚙', '地图页顶栏是设置键');
});

/* ------------------------------ 关卡选择 ------------------------------ */
test('关卡页渲染 5 行，且只解锁第 1 关', () => {
  const s = reset();
  TC.Router.go('levels', { silent: true });
  UI.regionId = 'asia_street';
  UI.renderLevels('asia_street');

  const rows = $$('#levelList .level-row');
  eq(rows.length, 5);
  eq(rows[0].getAttribute('data-level'), 'A1');
  no(rows[0].classList.contains('is-locked'), '第 1 关默认开放');
  for (let i = 1; i < 5; i++) ok(rows[i].classList.contains('is-locked'), 'A' + (i + 1) + ' 应还锁着');
  includes(rows[0].textContent, '夜市开张');
  eq(s.regions.A1, undefined);
});

test('通关上一关后下一关自动开放（解锁规则来自 TC.Calc）', () => {
  const s = reset();
  s.regions.asia_street.A1 = 3;
  UI.renderLevels('asia_street');
  const rows = $$('#levelList .level-row');
  no(rows[1].classList.contains('is-locked'), 'A1 通关后 A2 应开放');
  ok(rows[2].classList.contains('is-locked'), 'A3 仍然锁着');
  includes(rows[0].textContent, '重玩', '已通关的关卡按钮变「重玩」');
  includes(rows[1].textContent, '开始');
});

test('点锁着的关卡：提示且不跳转', () => {
  reset();
  UI.regionId = 'asia_street';
  TC.Router.go('levels', { force: true });       // 非 silent，会自动渲染
  const rows = $$('#levelList .level-row');
  const before = TC.Router.current;
  click(rows[2]);
  eq(TC.Router.current, before, '不该切走');
  eq(TC.Router.current, 'levels');
  includes($$('#toastHost .toast').pop().textContent, '还锁着');
});

test('阶段 3：点「开始营业」直接开一局并进入经营页', () => {
  reset();
  ok(UI.canPlay(), '有了 Canvas 舞台就该能开营业');

  const r = UI.openNextLevel();
  eq(r, true);
  eq(TC.Router.current, 'cook', '切到经营页');
  ok(UI.run, 'TC.Level.create 建出了一局');
  eq(UI.run.levelId, 'A1', '「开始营业」落在当前该打的那一关');
  eq(UI.run.pots.length, TC.Calc.stoveSlots(UI.save), '锅位数来自 Calc.stoveSlots');
  ok($('view-cook').classList.contains('is-active'));
  ok($('view-map').classList.contains('is-active') === false);
  eq($('bottomnav').hidden, true, '经营页隐藏底部导航');
  ok($('orderCard'), '订单卡存在');
  ok($('pantryBand'), '食材台存在');
  ok($('toolBar'), '道具备用栏存在');

  TC.Scene.stop();          // 别把 rAF 循环留给后面的用例
  UI.run = null;
});

/* ------------------------------ 底部导航 + 图鉴 ------------------------------ */
test('底部导航三个按钮都切到 codex 并落到对应标签', () => {
  const s = reset();
  const nav = $$('#bottomnav .nav-btn');
  eq(nav.length, 3);

  click(nav[1]);                      // 成就
  eq(TC.Router.current, 'codex');
  eq(UI.codexTab, 'ach');
  ok($('panel-ach').classList.contains('is-active'));
  no($('panel-book').classList.contains('is-active'));
  eq($('bottomnav').hidden, true, 'codex 页隐藏底部导航');

  TC.Router.go('map', { force: true, silent: true });
  click($$('#bottomnav .nav-btn')[2]);  // 每日任务
  eq(UI.codexTab, 'daily');
  ok($('panel-daily').classList.contains('is-active'));
  eq(s.level, 1);
});

test('codex 页内联的标签也能切换', () => {
  reset();
  TC.Router.go('codex', { silent: true });
  TC.UI.onRoute('codex', 'map', { tab: 'book' });
  const tabs = $$('#codexTabs .tab');
  eq(tabs.length, 3);
  click(tabs[2]);
  eq(UI.codexTab, 'daily');
  ok($('panel-daily').classList.contains('is-active'));
  ok(tabs[2].classList.contains('is-active'));
  no(tabs[0].classList.contains('is-active'));
});

test('角标显示成就完成数与可领任务数，为 0 时隐藏', () => {
  const s = reset();
  let b = UI.refreshBadges();
  eq(b.ach, 0);
  eq(b.daily, 0);
  eq($('achBadge').hidden, true);
  eq($('dailyBadge').hidden, true);

  s.achievements.first_step = '2026-09-15T00:00:00Z';
  b = UI.refreshBadges();
  eq(b.ach, 1);
  eq($('achBadge').hidden, false);
  eq($('achBadge').textContent, '1');
});

/* ------------------------------ 设置弹窗 ------------------------------ */
test('设置弹窗能开、能关，并渲染两项设置', () => {
  reset();
  UI.openSettings();
  eq($('modalSettings').hidden, false);
  includes($('setList').textContent, '音效');
  includes($('setList').textContent, '震动');
  eq($('setList').querySelector('[data-set="reset"]'), null, '重置存档入口应已移除');
  eq(TC.Save.clear, undefined, '底层 clear 也不该再暴露');

  click($('modalSettings').querySelector('.x'));
  eq($('modalSettings').hidden, true, '点 ✕ 应关闭');
});

test('音效 / 震动开关能切换并写档', () => {
  const s = reset();
  UI.openSettings();
  eq(s.settings.sound, true);

  click($('setList').querySelector('[data-set="sound"]'));
  eq(s.settings.sound, false);
  includes($('setList').textContent, '已关闭');
  eq(TC.Save.load().settings.sound, false, '应立即落盘');

  click($('setList').querySelector('[data-set="sound"]'));
  eq(s.settings.sound, true);

  click($('setList').querySelector('[data-set="vibrate"]'));
  eq(s.settings.vibrate, false);
});

/* ------------------------------ 提示 / 弹窗基础设施 ------------------------------ */
test('toast 插入提示层并能被清掉', () => {
  const host = $('toastHost');
  const before = host.querySelectorAll('.toast').length;
  const n = UI.toast('测试提示');
  eq(host.querySelectorAll('.toast').length, before + 1);
  eq(n.textContent, '测试提示');
  if (n.parentNode) n.parentNode.removeChild(n);
  eq(host.querySelectorAll('.toast').length, before);
});

test('dialog 只有点确定才执行回调', () => {
  let hit = 0;
  UI.dialog({ title: 'T', body: 'B', onYes: () => { hit++; } });
  click($('dlgNo'));
  eq(hit, 0, '取消不该触发');
  UI.dialog({ title: 'T', body: 'B', onYes: () => { hit++; } });
  click($('dlgYes'));
  eq(hit, 1);
});

test('弹窗开关状态可查询', () => {
  eq(UI.isModalOpen('modalUpgrade'), false);
  UI.openModal('modalUpgrade');
  eq(UI.isModalOpen('modalUpgrade'), true);
  UI.closeModal('modalUpgrade');
  eq(UI.isModalOpen('modalUpgrade'), false);
});

/* ------------------------------ 安全与健壮性 ------------------------------ */
test('地区名走 textContent / 转义，不会被当成 HTML 注入', () => {
  const s = reset();
  const rg = TC.DATA.region('asia_street');
  const backup = rg.name;
  rg.name = '<img src=x onerror=1>';
  try {
    UI.renderMap();
    const card = $$('#regionList .region-card')[0];
    eq(card.querySelectorAll('img').length, 0, '不该出现注入进去的标签');
    includes(card.textContent, '<img src=x onerror=1>', '应该原样当文字显示');
  } finally {
    rg.name = backup;
  }
  eq(s.level, 1);
});

test('给不存在的地区 / 关卡 id 不会崩', () => {
  reset();
  eq(UI.openRegion('ghost'), false);
  eq(UI.openLevel('Z9'), false);
  eq(UI.openRegion(null), false);
  eq(UI.openLevel(undefined), false);
  eq(TC.Router.current, 'map');
});

test('暂停 / 放弃在没有对局时是安全的空操作', () => {
  reset();
  eq(UI.openPause(), false);
  eq(UI.quitRun(), false);
  eq($('overlayPause').classList.contains('is-on'), false);
});

test('一次完整走查：拿星 → 解锁 → 进地区 → 关卡对外开放', () => {
  const s = reset();
  // 手动写 6 星（模拟打了两关 3 星）
  setStars(s, 'asia_street', 'A1', 3);
  setStars(s, 'asia_street', 'A2', 3);
  UI.renderMap();

  click($$('#regionList .region-card')[1].querySelector('.rc-name'));   // 点巴黎
  eq(TC.Router.current, 'levels');
  eq(UI.regionId, 'paris_cafe');
  includes($('regionHead').textContent, '巴黎咖啡馆');

  const rows = $$('#levelList .level-row');
  eq(rows.length, 5);
  no(rows[0].classList.contains('is-locked'), 'B1 应该直接可玩');
  includes(rows[0].textContent, '可颂');

  // 回地图再确认统计
  TC.Router.go('map', { force: true, silent: true });
  TC.UI.onRoute('map', 'levels', {});
  eq($('mapStars').textContent, '6');
  eq($('bottomnav').hidden, false);
});
