/* ==========================================================================
   tests/harness.js —— 零依赖测试框架（断言 + 收集 + 报告）
   不引入 jest / mocha：自己 60 行搞定，保证 `node tests/run.js` 直接可跑。
   ========================================================================== */
'use strict';

const REGISTRY = [];
let CURRENT_SECTION = '';

/** 注册一条测试。fn 可以是 async。 */
function test(name, fn) {
  REGISTRY.push({ name, fn, section: CURRENT_SECTION });
}

/** 分组标题，只用于报告排版 */
function section(name) {
  CURRENT_SECTION = name;
}

/* ---------------------------- 断言 ---------------------------- */
class AssertError extends Error {}

function fail(msg) {
  throw new AssertError(msg);
}

function ok(cond, msg) {
  if (!cond) fail('ok 断言失败：' + (msg || '期望为真，实际为 ' + inspect(cond)));
}

function no(cond, msg) {
  if (cond) fail('no 断言失败：' + (msg || '期望为假，实际为 ' + inspect(cond)));
}

function eq(actual, expected, msg) {
  if (!looseEqual(actual, expected)) {
    fail('eq 断言失败：' + (msg || '') + '\n      期望: ' + inspect(expected) + '\n      实际: ' + inspect(actual));
  }
}

function ne(actual, expected, msg) {
  if (looseEqual(actual, expected)) {
    fail('ne 断言失败：' + (msg || '') + '\n      两者都等于: ' + inspect(actual));
  }
}

function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    fail('deepEq 断言失败：' + (msg || '') + '\n      期望: ' + b + '\n      实际: ' + a);
  }
}

function gt(actual, bound, msg) {
  if (!(actual > bound)) fail('gt 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应 > ' + inspect(bound));
}
function gte(actual, bound, msg) {
  if (!(actual >= bound)) fail('gte 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应 >= ' + inspect(bound));
}
function lt(actual, bound, msg) {
  if (!(actual < bound)) fail('lt 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应 < ' + inspect(bound));
}
function lte(actual, bound, msg) {
  if (!(actual <= bound)) fail('lte 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应 <= ' + inspect(bound));
}
function approx(actual, expected, eps, msg) {
  eps = eps == null ? 1e-6 : eps;
  if (Math.abs(actual - expected) > eps) {
    fail('approx 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应≈ ' + inspect(expected) + ' (±' + eps + ')');
  }
}
function inRange(actual, lo, hi, msg) {
  if (!(actual >= lo && actual <= hi)) {
    fail('inRange 断言失败：' + (msg || '') + ' ' + inspect(actual) + ' 应落在 [' + lo + ', ' + hi + ']');
  }
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) fail('throws 断言失败：' + (msg || '期望抛出异常，实际没有'));
}
function includes(haystack, needle, msg) {
  const h = Array.isArray(haystack) ? haystack : String(haystack);
  if (h.indexOf(needle) === -1) {
    fail('includes 断言失败：' + (msg || '') + '\n      容器: ' + inspect(haystack) + '\n      缺少: ' + inspect(needle));
  }
}
function includesNot(haystack, needle, msg) {
  const h = Array.isArray(haystack) ? haystack : String(haystack);
  if (h.indexOf(needle) !== -1) {
    fail('includesNot 断言失败：' + (msg || '') + '\n      容器不应包含: ' + inspect(needle));
  }
}

/** 一组键，全部必须存在 */
function hasKeys(obj, keys, msg) {
  const missing = keys.filter((k) => !(obj && Object.prototype.hasOwnProperty.call(obj, k)));
  if (missing.length) fail('hasKeys 断言失败：' + (msg || '') + ' 缺少字段 ' + missing.join(', '));
}

/* ---------------------------- 内部工具 ---------------------------- */
function looseEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  return false;
}

function inspect(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return '[Function ' + (v.name || 'anon') + ']';
  try {
    const s = JSON.stringify(v);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch (e) {
    return String(v);
  }
}

/* ---------------------------- 执行器 ---------------------------- */
async function runList(list, reporter) {
  const pass = [];
  const fail_ = [];
  for (const t of list) {
    const t0 = Date.now();
    try {
      await t.fn();
      const ms = Date.now() - t0;
      pass.push({ ...t, ms });
      reporter && reporter.pass && reporter.pass(t, ms);
    } catch (e) {
      const ms = Date.now() - t0;
      fail_.push({ ...t, ms, err: e });
      reporter && reporter.fail && reporter.fail(t, e, ms);
    }
  }
  return { pass, fail: fail_, total: list.length };
}

async function runAll(reporter) {
  return runList(REGISTRY.slice(), reporter);
}

function reset() { REGISTRY.length = 0; CURRENT_SECTION = ''; }

module.exports = {
  test, section, runAll, runList, reset, AssertError,
  ok, no, eq, ne, deepEq, gt, gte, lt, lte, approx, inRange, throws,
  includes, includesNot, hasKeys, inspect,
  registry: REGISTRY,
  get count() { return REGISTRY.length; }
};
