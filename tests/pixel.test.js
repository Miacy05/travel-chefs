/* ==========================================================================
   tests/pixel.test.js —— 对应模块 TC.Pixel（像素精灵绘制）
   核心价值：把所有像素矩阵的「等宽 / 行数 / 合法色号」变成断言，
   这样手绘素材不可能悄悄画错。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, deepEq, gt, lte } = H;

section('TC.Pixel');
const { TC } = loadGame();
const P = TC.Pixel;
const D = TC.DATA;

/** 记录调用的假 2D 上下文，用来断言绘制行为 */
function fakeCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '',
    fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); }
  };
}

/* ------------------------------ 色板 ------------------------------ */
test('调色板严格是方案给的 5 色，不多不少', () => {
  eq(Object.keys(P.PALETTE).sort().join(','), 'k,m,r,w,y');
  eq(P.PALETTE.y, '#FFD166');
  eq(P.PALETTE.r, '#EF476F');
  eq(P.PALETTE.m, '#06D6A0');
  eq(P.PALETTE.w, '#FFFCF2');
  eq(P.PALETTE.k, '#3D2B1F');
  eq(P.COLORS.length, 5);
});

/* ------------------------------ 素材自检 ------------------------------ */
test('validate() 全部通过：所有矩阵等宽、行数正确、色号合法', () => {
  const errors = P.validate();
  eq(errors.length, 0, '素材有问题：\n      ' + errors.join('\n      '));
});

test('15 道菜都有一张 16×16 的独立像素图', () => {
  eq(Object.keys(P.DISHES).length, 15, '实际 ' + Object.keys(P.DISHES).length);
  D.DISHES.forEach((d) => {
    const m = P.DISHES[d.sprite];
    ok(m, d.id + ' 缺少 ' + d.sprite);
    eq(m.length, 16, d.sprite + ' 应有 16 行');
    m.forEach((row, i) => eq(row.length, 16, d.sprite + ' 第 ' + i + ' 行宽度不是 16'));
  });
});

test('15 张菜品图互不相同', () => {
  const seen = new Map();
  Object.keys(P.DISHES).forEach((k) => {
    const sig = P.DISHES[k].join('/');
    no(seen.has(sig), k + ' 与 ' + seen.get(sig) + ' 完全相同，等于没有独立图标');
    seen.set(sig, k);
  });
});

test('5 种顾客都有 16×24 的像素图（同一身体模板换配色）', () => {
  eq(Object.keys(P.CUST_SKINS).length, 5);
  eq(P.CUST_BODY.length, 24);
  P.CUST_BODY.forEach((row, i) => eq(row.length, 16, '第 ' + i + ' 行宽度不是 16'));
  const sigs = new Set();
  D.CUSTOMERS.forEach((c) => {
    const m = P.matrix(c.sprite);
    ok(m, c.id + ' 缺少像素图');
    eq(m.length, 24);
    sigs.add(m.join('/'));
  });
  eq(sigs.size, 5, '5 种顾客应该长得都不一样');
});

test('10 种食材形状都是 16×16', () => {
  eq(Object.keys(P.SHAPES).length, 10);
  Object.keys(P.SHAPES).forEach((k) => {
    eq(P.SHAPES[k].length, 16, k + ' 应有 16 行');
    P.SHAPES[k].forEach((row, i) => eq(row.length, 16, k + ' 第 ' + i + ' 行宽度不是 16'));
  });
});

test('45 种食材都能生成合法矩阵', () => {
  D.INGREDIENTS.forEach((ing) => {
    const m = P.ingredientMatrix(ing.art);
    ok(m, ing.id + ' 生成失败');
    eq(m.length, 16, ing.id);
    m.forEach((row, i) => eq(row.length, 16, ing.id + ' 第 ' + i + ' 行宽度不对'));
    no(/[ab]/.test(m.join('')), ing.id + ' 上色后还残留占位符 a/b');
  });
});

test('菜品上色后只剩 5 色板，占位符 a/b 不会漏到屏幕上', () => {
  D.DISHES.forEach((d) => {
    const m = P.dishMatrix(d.sprite);
    ok(m, d.id);
    eq(m.length, 16);
    no(/[ab]/.test(m.join('')), d.id + ' 上色后还残留占位符 a/b');
    m.forEach((row, i) => ok(/^[kwyrm.]+$/.test(row), d.id + ' 第 ' + i + ' 行出现非 5 色像素：' + row));
  });
  eq(P.dishMatrix('dish_ghost'), null, '未知菜品应返回 null');
});

test('每道菜都有自己的配色表，主色/辅色都在 5 色板里', () => {
  Object.keys(P.DISHES).forEach((k) => {
    const pal = P.DISH_PAL[k];
    ok(pal, k + ' 缺少配色表');
    ok(P.COLORS.indexOf(pal.a) !== -1, k + ' 主色非法：' + pal.a);
    ok(P.COLORS.indexOf(pal.b) !== -1, k + ' 辅色非法：' + pal.b);
  });
});

