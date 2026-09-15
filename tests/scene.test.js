/* ==========================================================================
   tests/scene.test.js —— 对应模块 TC.Scene（Canvas 像素车间）
   重点测**纯函数**：布局 / 坐标换算 / 命中检测 / 落点判定。
   这几个函数不碰 DOM 也不碰 canvas，所以「点没点中」这件事可以 100% 断言；
   draw() 用一个假 2D 上下文跑，只验证「画了东西、没抛异常、没画到画布外」。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, ne, section, gt, gte, lte, includes } = H;

section('TC.Scene');

const G = loadGame();
const { TC, document, window } = G;
const SC = TC.Scene;
const D = TC.DATA, L = TC.Level, S = TC.Save, U = TC.Util, P = TC.Pixel;

/** 逻辑画布尺寸（Scene 的坐标系就是它） */
const LUT_W = 160, LUT_H = 90;

/** 开一局用于布局（自带 pots / region / plates） */
function makeRun(levelId, upgrades) {
  const save = S.blank();
  if (upgrades) U.assign(save.upgrades, upgrades);
  return L.create(save, levelId || 'A1', { rand: U.seededBy('scene-test'), firstSpawn: 0 });
}

/** 假 2D 上下文：把每次绘制都记下来 */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() { calls.push({ op: 'save' }); },
    restore() { calls.push({ op: 'restore' }); },
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    scale(x, y) { calls.push({ op: 'scale', x, y }); },
    setTransform() { calls.push({ op: 'setTransform' }); },
    clearRect() { calls.push({ op: 'clearRect' }); },
    fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h, color: ctx.fillStyle }); },
  };
  return ctx;
}

/* ============================== 常量 ============================== */
test('逻辑画布固定 160×90，锅与盘子都是 16×16，出餐台 3 个位', () => {
  eq(SC.LUT.w, 160);
  eq(SC.LUT.h, 90);
  eq(SC.POT, 16);
  eq(SC.PLATE, 16);
  eq(SC.PLATE_SLOTS, 3);
  eq(SC.WALL_Y, 28);
});

test('四个功能区都完整落在 160×90 之内（不会画到画布外）', () => {
  ['register', 'fridge', 'stove', 'counter'].forEach((k) => {
    const r = SC.STATIONS[k];
    ok(r, k + ' 应存在');
    gte(r.x, 0, k + ' 左边界');
    gte(r.y, 0, k + ' 上边界');
    lte(r.x + r.w, LUT_W, k + ' 右边界');
    lte(r.y + r.h, LUT_H, k + ' 下边界');
    gt(r.w, 0);
    gt(r.h, 0);
  });
});

/* ============================== 布局 ============================== */
test('layout：正好 2 倍时铺满、无留白（320×180）', () => {
  const lay = SC.layout(320, 180, makeRun());
  eq(lay.scale, 2);
  eq(lay.ox, 0);
  eq(lay.oy, 0);
  eq(lay.w, 320);
  eq(lay.h, 180);
});

test('layout：比例不整除时取整数倍并居中留白（400×300 → scale 2, 偏移 40/60）', () => {
  const lay = SC.layout(400, 300, makeRun());
  eq(lay.scale, Math.floor(Math.min(400 / 160, 300 / 90)));
  eq(lay.scale, 2, '缩放倍数必须取整，像素才不会被拉花');
  eq(lay.ox, (400 - 160 * 2) / 2);
  eq(lay.oy, (300 - 90 * 2) / 2);
  eq(lay.ox, 40);
  eq(lay.oy, 60);
  eq(lay.scale % 1, 0);
});

test('layout：容器比逻辑画布还小时，倍数夹到最小 1', () => {
  const lay = SC.layout(100, 50, makeRun());
  eq(lay.scale, 1);
  eq(lay.ox, Math.floor((100 - LUT_W) / 2));
  eq(lay.oy, Math.floor((50 - LUT_H) / 2));
});

