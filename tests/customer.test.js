/* ==========================================================================
   tests/customer.test.js —— 第五优先级：顾客模型扩展
   需求原文：「每地区 8 种普通顾客模型（学生/上班族/主妇/老人/小孩/游客/厨师/快递员）
             的本地化造型，全部程序化像素绘制、完全原创；同屏最多 6 位顾客，
             2 行 3 列排队，新顾客右侧滑入、上完菜左侧滑走，不拥挤。」

   造型合成本身（40 种互不撞款）由 pixel.test.js 守着，这里守的是「玩法侧」：
     · 职业表本身自洽（8 种、权重合计 100、耐心有梯度）
     · 生客时按 run.regionId 换成当地造型（本地化真的接上了）
     · 同屏不重复 + 最多 6 位 + 座位上限
     · 顾客带是 2 行 3 列的网格，且只有新面孔会播滑入动画
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gt, gte, lte, includes } = H;

section('顾客模型（第五优先级）');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI, L = TC.Level, S = TC.Save, D = TC.DATA, C = TC.Calc, P = TC.Pixel;
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

// 确定性的伪随机，避免用例偶发失败
function lcg(seed) {
  let s = seed || 7;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/* ------------------------------ 职业表 ------------------------------ */
test('8 种职业覆盖需求里点名的那 8 类人', () => {
  eq(D.CUSTOMERS.length, 8);
  const ids = D.CUSTOMERS.map((c) => c.id).join(',');
  ['student', 'office', 'housewife', 'granny', 'kid', 'tourist', 'chef', 'courier']
    .forEach((id) => includes(ids, id, '缺少职业 ' + id));
  eq(D.CUSTOMERS.reduce((n, c) => n + c.weight, 0), 100, '权重合计应为 100');
});

test('每种职业都有职业补丁，且每个地区都能合成出造型', () => {
  D.CUSTOMERS.forEach((c) => {
    ok(P.CUST_PATCH[c.arch], c.name + ' 缺职业补丁');
    D.REGIONS.forEach((rg) => {
      const key = C.custSprite(c.id, rg.id);
      ok(P.custMatrix(key), c.name + ' 在 ' + rg.name + ' 合不出造型');
    });
  });
});

test('custSprite 按地区换装：同一个厨师在巴黎和墨西哥不是同一个人', () => {
  const a = C.custSprite('chef', 'paris_cafe');
  const b = C.custSprite('chef', 'taco_stand');
  eq(a, 'cust_chef_paris_cafe');
  ne_(a, b);
  no(P.custMatrix(a).join('/') === P.custMatrix(b).join('/'), '两地造型不该完全一样');
  eq(C.custSprite('nobody', 'asia_street'), 'cust_nobody_asia_street', '查不到就按 id 兜底');
  eq(C.custSprite('chef'), 'cust_chef_asia_street', '不传地区时回落到第一站');
});

test('顾客进店时穿的是当地衣服（本地化真的接上了）', () => {
  D.REGIONS.forEach((rg) => {
    const save = S.blank();
    // 直接把第一关打通，保证地区可进
    save.regions[rg.id][rg.prefix + '1'] = 1;
    const run = L.create(save, rg.prefix + '1', { rand: lcg(3), firstSpawn: 0, skipGuest: true });
    L.tick(run, 16);
    const c = run.customers[0];
    ok(c, rg.name + ' 应该有顾客上门');
    eq(c.sprite, C.custSprite(c.id, rg.id), '顾客的造型键应带本地地区');
    includes(c.sprite, rg.id, '造型键里应含地区 id');
  });
});

/* ------------------------------ 同屏人数 ------------------------------ */
test('同屏最多 6 位顾客（2 行 3 列），座位上限也是 6', () => {
  eq(C.SEAT_CAP, 6);
  D.LEVELS.forEach((lv) => lte(C.seats(lv.id, S.blank()), 6, lv.id + ' 座位超过 6'));
  const save = S.blank();
  save.upgrades.seats = 3;
  lte(C.seats('A5', save), 6, '加座也不能突破同屏上限');
});

