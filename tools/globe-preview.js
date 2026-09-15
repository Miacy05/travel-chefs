/* ==========================================================================
   tools/globe-preview.js —— 在终端里把程序化地球仪打印成字符画
   目的：不需要浏览器就能检查"这个球到底长什么样"（大陆是否成形、经纬线
   是否可读、轨道和星星位置是否合适）。纯调试工具，不参与发布产物。
   用法：node tools/globe-preview.js [角度1,角度2,...]
   ========================================================================== */
'use strict';

const { loadGame } = require('../tests/helpers.js');

const CH = { '.': ' ', k: '#', y: '·', m: 'O', w: '*', r: '@' };

const game = loadGame();
const P = game.TC.Pixel;
const spec = P.GLOBE_SPEC;

const thetas = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : [0, Math.PI / 4, Math.PI / 2];

console.log('网格 %dx%d  球半径=%s  轨道=%s  色号 P.globeBit 输出：',
  spec.size, spec.size, spec.radius, spec.orbit);
console.log('  · 海洋   O 陆地   * 云   # 描边/经纬线   @ 定位针\n');

thetas.forEach((theta) => {
  const cells = P.globePlaneCells(theta, spec);
  const plane = {};
  cells.forEach((c) => { plane[c.x + ':' + c.y] = c.ch; });

  console.log('---- theta = ' + theta.toFixed(2) + ' rad ----');
  let rows = [];
  for (let gy = 0; gy < spec.size; gy++) {
    let line = '';
    for (let gx = 0; gx < spec.size; gx++) {
      const k = gx + ':' + gy;
      const ch = plane[k] !== undefined ? plane[k] : P.globeBit(gx, gy, theta, spec);
      line += CH[ch] === undefined ? '?' : CH[ch];
    }
    rows.push(line);
  }
  console.log(rows.join('\n'));
  console.log('');
});

/* 顺带统计一下各色号占比，确认"海洋为主、陆地成块、云不多不少" */
const stat = {};
for (let gy = 0; gy < spec.size; gy++) {
  for (let gx = 0; gx < spec.size; gx++) {
    const ch = P.globeBit(gx, gy, 0, spec);
    stat[ch] = (stat[ch] || 0) + 1;
  }
}
console.log('theta=0 各色号格子数：', JSON.stringify(stat), ' 合计', spec.size * spec.size);
