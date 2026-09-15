/* ==========================================================================
   tests/daily.test.js —— 对应模块 TC.Daily（每日任务按日期可复现）
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, eq, section, deepEq, gt } = H;

section('TC.Daily');
const { TC } = loadGame();
const Y = TC.Daily;
const S = TC.Save;
const D = TC.DATA;

test('randFor：同一天必然拿到同一串随机数', () => {
  const a = Y.randFor('2026-09-15');
  const b = Y.randFor('2026-09-15');
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  deepEq(seqA, seqB);
  seqA.forEach((v) => ok(v >= 0 && v < 1, '随机数应落在 [0,1)'));
});

test('不同日期会拿到不同的随机序列', () => {
  const a = Y.randFor('2026-09-15');
  const b = Y.randFor('2026-09-16');
  ok(a() !== b(), '相邻日期不该完全一致');
});

test('idsFor：每天 3 条、不重复、都来自任务池', () => {
  const ids = Y.idsFor('2026-09-15');
  eq(ids.length, 3);
  eq(new Set(ids).size, 3, '同一批不能重复');
  ids.forEach((id) => ok(D.task(id), id + ' 不在任务池里'));
});

test('idsFor 是确定性的：调用顺序不影响结果', () => {
  const dates = ['2026-09-15', '2026-09-16', '2026-10-01', '2027-01-01', '2026-02-28'];
  const forward = {};
  dates.forEach((d) => { forward[d] = Y.idsFor(d).join(','); });
  const backward = {};
  dates.slice().reverse().forEach((d) => { backward[d] = Y.idsFor(d).join(','); });
  dates.forEach((d) => eq(backward[d], forward[d], d + ' 的结果应可复现'));
});

test('idsFor 不受存档与全局状态影响', () => {
  const a = Y.idsFor('2026-09-15').join(',');
  S.blank();
  S.addCoins(S.blank(), 1000);
  const b = Y.idsFor('2026-09-15').join(',');
  eq(a, b);
});

test('日期分布：不同日期的组合并非永远相同', () => {
  const set = new Set();
  for (let i = 1; i <= 20; i++) {
    set.add(Y.idsFor('2026-09-' + (i < 10 ? '0' + i : i)).join(','));
  }
  gt(set.size, 1, '20 天里不该永远抽出同一组任务');
});

test('tasksFor 返回存档用的形状', () => {
  const t = Y.tasksFor('2026-09-15');
  eq(t.length, 3);
  t.forEach((x) => {
    eq(Object.keys(x).join(','), 'id');
    ok(D.task(x.id));
  });
  eq(Y.tasksFor('2026-09-15').map((x) => x.id).join(','), Y.idsFor('2026-09-15').join(','));
});

test('metricKeyOf / progressOf 读取今日计数', () => {
  const s = S.blank();
  const task = D.task('d_plays');
  eq(Y.metricKeyOf(task), 'plays');
  eq(Y.progressOf(s, task), 0);
  s.daily.metrics.plays = 3;
  eq(Y.progressOf(s, task), 3);
  eq(Y.progressOf(s, null), 0);
});

test('rows：抽完任务后 3 行，进度为 0、不可领', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  const rows = Y.rows(s);
  eq(rows.length, 3);
  rows.forEach((r) => {
    eq(r.cur, 0);
    eq(r.done, false);
    eq(r.canClaim, false);
    eq(r.claimed, false);
    gt(r.target, 0);
    ok(r.name, '缺少任务名');
    ok(r.rewardText.indexOf('🪙') === 0 || r.rewardText.indexOf('💎') === 0, '奖励文案格式不对');
  });
  eq(Y.claimableCount(s), 0);
  eq(Y.doneCount(s), 0);
});

test('rows：进度会被 target 截断，达成后可领', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  const rows = Y.rows(s);
  const r = rows[0];
  s.daily.metrics[r.task.metric] = r.task.target + 50;
  const again = Y.rows(s)[0];
  eq(again.cur, again.target, '进度条不该超过 target');
  eq(again.done, true);
  eq(again.canClaim, true);
  eq(Y.claimableCount(s), 1);
  eq(Y.doneCount(s), 1);
});

test('rows：已领取的任务不再出现在可领列表', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  const r = Y.rows(s)[0];
  s.daily.metrics[r.task.metric] = r.task.target;
  const res = S.claimTask(s, r.id);
  eq(res.ok, true);
  const after = Y.rows(s).filter((x) => x.id === r.id)[0];
  eq(after.claimed, true);
  eq(after.canClaim, false);
  eq(Y.claimableCount(s), 0);
});

test('rows 会跳过被删掉的任务 id，不会崩', () => {
  const s = S.blank();
  S.checkDaily(s, '2026-09-15');
  s.daily.tasks.push({ id: 'ghost_task' });
  eq(Y.rows(s).length, 3, '无效 id 被忽略');
});

test('每日三题都来自不同的功能面（不含重复 id）', () => {
  for (const d of ['2026-01-01', '2026-06-15', '2026-12-31']) {
    const ids = Y.idsFor(d);
    eq(new Set(ids).size, 3, d + ' 抽到了重复任务');
  }
});
