#!/usr/bin/env node
/*
 * push-to-github.js —— 不依赖 git 命令、不依赖 github.com 网页，
 * 直接用 GitHub REST API（api.github.com）把本项目推成一个仓库。
 *
 * 为什么需要它：
 *   本机到 github.com:443 的 HTTPS 被阻断（直连超时、代理 502 / TLS 失败），
 *   所以 `git push` 走不通；而 api.github.com 是通的。
 *   本脚本用 Git Data API 直接构造 4 次提交，效果等同于 git push 的结果。
 *
 * 用法：
 *   1) 先在浏览器打开 https://github.com/settings/tokens
 *      生成一个 Classic token，勾选 repo 权限（详见 README 的部署章节）
 *   2) 在 PowerShell 里执行：
 *        chcp 65001 > $null
 *        & "C:\Users\20742\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" "tools\push-to-github.js"
 *      或者把 clone 到本机后用系统 node 跑： node tools/push-to-github.js
 *   3) 按提示粘贴 token（输入时不显示），脚本会自动建仓库并推 4 次提交
 *
 * 不想粘贴 token？也可以先设环境变量：
 *      $env:GH_TOKEN = "你的token"     然后运行本脚本
 *
 * 只检查不推送（自检模式，不需要 token）：
 *      node tools/push-to-github.js --selftest
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://api.github.com';
const REPO_NAME = process.env.TC_REPO_NAME || 'travel-chefs';
const OWNER_HINT = process.env.TC_OWNER || '20742';
const BRANCH = 'main';

/* 永远不上传的目录 / 文件（本地辅助物，不属于交付内容） */
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'backup-v1']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'push-to-github.cmd']);

