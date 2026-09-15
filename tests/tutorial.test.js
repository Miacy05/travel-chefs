/* ==========================================================================
   tests/tutorial.test.js —— 对应第一优先级「新手教程系统」
   测三件事：
     ① 步骤表（DATA.TUTORIAL）是不是需求里的那 8 个环节、文案对不对
     ② 教学局的规则（TC.Level 里 tutorial:true 的那条分支）：不倒计时、耐心放慢、不结算
     ③ 遮罩的开关与推进：首次自动播 → 走完 8 步 → 写 tutorialDone；跳过也能关
   注意：本文件不测「高亮块像素对齐」—— jsdom 没有布局引擎，矩形恒为 0，
        所以只断言「量不到目标时会退化成不挡屏的中间态」。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gt, includes, includesNot, hasKeys } = H;

section('TC.UI · 新手教程');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI, L = TC.Level, S = TC.Save, C = TC.Calc, D = TC.DATA, U = TC.Util, SC = TC.Scene;

const $ = (id) => document.getElementById(id);
const resetSave = () => { UI.save = S.blank(); S.checkDaily(UI.save, U.today()); return UI.save; };

/* ------------------------------ 步骤表 ------------------------------ */
test('教程步骤表是需求里的 8 个环节，顺序与文案都对得上', () => {
  eq(D.TUTORIAL.length, 8, '教程必须是 8 步');
  eq(D.TUTORIAL_LEVEL, 'A1', '教学演示局固定用第 1 区第 1 关');
  const ids = D.TUTORIAL.map((s) => s.id);
  eq(new Set(ids).size, 8, '步骤 id 不能重复');
  D.TUTORIAL.forEach((s) => {
    hasKeys(s, ['id', 'no', 'view', 'spot', 'act', 'text'], '步骤字段');
    ok(s.text && s.text.length > 4, '每步都要有一句中文引导：' + s.id);
    ok(['map', 'cook', 'result'].indexOf(s.view) !== -1, '视图只能是 map/cook/result：' + s.id);
  });
  // 需求里的 8 句原文
  const byNo = {};
  D.TUTORIAL.forEach((s) => { byNo[s.no] = s; });
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => ok(byNo[n], '缺少第 ' + n + ' 环节'));
  includes(byNo[1].text, '点击食材');
  includes(byNo[2].text, '熟了');
  includes(byNo[3].text, '盘子');
  includes(byNo[4].text, '拖给顾客');
  includes(byNo[5].text, '耐心条');
  includes(byNo[6].text, '三星');
  includes(byNo[7].text, '金币');
  includes(byNo[8].text, '新地区');
  // 四个「要玩家真的做一次」的动作步
  eq(D.TUTORIAL.filter((s) => s.act).map((s) => s.act).join(','), 'ingredient,pot,plate,serve');
});

/* ------------------------------ 教学局的规则 ------------------------------ */
test('教学局：只坐 1 位顾客、倒计时不走、耐心放慢', () => {
  const save = resetSave();
  const run = L.create(save, D.TUTORIAL_LEVEL, { tutorial: true, firstSpawn: 1, rand: () => 0 });
  eq(run.tutorial, true);
  eq(run.seats, 1, '教学局只坐 1 位，流程才跟得住');

  L.tick(run, 1);                       // 先让第一位顾客上门
  const c = L.waiting(run)[0];
  ok(c, '第一位顾客应该已经上门');
  const before = run.timeLeft;
  const p0 = c.patienceLeft;

  L.tick(run, 30000);
  eq(run.timeLeft, before, '教学局不该推进营业倒计时');
  eq(run.over, false, '教学局不该结束');
  gt(run.runtime, 30000, '但 runtime 要照常走（烹饪进度靠它）');
  eq(p0 - c.patienceLeft, Math.round(30000 * L.TUTORIAL_PATIENCE_MUL), '耐心按 8% 速消耗，新手不会被逼死');
  gt(c.patienceLeft, 0);
});

test('普通局不受教学局规则影响：照常倒计时、耐心照常掉', () => {
  const save = resetSave();
  const run = L.create(save, 'A1', { firstSpawn: 1, rand: () => 0 });
  eq(run.tutorial, false);

  L.tick(run, 1);
  const c = L.waiting(run)[0];
  const before = run.timeLeft;
  const p0 = c.patienceLeft;

  L.tick(run, 10000);
  eq(run.timeLeft, before - 10000, '普通局必须正常倒计时');
  eq(p0 - c.patienceLeft, 10000, '普通局耐心 1:1 消耗');
});

test('教学局不会结算、也不会写档', () => {
  const save = resetSave();
  const run = L.create(save, D.TUTORIAL_LEVEL, { tutorial: true, rand: () => 0 });
  UI.save = save;
  UI.run = run;
  eq(UI.onRunOver(run), false, '教学局不该进结算');
  eq(save.coins, 0);
  eq(C.levelStars(save, 'A1'), 0);
  UI.run = null;
});