test('layout：非法尺寸不会崩（0 / 负数 / undefined / NaN）', () => {
  [0, -5, undefined, null, NaN].forEach((v) => {
    const lay = SC.layout(v, v, makeRun());
    gte(lay.w, 1);
    gte(lay.h, 1);
    gte(lay.scale, 1);
  });
});

test('layout：锅位数跟着 run.pots 走，且始终居中排在灶台里', () => {
  const run2 = makeRun('A1');                       // 默认 2 个锅
  const lay2 = SC.layout(320, 180, run2);
  eq(run2.pots.length, 2);
  eq(lay2.pots.length, run2.pots.length);

  const run3 = makeRun('A1', { stove_slots: 2 });    // 升级「灶台工位」→ 3 个锅
  const lay3 = SC.layout(320, 180, run3);
  eq(run3.pots.length, 3);
  eq(lay3.pots.length, 3);

  const st = SC.STATIONS.stove;
  lay3.pots.forEach((p, i) => {
    eq(p.index, i);
    eq(p.w, SC.POT);
    eq(p.h, SC.POT);
    gte(p.x, st.x, '锅不能超出灶台左边');
    lte(p.x + p.w, st.x + st.w, '锅不能超出灶台右边');
    gte(p.y, st.y);
    lte(p.y + p.h, st.y + st.h);
  });
  for (let i = 1; i < lay3.pots.length; i++) {
    gte(lay3.pots[i].x, lay3.pots[i - 1].x + lay3.pots[i - 1].w, '锅位不能重叠');
  }
  const first = lay3.pots[0], last = lay3.pots[lay3.pots.length - 1];
  lte(Math.abs((first.x - st.x) - ((st.x + st.w) - (last.x + last.w))), 1, '锅位应水平居中');
});

test('layout：出餐台固定 3 个盘子位，尺寸正确且互不重叠', () => {
  const lay = SC.layout(320, 180, makeRun());
  eq(lay.plates.length, SC.PLATE_SLOTS);
  const cn = SC.STATIONS.counter;
  lay.plates.forEach((p, i) => {
    eq(p.index, i);
    eq(p.w, SC.PLATE);
    eq(p.h, SC.PLATE);
    gte(p.x, cn.x);
    lte(p.x + p.w, cn.x + cn.w);
    gte(p.y, cn.y);
    lte(p.y + p.h, cn.y + cn.h);
  });
  for (let i = 1; i < lay.plates.length; i++) {
    gte(lay.plates[i].x, lay.plates[i - 1].x + lay.plates[i - 1].w);
  }
});

test('layout：墙上装饰按地区走，位置等距且不越界（5 个地区都一样）', () => {
  D.REGIONS.forEach((rg) => {
    const run = makeRun(rg.prefix + '1');
    const lay = SC.layout(320, 180, run);
    eq(lay.decor.length, 3, rg.id + ' 应有 3 件装饰');
    lay.decor.forEach((d, i) => {
      eq(d.index, i);
      eq(d.id, run.region.decor[i]);
      eq(d.x, SC.DECOR.x0 + i * SC.DECOR.step);
      eq(d.w, SC.DECOR.w);
      eq(d.h, SC.DECOR.h);
      gte(d.x, 0);
      lte(d.x + d.w, LUT_W, rg.id + ' 的第 ' + i + ' 件装饰超出右边界');
    });
  });
});

test('layout：返回的是快照，改它不会污染 SC.STATIONS 常量', () => {
  const a = SC.layout(320, 180, makeRun());
  a.stations.fridge.x = 999;
  const b = SC.layout(320, 180, makeRun());
  ne(b.stations.fridge.x, 999);
  eq(b.stations.fridge.x, SC.STATIONS.fridge.x);
});

/* ============================== 坐标换算 ============================== */
test('toScreen / toLut：互为逆运算（含留白偏移）', () => {
  const lay = SC.layout(400, 300, makeRun());        // scale 2, ox 40, oy 60
  [[0, 0], [1, 1], [80, 45], [159, 89], [37, 12]].forEach(([lx, ly]) => {
    const s = SC.toScreen(lay, lx, ly);
    eq(s.x, lay.ox + lx * lay.scale);
    eq(s.y, lay.oy + ly * lay.scale);
    const back = SC.toLut(lay, s.x, s.y);
    eq(back.x, lx);
    eq(back.y, ly);
  });
});