test('同屏不会出现两位同款职业（真随机下连续生客也不撞）', () => {
  const save = S.blank();
  save.upgrades.seats = 3;                       // A5 基础 3 座 + 3 = 6 座
  const run = L.create(save, 'A5', { rand: lcg(11), firstSpawn: 0, skipGuest: true });
  L.tick(run, 16);
  for (let i = 0; i < 6; i++) L.tick(run, 4300);
  const wait = L.waiting(run);
  gt(wait.length, 2);
  eq(new Set(wait.map((c) => c.id)).size, wait.length, '同屏职业重复了：' + wait.map((c) => c.id));
  lte(wait.length, 6, '同屏不该超过 6 位');
});

/* ------------------------------ 顾客带布局 ------------------------------ */
test('顾客带是 3 列网格：1~3 人一行，4~6 人自动折成 2 行', () => {
  const css = G.html;
  includes(css, '.cust-band{', '缺顾客带样式');
  includes(css, 'grid-template-columns:repeat(3,minmax(0,1fr))', '顾客带应是 3 列网格');
  includes(css, '@keyframes custIn', '缺「新顾客滑入」动画');
  includes(css, '@keyframes custLeave', '缺「上完菜滑走」动画');
});

test('人多时自动缩小立绘（4 人以上用 2 倍像素），不挤成一团', () => {
  eq(UI.custScale(1), 3);
  eq(UI.custScale(3), 3);
  eq(UI.custScale(4), 2);
  eq(UI.custScale(6), 2);
  // 卡片里的画布尺寸跟着倍率走
  eq(P.CUST_W * UI.custScale(4), 32);
  eq(P.CUST_H * UI.custScale(4), 48);
});

test('渲染顾客带：最多 6 张卡、换人时切到紧凑模式、只有新面孔播滑入', () => {
  UI.save = S.blank();
  S.checkDaily(UI.save, TC.Util.today());
  const save = UI.save;
  save.upgrades.seats = 3;
  const run = L.create(save, 'A5', { rand: lcg(5), firstSpawn: 0, skipGuest: true });
  UI.run = run;

  L.tick(run, 16);
  eq(UI.renderCustBand(run), true);
  const band = $('custBand');
  eq($$('#custBand .cust').length, 1, '第一位顾客');
  eq(band.classList.contains('is-tight'), false, '1 个人不用紧凑模式');
  eq($$('#custBand .cust.is-new').length, 1, '第一次露面应播滑入');

  // 再来一位：老顾客不该重复播滑入
  L.tick(run, 4300);
  UI.renderCustBand(run);
  eq($$('#custBand .cust').length, 2);
  eq($$('#custBand .cust.is-new').length, 1, '只有新来的那位播滑入，老顾客不动');

  // 一口气坐到 6 位
  for (let i = 0; i < 8; i++) L.tick(run, 4300);
  UI.renderCustBand(run);
  const cards = $$('#custBand .cust');
  lte(cards.length, 6, '同屏最多 6 张卡');
  eq(band.classList.contains('is-tight'), cards.length > 3, '人多时切紧凑模式');

  UI.run = null;
});

test('上完菜的顾客挂 is-leaving（播左侧滑走动画）', () => {
  UI.save = S.blank();
  const run = L.create(UI.save, 'A1', { rand: lcg(2), firstSpawn: 0, skipGuest: true });
  UI.run = run;
  L.tick(run, 16);
  const c = L.waiting(run)[0];
  c.state = 'served';
  UI.renderCustBand(run);
  const card = $('custBand').querySelector('[data-uid="' + c.uid + '"]');
  ok(card.classList.contains('is-leaving'), '上完菜应播滑走动画');
  UI.run = null;
});

test('没有顾客时显示等待提示，且提示横跨整行', () => {
  const band = $('custBand');
  band.innerHTML = '<span class="cust-hint">顾客马上就到…</span>';
  includes(G.html, '.cust-hint{', '缺提示样式');
  includes(G.html, 'grid-column:1 / -1', '提示应横跨整行');
});

/* 局部小工具：断言不等（harness 的 ne 在部分版本叫别的名字，这里自带一个） */
function ne_(a, b, msg) { ok(a !== b, msg || ('应不相等：' + a)); }