/* ------------------------------ 遮罩开关 ------------------------------ */
test('首次进游戏自动播；走完 8 步后写 tutorialDone 并收掉遮罩', () => {
  const save = resetSave();
  eq(S.needsTutorial(save), true, '新档应该需要教程');

  eq(UI.tutAutoStart(), true, '应该自动起教程');
  eq(UI.tutActive(), true);
  eq($('tutHost').classList.contains('is-on'), true);
  ok(UI.run && UI.run.tutorial, '教程要起一局教学演示局');

  /* 第 1 步在地图上讲「解锁新地区」 */
  eq(UI.tutIndex(), 0);
  eq(D.TUTORIAL[0].view, 'map');
  eq($('tutStepLab').textContent, '第 1 / 8 步');
  eq($('tutText').textContent, D.TUTORIAL[0].text);
  eq($('btnTutNext').hidden, false, '纯讲解步要显示「下一步」');

  /* 逐条走下去：讲解步点按钮、动作步做动作 */
  UI.tutNext();                       // → 2/8 点食材
  eq(UI.tutIndex(), 1);
  eq($('btnTutNext').hidden, true, '动作步要隐藏「下一步」，逼玩家真的做一次');
  eq(UI.tutAction('pot'), false, '做错动作不该推进');
  eq(UI.tutAction('ingredient'), true, '做对动作才推进');
  eq(UI.tutIndex(), 2);
  UI.tutAction('pot');                // → 装盘
  eq(UI.tutIndex(), 3);
  UI.tutAction('plate');              // → 上菜
  eq(UI.tutIndex(), 4);
  UI.tutAction('serve');              // → 耐心条
  eq(UI.tutIndex(), 5);
  UI.tutNext();                       // → 金币
  eq(UI.tutIndex(), 6);
  UI.tutNext();                       // → 结算页讲三星
  eq(UI.tutIndex(), 7);
  eq(TC.Router.current, 'result', '最后一步要停在结算页');
  eq($('btnTutNext').textContent, '完成教程');

  const coinsBefore = UI.save.coins;
  eq(UI.tutNext(), true);             // 完成教程
  eq(UI.tutActive(), false, '第 8 步之后再点就结束');
  eq($('tutHost').classList.contains('is-on'), false);
  eq(S.needsTutorial(UI.save), false, '教程看完要写 tutorialDone');
  eq(UI.save.tutorialDone, true);
  eq(UI.save.coins, coinsBefore, '教学不该给玩家发钱');
  eq(C.levelStars(UI.save, 'A1'), 0, '教学不该给玩家发星星');
  eq(UI.run, null, '教程结束后不该留着教学局');
  eq(TC.Router.current, 'map', '结束后回地图');
});

test('跳过教程：立刻收起遮罩、也记成已看完', () => {
  resetSave();
  UI.tutStart();
  eq(UI.tutActive(), true);
  UI.tutStop();
  eq(UI.tutActive(), false);
  eq($('tutHost').classList.contains('is-on'), false);
  eq(UI.save.tutorialDone, true, '跳过也算看过，不然每次进游戏都弹');
  eq(UI.run, null);
});

test('done:false 只摘遮罩、不动存档（测试环境用）', () => {
  const save = resetSave();
  UI.tutStart();
  UI.tutStop({ done: false });
  eq(UI.tutActive(), false);
  eq(save.tutorialDone, false, '不该写 tutorialDone');
  eq(S.needsTutorial(save), true, '下次仍然需要教程');
});

test('看过教程之后不再自动播', () => {
  const save = resetSave();
  S.setTutorialDone(save, true);
  eq(UI.tutAutoStart(), false);
  eq(UI.tutActive(), false);
});

/* ------------------------------ 高亮与设置入口 ------------------------------ */
test('量不到高亮目标时退化成不挡屏的中间态（jsdom 无布局引擎）', () => {
  resetSave();
  UI.tutStart();
  const spot = $('tutSpot');
  eq(spot.style.left, '50%', '没有布局信息时聚光块应收到中间，而不是铺满屏');
  eq(spot.style.width, '0px');
  ok($('tutDots').querySelectorAll('i').length === 8, '进度点应有 8 个');
  UI.tutStop({ done: false });
});

test('设置里能「回顾新手教程」，点了就重新播', () => {
  resetSave();
  UI.openSettings();
  const row = $('setList').querySelector('[data-set="tutorial"]');
  ok(row, '设置里应该有「回顾新手教程」入口');
  includes($('setList').textContent, '回顾新手教程');
  eq(UI.onSetting('tutorial'), true);
  eq(UI.tutActive(), true, '点了就该开始播');
  eq($('modalSettings').hidden, true, '设置弹窗要让开');
  UI.tutStop({ done: false });
});

test('教程遮罩不吞掉玩家操作（pointer-events 由 CSS 控制，这里守住结构）', () => {
  eq($('tutHost').querySelector('#tutSpot') != null, true);
  ok($('tutBubble').querySelector('.tut-card'), '气泡要有卡片容器');
  ok($('btnTutSkip'), '必须有「跳过教程」按钮');
  eq($('btnTutSkip').textContent, '跳过教程');
  /* canvas 区域步（灶台/出餐台）是合法的 spot 名 */
  const spots = D.TUTORIAL.map((s) => s.spot);
  includes(spots.join(','), 'stove');
  includes(spots.join(','), 'counter');
  includesNot(spots.join(','), 'undefined');
});

/* ------------------------------ 教程不该污染其它流程 ------------------------------ */
test('教程结束后能正常开一局普通营业', () => {
  const save = resetSave();
  UI.tutStart();
  UI.tutStop();
  const okOpen = UI.openLevel('A1', { loop: false });
  eq(okOpen, true, '教程之后关卡照常能进');
  ok(UI.run && !UI.run.tutorial, '这一局是普通局');
  SC.stop();
  UI.run = null;
});