test('toScreen：逻辑原点落在留白偏移处，不是画布左上角', () => {
  const o = SC.toScreen(SC.layout(400, 300, makeRun()), 0, 0);
  eq(o.x, 40);
  eq(o.y, 60);
});

/* ============================== 命中检测 ============================== */
test('hit：点冰箱 → fridge', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  const r = SC.STATIONS.fridge;
  const h = SC.hit(run, lay, r.x + r.w / 2, r.y + r.h / 2);
  ok(h, '应该命中');
  eq(h.kind, 'fridge');
});

test('hit：点各口锅 → pot + 正确的 index', () => {
  const run = makeRun('A1', { stove_slots: 2 });
  const lay = SC.layout(320, 180, run);
  eq(lay.pots.length, 3);
  lay.pots.forEach((p, i) => {
    const h = SC.hit(run, lay, p.x + p.w / 2, p.y + p.h / 2);
    ok(h, '第 ' + i + ' 口锅应该命中');
    eq(h.kind, 'pot');
    eq(h.index, i);
  });
});

test('hit：点收银台 → register', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  const r = SC.STATIONS.register;
  const h = SC.hit(run, lay, r.x + 2, r.y + 2);
  ok(h);
  eq(h.kind, 'register');
});

test('hit：点出餐台 → counter 并带上盘子序号', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  // 出餐台上要有菜，plateIndex 才有意义
  run.plates.push({
    dishId: D.DISHES[0].id, name: D.DISHES[0].name, sprite: D.DISHES[0].sprite,
    lifeMax: 1000, lifeLeft: 1000, cookTotal: 1000, perfectWindow: 600, since: 0,
  }, {
    dishId: D.DISHES[1].id, name: D.DISHES[1].name, sprite: D.DISHES[1].sprite,
    lifeMax: 1000, lifeLeft: 1000, cookTotal: 1000, perfectWindow: 600, since: 0,
  });
  const p = lay.plates[1];
  const h = SC.hit(run, lay, p.x + p.w / 2, p.y + p.h / 2);
  ok(h);
  eq(h.kind, 'counter');
  eq(h.plateIndex, 1);
});

test('hit：出餐台没菜时 plateIndex 是 -1（UI 当作「空台」处理）', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  const p = lay.plates[0];
  const h = SC.hit(run, lay, p.x + 1, p.y + 1);
  eq(h.kind, 'counter');
  eq(h.plateIndex, -1);
});

test('hit：点地板空白 → null', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  eq(SC.hit(run, lay, 80, 88), null);
  eq(SC.hit(run, lay, 1, 89), null);
});

test('hit：边界按「左闭右开」，相邻区域不会算重', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  const pots = lay.pots;
  eq(SC.hit(run, lay, pots[0].x, pots[0].y).kind, 'pot', '左上角算命中（左闭）');
  eq(SC.hit(run, lay, pots[0].x + pots[0].w, pots[0].y), null, '右边界不算（右开）');
  eq(SC.hit(run, lay, pots[pots.length - 1].x + pots[pots.length - 1].w, pots[0].y), null);
  // 灶台与出餐台之间的空档
  eq(SC.hit(run, lay, 105, 60), null);
  eq(SC.hit(run, lay, 106, 60).kind, 'counter', '出餐台左边界算命中');
});

test('hit：没有 layout 时安全返回 null', () => {
  eq(SC.hit(makeRun(), null, 10, 10), null);
  eq(SC.hitScreen(makeRun(), null, 10, 10), null);
});

test('hitScreen：屏幕坐标会先换算回逻辑坐标再判定', () => {
  const run = makeRun();
  D.DISHES.slice(0, 3).forEach((d) => {
    run.plates.push({
      dishId: d.id, name: d.name, sprite: d.sprite,
      lifeMax: 1000, lifeLeft: 1000, cookTotal: 1000, perfectWindow: 600, since: 0,
    });
  });
  const lay = SC.layout(400, 300, run);              // ox 40, oy 60, scale 2
  const p = lay.plates[2];
  const s = SC.toScreen(lay, p.x + p.w / 2, p.y + p.h / 2);
  const h = SC.hitScreen(run, lay, s.x, s.y);
  ok(h);
  eq(h.kind, 'counter');
  eq(h.plateIndex, 2);
});

