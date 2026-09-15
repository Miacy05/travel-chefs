/* ==========================================================================
   tests/run.js —— 测试入口
   用法：node tests/run.js           跑全部
        node tests/run.js calc     只跑名字含 calc 的文件
        node tests/run.js --list   只列出测试文件
   约定：每次改动 index.html 后必须跑一遍，全绿（退出码 0）才算完成。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./harness');

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

const filter = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const listOnly = process.argv.includes('--list');

/* ------------------------- 收集测试文件 ------------------------- */
let files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
if (filter.length) files = files.filter((f) => filter.some((k) => f.includes(k)));

if (listOnly) {
  process.stdout.write(files.join('\n') + '\n');
  process.exit(0);
}

if (!files.length) {
  process.stdout.write(C.r + '没有找到 *.test.js 测试文件' + C.x + '\n');
  process.exit(1);
}

/* ------------------------- 分文件加载 ------------------------- */
const groups = [];
const loadErrors = [];
for (const f of files) {
  const before = H.registry.length;
  try {
    require(path.join(__dirname, f));
  } catch (e) {
    loadErrors.push({ file: f, err: e });
  }
  groups.push({ file: f, tests: H.registry.slice(before) });
}

/* ------------------------- 执行 ------------------------- */
(async function main() {
  const t0 = Date.now();
  process.stdout.write('\n' + C.b + 'Travel Chefs · 单元测试' + C.x + '\n');
  process.stdout.write(C.d + 'index.html + tests/*.test.js（零依赖，无需 jest/mocha）' + C.x + '\n\n');

  let totalPass = 0, totalFail = 0, totalMs = 0;
  const failures = [];

  for (const g of groups) {
    const label = '  ' + g.file;
    if (!g.tests.length) {
      process.stdout.write(C.d + label.padEnd(34) + '  (无用例)' + C.x + '\n');
      continue;
    }
    const res = await H.runList(g.tests);
    totalPass += res.pass.length;
    totalFail += res.fail.length;
    totalMs += res.pass.concat(res.fail).reduce((a, b) => a + b.ms, 0);

    const mark = res.fail.length ? C.r + '✗' + C.x : C.g + '✓' + C.x;
    const cnt = res.pass.length + '/' + res.total;
    const pad = res.fail.length ? C.r + cnt : C.g + cnt;
    process.stdout.write(mark + C.b + label + C.x + '  ' + pad + C.x + C.d + '  ' + res.pass.concat(res.fail).reduce((a, b) => a + b.ms, 0) + 'ms' + C.x + '\n');

    for (const f of res.fail) {
      failures.push({ file: g.file, ...f });
    }
  }

  for (const le of loadErrors) {
    failures.push({ file: le.file, name: '(加载文件)', err: le.err });
    totalFail++;
  }

  /* ---------- 失败详情 ---------- */
  if (failures.length) {
    process.stdout.write('\n' + C.r + C.b + '失败详情' + C.x + '\n');
    for (const f of failures) {
      process.stdout.write('\n' + C.r + ' ✗ ' + f.file + ' › ' + f.name + C.x + '\n');
      const msg = f.err && f.err.stack ? f.err.stack : String(f.err);
      process.stdout.write(msg.split('\n').slice(0, 6).map((l) => '     ' + l).join('\n') + '\n');
    }
  }

  /* ---------- 汇总 ---------- */
  const dt = Date.now() - t0;
  process.stdout.write('\n' + '─'.repeat(52) + '\n');
  if (totalFail === 0) {
    process.stdout.write(
      C.g + C.b + '  全部通过' + C.x + '  ' + totalPass + ' 条断言  ·  ' +
      files.length + ' 个测试文件  ·  ' + dt + 'ms\n\n'
    );
  } else {
    process.stdout.write(
      C.r + C.b + '  失败 ' + totalFail + ' 条' + C.x + C.d + '（通过 ' + totalPass + ' 条 · ' + dt + 'ms）' + C.x + '\n' +
      C.d + '  请修好再继续，不要跳过。' + C.x + '\n\n'
    );
  }

  process.exit(totalFail === 0 ? 0 : 1);
})();
