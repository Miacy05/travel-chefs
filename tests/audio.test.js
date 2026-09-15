/* ==========================================================================
   tests/audio.test.js —— 对应模块 TC.Audio（WebAudio 音效合成）

   这个模块的特殊之处：它天生依赖浏览器音频能力，而 jsdom 没有 AudioContext。
   所以测试分两条线：
     ① 无声环境 —— 必须静默降级，绝不抛错（「双击 HTML 就能玩」的底线）；
     ② 注入假 AudioContext —— 验证真的把配方翻译成了正确的振荡器与包络。
   另外补一条回归断言：index.html 里出现的每个 sfx('x') 都必须在配方表里，
   防止以后加了新音效调用却忘了配音色（会静默无声，很难被发现）。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, deepEq, gt, gte, lte, includes, section } = H;

section('TC.Audio');
const { TC, window: win, html } = loadGame();
const A = TC.Audio;

/* ------------------------------ 假 AudioContext ------------------------------ */

function makeFake(opts) {
  opts = opts || {};
  const log = { oscs: [], gains: [], ramps: [], connect: 0, resumes: 0, throwOnOsc: false };

  function Ctor() {
    this.state = opts.state || 'running';
    this.currentTime = opts.currentTime == null ? 1.5 : opts.currentTime;
    this.destination = { tag: 'destination' };
    log.ctx = this;
  }
  Ctor.prototype.resume = function () {
    log.resumes += 1;
    this.state = 'running';
  };
  Ctor.prototype.createOscillator = function () {
    if (log.throwOnOsc) throw new Error('模拟音频硬件故障');
    const o = { type: '', frequency: { value: 0 }, out: null, started: [], stopped: [] };
    o.connect = (d) => { o.out = d; log.connect += 1; };
    o.start = (t) => o.started.push(t);
    o.stop = (t) => o.stopped.push(t);
    log.oscs.push(o);
    return o;
  };
  Ctor.prototype.createGain = function () {
    const g = { out: null };
    g.gain = {
      setValueAtTime: (v, t) => log.ramps.push({ how: 'set', v, t }),
      exponentialRampToValueAtTime: (v, t) => log.ramps.push({ how: 'ramp', v, t }),
    };
    g.connect = (d) => { g.out = d; log.connect += 1; };
    log.gains.push(g);
    return g;
  };
  return { Ctor, log };
}

/** 在「有假音频」的环境里跑一段测试，结束后彻底还原（避免污染其他测试文件） */
function withFake(opts, fn) {
  const pA = win.AudioContext, pW = win.webkitAudioContext;
  const fake = makeFake(opts);
  win.AudioContext = fake.Ctor;
  A.reset();
  try { return fn(fake); } finally {
    if (pA === undefined) delete win.AudioContext; else win.AudioContext = pA;
    if (pW === undefined) delete win.webkitAudioContext; else win.webkitAudioContext = pW;
    A.reset();
  }
}

/** 在「没有音频能力」的环境里跑一段测试 */
function withoutAudio(fn) {
  const pA = win.AudioContext, pW = win.webkitAudioContext;
  delete win.AudioContext;
  delete win.webkitAudioContext;
  A.reset();
  try { return fn(); } finally {
    if (pA === undefined) delete win.AudioContext; else win.AudioContext = pA;
    if (pW === undefined) delete win.webkitAudioContext; else win.webkitAudioContext = pW;
    A.reset();
  }
}

const save = (sound) => ({ settings: { sound } });

/* ------------------------------ 模块契约 ------------------------------ */

test('TC.Audio 挂在命名空间上，并给出完整的音效清单', () => {
  ok(A, 'TC.Audio 应存在');
  eq(typeof A.play, 'function');
  eq(typeof A.kinds, 'function');
  eq(typeof A.enabled, 'function');
  const kinds = A.kinds();
  eq(kinds.length, 15, '配方数量变了要同步更新这条断言');
  ['tap', 'deny', 'add', 'fire', 'coin', 'perfect', 'lost', 'easter', 'alert'].forEach((k) => {
    includes(kinds, k, '缺少音效 ' + k);
  });
});

test('回归：index.html 里出现的每个 sfx(x) 都有对应音效配方', () => {
  // 从真实源码里抓所有 sfx('xxx') 调用点
  const used = (html.match(/sfx\('([a-z_]+)'\)/g) || [])
    .map((s) => s.replace(/^sfx\('/, '').replace(/'\)$/, ''));
  ok(used.length > 0, '源码里应能找到 sfx 调用');
  const kinds = A.kinds();
  const missing = used.filter((k) => kinds.indexOf(k) === -1);
  eq(missing.join(','), '', '这些音效被调用但没有配方，会静默无声：' + missing.join(', '));
  // 反向：配方表里不该有永远不会响的死音色
  const unused = kinds.filter((k) => used.indexOf(k) === -1);
  eq(unused.join(','), '', '这些配方没有任何调用点，属于死配置：' + unused.join(', '));
});

