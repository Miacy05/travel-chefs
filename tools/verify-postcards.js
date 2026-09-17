/* ==========================================================================
   tools/verify-postcards.js —— 在真实浏览器里回读「明信片素材」的加载状态
   为什么不用 shell 直接传 JS：大段 JS 经过 bash 会被反引号展开 / GBK 转码破坏，
   所以这里从另一个 node 进程把 JS 作为独立 argv 交给 tools/shot.js。
   为什么需要它：本机环境看不了图片内容，只能用「图片是否真的解码成功」来验证，
   而不是靠肉眼。

   用法：node tools/verify-postcards.js            （本地源码，先造一份有进度的存档）
        node tools/verify-postcards.js --url=https://travel-chefs.vercel.app/
   ========================================================================== */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const REMOTE = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6);

const CHECK = `
(async function () {
  var names = ['china', 'france', 'japan', 'italy', 'mexico'];
  var lines = [];

  /* 1. 五张图能不能真的加载出来（naturalWidth 为 0 就是 404 或解码失败） */
  lines = lines.concat(await Promise.all(names.map(function (n) {
    return new Promise(function (done) {
      var im = new Image();
      var t0 = performance.now();
      im.onload = function () {
        done(n + '  ok  ' + im.naturalWidth + 'x' + im.naturalHeight +
             '  ' + Math.round(performance.now() - t0) + 'ms');
      };
      im.onerror = function () { done(n + '  FAIL  加载失败（404 或不是图片）'); };
      im.src = 'assets/postcards/' + n + '.png';
    });
  })));

  /* 2. 图鉴里的卡面渲染情况 */
  TC.Router.go('codex', { force: true, tab: 'book' });
  TC.UI.setBookTab('card');
  await new Promise(function (r) { setTimeout(r, 400); });

  var cards = [].slice.call(document.querySelectorAll('#sub-card .postcard'));
  var imgs = [].slice.call(document.querySelectorAll('#sub-card .pc-img'));
  var decoded = imgs.filter(function (i) { return i.naturalWidth > 0; });
  lines.push('图鉴卡面：' + cards.length + ' 张卡，' + imgs.length +
             ' 张带图，已解码 ' + decoded.length + ' 张');
  decoded.slice(0, 1).forEach(function (i) {
    lines.push('  卡面区域 ' + Math.round(i.clientWidth) + 'x' + i.clientHeight + ' px');
  });

  /* 3. 已解锁的卡 -> 大图弹窗 */
  var modal = document.getElementById('modalPostcard');
  var open = document.querySelector('#sub-card .postcard.is-open');
  if (open) {
    open.click();
    await new Promise(function (r) { setTimeout(r, 500); });
    var big = document.querySelector('#pcdScene .pcd-img');
    lines.push('大图弹窗：' + (modal.hasAttribute('hidden') ? '没打开(异常)' : '已打开') +
               '  ' + document.getElementById('pcdTitle').textContent +
               '  ' + document.getElementById('pcdStars').textContent);
    lines.push('大图：' + (big ? (big.naturalWidth + 'x' + big.naturalHeight +
               '  显示 ' + Math.round(big.clientWidth) + 'x' + big.clientHeight) : '没有 img'));
    TC.UI.closeModal('modalPostcard');
    await new Promise(function (r) { setTimeout(r, 200); });
    lines.push('关闭按钮：' + (modal.hasAttribute('hidden') ? '能关(正确)' : '关不掉(异常)'));
  }

  /* 4. 未解锁的卡 -> 只弹提示，不能开窗 */
  var locked = document.querySelector('#sub-card .postcard.is-locked');
  if (locked) {
    locked.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    var all = document.querySelectorAll('.toast');
    var t = all[all.length - 1];
    lines.push('未解锁卡：提示「' + (t ? t.textContent : '(无)') + '」' +
               '  弹窗' + (modal.hasAttribute('hidden') ? '未开(正确)' : '被打开(异常)'));
  }
  return lines.join('\\n');
})()
`;

const args = [path.join(__dirname, 'shot.js')];
if (REMOTE) args.push('--url=' + REMOTE);
else args.push('--seed=1');
args.push('--eval=' + CHECK);

const r = spawnSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === null ? 1 : r.status);