test('plateAt：出餐台上没菜时返回 -1', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  eq(run.plates.length, 0);
  eq(SC.plateAt(run, lay, lay.plates[0].x + 2, lay.plates[0].y + 2), -1);
});

test('plateAt：有菜时返回对应盘子序号', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  run.plates.push({
    dishId: D.DISHES[0].id, name: 'x', sprite: D.DISHES[0].sprite,
    lifeMax: 1000, lifeLeft: 1000, cookTotal: 1000, perfectWindow: 600, since: 0,
  });
  const p = lay.plates[0];
  eq(SC.plateAt(run, lay, p.x + 2, p.y + 2), 0);
});

test('plateAt：盘子位比菜多时越界安全（不会读到 undefined 崩掉）', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  run.plates.push({
    dishId: D.DISHES[0].id, sprite: D.DISHES[0].sprite,
    lifeMax: 1000, lifeLeft: 1000, cookTotal: 1000, perfectWindow: 600, since: 0,
  });
  const p = lay.plates[2];                           // 第 3 个位子：run.plates[2] 不存在
  eq(SC.plateAt(run, lay, p.x + 2, p.y + 2), -1);
});

/* ============================== 顾客落点 ============================== */
test('customerAt：点在谁的矩形里就返回谁的 uid', () => {
  const rects = [
    { uid: 'a', x: 0, y: 0, w: 50, h: 100 },
    { uid: 'b', x: 60, y: 0, w: 50, h: 100 },
    { uid: 'c', x: 120, y: 0, w: 50, h: 100 },
  ];
  eq(SC.customerAt(rects, 25, 50), 'a');
  eq(SC.customerAt(rects, 85, 50), 'b');
  eq(SC.customerAt(rects, 145, 50), 'c');
});

test('customerAt：点在所有顾客之外 → null', () => {
  const rects = [{ uid: 'a', x: 0, y: 0, w: 50, h: 100 }];
  eq(SC.customerAt(rects, 51, 50), null);
  eq(SC.customerAt(rects, 25, 101), null);
  eq(SC.customerAt(rects, -1, 50), null);
});

test('customerAt：矩形重叠时以最后一个为准（后画的在上层）', () => {
  const rects = [
    { uid: 'under', x: 0, y: 0, w: 100, h: 100 },
    { uid: 'over', x: 20, y: 20, w: 40, h: 40 },
  ];
  eq(SC.customerAt(rects, 30, 30), 'over');
  eq(SC.customerAt(rects, 5, 5), 'under');
});

test('customerAt：空表 / null / 缺字段都安全', () => {
  eq(SC.customerAt([], 1, 1), null);
  eq(SC.customerAt(null, 1, 1), null);
  eq(SC.customerAt(undefined, 1, 1), null);
  eq(SC.customerAt([null, undefined], 1, 1), null);
});

/* ============================== 绘制 ============================== */
test('draw：正常画一帧会真的调用绘制接口，并返回画了几组东西', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  const ctx = fakeCtx();
  const n = SC.draw(ctx, run, lay, 0);
  gt(n, 0, '至少画了墙地 + 收银台 + 冰箱 + 灶台 + 出餐台');
  gt(ctx.calls.filter((c) => c.op === 'fillRect').length, 20, '绘制调用次数应该不少');
  eq(ctx.calls.filter((c) => c.op === 'save').length,
     ctx.calls.filter((c) => c.op === 'restore').length,
     'save / restore 必须配对，否则上下文状态会漏出去');
});

test('draw：缺少 ctx / run / lay 时安静返回 0，不抛异常', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  eq(SC.draw(null, run, lay, 0), 0);
  eq(SC.draw(fakeCtx(), null, lay, 0), 0);
  eq(SC.draw(fakeCtx(), run, null, 0), 0);
});