test('每个配方的结构合法：波形 / 音量 / 音符序列', () => {
  const okTypes = ['sine', 'square', 'triangle', 'sawtooth'];
  A.kinds().forEach((k) => {
    const r = A.RECIPES[k];
    includes(okTypes, r.type, k + ' 的波形非法');
    gt(r.gain, 0, k + ' 音量应 > 0');
    lte(r.gain, 0.1, k + ' 音量过大，会刺耳');
    gt(r.notes.length, 0, k + ' 至少要有一个音符');
    let lastEnd = 0;
    r.notes.forEach((n, i) => {
      eq(n.length, 3, k + ' 第 ' + i + ' 个音符应形如 [频率, 起始, 时长]');
      gte(n[0], 20, k + ' 频率低于人耳可听下限');
      lte(n[0], 20000, k + ' 频率高于人耳可听上限');
      gte(n[1], 0, k + ' 起始偏移不能为负');
      gt(n[2], 0, k + ' 时长应为正');
      lastEnd = Math.max(lastEnd, n[1] + n[2]);
    });
    lte(lastEnd, 0.5, k + ' 总时长 ' + lastEnd + 's 太长，会影响操作手感');
  });
});

/* ------------------------------ 无声环境降级 ------------------------------ */

test('没有 AudioContext 时：play 返回 false 且不抛错', () => {
  withoutAudio(() => {
    eq(A.ready(), false);
    eq(A.play('tap', save(true)), false);
    eq(A.play('deny'), false);
  });
});

test('无声环境下 kinds / enabled 仍然可用（不依赖音频能力）', () => {
  withoutAudio(() => {
    eq(A.kinds().length, 15);
    eq(A.enabled(save(true)), true);
    eq(A.enabled(save(false)), false);
  });
});

test('构造 AudioContext 抛异常时静默降级，不往外抛', () => {
  withoutAudio(() => {
    win.AudioContext = function () { throw new Error('浏览器拒绝创建音频上下文'); };
    try {
      eq(A.play('tap', save(true)), false, '构造失败应返回 false');
      eq(A.play('tap', save(true)), false, '失败后不再反复重试');
    } finally { delete win.AudioContext; A.reset(); }
  });
});

/* ------------------------------ 声音开关 ------------------------------ */

test('声音开关关闭时：不发声，也不创建任何音频节点', () => {
  withFake({}, (f) => {
    eq(A.play('tap', save(false)), false);
    eq(f.log.oscs.length, 0, '关掉声音就一个振荡器都不该建');
    eq(f.log.gains.length, 0);
  });
});

test('存档里没有 settings.sound 字段时按开启处理', () => {
  withFake({}, () => {
    eq(A.enabled({}), true);
    eq(A.enabled({ settings: {} }), true);
    eq(A.enabled(null), true);
    eq(A.play('tap', {}), true);
  });
});

test('sound 明确为 true 时正常发声', () => {
  withFake({}, (f) => {
    eq(A.play('tap', save(true)), true);
    gt(f.log.oscs.length, 0);
  });
});

/* ------------------------------ 合成细节 ------------------------------ */

test('单音符音效：频率与波形取自配方，信号链完整', () => {
  withFake({ currentTime: 2 }, (f) => {
    eq(A.play('tap', save(true)), true);
    eq(f.log.oscs.length, 1);
    const o = f.log.oscs[0];
    const g = f.log.gains[0];
    eq(o.frequency.value, A.RECIPES.tap.notes[0][0]);
    eq(o.type, A.RECIPES.tap.type);
    eq(o.out, g, '振荡器应接到增益上');
    eq(g.out, f.log.ctx.destination, '增益应接到输出');
  });
});

test('多音符音效：按配方的起始偏移依次排开，时间从 currentTime 起算', () => {
  withFake({ currentTime: 10 }, (f) => {
    A.play('serve', save(true));
    const notes = A.RECIPES.serve.notes;
    eq(f.log.oscs.length, notes.length, '音符数应与振荡器数一致');
    f.log.oscs.forEach((o, i) => {
      eq(o.started[0], 10 + notes[i][1], '第 ' + i + ' 个音的起始时间不对');
    });
    // 起始时间必须严格递增，否则会听成和弦而不是旋律
    for (let i = 1; i < notes.length; i++) gt(notes[i][1], notes[i - 1][1], '第 ' + i + ' 个音应更晚');
  });
});

