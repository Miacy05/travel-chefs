/* ==========================================================================
   tests/tutorial.test.js —— 对应第一优先级「新手教程系统」
   测三件事：
     ① 步骤表（DATA.TUTORIAL）是不是需求里的那 11 个环节、文案对不对
     ② 教学局的规则（TC.Level 里 tutorial:true 的那条分支）：不倒计时、耐心放慢、不结算
     ③ 遮罩的开关与推进：首次自动播 → 走完 11 步 → 写 tutorialDone；跳过也能关
   推进方式（关键）：动作步不靠「玩家点了什么」，而是靠 UI.tutSync 每帧读「游戏状态」
     来判定（tutCheck）—— 同一次点击可能连着触发「点配料」和「自动开火」，
     按动作标签匹配会连跳两步。所以测试也要按状态去驱动（tapIngredient / toPlate / serve）。
   注意：本文件不测「高亮块像素对齐」—— jsdom 没有布局引擎，矩形恒为 0，
        所以只断言「量不到目标时会退化成不挡屏的中间态」。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, no, section, gt, gte, includes, includesNot, hasKeys } = H;

section('TC.UI · 新手教程');

const G = loadGame();
const { TC, document, window } = G;
const UI = TC.UI, L = TC.Level, S = TC.Save, C = TC.Calc, D = TC.DATA, U = TC.Util, SC = TC.Scene;

const $ = (id) => document.getElementById(id);
const resetSave = () => { UI.save = S.blank(); S.checkDaily(UI.save, U.today()); return UI.save; };

/* ------------------------------ 步骤表 ------------------------------ */
test('教程步骤表是需求里的 11 个环节，顺序与文案都对得上', () => {
  eq(D.TUTORIAL.length, 11, '教程必须是 11 步');
  eq(D.TUTORIAL_LEVEL, 'A1', '教学演示局固定用第 1 区第 1 关');
  const ids = D.TUTORIAL.map((s) => s.id);
  eq(new Set(ids).size, 11, '步骤 id 不能重复');
  /* 动作步的判定条件：只认「游戏状态」，不认「触发了什么动作事件」。
     这套 check 白名单是防连跳两步的关键（一次点击可能连着触发点配料 + 自动开火）。 */
  const CHECKS = ['ing', 'cooking', 'ready', 'plated', 'served'];
  D.TUTORIAL.forEach((s) => {
    hasKeys(s, ['id', 'no', 'view', 'spot', 'text'], '步骤字段');
    ok(s.text && s.text.length > 4, '每步都要有一句中文引导：' + s.id);
    ok(['map', 'cook', 'result'].indexOf(s.view) !== -1, '视图只能是 map/cook/result：' + s.id);
    ok(s.check == null || CHECKS.indexOf(s.check) !== -1,
      'check 只能是既定的状态判定：' + s.id + ' → ' + s.check);
    /* 配料步必须带 ing 下标，tutCheck 靠它去比「订单里第几样配料已下锅」 */
    if (s.check === 'ing') ok(typeof s.ing === 'number', s.id + ' 是配料步，必须带 ing 下标');
  });
  // 需求里的 11 个环节，一个都不能少
  const byNo = {};
  D.TUTORIAL.forEach((s) => { byNo[s.no] = s; });
  for (let n = 1; n <= 11; n++) ok(byNo[n], '缺少第 ' + n + ' 环节');
  includes(byNo[1].text, '解锁');          // ① 解锁新地区
  includes(byNo[2].text, '关卡');          // ② 选关开业
  includes(byNo[3].text, '{ing}');         // ③④⑤ 三次配料点击（名字运行时填）
  includes(byNo[4].text, '{ing}');
  includes(byNo[5].text, '{ing}');
  includes(byNo[6].text, '自动');          // ⑥ 自动下锅 + 自动开火
  includes(byNo[7].text, '绿');            // ⑦ 等进度圈转绿
  includes(byNo[8].text, '盘子');          // ⑧ 装盘
  includes(byNo[9].text, '拖给顾客');      // ⑨ 上菜
  includes(byNo[9].text, '耐心条');
  includes(byNo[10].text, '金币');         // ⑩ 金币 & 小费
  includes(byNo[10].text, '小费');
  includes(byNo[11].text, '钻石');         // ⑪ 钻石
  // 「点配料」被拆成三步，保证玩家真的会点三下，而不是一句带过
  eq(D.TUTORIAL.filter((s) => s.check === 'ing').length, 3, '配料要点三样，就该留三步');
  eq(D.TUTORIAL.filter((s) => s.check === 'ing').map((s) => s.ing).join(','), '0,1,2',
    '三样配料的 ing 下标要依次是 0/1/2');
  // 四种「要玩家真的做一次」的状态判定，一个都不能少
  const kinds = D.TUTORIAL.filter((s) => s.check).map((s) => s.check);
  ['cooking', 'ready', 'plated', 'served'].forEach((k) => {
    ok(kinds.indexOf(k) !== -1, '缺少「' + k + '」这个状态判定步');
  });
  // 纯讲解步（没有 check）也要有，靠「下一步」按钮推进
  gte(D.TUTORIAL.filter((s) => !s.check).length, 3, '讲解步不能少于 3 步');
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

test('教学局实操：连点配料会一步一进，点齐自动下锅开火（不会卡在第 5 步）', () => {
  resetSave();
  /* 自动推进有「每步至少停留 TUT_DWELL」的节流；测试里把它压到 0，
     否则连续点击之间时间不够，推进会被节流挡掉（测试会误判成「不推进」）。 */
  const dwell = UI.TUT_DWELL;
  UI.TUT_DWELL = 0;
  UI.tutStart();
  try {
    eq(UI.tutIndex(), 0, '从第 1 步（地图讲解）开始');
    UI.tutNext();                              // → 第 2 步：选关开业（讲解）
    eq(UI.tutIndex(), 1);
    UI.tutNext();                              // → 第 3 步：点第 1 样配料（切到灶台页）
    eq(UI.tutIndex(), 2);
    eq(D.TUTORIAL[2].check, 'ing');
    eq($('btnTutNext').hidden, true, '动作步要藏起「下一步」，逼玩家真的做一次');

    L.tick(UI.run, 700);                       // 教学局首客 600ms 上门
    const c = L.waiting(UI.run)[0];
    ok(c, '教学局第一位顾客应该上门');
    const steps = D.dish(c.dishId).steps.slice();
    eq(steps.length, 3, '教学演示局这道菜正好三样配料，对应教程第 3~5 步');

    /* 点错配料 / 重复点同一配料：都不算，绝不能推进一步 */
    const wrong = Object.keys(D.byId.ingredient).filter((k) => steps.indexOf(k) === -1)[0];
    ok(wrong, '应该能找到一样不属于本单的配料');
    eq(UI.tapIngredient(wrong), false, '不需要的配料点了不算');
    eq(UI.tutIndex(), 2, '点错配料不该推进一步');
    ok(UI.tapIngredient(steps[0]), '该下锅的配料要能点进去');
    eq(UI.tutIndex(), 3, '点第 1 样配料 → 进入第 4 步');
    eq(UI.tapIngredient(steps[0]), false, '同一样配料不能重复下锅');
    eq(UI.tutIndex(), 3, '重复点击不该推进一步');

    /* 点第二样 → 再进一步 */
    UI.tapIngredient(steps[1]);
    eq(UI.tutIndex(), 4, '点第 2 样配料 → 进入第 5 步');

    /* 点最后一样：备料齐 → 自动下锅 + 自动开火，教程顺势走完「自动开火」那步 */
    UI.tapIngredient(steps[2]);
    const pot = L.prepPotOf(UI.run, c.dishId);
    ok(pot, '应该有锅在煮这道菜');
    eq(pot.state, 'cooking', '配料点齐后必须自动开火');
    eq(UI.tutIndex(), 6, '自动开火这一下会把教程推进到第 7 步（等进度圈），不会卡在第 6 步');
    eq(D.TUTORIAL[UI.tutIndex()].check, 'ready', '第 7 步的判定条件应该是「出锅」');
  } finally {
    SC.stop();
    UI.TUT_DWELL = dwell;
    UI.tutStop({ done: false });
    UI.run = null;
  }
});

/* ------------------------------ 遮罩开关 ------------------------------ */
test('首次进游戏自动播；走完 11 步后写 tutorialDone 并收掉遮罩', () => {
  const save = resetSave();
  eq(S.needsTutorial(save), true, '新档应该需要教程');

  const dwell = UI.TUT_DWELL;
  UI.TUT_DWELL = 0;                       // 关掉「每步至少停留」的节流，让状态判定立刻生效
  try {
    eq(UI.tutAutoStart(), true, '应该自动起教程');
    eq(UI.tutActive(), true);
    eq($('tutHost').classList.contains('is-on'), true);
    ok(UI.run && UI.run.tutorial, '教程要起一局教学演示局');

    /* 第 1 步在地图上讲「解锁新地区」 */
    eq(UI.tutIndex(), 0);
    eq(D.TUTORIAL[0].view, 'map');
    eq($('tutStepLab').textContent, '第 1 / 11 步');
    eq($('tutText').textContent, D.TUTORIAL[0].text);
    eq($('btnTutNext').hidden, false, '纯讲解步要显示「下一步」');

    /* 第 2 步：选关开业（也是讲解步，靠按钮推进） */
    UI.tutNext();
    eq(UI.tutIndex(), 1);
    eq($('btnTutNext').hidden, false);

    /* 第 3 步起进灶台页：点配料 → 自动下锅开火 → 出锅 → 装盘 → 上菜，全靠游戏状态自动推进 */
    UI.tutNext();
    eq(UI.tutIndex(), 2);
    eq(D.TUTORIAL[2].check, 'ing');
    eq($('btnTutNext').hidden, true, '动作步要隐藏「下一步」，逼玩家真的做一次');

    L.tick(UI.run, 700);
    const c = L.waiting(UI.run)[0];
    ok(c, '教学局第一位顾客应该上门');
    const steps = D.dish(c.dishId).steps.slice();

    UI.tapIngredient(steps[0]);
    eq(UI.tutIndex(), 3, '第 3 步做完自动进第 4 步');
    UI.tapIngredient(steps[1]);
    eq(UI.tutIndex(), 4, '第 4 步做完自动进第 5 步');
    UI.tapIngredient(steps[2]);
    eq(UI.tutIndex(), 6, '点齐三样 → 自动下锅开火 → 直接跳到第 7 步「等出锅」');

    /* 第 7 步：把菜烧到 ready，state 判定会自动推进 */
    const pot = L.prepPotOf(UI.run, c.dishId);
    ok(pot && pot.state === 'cooking', '这时锅应该在煮');
    for (let i = 0; i < 90 && pot.state !== 'ready'; i++) L.tick(UI.run, 1000);
    eq(pot.state, 'ready', '一直烧到出锅为止');
    UI.tutSync();
    eq(UI.tutIndex(), 7, '出锅 → 第 8 步「装盘」');

    /* 第 8 步：装盘（端起盘子） */
    const pr = L.toPlate(UI.run, UI.run.pots.indexOf(pot));
    eq(pr.ok, true, '出锅的菜应该能装盘');
    UI.holdPlate(pr.plateIdx);
    eq(UI.tutIndex(), 8, '装盘 → 第 9 步「上菜」');

    /* 第 9 步：把盘子拖给顾客 */
    const served = UI.servePlateTo(pr.plateIdx, c.uid);
    ok(served && served.ok, '这道菜应该正好是他点的');
    eq(UI.tutIndex(), 9, '上菜 → 第 10 步「金币 & 小费」');

    /* 第 10、11 步：两种货币讲解，靠按钮推进 */
    eq($('btnTutNext').hidden, false, '讲解步重新显示「下一步」');
    UI.tutNext();
    eq(UI.tutIndex(), 10);
    eq($('btnTutNext').textContent, '完成教程');
    eq(TC.Router.current, 'cook', '最后一步停在经营页讲货币');

    const coinsBefore = UI.save.coins;
    eq(UI.tutNext(), true);             // 完成教程
    eq(UI.tutActive(), false, '第 11 步之后再点就结束');
    eq($('tutHost').classList.contains('is-on'), false);
    eq(S.needsTutorial(UI.save), false, '教程看完要写 tutorialDone');
    eq(UI.save.tutorialDone, true);
    eq(UI.save.coins, coinsBefore, '教学不该给玩家发钱');
    eq(C.levelStars(UI.save, 'A1'), 0, '教学不该给玩家发星星');
    eq(UI.run, null, '教程结束后不该留着教学局');
    eq(TC.Router.current, 'map', '结束后回地图');
  } finally {
    UI.TUT_DWELL = dwell;
    SC.stop();
    if (UI.tutActive()) UI.tutStop({ done: false });
    if (UI.run && UI.run.tutorial) UI.run = null;
  }
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
  /* 量不到目标矩形时，正确做法是「不画高亮框 + 不压暗」，
     而不是把聚光块铺满屏或随便丢到某个角落 —— 后者会挡住玩家要点的东西。 */
  eq(spot.style.display, 'none', '没有布局信息时不画聚光块');
  eq($('tutDimTop').style.display, 'none', '也不该压暗上半屏');
  eq($('tutDimBottom').style.display, 'none', '也不该压暗下半屏');
  eq($('tutDimLeft').style.display, 'none', '也不该压暗左侧');
  eq($('tutDimRight').style.display, 'none', '也不该压暗右侧');
  ok($('tutDots').querySelectorAll('i').length === 11, '进度点应有 11 个');
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

test('设置里能「游戏帮助 / 货币说明」，点了打开帮助弹窗并讲清三种货币', () => {
  resetSave();
  UI.openSettings();
  const row = $('setList').querySelector('[data-set="help"]');
  ok(row, '设置里应该有「游戏帮助 / 货币说明」入口');
  includes($('setList').textContent, '游戏帮助');
  eq(UI.onSetting('help'), true, '点帮助应打开帮助弹窗');
  eq(UI.isModalOpen('modalHelp'), true, '帮助弹窗应打开');
  const body = $('helpBody').textContent;
  includes(body, '金币', '要讲金币');
  includes(body, '小费', '要讲小费');
  includes(body, '钻石', '要讲钻石');
  includes(body, '来源', '要分别讲来源');
  includes(body, '用途', '要分别讲用途');
  UI.closeModal('modalHelp');
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