test('draw：三种锅状态（备料 / 烹饪中 / 已出锅）全都画得出来', () => {
  const run = makeRun('A1', { stove_slots: 2 });     // 3 个锅位
  const d0 = D.DISHES[0];
  run.pots = [
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(0, 1), state: 'prep', cookLeft: 0, cookTotal: 3000, readyAt: 0 },
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(), state: 'cooking', cookLeft: 1500, cookTotal: 3000, readyAt: 0 },
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(), state: 'ready', cookLeft: 0, cookTotal: 2000, readyAt: 100 },
  ];
  run.plates = [{
    dishId: d0.id, name: d0.name, sprite: d0.sprite,
    lifeMax: 1000, lifeLeft: 800, cookTotal: 3000, perfectWindow: 1800, since: 0,
  }];
  const lay = SC.layout(320, 180, run);
  eq(lay.pots.length, 3);
  const ctx = fakeCtx();
  gt(SC.draw(ctx, run, lay, 3), 0);
  gt(ctx.calls.filter((c) => c.op === 'fillRect').length, 20);
});

test('draw：所有绘制都落在 160×90 逻辑画布内（第 1 次铺满留白的底色除外）', () => {
  const run = makeRun('A1', { stove_slots: 2 });
  const d0 = D.DISHES[0];
  run.customers = [{ uid: 'c1', id: 'office', name: '上班族', sprite: 'cust_office', dishId: d0.id, patienceMax: 20000, patienceLeft: 20000, state: 'waiting', bornAt: 0 }];
  run.selected = 'c1';
  run.pots = [
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(0, 1), state: 'prep', cookLeft: 0, cookTotal: 3000, readyAt: 0 },
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(), state: 'cooking', cookLeft: 1500, cookTotal: 3000, readyAt: 0 },
    { dishId: d0.id, steps: d0.steps.slice(), done: d0.steps.slice(), state: 'ready', cookLeft: 0, cookTotal: 2000, readyAt: 100 },
    null,
  ];
  run.plates = [
    { dishId: d0.id, name: d0.name, sprite: d0.sprite, lifeMax: 1000, lifeLeft: 800, cookTotal: 3000, perfectWindow: 1800, since: 0 },
    { dishId: d0.id, name: d0.name, sprite: d0.sprite, lifeMax: 1000, lifeLeft: 200, cookTotal: 3000, perfectWindow: 1800, since: 0 },
  ];
  const lay = SC.layout(320, 180, run);
  eq(lay.pots.length, 4);
  const ctx = fakeCtx();
  gt(SC.draw(ctx, run, lay, 3), 0);

  const fills = ctx.calls.filter((c) => c.op === 'fillRect');
  // 第 1 个 fillRect 是铺满整块画布（屏幕坐标）的留白底色，之后全部是逻辑坐标
  fills.slice(1).forEach((c, i) => {
    // 所有绘制参数必须是有限数：一旦写出 pot.h 这种不存在的字段，
    // 真实 canvas 会静默画不出来（NaN），这类 bug 必须在这里被抓住
    [c.x, c.y, c.w, c.h].forEach((v) => {
      ok(typeof v === 'number' && isFinite(v),
        '第 ' + (i + 2) + ' 次绘制的坐标不是有限数：' + JSON.stringify(c));
    });
    gt(c.w, 0, '第 ' + (i + 2) + ' 次绘制宽度应为正：' + JSON.stringify(c));
    gt(c.h, 0, '第 ' + (i + 2) + ' 次绘制高度应为正：' + JSON.stringify(c));
    gte(c.x, 0, '第 ' + (i + 2) + ' 次绘制 x 越界：' + JSON.stringify(c));
    gte(c.y, 0, '第 ' + (i + 2) + ' 次绘制 y 越界：' + JSON.stringify(c));
    lte(c.x + c.w, LUT_W, '第 ' + (i + 2) + ' 次绘制右边越界：' + JSON.stringify(c));
    lte(c.y + c.h, LUT_H, '第 ' + (i + 2) + ' 次绘制下边越界：' + JSON.stringify(c));
  });
});