test('每个音符都有「起音 → 峰值 → 收敛到静音」的包络，且 stop 晚于 start', () => {
  withFake({}, (f) => {
    A.play('coin', save(true));
    const notes = A.RECIPES.coin.notes;
    // 每个音符 3 个包络控制点：set 极小值 → ramp 到配方音量 → ramp 回静音
    eq(f.log.ramps.length, notes.length * 3, '每个音符应有 3 个包络控制点');
    for (let i = 0; i < notes.length; i++) {
      const attack = f.log.ramps[i * 3];
      const peak = f.log.ramps[i * 3 + 1];
      const decay = f.log.ramps[i * 3 + 2];
      eq(attack.how, 'set');
      lte(attack.v, 0.001, '起音必须从极小值开始，避免爆音');
      eq(peak.how, 'ramp');
      eq(peak.v, A.RECIPES.coin.gain, '峰值应等于配方音量');
      eq(decay.how, 'ramp');
      lte(decay.v, 0.001, '结尾应收敛到静音');
      gt(peak.t, attack.t, '爬升必须晚于起音');
      gt(decay.t, peak.t, '衰减必须晚于峰值');
      const o = f.log.oscs[i];
      ok(o.stopped[0] > o.started[0], '第 ' + i + ' 个音应真的响了一段时间');
    }
  });
});

test('包络峰值等于配方音量（音量不会被写死）', () => {
  withFake({}, (f) => {
    A.play('easter', save(true));
    const peak = f.log.ramps.filter((r) => r.how === 'ramp' && r.v > 0.001)[0];
    eq(peak.v, A.RECIPES.easter.gain);
  });
});

/* ------------------------------ 异常与边界 ------------------------------ */

test('未知音效名返回 false，且不创建节点', () => {
  withFake({}, (f) => {
    eq(A.play('no_such_sound', save(true)), false);
    eq(A.play('', save(true)), false);
    eq(A.play(undefined, save(true)), false);
    eq(f.log.oscs.length, 0);
  });
});

test('音频节点创建失败时返回 false，绝不把异常抛给玩法层', () => {
  withFake({}, (f) => {
    f.log.throwOnOsc = true;
    eq(A.play('tap', save(true)), false, '应吞掉异常并返回 false');
    f.log.throwOnOsc = false;
    A.reset();
    eq(A.play('tap', save(true)), true, '恢复后应还能正常发声');
  });
});

test('reset() 能丢弃上下文，让下一次 play 重新建立', () => {
  withFake({}, (f) => {
    A.play('tap', save(true));
    eq(A.ready(), true);
    const built = f.log.oscs.length;
    A.reset();
    eq(A.ready(), false, 'reset 后应回到未初始化状态');
    A.play('tap', save(true));
    gt(f.log.oscs.length, built, '应重新建了上下文');
  });
});

/* ------------------------------ 节流 ------------------------------ */

test('同一音效在节流窗口内不会重复发声（防连点糊成噪音）', () => {
  withFake({}, (f) => {
    eq(A.play('tap', save(true), 1000), true, '第一次应发声');
    eq(A.play('tap', save(true), 1010), false, '10ms 后重复应被节流');
    eq(A.play('tap', save(true), 1039), false, '窗口内仍应被节流');
    eq(f.log.oscs.length, 1);
  });
});

test('节流边界：正好间隔 THROTTLE_MS 可以发声', () => {
  withFake({}, (f) => {
    const gap = A.THROTTLE_MS;
    eq(A.play('tap', save(true), 1000), true);
    eq(A.play('tap', save(true), 1000 + gap), true, '达到间隔应放行');
    eq(f.log.oscs.length, 2);
  });
});

test('节流按音效名各自独立：一种被节流不影响另一种', () => {
  withFake({}, (f) => {
    eq(A.play('tap', save(true), 1000), true);
    eq(A.play('tap', save(true), 1005), false, 'tap 被节流');
    eq(A.play('deny', save(true), 1005), true, 'deny 不该受 tap 影响');
    // tap 单音符，deny 双音符 → 共 3 个振荡器
    eq(f.log.oscs.length, 1 + A.RECIPES.deny.notes.length);
    eq(f.log.oscs[1].frequency.value, A.RECIPES.deny.notes[0][0], '响的应是 deny 而不是 tap');
  });
});

/* ------------------------------ 上下文恢复 ------------------------------ */

test('上下文处于 suspended 时自动 resume（从后台切回的场景）', () => {
  withFake({ state: 'suspended' }, (f) => {
    eq(A.play('tap', save(true)), true);
    eq(f.log.resumes, 1, '应尝试恢复被挂起的上下文');
    eq(f.log.ctx.state, 'running');
  });
});

test('上下文本来就正常时不调用 resume', () => {
  withFake({ state: 'running' }, (f) => {
    A.play('tap', save(true));
    eq(f.log.resumes, 0);
  });
});

test('resume() 在没有上下文时安全返回 false', () => {
  withoutAudio(() => { eq(A.resume(), false); });
});