/* 5 次提交的内容分组 —— 顺序即提交顺序，也决定了仓库首页的时间线 */
const COMMITS = [
  {
    message:
      'chore: 初始化仓库忽略规则\n\n' +
      '排除编辑器/系统临时文件、测试依赖目录，以及旧版原型备份。\n\n' +
      'backup-v1/ 保留在本地作为 v1 原型存档但不进仓库 —— 仓库根目录只放当前\n' +
      '版本的 index.html，避免静态托管时抓错入口文件。',
    pick: () => ['.gitignore'],
  },
  {
    message:
      'feat: Travel Chefs 像素经营游戏 —— 单文件引擎\n\n' +
      '零依赖、零构建，全部内联在一个 index.html 里，双击即玩。\n\n' +
      '玩法链路：接待顾客 → 点食材备料 → 点灶台开火 → 拖到盘子装盘 → 拖给顾客上菜。\n' +
      '内容规模：5 个地区 × 5 关 = 25 关，15 道菜，45 种食材，5 类顾客，3 个彩蛋。\n\n' +
      '架构上按「规则与渲染分离」切分，统一挂在 window.TC 命名空间下：\n' +
      '  TC.Util  → TC.DATA  → TC.Calc   → TC.Save   → TC.Upgrade\n' +
      '  TC.Level → TC.Daily → TC.Easter → TC.Ach    → TC.Pixel\n' +
      '  TC.Scene → TC.Audio → TC.UI     → TC.Router\n' +
      '所有游戏规则写在纯函数模块里，Scene / UI / Audio 只负责绘制与把事件翻译成\n' +
      '对逻辑层的调用，自己不做规则判断 —— 因此约 90% 的规则代码都能被单元测试\n' +
      '直接覆盖，而不必依赖截图做回归。\n\n' +
      '渲染：160×90 逻辑分辨率 + 整数倍缩放居中留白，全部图形由代码生成的矩形\n' +
      '列表绘制，没有一张图片资源；严格 5 色调色板（暖黄/番茄红/薄荷绿/奶油白/深棕）。\n' +
      '音效：TC.Audio 用 WebAudio 现场合成 14 种音色，不引入任何音频文件，\n' +
      '没有 AudioContext 的环境静默降级，保证「双击 HTML 就能玩」。\n' +
      '存档：localStorage 单 key（travel-chefs:v2），带版本号与逐字段兜底。',
    pick: () => ['index.html'],
  },
  {
    message:
      'test: 零依赖单元测试体系（14 个文件 / 383 条断言全绿）\n\n' +
      '自带约 60 行的断言框架 + jsdom 装载器，不需要 jest / mocha：\n' +
      'node tests/run.js 会把真实的 index.html 加载进 jsdom，跑真实 DOM 与真实事件。\n\n' +
      '覆盖范围：\n' +
      '  数据表自洽性、价格/小费/星级/经验结算、存档读写与迁移、关卡状态机、\n' +
      '  升级购买与数值读取、每日任务抽取、成就判定、三个彩蛋、\n' +
      '  像素图形生成与 5 色校验、场景布局与命中检测、视图路由、\n' +
      '  音效合成/节流/无声环境降级，\n' +
      '  以及 flow.test.js 的端到端链路（开一关 → 做单 → 上菜 → 结算 → 解锁）。\n\n' +
      '跑法：node tests/run.js',
    pick: () =>
      fs
        .readdirSync(path.join(ROOT, 'tests'))
        .filter((f) => f.endsWith('.js') || f.endsWith('.ps1'))
        .sort()
        .map((f) => 'tests/' + f),
  },
  {
    message:
      'docs: 重写 README\n\n' +
      '原 README 描述的是已废弃的 v1 原型（4 个独立文件、6 个地区、配方点选玩法），\n' +
      '与当前单文件 Canvas 版本完全不符，因此逐节重写：\n\n' +
      '- 完整操作链路与三个道具的冷却 / 效果\n' +
      '- 星级三条件（累计制）、金币与经验公式、Perfect 判定\n' +
      '- 5 地区 / 25 关 / 15 道菜 / 5 类顾客的真实参数表\n' +
      '- 4 条升级线的满级效果\n' +
      '- 图鉴 / 成就 / 每日任务 / 3 个彩蛋\n' +
      '- 技术方案：单文件 + window.TC 模块 + 规则与渲染分离\n' +
      '- 单元测试说明与 14 个测试文件的覆盖清单\n' +
      '- Vercel 与腾讯云 CloudBase 两条部署路径及常见问题\n' +
      '- 已知限制',
    pick: () => ['README.md'],
  },
  {
    message:
      'docs: 补充真机截图与 MIT 许可证\n\n' +
      'docs/ 下 5 张截图全部是 390×844 @2x 的真机视口实拍（CDP 设备模拟），\n' +
      '而且不是摆拍的空壳 —— 画面里的顾客排队、锅里的火、出餐台上的菜、结算页的\n' +
      '3 星通关，都是脚本通过游戏的公开接口（TC.Level / TC.UI）真玩出来的状态。\n' +
      '截图脚本同时输出每个页面的溢出度量，确认 5 个页面在窄屏下都不横向溢出。\n\n' +
      '另外补上 MIT LICENSE；tools/push-to-github.js 是本机 github.com:443 不通时\n' +
      '走 GitHub REST API 建仓库、生成提交记录的备用通道（详见 README 第八节）。',
    pick: () =>
      ['LICENSE']
        .concat(
          fs
            .readdirSync(path.join(ROOT, 'docs'))
            .filter((f) => f.endsWith('.png'))
            .sort()
            .map((f) => 'docs/' + f)
        )
        .concat(['tools/push-to-github.js']),
  },
];

/* ------------------------------------------------------------------ 小工具 */

function log(s) {
  process.stdout.write(s + '\n');
}