test('顾客上色后占位符 s/h/c/t 不残留', () => {
  Object.keys(P.CUST_SKINS).forEach((k) => {
    const m = P.custMatrix(k);
    ok(m, k);
    eq(m.length, 24);
    no(/[shct]/.test(m.join('')), k + ' 上色后还残留占位符');
    m.forEach((row) => ok(/^[kwyrm.]+$/.test(row), k + ' 出现非 5 色像素：' + row));
  });
  eq(P.custMatrix('cust_ghost'), null);
});

test('matrix() 对菜品与顾客都返回 5 色矩阵', () => {
  const d = P.matrix('dish_nigiri');
  eq(d.length, 16);
  d.forEach((row) => ok(/^[kwyrm.]+$/.test(row)));
  const c = P.matrix('cust_kid');
  eq(c.length, 24);
  c.forEach((row) => ok(/^[kwyrm.]+$/.test(row)));
});

test('validate 能抓出缺少 art / 不存在的模板', () => {
  gt(P.validate({ dishes: [], customers: [], ingredients: [{ id: 'x' }] }).length, 0, '缺少 art 应被抓出');
  gt(P.validate({ dishes: [], customers: [], ingredients: [{ id: 'x', art: { tpl: 'ghost', c1: 'y', c2: 'y' } }] }).length, 0, '不存在的模板应被抓出');
  gt(P.validate({ dishes: [], customers: [], ingredients: [{ id: 'x', art: { tpl: 'bowl', c1: 'z', c2: 'y' } }] }).length, 0, '非法色号应被抓出');
});

test('同一模板换色后确实长得不一样', () => {
  const bowls = D.INGREDIENTS.filter((i) => i.art.tpl === 'bowl');
  gt(bowls.length, 3);
  const sigs = new Set(bowls.map((i) => P.ingredientMatrix(i.art).join('/')));
  gt(sigs.size, 1, '碗类食材不该全都一个样');
});

test('validate 能抓出被画坏的素材', () => {
  const bad = P.validate({
    dishes: [{ id: 'x', sprite: 'dish_chowmein' }],
    customers: [],
    ingredients: [{ id: 'x', art: { tpl: 'bowl', c1: 'y', c2: 'z' } }]
  });
  gt(bad.length, 0, '非法色号应被抓出来');
  const bad2 = P.validate({
    dishes: [{ id: 'x', sprite: 'dish_nope' }],
    customers: [], ingredients: []
  });
  gt(bad2.length, 0, '缺失 sprite 应被抓出来');
  const bad3 = P.validate({ dishes: [], customers: [], ingredients: [{ id: 'x', art: { tpl: 'ghost', c1: 'y', c2: 'y' } }] });
  gt(bad3.length, 0, '不存在的模板应被抓出来');
});

/* ------------------------------ 矩形化 ------------------------------ */
test('rectsOfMatrix 做游程合并，坐标与颜色都对', () => {
  const m = [
    'yy..rr',
    '.yy.rr'
  ];
  const rects = P.rectsOfMatrix(m, 2);
  // scale=2；行0: yy@x0 → 0，rr@x4 → 8；行1: yy@x1 → 2，rr@x4 → 8
  eq(rects.length, 4, '相邻同色应合并成 1 块，空白应跳过');
  deepEq(rects[0], { x: 0, y: 0, w: 4, h: 2, ch: 'y', color: '#FFD166' });
  deepEq(rects[1], { x: 8, y: 0, w: 4, h: 2, ch: 'r', color: '#EF476F' });
  deepEq(rects[2], { x: 2, y: 2, w: 4, h: 2, ch: 'y', color: '#FFD166' });
  deepEq(rects[3], { x: 8, y: 2, w: 4, h: 2, ch: 'r', color: '#EF476F' });
  // 同一行连续 4 个同色像素必须合并为 1 块
  eq(P.rectsOfMatrix(['yyyy'], 1).length, 1);
});

test('rectsOfMatrix 跳过透明像素', () => {
  eq(P.rectsOfMatrix(['....', '....'], 1).length, 0);
  eq(P.rectsOfMatrix(['....', '.k..'], 1).length, 1);
  eq(P.rectsOf(null, 1).length, 0, 'null 矩阵不应报错');
  eq(P.rectsOfMatrix(null, 1).length, 0);
});

test('scale 会等比放大坐标与尺寸', () => {
  const r1 = P.rectsOfMatrix(['yy'], 1)[0];
  const r3 = P.rectsOfMatrix(['yy'], 3)[0];
  eq(r1.w, 2);
  eq(r3.w, 6);
  eq(r3.h, 3);
  eq(r3.y, 0);
});