test('draw：用到的颜色全部来自 5 色板（不会漏出线稿占位色 / 纯黑）', () => {
  const run = makeRun();
  const ctx = fakeCtx();
  SC.draw(ctx, run, SC.layout(320, 180, run), 1);
  const legal = Object.keys(P.PALETTE).map((k) => P.PALETTE[k]);
  eq(legal.length, 5, '色板只有 5 色');
  ctx.calls.filter((c) => c.op === 'fillRect').forEach((c) => {
    ok(c.color === '' || legal.indexOf(c.color) !== -1,
      '出现了色板外的颜色：' + c.color);
  });
});

test('draw：5 个地区的地面 / 墙面配色都合法且画得出来', () => {
  D.REGIONS.forEach((rg) => {
    ok(P.PALETTE[rg.wall], rg.id + ' 的 wall 色号非法：' + rg.wall);
    ok(P.PALETTE[rg.floor], rg.id + ' 的 floor 色号非法：' + rg.floor);
    ok(P.PALETTE[rg.accent], rg.id + ' 的 accent 色号非法：' + rg.accent);
    const run = makeRun(rg.prefix + '1');
    gt(SC.draw(fakeCtx(), run, SC.layout(320, 180, run), 0), 0, rg.id + ' 画不出来');
  });
});

test('draw：留白区下半段用地板色延续（否则地板下方会露出一条墙色横带）', () => {
  D.REGIONS.forEach((rg) => {
    const run = makeRun(rg.prefix + '1');
    const lay = SC.layout(340, 400, run);        // 比例不整除 → scale 2 + 上下留白
    const bandY = lay.oy + LUT_H * lay.scale;
    gt(lay.oy, 0, rg.id + '：这个尺寸本该有上留白');
    gt(lay.h - bandY, 0, rg.id + '：这个尺寸本该有下留白');

    const ctx = fakeCtx();
    SC.draw(ctx, run, lay, 0);

    const wall = P.PALETTE[rg.wall];
    const floor = P.PALETTE[rg.floor];
    // 变换之前画的都是屏幕坐标（缩放留白区），变换之后的才是 160×90 逻辑坐标
    const ti = ctx.calls.findIndex((c) => c.op === 'translate');
    gt(ti, 0, '应当先画留白再 translate');
    const screen = ctx.calls.slice(0, ti).filter((c) => c.op === 'fillRect');
    const lut = ctx.calls.slice(ti).filter((c) => c.op === 'fillRect');
    gt(lut.length, 0, '逻辑区应有绘制');

    const wallIdx = screen.findIndex(
      (c) => c.color === wall && c.w === lay.w && c.h === lay.h && c.y === 0);
    const floorIdx = screen.findIndex(
      (c) => c.color === floor && c.w === lay.w && c.y === bandY && c.h === lay.h - bandY);
    gte(wallIdx, 0, rg.id + '：应先用墙色把整块画布铺满');
    gte(floorIdx, 0, rg.id + '：下留白必须用地板色（' + rg.floor + '）铺满，实际没有');
    gt(floorIdx, wallIdx, rg.id + '：地板色要画在墙色之后才盖得住');

    // 留白区（屏幕坐标）不能画到画布外
    screen.forEach((c) => {
      gte(c.x, 0, rg.id + ' 留白越界左：' + JSON.stringify(c));
      gte(c.y, 0, rg.id + ' 留白越界上：' + JSON.stringify(c));
      lte(c.x + c.w, lay.w, rg.id + ' 留白越界右：' + JSON.stringify(c));
      lte(c.y + c.h, lay.h, rg.id + ' 留白越界下：' + JSON.stringify(c));
      ok(isFinite(c.x + c.y + c.w + c.h), rg.id + ' 留白坐标非有限数');
    });
    // 逻辑区仍然只能落在 160×90 之内
    lut.forEach((c) => {
      gte(c.x, 0);
      gte(c.y, 0);
      lte(c.x + c.w, LUT_W, rg.id + ' 逻辑区越界右：' + JSON.stringify(c));
      lte(c.y + c.h, LUT_H, rg.id + ' 逻辑区越界下：' + JSON.stringify(c));
    });
  });
});

