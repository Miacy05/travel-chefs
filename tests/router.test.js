/* ==========================================================================
   tests/router.test.js —— 对应模块 TC.Router（视图路由）
   阶段 0 验收：路由能切到 5 个页面
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, includes } = H;

section('TC.Router');
const G = loadGame();

test('boot 未抛异常', () => {
  eq(G.TC.bootError, null, 'bootError 应为 null');
});

test('index.html 加载期没有 JS 异常', () => {
  eq(G.errors.length, 0, '加载时出现异常：' + G.errors.map((e) => e && e.message).join(' | '));
  ok(G.TC.VERSION, 'TC 命名空间应带版本号');
  ['Util', 'DATA', 'Calc', 'Save', 'Upgrade', 'Level', 'Daily', 'Easter', 'Ach', 'Router']
    .forEach((m) => ok(G.TC[m], '缺少模块 TC.' + m));
});

test('页面上存在 5 个 [data-view] 视图容器', () => {
  const views = G.TC.Router.scan();
  const names = Object.keys(views).sort();
  eq(names.length, 5, '应有 5 个视图');
  ['map', 'levels', 'cook', 'result', 'codex'].forEach((n) => {
    ok(views[n], '缺少视图 ' + n);
  });
});

test('scan() 返回的每个视图都是真实 DOM 元素', () => {
  const views = G.TC.Router.scan();
  Object.keys(views).forEach((n) => {
    ok(views[n].nodeType === 1, n + ' 不是元素节点');
  });
});

test('R.list() 给出 5 个页面且顺序符合方案', () => {
  eq(G.TC.Router.list().join(','), 'map,levels,cook,result,codex');
});

test('初始位于世界地图页，且只有它是 is-active', () => {
  const R = G.TC.Router;
  R.go('map', { silent: true });
  eq(R.current, 'map');
  const active = G.document.querySelectorAll('.view.is-active');
  eq(active.length, 1, '同时只能有 1 个 active 视图');
  eq(active[0].getAttribute('data-view'), 'map');
});

test('依次切到 5 个页面，每次都只有目标页 active', () => {
  const R = G.TC.Router;
  R.list().forEach((name) => {
    ok(R.go(name), '切到 ' + name + ' 应成功');
    eq(R.current, name, 'current 应为 ' + name);
    const active = G.document.querySelectorAll('.view.is-active');
    eq(active.length, 1, name + '：active 视图数应为 1');
    eq(active[0].getAttribute('data-view'), name, name + '：active 的应是它自己');
  });
});

test('切换到不存在的视图返回 false 且不改变当前页', () => {
  const R = G.TC.Router;
  R.go('map', { silent: true });
  eq(R.go('nope'), false);
  eq(R.current, 'map');
});

test('重复切到同一页返回 true（幂等）', () => {
  const R = G.TC.Router;
  R.go('codex', { silent: true });
  eq(R.go('codex'), true);
  eq(R.current, 'codex');
});

test('onChange 能在切换时收到 (新页, 旧页)', () => {
  const R = G.TC.Router;
  R.go('map', { silent: true });
  const seen = [];
  const fn = (n, p) => seen.push([n, p]);
  R.onChange(fn);
  R.go('cook');
  R.go('result');
  eq(JSON.stringify(seen), JSON.stringify([['cook', 'map'], ['result', 'cook']]));
  R._onChange = R._onChange.filter((f) => f !== fn); // 清理，避免影响后续用例
});

test('silent 选项不触发 onChange', () => {
  const R = G.TC.Router;
  const seen = [];
  const fn = (n) => seen.push(n);
  R.onChange(fn);
  R.go('map', { silent: true });
  R.go('levels', { silent: true });
  eq(seen.length, 0, 'silent 时不应回调');
  R._onChange = R._onChange.filter((f) => f !== fn);
});

test('back() 回到上一页，无历史时回到 map', () => {
  const R = G.TC.Router;
  R.go('map', { silent: true });
  R.prev = null;
  eq(R.back(), true);
  eq(R.current, 'map');

  R.go('levels', { silent: true });
  R.go('cook', { silent: true });
  eq(R.back(), true);
  eq(R.current, 'levels');
});

test('顶栏策略：5 个页面都有独立的 action', () => {
  const R = G.TC.Router;
  eq(R.topbarFor('map').action, 'gear');
  eq(R.topbarFor('levels').action, 'back');
  eq(R.topbarFor('cook').action, 'pause');
  eq(R.topbarFor('result').action, 'none');
  eq(R.topbarFor('codex').action, 'back');
});

test('底部导航只在世界地图页显示', () => {
  const R = G.TC.Router;
  eq(R.navVisibleFor('map'), true);
  ['levels', 'cook', 'result', 'codex'].forEach((n) => {
    eq(R.navVisibleFor(n), false, n + ' 不应显示底部导航');
  });
});

test('页面骨架包含方案要求的 5 个页面容器 id', () => {
  ['view-map', 'view-cook', 'view-result', 'view-codex'].forEach((id) => {
    ok(G.document.getElementById(id), '缺少 #' + id);
  });
  ok(G.document.getElementById('modalUpgrade'), '缺少升级弹窗 #modalUpgrade');
  ok(G.document.getElementById('scene'), '缺少厨房场景 canvas #scene');
  ok(G.document.getElementById('regionList'), '缺少地区列表容器');
  ok(G.document.getElementById('pantryBand'), '缺少备料台容器');
  ok(G.document.getElementById('toolBar'), '缺少道具栏容器');
  ok(G.document.getElementById('globe'), '缺少地球仪（彩蛋 1 触发点）');
});

test('底部导航 3 个标签 + 1 个开始营业按钮都在', () => {
  const nav = G.document.getElementById('bottomnav');
  const tabs = nav.querySelectorAll('[data-nav="codex"]');
  eq(tabs.length, 3, '应有 图鉴/成就/任务 3 个导航');
  ok(nav.querySelector('#btnStart'), '缺少「开始营业」主按钮');
  includes(tabs[2].getAttribute('data-tab'), 'daily', '第 3 个导航应指向每日任务');
});

test('顶部有金币 / 钻石两个数值位', () => {
  ok(G.document.querySelector('[data-bind="coins"]'), '缺少金币位');
  ok(G.document.querySelector('[data-bind="gems"]'), '缺少钻石位');
});