test('所有精灵转成矩形后颜色都落在 5 色板里', () => {
  const allowed = Object.keys(P.PALETTE).map((k) => P.PALETTE[k]);
  D.DISHES.forEach((d) => {
    P.rectsOf(d.sprite, 2).forEach((r) => ok(allowed.indexOf(r.color) !== -1, d.id + ' 出现非法颜色 ' + r.color));
  });
  D.INGREDIENTS.forEach((i) => {
    P.ingredientRects(i.art, 2).forEach((r) => ok(allowed.indexOf(r.color) !== -1, i.id + ' 出现非法颜色 ' + r.color));
  });
});

test('每个精灵都能转出非空矩形列表', () => {
  D.DISHES.forEach((d) => gt(P.rectsOf(d.sprite, 2).length, 10, d.id + ' 的像素图几乎空白'));
  D.CUSTOMERS.forEach((c) => gt(P.rectsOf(c.sprite, 2).length, 20, c.id + ' 的像素图几乎空白'));
  D.INGREDIENTS.forEach((i) => gt(P.ingredientRects(i.art, 2).length, 5, i.id + ' 的像素图几乎空白'));
});

test('rectsOf 命中缓存（同一 key 返回同一数组）', () => {
  const a = P.rectsOf('dish_chowmein', 2);
  const b = P.rectsOf('dish_chowmein', 2);
  eq(a, b, '应返回同一个数组引用');
});

/* ------------------------------ 绘制 ------------------------------ */
test('paintRects 按矩形列表逐块填充，返回绘制次数', () => {
  const ctx = fakeCtx();
  const n = P.paintRects(ctx, P.rectsOfMatrix(['yy', 'rr'], 1), 10, 20);
  eq(n, 2);
  eq(ctx.calls.length, 2);
  deepEq(ctx.calls[0], { x: 10, y: 20, w: 2, h: 1, color: '#FFD166' });
  deepEq(ctx.calls[1], { x: 10, y: 21, w: 2, h: 1, color: '#EF476F' });
});

test('paintRects 对空输入安全', () => {
  eq(P.paintRects(null, []), 0);
  eq(P.paintRects(fakeCtx(), null), 0);
  eq(P.paintRects(fakeCtx(), []), 0);
});

test('paint 能把菜品画到指定坐标', () => {
  const ctx = fakeCtx();
  const n = P.paint(ctx, 'dish_milktea', 4, 6, 2);
  gt(n, 0);
  ctx.calls.forEach((c) => {
    ok(c.x >= 4 && c.y >= 6, '绘制坐标应相对偏移量');
  });
});

test('paintIngredient 能画食材', () => {
  const ctx = fakeCtx();
  const n = P.paintIngredient(ctx, D.INGREDIENTS[0].art, 0, 0, 2);
  gt(n, 0);
});

test('matrix() 对未知 key 返回 null，不抛异常', () => {
  eq(P.matrix('ghost_key'), null);
  eq(P.matrix(null), null);
  eq(P.matrix(''), null);
});

test('toCanvas 在无 canvas 环境下不抛异常', () => {
  // jsdom 里 getContext 返回 null（无 node-canvas），实现必须能容忍
  const cv = P.toCanvas('dish_chowmein', 2);
  ok(cv === null || cv.nodeType === 1, '应返回 canvas 或 null');
  const cv2 = P.toCanvas('ghost_key', 2);
  eq(cv2, null, '未知 key 应返回 null');
  const cv3 = P.toCanvas(null, 2, D.INGREDIENTS[0].art);
  ok(cv3 === null || cv3.nodeType === 1);
});

/* ------------------------------ 与数据层的一致性 ------------------------------ */
test('数据里引用的 sprite / tpl 全部存在', () => {
  D.DISHES.forEach((d) => ok(P.DISHES[d.sprite], d.id + ' 的 sprite 不存在'));
  D.CUSTOMERS.forEach((c) => ok(P.CUST_SKINS[c.sprite], c.id + ' 的 sprite 不存在'));
  D.INGREDIENTS.forEach((i) => ok(P.SHAPES[i.art.tpl], i.id + ' 的 tpl 不存在'));
});

test('顾客配色覆盖了 5 色板里的多种组合（不会全都一个颜色）', () => {
  const hairs = new Set(D.CUSTOMERS.map((c) => P.CUST_SKINS[c.sprite].h));
  const clothes = new Set(D.CUSTOMERS.map((c) => P.CUST_SKINS[c.sprite].c));
  gt(hairs.size, 2, '头发颜色太单一');
  gt(clothes.size, 2, '衣服颜色太单一');
  Object.keys(P.CUST_SKINS).forEach((k) => {
    const s = P.CUST_SKINS[k];
    [s.h, s.c, s.t].forEach((c) => ok(P.COLORS.indexOf(c) !== -1, k + ' 用了非法颜色 ' + c));
  });
});
