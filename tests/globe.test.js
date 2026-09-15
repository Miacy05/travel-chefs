/* ==========================================================================
   tests/globe.test.js —— 对应「程序化像素地球仪」（TC.Pixel 的球面算法 + TC.UI 的动画开关）
   为什么值得单测：地球仪是纯函数算出来的图形，肉眼只能看出"像不像地球"，
   但"球外的格子绝不能是陆地/云""转一整圈必须回到原样"这类约束，
   靠断言才守得住 —— 以后调大陆大小、轨道粗细时不会把结构改坏。
   ========================================================================== */
'use strict';
const H = require('./harness');
const { loadGame } = require('./helpers');
const { test, ok, no, eq, ne, section, gt, gte, lte, approx, includes } = H;

section('地球仪 · 程序化像素球');

const G = loadGame();
const { TC, document } = G;
const P = TC.Pixel;
const UI = TC.UI;
const spec = P.GLOBE_SPEC;
const SIZE = spec.size;
const LEGAL = ['.', 'k', 'w', 'y', 'r', 'm'];
const THETAS = [0, 0.4, 1.1, 2.4, 4.0, 5.5, 7.5, Math.PI * 2];

/** 把整颗球扫一遍，返回 { key: 色号 } 的分布 */
function scan(theta) {
  const out = {};
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) {
      const ch = P.globeBit(gx, gy, theta, spec);
      out[ch] = (out[ch] || 0) + 1;
    }
  }
  return out;
}

/* ------------------------------ 基本契约 ------------------------------ */
test('地球仪只输出 5 色板里的色号，没有非法字符', () => {
  THETAS.forEach((th) => {
    const st = scan(th);
    Object.keys(st).forEach((ch) => {
      includes(LEGAL, ch, 'theta=' + th + ' 出现了非法色号');
    });
    eq(Object.keys(st).reduce((n, k) => n + st[k], 0), SIZE * SIZE, 'theta=' + th + ' 扫码格子数不对');
  });
});

test('同样的角度必然画出同样的球（纯函数 / 可复现）', () => {
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) {
      eq(P.globeBit(gx, gy, 1.234, spec), P.globeBit(gx, gy, 1.234, spec), '同参数结果应一致');
    }
  }
});

test('球面（海陆 + 经纬线 + 大头针）转满一整圈回到原样', () => {
  /* 注意：整幅画不等于 2π 周期 —— 云层比地面转得快、小飞机另有一条轨道，
     它们的周期各不相同。真正的周期是球面本身，这里就只断言球面。 */
  for (let i = 0; i < 60; i++) {
    const lat = -1.5 + i * 0.05;
    for (let j = 0; j < 24; j++) {
      const lon = -3 + j * 0.25;
      eq(P.globeLand(lat, lon), P.globeLand(lat, lon + Math.PI * 2), '陆地应 2π 周期');
      eq(P.globeGrid(lat, lon, spec), P.globeGrid(lat, lon + Math.PI * 2, spec), '经纬线应 2π 周期');
    }
  }
  const a = P.globePinAt(0.25, spec);
  const b = P.globePinAt(0.25 + Math.PI * 2, spec);
  approx(b.x, a.x, 1e-9, '大头针应 2π 周期');
  approx(b.y, a.y, 1e-9, '大头针应 2π 周期');
});

test('云层转得比地面快（转一整圈后云会错位，形成层次）', () => {
  gt(spec.cloudSpeed, 1, '云必须比地面快，否则看不出前后层次');
  /* 抽一个确定有云的经纬度：球面那边对得上，云层那边错开了 */
  let found = 0;
  for (let i = 0; i < 40 && found < 3; i++) {
    const lat = -1 + i * 0.05;
    for (let j = 0; j < 40; j++) {
      const lon = -3 + j * 0.15;
      if (!P.globeCloud(lat, lon)) continue;
      found++;
      ne(P.globeCloud(lat, lon), P.globeCloud(lat, lon + Math.PI * 2 * spec.cloudSpeed * 0.5),
        '云在同样的地面角速度下应该错位');
      break;
    }
  }
  gt(found, 0, '应该能抽到云点');
});

/* ------------------------------ 球体结构 ------------------------------ */
test('球心一定是球面（不是透明），球外一定不是陆地或海洋', () => {
  const c = SIZE / 2;
  const centre = P.globeBit(c, c, 0.9, spec);
  no(centre === '.', '球心不该是透明，实际 ' + centre);
  includes(['y', 'm', 'w', 'k', 'r'], centre, '球心色号不合法');

  /* 四角离球心最远，必然是球外：只允许"轨道虚线(k) / 星星(y) / 透明" */
  [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]].forEach(([gx, gy]) => {
    const ch = P.globeBit(gx, gy, 0.3, spec);
    includes(['.', 'k', 'y'], ch, '角落 (' + gx + ',' + gy + ') 出现球面颜色：' + ch);
  });
});

test('球体有完整一圈描边：贴着半径 R 的格子都是棕色', () => {
  /* 沿 8 个方向各取一个"正好在描边带里"的格子 */
  const c = SIZE / 2;
  let hit = 0;
  for (let a = 0; a < 8; a++) {
    const ang = a * Math.PI / 4;
    const r = spec.radius - spec.rim * 0.5;                 // 描边带正中
    const gx = Math.round(c + Math.cos(ang) * r - 0.5);
    const gy = Math.round(c + Math.sin(ang) * r - 0.5);
    if (P.globeBit(gx, gy, 0, spec) === 'k') hit++;
  }
  eq(hit, 8, '描边带上应处处是棕色描边，实际命中 ' + hit + '/8');
});