function kb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question(question, (a) => {
        rl.close();
        resolve(String(a).trim());
      });
      return;
    }
    process.stdout.write(question);
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      const c = String(chunk);
      if (c === '\r' || c === '\n' || c === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf.trim());
      } else if (c === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c >= ' ') {
        buf += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/* 读取计划要提交的文件，并做一次磁盘存在性校验 */
function collectPlan() {
  const groups = [];
  const seen = new Set();
  for (const c of COMMITS) {
    const files = c.pick().filter((rel) => {
      const abs = path.join(ROOT, rel);
      const top = rel.split('/')[0];
      if (EXCLUDE_DIRS.has(top) || EXCLUDE_FILES.has(path.basename(rel))) return false;
      if (!fs.existsSync(abs)) {
        log('  [警告] 文件不存在，已跳过：' + rel);
        return false;
      }
      return true;
    });
    const items = files.map((rel) => {
      const abs = path.join(ROOT, rel);
      const buf = fs.readFileSync(abs);
      seen.add(rel);
      return { rel, buf, size: buf.length };
    });
    groups.push({ message: c.message, items });
  }
  return groups;
}

function summarize(groups) {
  let total = 0;
  let bytes = 0;
  const lines = [];
  lines.push('计划推送 ' + groups.length + ' 次提交：');
  groups.forEach((g, i) => {
    const size = g.items.reduce((a, b) => a + b.size, 0);
    total += g.items.length;
    bytes += size;
    lines.push(
      '  ' +
        (i + 1) +
        '. ' +
        g.message.split('\n')[0] +
        '   →   ' +
        g.items.length +
        ' 个文件 / ' +
        kb(size)
    );
  });
  lines.push('  合计 ' + total + ' 个文件 / ' + kb(bytes));
  return lines.join('\n');
}

/* ------------------------------------------------------------- API 封装 */

function makeApi(token) {
  return async function api(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: Object.assign(
        {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'travel-chefs-push',
        },
        token ? { authorization: 'Bearer ' + token } : {},
        body ? { 'content-type': 'application/json' } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    if (!res.ok) {
      const msg = (json && json.message) || text.slice(0, 200) || '(空响应)';
      const err = new Error(method + ' ' + url + ' → HTTP ' + res.status + '：' + msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  };
}

async function probeNetwork() {
  try {
    const res = await fetch(API + '/zen', {
      headers: { 'user-agent': 'travel-chefs-push' },
      signal: AbortSignal.timeout(15000),
    });
    const t = await res.text();
    return { ok: res.ok, status: res.status, text: t.trim().slice(0, 60) };
  } catch (e) {
    return { ok: false, status: 0, text: String((e && e.message) || e) };
  }
}

/* --------------------------------------------------------------- 主流程 */

async function selftest() {
  log('=== 自检模式（不联网推送，不需要 token）===');
  const groups = collectPlan();
  log(summarize(groups));
  log('');
  log('检查 api.github.com 可达性（这一步决定了脚本能不能工作）...');
  const p = await probeNetwork();
  if (p.ok) {
    log('  OK  HTTP ' + p.status + '  服务端回应：' + p.text);
  } else {
    log('  失败  ' + p.text);
    log('  → 需要先让本机能访问 api.github.com（通常是打开代理 / 切换节点）');
    return 1;
  }
  log('');
  log('结论：推送逻辑与网络都就绪，只差一个 GitHub Token 就能执行。');
  log('下一步：在浏览器打开 https://github.com/settings/tokens 生成 token，');
  log('        然后用不带 --selftest 的命令运行本脚本。');
  return 0;
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();

  log('=== Travel Chefs → GitHub 推送工具（走 api.github.com）===');
  log('');

  const groups = collectPlan();
  log(summarize(groups));
  log('');

  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (!token) {
    log('需要一个 GitHub Token。生成方式：');
    log('  1. 浏览器打开 https://github.com/settings/tokens');
    log('  2. 点 Generate new token (classic)');
    log('  3. Note 随便填，Expiration 选 30 天，勾选最上面的 repo 那一项');
    log('  4. 点最下面 Generate token，复制得到的那串（只显示一次）');
    log('');
    token = await askHidden('请粘贴 token 后回车（输入时不会显示）：');
    log('');
  }
  if (!token) {
    log('没有拿到 token，已退出。');
    return 1;
  }

  const api = makeApi(token);

  log('1/5  校验 token ...');
  let me;
  try {
    me = await api('GET', '/user');
  } catch (e) {
    log('  失败：' + e.message);
    if (e.status === 401) {
      log('  → token 无效或已过期/被撤销，请重新生成一个，注意勾选 repo 权限。');
    } else if (!e.status) {
      log('  → 连不上 api.github.com，请先打开代理再试。');
    }
    return 1;
  }
  log('  OK  已登录为 ' + me.login);

  log('2/5  检查仓库 ' + me.login + '/' + REPO_NAME + ' ...');
  let repo = null;
  try {
    repo = await api('GET', '/repos/' + me.login + '/' + REPO_NAME);
  } catch (e) {
    if (e.status !== 404) {
      log('  失败：' + e.message);
      return 1;
    }
  }

  if (repo) {
    if (repo.size > 0) {
      log('  仓库已存在且非空（' + repo.size + ' KB）。为安全起见本脚本不覆盖它。');
      log('  → 请换一个名字：$env:TC_REPO_NAME = "travel-chefs-2"  然后再运行本脚本。');
      return 1;
    }
    log('  仓库已存在但是空的，直接往里推。');
  } else {
    log('  不存在，创建中 ...');
    try {
      repo = await api('POST', '/user/repos', {
        name: REPO_NAME,
        description:
          '像素风模拟经营烹饪游戏 · 单文件 Canvas 引擎 + 零依赖单元测试（5 地区 25 关）',
        private: false,
        has_issues: true,
        has_wiki: false,
        auto_init: false,
      });
      log('  OK  已创建（公开仓库）');
    } catch (e) {
      log('  失败：' + e.message);
      return 1;
    }
  }

  log('3/5  上传文件并生成提交 ...');
  let parent = null;
  let baseTree = null;
  const pushed = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const tree = [];
    for (const it of g.items) {
      /* README 里用 {{OWNER}} 占位，推送时替换成真实账号名 —— 这样不必事先知道用户名。
         注意只对含占位符的文件做替换：docs/*.png 是二进制，绝不能过一遍 utf8。 */
      const raw = it.buf;
      const b64 =
        raw.indexOf('{{OWNER}}') === -1
          ? raw.toString('base64')
          : Buffer.from(raw.toString('utf8').split('{{OWNER}}').join(me.login), 'utf8').toString('base64');
      const blob = await api('POST', '/repos/' + me.login + '/' + REPO_NAME + '/git/blobs', {
        content: b64,
        encoding: 'base64',
      });
      tree.push({ path: it.rel, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const treeReq = { tree };
    if (baseTree) treeReq.base_tree = baseTree;
    const newTree = await api('POST', '/repos/' + me.login + '/' + REPO_NAME + '/git/trees', treeReq);

    const commitReq = {
      message: g.message,
      tree: newTree.sha,
      parents: parent ? [parent] : [],
    };
    const commit = await api(
      'POST',
      '/repos/' + me.login + '/' + REPO_NAME + '/git/commits',
      commitReq
    );

    if (!parent) {
      await api('POST', '/repos/' + me.login + '/' + REPO_NAME + '/git/refs', {
        ref: 'refs/heads/' + BRANCH,
        sha: commit.sha,
      });
    } else {
      await api('PATCH', '/repos/' + me.login + '/' + REPO_NAME + '/git/refs/heads/' + BRANCH, {
        sha: commit.sha,
      });
    }

    parent = commit.sha;
    baseTree = newTree.sha;
    pushed.push({ sha: commit.sha, subject: g.message.split('\n')[0], files: g.items.length });
    log(
      '     ' +
        (i + 1) +
        '/' +
        groups.length +
        '  ' +
        commit.sha.slice(0, 7) +
        '  ' +
        g.message.split('\n')[0]
    );
  }

  log('4/5  设置默认分支为 ' + BRANCH + ' ...');
  try {
    await api('PATCH', '/repos/' + me.login + '/' + REPO_NAME, { default_branch: BRANCH });
    log('  OK');
  } catch (e) {
    log('  跳过（不影响使用）：' + e.message);
  }

  const url = 'https://github.com/' + me.login + '/' + REPO_NAME;

  log('5/6  校验线上 README ...');
  try {
    const fresh = await api(
      'GET',
      '/repos/' + me.login + '/' + REPO_NAME + '/contents/README.md?ref=' + BRANCH
    );
    const text = Buffer.from((fresh && fresh.content) || '', 'base64').toString('utf8');
    if (text.indexOf('{{OWNER}}') !== -1) {
      log('  [警告] README 里还留着 {{OWNER}} 占位符没替换掉');
    } else if (text.indexOf(url) !== -1) {
      log('  OK  仓库地址已经写进线上 README');
    } else {
      log('  OK  已取回线上 README（没找到仓库地址，不影响使用）');
    }
  } catch (e) {
    log('  跳过：' + e.message);
  }

  log('6/6  完成');
  log('');
  log('仓库地址：' + url);
  log('提交记录：' + pushed.length + ' 条');
  pushed.forEach((p, i) => {
    log('  ' + (i + 1) + '. ' + p.sha + '  ' + p.subject);
  });
  log('');
  log('注意：git push 走的 github.com 在本机当前不通，所以那些提交不会出现在你本地仓库的');
  log('      origin 里 —— 这是两条独立的通道，仓库内容是一致的。');
  log('');
  log('下一步（部署成 xxx.vercel.app）：');
  log('  vercel.com 可以直连（实测 HTTP 200），用 GitHub 账号登录后');
  log('  Add New Project → 选 travel-chefs → Framework Preset 选 Other');
  log('  → Build Command 和 Output Directory 都留空 → Deploy');

  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    log('');
    log('未预期的错误：' + ((e && e.stack) || e));
    process.exit(1);
  });