test('draw：正好铺满（无留白）时不画下留白，也不多铺一层', () => {
  const run = makeRun();
  const lay = SC.layout(320, 180, run);
  eq(lay.oy, 0);
  const ctx = fakeCtx();
  SC.draw(ctx, run, lay, 0);
  const ti = ctx.calls.findIndex((c) => c.op === 'translate');
  const screen = ctx.calls.slice(0, ti).filter((c) => c.op === 'fillRect');
  eq(screen.length, 1, '无留白时屏幕坐标只应有 1 次「铺满底色」的绘制');
  eq(screen[0].w, lay.w);
  eq(screen[0].h, lay.h);
});

/* ============================== 循环 ============================== */
test('resize：能拿到画布尺寸并同步到 canvas.width/height', () => {
  const size = SC.resize();
  ok(size, 'resize 应返回尺寸对象');
  gt(size.w, 0);
  gt(size.h, 0);
  const cv = document.getElementById('scene');
  eq(cv.width, size.w);
  eq(cv.height, size.h);
});

test('jsdom 没有 2D 上下文时 render() 安静返回 false，绝不抛异常', () => {
  const run = makeRun();
  SC.start(run, { loop: false });
  eq(SC.run(), run);
  eq(SC.isRunning(), true);
  eq(SC.render(), false, '拿不到 2d 上下文就不画');
  SC.stop();
  eq(SC.isRunning(), false);
});

test('start(opts.loop=false)：不排 rAF，方便单测手动 step 保持确定性', () => {
  eq(typeof window.requestAnimationFrame, 'function', 'jsdom 本身有 rAF，但 Scene 不该自己排');
  const run = makeRun('A1');
  SC.start(run, { loop: false });
  eq(SC.isRunning(), true);
  SC.stop();
  eq(SC.isRunning(), false);
});

test('step：推进一帧会走 TC.Level.tick，并把顾客推进来', () => {
  const run = makeRun('A1');                          // firstSpawn 0 → 第一帧就上人
  SC.start(run, { loop: false });
  const t0 = run.timeLeft;
  SC.step(16);
  eq(run.customers.length, 1, '第一位顾客应该已上门');
  gt(t0 - run.timeLeft, 0, '时间应该往前走');
  eq(SC.run(), run);
  SC.stop();
});

test('step：第一口锅的火没开时不会自己出菜（规则来自 TC.Level）', () => {
  const run = makeRun('A1');
  SC.start(run, { loop: false });
  SC.step(16);
  eq(run.pots.filter(Boolean).length, 0, '不点食材就不该占锅');
  SC.stop();
});

test('step：run.over 时自动停表并交给 UI 结算（且只结算一次）', () => {
  const run = makeRun('A1');
  run.timeLeft = 1;                                   // 下一秒就结束
  const savedSave = TC.UI.save;
  const savedRun = TC.UI.run;
  TC.UI.save = run.save;
  TC.UI.run = run;
  TC.UI._settled = false;

  SC.start(run, { loop: false });
  const ev = SC.step(50);
  includes(ev.map((e) => e.type), 'end', '应该发出 end 事件');
  eq(run.over, true);
  eq(SC.isRunning(), false, '结束后应自动停表');
  eq(TC.UI._settled, true, 'UI 应该收到结算通知');
  ok(TC.UI.result, '结算结果应该挂在 UI 上');

  const again = SC.step(50);
  eq(again.length, 0, '已经结束的对局不再产生事件');

  // 还原现场，别影响后面的用例
  TC.UI.save = savedSave;
  TC.UI.run = savedRun;
  TC.UI.result = null;
  TC.UI._settled = false;
  TC.Scene.stop();
  TC.Router.go('map', { force: true, silent: true });
  TC.UI.onRoute('map', null, {});
});

test('stop：没启动过也能安全调用', () => {
  SC.stop();
  SC.stop();
  eq(SC.isRunning(), false);
});