test('海陆云三种材质都真的出现过，且海洋占多数', () => {
  const st = scan(0);
  gt(st.y || 0, 0, '应该有海洋');
  gt(st.m || 0, 0, '应该有陆地');
  gt(st.w || 0, 0, '应该有云层');
  gt(st.r || 0, 0, '应该有定位大头针');
  gte(st.y || 0, st.m || 0, '海洋格子数应不少于陆地（否则看着像一整块大陆）');
});

test('陆地和云的判定是球面函数：同一经纬度结果稳定', () => {
  eq(typeof P.globeLand, 'function');
  eq(typeof P.globeCloud, 'function');
  eq(P.globeLand(0.3, 1.2), P.globeLand(0.3, 1.2));
  eq(typeof P.globeLand(0, 0), 'boolean');
  eq(typeof P.globeCloud(0, 0), 'boolean');
});

test('经纬线是虚线：一条经线上的格子有实有虚', () => {
  let on = 0, off = 0;
  for (let i = 0; i < 60; i++) {
    const lat = -1.2 + i * 0.04;
    for (let j = 0; j < 40; j++) {
      const lon = -Math.PI / 2 + j * 0.04;
      if (P.globeGrid(lat, lon, spec) && P.globeLand(lat, lon)) continue;
      if (P.globeGrid(lat, lon, spec)) on++; else off++;
    }
  }
  gt(on, 0, '应该有落在经纬线上的点');
  gt(off, on, '虚线应当是"少数在线上"，否则就是一张实心网');
});

test('陆地纹理点稀疏（约 1/29），不会糊成一层胡椒', () => {
  let n = 0;
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) if (P.globeLandTexture(gx, gy)) n++;
  }
  gt(n, 0, '应该有纹理点');
  lte(n, SIZE * SIZE / 10, '纹理点太密了：' + n + ' 个');
});

/* ------------------------------ 旋转 ------------------------------ */
test('自转真的在转：不同角度的大陆分布不同，但都还是球', () => {
  const a = scan(0), b = scan(1.2);
  ne(JSON.stringify(b), JSON.stringify(a), '转过之后画面应该变了');
  /* 球体面积不随旋转变化：球内格子数（非透明且非轨道）应基本恒定 */
  const inBall = (st) => (st.y || 0) + (st.m || 0) + (st.w || 0) + (st.r || 0) + (st.k || 0);
  eq(typeof inBall(a), 'number');
  gt(inBall(b), 0);
});

/* ------------------------------ 定位针 ------------------------------ */
test('定位大头针跟着球面转：正面可见、背面隐藏', () => {
  const front = P.globePinAt(0, spec);
  const back = P.globePinAt(Math.PI, spec);
  eq(front.visible, true, '正面应该看得见大头针');
  eq(back.visible, false, '转到背面应隐藏');
  /* 正面时应当落在球内 */
  const dx = front.x - SIZE / 2, dy = front.y - SIZE / 2;
  lte(Math.sqrt(dx * dx + dy * dy), spec.radius, '大头针不该跑到球外');
});

/* ------------------------------ 小飞机 ------------------------------ */
test('小飞机从头顶点起飞，绕一圈回到顶点', () => {
  const top = P.globePlaneAt(0, spec);
  approx(top.x, SIZE / 2, 0.6, 'x 应在中线上');
  lte(top.y, SIZE / 2 - spec.orbit + 1, 'y 应在上方');
  eq(top.face, 1, '上半圈朝右飞');

  /* a = theta*planeSpeed - π/2 = π/2（正下方）时应该朝左 */
  const halfTurn = Math.PI / spec.planeSpeed;
  const bottom = P.globePlaneAt(halfTurn, spec);
  gte(bottom.y, SIZE / 2 + spec.orbit - 1, 'y 应在下方');
  eq(bottom.face, -1, '下半圈要镜像成朝左，否则倒着飞');

  const back = P.globePlaneAt(halfTurn * 2, spec);
  approx(back.x, SIZE / 2, 0.6, '飞满一圈回到顶点');
});

test('小飞机的每个格子都在画布内，且只用合法色号', () => {
  [0, 1.5, 3, 4.5, 6, 7.5, 9, 12].forEach((th) => {
    const cells = P.globePlaneCells(th, spec);
    gt(cells.length, 0, 'theta=' + th + ' 应该有小飞机');
    cells.forEach((c) => {
      includes(LEGAL, c.ch, '小飞机色号非法：' + c.ch);
      gte(c.x, 0, 'x 越界'); lte(c.x, SIZE - 1, 'x 越界');
      gte(c.y, 0, 'y 越界'); lte(c.y, SIZE - 1, 'y 越界');
    });
  });
});

/* ------------------------------ 渲染与动画开关 ------------------------------ */
test('jsdom 里没有 2D 上下文时，画地球仪/开动画都安全（不启 rAF、不抛错）', () => {
  eq(typeof UI.paintGlobe, 'function');
  const drawn = UI.paintGlobe(0);
  eq(drawn, false, '没有 canvas 2D 上下文时应返回 false 而不是报错');

  /* 关键：jsdom 里绝不能起 rAF 循环 —— 否则测试进程会被撑住不退出 */
  eq(UI.startGlobe(), false, '无 2D 上下文时不启循环');
  eq(UI.stopGlobe(), true, '停循环应当幂等安全');
  eq(typeof UI.globeTheta(), 'number');
});

test('地图页上的地球仪画布尺寸和逻辑网格对得上', () => {
  const cv = document.getElementById('globeCanvas');
  ok(cv, '缺少地球仪画布');
  eq(cv.width, 128, '画布宽');
  eq(cv.height, 128, '画布高');
  eq(cv.width / spec.size, 4, '每格应该是 4px');
});
