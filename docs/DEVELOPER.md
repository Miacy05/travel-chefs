# Travel Chefs · 开发者说明（Developer Guide）

> 面向**要改这个项目的人**：架构怎么切、规则写在哪、数据长什么样、加东西要动哪几处、怎么测、怎么上线。
> 读玩法/数值表请看 [README.md](../README.md)；本文只讲**工程实现**。

---

## 目录

1. [30 秒速览](#1-30-秒速览)
2. [开发环境](#2-开发环境)
3. [架构总览](#3-架构总览)
4. [纯逻辑层 API](#4-纯逻辑层-api)
5. [表现层](#5-表现层)
6. [数据结构详解](#6-数据结构详解)
7. [存档与迁移](#7-存档与迁移)
8. [扩展手册](#8-扩展手册)
9. [测试体系](#9-测试体系)
10. [部署 Runbook](#10-部署-runbook)
11. [域名与访问](#11-域名与访问)
12. [排错索引](#12-排错索引)
13. [开发约定](#13-开发约定)
14. [已知限制与路线图](#14-已知限制与路线图)

---

## 1. 30 秒速览

| 项 | 值 |
| --- | --- |
| 版本 | `TC.VERSION = '2.5.0'` |
| 形态 | **单文件**：`index.html`，10740 行 / 448 KB，零依赖、零构建、零资源文件 |
| 运行 | 双击 `index.html` 即可；或任意静态服务器 |
| 语言 | 原生 ES5 语法（无 `let/const/箭头函数`，兼容老 WebView），`'use strict'` + IIFE |
| 命名空间 | `window.TC`，16 个模块 + 1 个引导函数 |
| 公开函数 | **394 个**（`TC.UI` 占 132 个） |
| 数据规模 | 5 地区 · 25 关 · 15 菜 · 45 食材 · 8 顾客 · 4 特殊顾客 · 23 升级 · 10 成就 · 10 徽章 · 3 道具 · 6 任务 · 3 彩蛋 · 11 步教程 |
| 测试 | `node tests/run.js` → **24 文件 / 541 断言 / 全绿**（约 2s，只依赖 jsdom） |
| 存档 | 单 `localStorage` key `travel-chefs:v2`，无后端、无数据库 |
| 部署 | GitHub + Vercel（主）/ 阿里云 OSS 香港 + 自有域名（国内直连） |

### 命令速查

```bash
node tests/run.js              # 跑全部测试
node tests/run.js calc save    # 只跑文件名含 calc / save 的
node tests/run.js --list       # 列出测试文件

python -m http.server 5173     # 本地静态服务器（然后开 http://localhost:5173）

node tools/globe-preview.js    # 地球仪字符画预览
node tools/globe-png.js        # 地球仪导出 PNG
node tools/shot.js             # 真机视口截图 → docs/
node tools/push-to-github.js   # SSH 不通时的备用推送通道（走 api.github.com）
```

---

## 2. 开发环境

### 2.1 最低要求

- **Node.js ≥ 18**（只用于跑测试与开发脚本；**跑游戏本身不需要 Node**）
- **jsdom**（只有测试需要，见 9.1）
- 任意现代浏览器

本机（Windows）实测可用路径，直接抄：

```powershell
# Node
C:\Users\20742\.workbuddy\binaries\node\versions\22.22.2-3\node.exe

# Git（本机没装进 PATH，用便携版全路径）
C:\Users\20742\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe

# 浏览器（无 Chrome，用 Edge 无头模式截图）
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
```

### 2.2 jsdom 的三种装法

`tests/helpers.js` 会按顺序自己找 jsdom，找不到才报错：

1. 环境变量 `TC_JSDOM=<jsdom 模块绝对路径>`
2. `require('jsdom')` —— 即项目下 `npm i -D jsdom`
3. `tests/node_modules/jsdom`
4. `~/.workbuddy/binaries/node/workspace/node_modules/jsdom`（WorkBuddy 托管工作区）
5. 各版本托管 Node 的 `node_modules/jsdom`

本机用法（托管工作区已装好 jsdom）：

```powershell
$env:NODE_PATH = "C:\Users\20742\.workbuddy\binaries\node\workspace\node_modules"
& $node tests\run.js
```

> `TC_JSDOM` 也可以指向一个**含 `package.json` 的目录**，helper 里的 `require()` 会自己解析。

### 2.3 编码约定（重要）

- 所有源文件为 **UTF-8 无 BOM**，换行 `\n`。
- `index.html` 内的中文注释是该文件的一部分，改动时保持原有缩进风格（2 空格）。
- 本机 PowerShell 的 `Get-Content` 默认会按 GBK 解码而显示乱码，**读中文一律加 `-Encoding utf8`**，或直接用读取工具而不是 `cat`/`type`。

---

## 3. 架构总览

### 3.1 模块图谱

`index.html` 是一个文件，但内部按职责切成 16 个 **IIFE**，各自把产物挂到 `window.TC` 上：

```
第 10 行起    <style>        全部样式（CSS 变量 + 媒体查询）
第 1704 行起  <script>       全部逻辑，按下列顺序串行执行
```

| # | 模块 | 行区间 | 行数 | 职责 | 层 |
| --- | --- | --- | --- | --- | --- |
| 1 | `TC.Util` | 1718–1824 | 107 | 数学/随机/日期/克隆工具 | 基础 |
| 2 | `TC.DATA` | 1833–2427 | 595 | 全部静态配置与索引 | 基础 |
| 3 | `TC.Calc` | 2434–2986 | 553 | 全部规则计算（纯函数） | **逻辑** |
| 4 | `TC.Save` | 2992–3506 | 515 | 存档读写 / 迁移 / 所有状态变更 | **逻辑** |
| 5 | `TC.Upgrade` | 3512–3611 | 100 | 升级页取数与聚合 | **逻辑** |
| 6 | `TC.Level` | 3619–4592 | 974 | 关卡状态机 | **逻辑** |
| 7 | `TC.Daily` | 4598–4665 | 68 | 每日任务 | **逻辑** |
| 8 | `TC.Easter` | 4675–4831 | 157 | 三个彩蛋的计数与触发 | **逻辑** |
| 9 | `TC.Guest` | 4840–4942 | 103 | 特殊顾客的挑选与增益 | **逻辑** |
| 10 | `TC.Ach` | 4949–5009 | 61 | 成就进度与达成 | **逻辑** |
| 11 | `TC.Pixel` | 5019–6082 | 1064 | 像素图形的程序化生成 | 表现 |
| 12 | `TC.Scene` | 6096–7164 | 1069 | Canvas 绘制与命中检测 | 表现 |
| 13 | `TC.Audio` | 7174–7307 | 134 | WebAudio 实时合成 | 表现 |
| 14 | `TC.UI` | 7316–10617 | 3302 | DOM 渲染 + 事件翻译 | 表现 |
| 15 | `TC.Router` | 10623–10700 | 78 | 视图路由 | 表现 |
| 16 | `TC.boot` | 10708–10740 | 33 | 引导：装 DOM 事件 → 读存档 → 首屏 | 入口 |

### 3.2 架构红线（改代码前必读）

源码第 1707 行的原话：

> **游戏规则只写在纯逻辑模块**（`DATA / Calc / Save / Level / Upgrade / Daily / Easter`），
> `Scene` 与 `UI` 只负责渲染与把操作翻译成逻辑调用。

实践含义，违反任何一条都会让测试失去意义：

| 允许 | 禁止 |
| --- | --- |
| `UI` 调 `L.tapIngredient(...)` 然后把返回值画出来 | 在 `UI` 里判断「这道菜该不该算 Perfect」 |
| `Scene` 调 `C.patience(customer, level)` 拿耐心值 | 在 `Scene` 里重算耐心公式 |
| `Pixel` 调 `D.dish(id)` 取菜名 | 在 `Pixel` 里硬编码菜名 |
| 逻辑模块返回**数据**（数字 / 对象 / 事件数组） | 逻辑模块直接碰 `document` / `canvas` |

> 例外与边界：`TC.Scene` 持有 canvas 与 `requestAnimationFrame`，`TC.UI` 持有 DOM —— 它们各自有
> 一定的渲染缓存（`SC.invalidate()` / `UI.persist()`），但**都不做规则判断**。

### 3.3 依赖方向

```
             TC.Util ──┐
                      ├──> TC.Calc ──> TC.Level ──┐
TC.DATA ──────────────┘         │                │
                                ├──> TC.Upgrade  │
                                ├──> TC.Daily    ├──> TC.UI ──> TC.Router ──> TC.boot
                                ├──> TC.Easter   │        │
                                ├──> TC.Guest ───┘        ├──> TC.Scene
                                └──> TC.Ach               └──> TC.Audio
TC.Pixel ────────────────────────────────────────────────> TC.Scene / TC.UI
```

- **只能向下依赖**：`UI` 可以调 `Calc`，`Calc` 绝不能调 `UI`。
- `TC.DATA` 与 `TC.Util` 是叶子节点，**不依赖任何东西**（`DATA` 内部会自己 `REGIONS.forEach` 生成派生表）。
- 模块间靠**调用**通信，不靠共享可变全局；跨模块状态只有两处：`window.TC`（模块表）和 `Save`（存档）。

### 3.4 引导流程（`TC.boot`）

```js
TC.boot()                       // UI 已 ready 时直接返回
  ├─ UI.init()                  // 缓存 DOM 引用、绑事件
  ├─ Router.scan()              // 收集所有 [data-view] 容器
  ├─ UI.startGlobe()            // 地图地球仪起动画
  ├─ UI.tutAutoStart()          // 存档 tutorialDone=false → 自动播教程
  └─ UI.tryLoginReward()        // 每日登录奖励
失败时: TC.bootError = e, TC.booted 保持 false，页面顶部显示降级提示（不白屏）
```

`TC.booted` / `TC.bootError` 是给测试和排错用的两个探针 —— jsdom 测试里若 `bootError` 非空，说明启动链路断了。

---

## 4. 纯逻辑层 API

> 完整函数名见各模块小节；这里给**语义与约定**。全部函数可在 jsdom 里直接调用（不需要真实 canvas/DOM 布局）。

### 4.1 `TC.Util`（15 个）

```js
U.clamp(v, lo, hi)                 // 夹取
U.lerp(a, b, t)                    // 线性插值
U.hashSeed(str)                    // FNV-1a 32 位哈希 → 种子
U.mulberry32(seed)                 // 可复现 PRNG，返回 () => [0,1)
U.seededBy(str)                    // 由字符串造 PRNG（每日任务/顾客生成复现用）
U.pick(arr) / U.pickWeighted(arr, weighter) / U.sample(arr, n)
U.sum(arr)                         // 数值数组求和
U.mmss(ms)                         // 毫秒 → "1:05"
U.today()                          // 本地日期 "YYYY-MM-DD"
U.dayOffset(dateStr, n)            // 日期偏移
U.deepClone(o) / U.assign(target, src)
U.indexBy(arr, key)                // 数组 → { key: item }
```

> **确定性是这个项目的一条硬要求**：每日任务、困难模式的随机故障、顾客生成都走 `U.seededBy(...)`，
> 从而「同一天同一关必然一样的随机序列」可以被测试断言。

### 4.2 `TC.DATA`（19 个查询函数 + 19 个数据表）

数据表：`CONFIG`、`REGIONS`、`LEVELS`、`DISHES`、`INGREDIENTS`、`CUSTOMERS`、`SPECIAL_GUESTS`、
`UPGRADES`、`UP_TABS`、`ACHIEVEMENTS`、`BADGES`、`TOOLS`、`DAILY_POOL`、`DAILY_COUNT`、
`EASTER`、`TUTORIAL`、`TUTORIAL_LEVEL`、`byId`、`MAX_*` 之类的派生常量。

按 id 取（命中不到返回 `null`，**不抛异常**）：

```js
D.region(id)   D.level(id)      D.dish(id)      D.ingredient(id)
D.customer(id) D.specialGuest(id) D.upgrade(id) D.achievement(id)
D.task(id)     D.tool(id)       D.badge(id)
```

按地区过滤（返回新数组）：

```js
D.dishesOf(regionId)   D.levelsOf(regionId)   D.ingredientsOf(regionId)
D.badgesOf(regionId)   D.upgradesOf(tab)
```

聚合与其他：

```js
D.totalLevels()        // 25
D.maxStars()           // 75
D.upgradeVisible(u, unlockedRegionIds)   // 带 dishId 的升级项要解锁该地区才可见
D.byId.*               // 全部索引的原始对象
```

> `LEVELS`、`BADGES`、`UPGRADES` 里的部分条目是**运行时派生**的：
> `BADGES` 由 `REGIONS.forEach` 生成（每区 2 枚），
> `UPGRADES` 在 8 个手写项之后由 `DISHES.forEach` 追加 15 个 `menu_*` 菜单等级。
> 所以「升级项 23 项」这个数字是**算出来的**，加一道菜会自动变成 24 项。

### 4.3 `TC.Calc`（61 个，规则的核心）

按主题分组（全部纯函数，`(数值, 存档) → 数值`）：

```js
// —— 升级数值 ——
C.upLv(save, id)   C.upVal(save, id)   C.upCost(save, id)   C.upEffect / C.upNextEffect / C.upEffectMax
C.coinMul(save)    C.waiterLv(save)    C.manualTipMul(save)
C.tipBaseAdd(save) C.tipUpgradeMul(save)
C.decorLv(save, regionId)  C.decorShown(...)  C.decorGlow(...)
C.stoveSlots(save) C.seats(save)  C.spawnInterval(...)  C.cookTime(save, dish)  C.plateLife(save)

// —— 钱与单笔结算 ——
C.sellPrice(save, dish)   C.tipBonusMul(save, regionId)
C.tip(...)                C.orderIncome(...)     C.settle(...)   C.metrics(run)

// —— 星级 / 解锁 ——
C.starConditions(levelId)  C.stars(...)          C.levelStars(save, id)
C.totalStars(save)  C.regionStars(save, rg)      C.isRegionUnlocked(save, rg)
C.unlockedRegionIds(save)  C.isLevelUnlocked(save, id)  C.isLevelCleared(save, id)
C.clearedCount(save)  C.threeStarCount(save)
C.dishUnlocked(save, dish)  C.unlockedDishIds(save)
C.isRegionCleared(save, rg)  C.regionClearedCount(save, rg)

// —— 挑战模式 ——
C.hardUnlocked(save, rg)   C.hardStars(save, id)  C.hardClearedCount(save, rg)
C.hardModifiers(...)       C.badgeState(...)      C.badgeStates(save)  C.badgesObtained(save)

// —— 图鉴 ——
C.seenCustomers(save)  C.seenCount(save, id)  C.collectionCount(save)  C.collectionTotal()
C.eggCount(save)

// —— 成长 ——
C.expFor(...)  C.expToNext(save)  C.applyExp(save, gained)   C.nextLevel(save)

// —— 外观 ——
C.custSprite(customer, regionId)
```

约定：

- **`save` 永远是第一个参数**（读档算值），第二参数是业务对象；不要传 `undefined`，用 `TC.Save.blank()`。
- 所有函数**不修改入参**。
- 概率/随机相关的函数额外接受一个 `rand` 函数，默认 `Math.random` —— 测试注入 `U.mulberry32(seed)` 即可复现。

### 4.4 `TC.Save`（30 个）

```js
// 存储层
S.storage()            // localStorage，不可用时降级到内存 store（隐私模式/单测）
S.memoryStore

// 读写
S.blank()              // 干净存档
S.load()               // 读 + normalize + migrate
S.write(save)          // 写（内部 try/catch，写失败不崩）
S.parse(raw)           // 字符串 → 存档
S.normalize(raw)       // 任意形状 → 补全字段（不丢已有值）
S.migrate(save)        // 版本迁移

// 金钱与经验
S.addCoins / S.spendCoins / S.canAfford / S.addGems / S.spendGems
S.award(save, {coins, gems})     // 成就/任务发奖统一入口
S.addExp(save, n)

// 进度
S.setLevelStars(save, levelId, n)   S.setHardStars(save, levelId, n)
S.buyUpgrade(save, id)              S.setDecorLv(save, regionId, lv)   S.decorOwned(...)
S.bumpDaily(save, metric, n)        S.checkDaily(save)                 S.isTaskClaimed(save, id)
S.claimTask(save, id)               S.tryLoginReward(save)
S.hasAchievement(save, id)          S.checkAchievements(save)          S.achievementProgress(save, id)
S.recordRun(save, runResult)        // 一局结束的汇总写档

// 教程
S.setTutorialDone(save, bool)       S.needsTutorial(save)
```

**规矩：所有状态变更必须走 `TC.Save`**，不要在 `UI` 里直接 `save.coins += 100` ——
因为归一化、上限、成就联动、每日任务进度都挂在 `Save` 的方法里。

### 4.5 `TC.Level`（36 个，关卡状态机）

`L.create(save, levelId, opts)` 生成一个 `run` 对象（纯数据，可被测试直接驱动）：

```js
var run = L.create(save, 'A1', { tutorial: false, seed: 12345, skipGuest: false });
```

驱动的两个入口：

```js
L.tick(run, dtMs)      // 推进时间：顾客生成 / 耐心衰减 / 烹饪进度 / 灶台故障
L.select(run, id)      // 玩家操作：点食材 / 点灶台 / 装盘 / 上菜 / 用道具
```

查询与操作（36 个的完整名单见源码注释；常用的）：

```js
L.customer(run) / L.customers(run)      // 当前顾客队列
L.currentOrder(run)                      // 当前该做的菜
L.pantry(run) / L.currentCustomer(run)
L.tapIngredient(run, ing)   L.prepAll(run)     L.tapPot(run, slot)
L.toPlate(run, slot)        L.serve(run, plateIndex, customerIndex)   L.autoServe(run)
L.toolCdLeft / L.canUseTool / L.chargeTool / L.useTool
L.tapFridge(run)
L.hud(run)                  // 给 UI 的一屏所需只读数据
L.finish(run)               // 结算 → { stars, coins, exp, events... }
L.quit(run)
L.nextAction(run)           // 「下一步该点哪儿」提示（教程与跳动箭头都用它）
```

事件机制：`tick` / `select` 把这些事件推入 `run.events`，`UI.onRunEvents` 负责翻译成音效与飞字：

```
run.events: ['cook.start', 'cook.ready', 'serve.perfect', 'customer.lost', 'stove.break', ...]
```

> **`run` 是纯数据**，不持有 DOM/canvas 引用 —— 这就是 `level.test.js`（65 条断言）能脱离浏览器跑完整局的原因。

### 4.6 其余逻辑模块

| 模块 | 关键函数 | 说明 |
| --- | --- | --- |
| `TC.Upgrade` | `tabs()` `rows(save, tab)` `buy(save, id)` `canBuy(save, id)` `summary(save)` | 升级页的**取数聚合**层；真正扣费在 `Save.buyUpgrade` |
| `TC.Daily` | `randFor(date)` `idsFor(date)` `tasksFor(save, date)` `progressOf(save, id)` `rows(save)` `claimableCount(save)` | 每日任务由**日期哈希**决定，同一天必然抽到同样 3 条 |
| `TC.Easter` | `globeRollover(save, date)` `tapGlobe(save)` `checkRainbow(...)` `tapPenguin(run)` `list(save)` | 三个彩蛋的**唯一判定处**；地球仪「每天一次」由 `globeFiredDay` 把关 |
| `TC.Guest` | `pick(ctx)` `markSeen(save, id)` `applyBuff(run, g)` `tickBuff(run, dt)` `cookMul(run)` | 特殊顾客的挑选与 30 秒增益；**一生一次**由 `guest.seen` 把关 |
| `TC.Ach` | `metrics(save)` `valueOf(save, metric)` `progress(save, ach)` `rows(save)` `evaluate(save)` | 10 个成就的 10 种 `metric` 取值见 6.8 |

---

## 5. 表现层

### 5.1 `TC.Pixel`（23 个）—— 像素美术

**没有一张图片资源**：全部图形都是代码生成的**矩形列表**，再由 `TC.Scene` 画到 canvas。

```js
P.shape(name, opts)             // 取预定义图形
P.matrix(...)                   // 逻辑网格（二维色号数组）
P.rectsOfMatrix(m) / P.rectsOf(name)
P.ingredientMatrix(id) / P.ingredientRects(id)
P.dishMatrix(id)
P.custKey(c) / P.custParts(c, regionId) / P.custMatrix(c, regionId)   // 顾客 = 线稿 + 职业补丁 + 地区配色
P.globeGrid()  P.globeBit(gx, gy, theta)  P.globeLand/globeCloud/globeLandTexture
P.globePinAt(...)  P.globePlaneAt(...)  P.globePlaneCells(...)       // 地球仪 = 球面参数化
P.paint(ctx, rects, scale)  P.paintRects / P.paintIngredient / P.toCanvas
P.validate(rects)               // 5 色调色板校验：出现第 6 种颜色就报错
```

调色板（严格 5 色）：

| 代号 | 颜色 | 用途 |
| --- | --- | --- |
| `y` | `#FFD166` 暖黄 | 地面、光源、暖调 |
| `r` | `#EF476F` 番茄红 | 强调、危险、食物 |
| `m` | `#06D6A0` 薄荷绿 | 植物、健康、成功 |
| `w` | `#FFFCF2` 奶油白 | 高光、墙面 |
| `k` | `#3D2B1F` 深棕 | 描边、阴影、文字 |
| `b` / `s` | 蓝 / 深灰 | 少数场景特例（水、石板） |
| `-` | 透明 | 空像素 |

> `P.validate()` 在构建期把关：**输出矩形不得出现第 6 种颜色**。改美术时若绕过它会破坏统一风格。

### 5.2 `TC.Scene`（23 个）—— Canvas 像素车间

- **逻辑分辨率 160×90**，整数倍缩放 + letterbox 居中 → 像素永不糊。
- 关键函数：

```js
SC.run() / SC.isRunning() / SC.start() / SC.stop()   // RAF 生命周期（不可见时自动停）
SC.layout(run)       // 计算该帧所有可点区域
SC.draw(run)         // 绘制
SC.hit(run, x, y)    // 逻辑坐标命中检测 → 返回被点中的对象
SC.hitScreen(run, clientX, clientY)   // 屏幕坐标 → 逻辑坐标 → hit
SC.plateAt(run, ...) / SC.customerAt(run, ...)
SC.sceneSig(run) / SC.invalidate()    // 场景签名，用于跳过无变化的重绘
SC.resize() / SC.layoutNow() / SC.frame()
SC.playSceneFade(...) / SC.step(run, dt)
```

- **只在看得见时跑**：离开营业页、`document.hidden`、系统「减少动态效果」都会停 RAF（后者只画一帧静态球）。
- 场景外壳（店铺造型）在 `SC.SHELLS` 里按 `region.shellId` 取，所以「换个地区 = 换个店面」。

### 5.3 `TC.Audio`（7 个）

```js
A.kinds()            // 15 种音色名
A.enabled(...) / A.volume(...)
A.ready() / A.resume()   // 浏览器自动播放策略：首次交互后 resume
A.play(name)             // 振荡器 + 包络实时合成，无音频文件
A.reset()
```

无 `AudioContext` 的环境（Node / jsdom）**静默降级**，绝不抛错影响玩法。

### 5.4 `TC.UI`（132 个，最大模块）

职责：DOM 渲染 + 事件翻译。三条内部约定：

1. **`UI.renderXxx()` 只读数据不写档**；要改状态一律调 `TC.Save` / `TC.Level`。
2. **`UI.persist()`** 是唯一的写档时机（节流），别在渲染函数里 `Save.write`。
3. **页面识别靠 `[data-view]`**：`map` / `levels` / `cook` / `result` / `codex` 容器，
   由 `TC.Router` 扫描与切换，`UI` 不为每个页面各写一套显示逻辑。

按功能分组（节选）：

| 组 | 函数 |
| --- | --- |
| 引导 | `init` `hideBoot` `canPlay` |
| 顶栏 | `updateTopbar` `runTopbarAction` |
| 地图 | `renderMap` `renderRegionProgress` `openRegion` `tapLevel` `tapGlobe` `fxPlane` `spawnFx` |
| 关卡列表 | `renderLevels` `openLevel` `openNextLevel` `openHard` `syncLevelsFoot` |
| 营业页 | `enterCook` `leaveCook` `syncCook` `syncPantry` `syncOrder` `syncTools` `syncCustBars` `syncNextHint` `tapIngredient` `autoFire` `prepAll` `tapPot` `pickCustomer` `useTool` `holdPlate` |
| 拖拽 | `startDrag` `dragMove` `dragUp` `cancelDrag` `isDragging` `servePlateTo` `plateTap` |
| 结算 | `onRunOver` `renderResult` `nextLevelInfo` `playNextLevel` |
| 升级 | `openUpgrade` `renderUpTabs` `renderUpList` `buyUpgrade` `upgradableCount` |
| 图鉴 | `renderCodex` `setCodexTab` `renderBook` `renderBookDish/Cust/Badge/Card` `postcardSrc` `openPostcard` |
| 成就/任务 | `renderAch` `renderDaily` `claimTask` `showAchBanner` `closeAchBanner` |
| 教程 | `tutStart` `tutStop` `tutRun` `tutNext` `tutGo` `tutPaint` `tutActive` `tutAutoStart` |
| 弹窗 | `openModal` `closeModal` `dialog` `closeDialog` `openSettings` `onSetting` `onVolume` |
| 特效 | `toast` `stageToast` `flyGain` `flyEmote` `onRainbow` `fxPenguin` `fxCandy` |

### 5.5 `TC.Router`（8 个）

```js
R.scan(root)     // 收集 [data-view] 容器
R.go(name)       // 切页（写 document 上的 data-route，CSS 负责显示/隐藏）
R.back()
R.has(name) / R.list() / R.onChange(fn)
R.navVisibleFor(route) / R.topbarFor(route)
```

页序由 `R._order = ['map','levels','cook','result','codex']` 定义。

---

## 6. 数据结构详解

> 下面是**字段级**说明，改数据表时对照这张表改。

### 6.1 `REGIONS`（5 条）

```js
{
  id: 'asia_street', name: '亚洲街边摊', icon: '🏮', order: 1,
  unlockStars: 0,                      // 累计星星门槛
  prefix: 'A',                         // 关卡 id 前缀：'A' → A1..A5
  levels: ['A1','A2','A3','A4','A5'],
  dishes: ['chowmein','dumpling','milktea'],
  decor: ['big_lantern','bamboo_planter','neon_sign'],   // 装饰布置 Lv1/2/3 逐级解锁，顺序即解锁顺序
  decorName: ['大红灯笼','竹丛绿植','霓虹招牌'],
  floor: 'y', wall: 'k', accent: 'r',  // 色号（见 5.1 调色板；'m' 别当中性色用）
  shellId: 'asia_street',              // 取 SC.SHELLS 的店铺外壳
  priceMul: 1.00,                      // 价格倍率，只影响金币目标
  postcard: { name: '亚洲街边摊', sub: '霓虹与蒸汽' },
  tagline: '一口锅，一条街'
}
```

### 6.2 `LEVELS`（25 条）

```js
{
  id: 'A1', regionId: 'asia_street', index: 1,
  name: '夜市开张',
  duration: 90,            // 单局时长（**秒**）
  seats: 2,                // 座位数
  spawnInterval: 6.8,      // 上客间隔（**秒**）
  patienceScale: 1.0,      // 顾客耐心缩放
  dishPool: [ ... ],       // 本关可出的菜（数量随关卡递增：1→2→3）
  stars: { served: 7, coins: 150, maxLost: 1, minCombo: 6 },   // 三星条件，按顺序累计
  reward: { ... },         // 通关奖励
  unlockOnClear: true      // 通关是否解锁下一关
}
```

> `stars.coins` 是**第 1 区的基准值**，实际目标 = `基准 × region.priceMul`。
> 实测：A1 = 150 / B1 = 173 / C1 = 195 / D1 = 218 / E1 = 240。

### 6.3 `DISHES`（15 条，每区 3 道）

```js
{ id: 'chowmein', regionId: 'asia_street', name: '炒面', en: 'Chow Mein',
  sprite: 'dish_chowmein',
  price: 18, tipBase: 4, cookTime: 3000,       // cookTime 单位 **ms**
  steps: ['noodle','veg','sauce'],             // 指向 INGREDIENTS：备料点齐即可，不要求顺序
  unlockAt: 1 }                                // 推出该菜的关卡序号
```

### 6.4 `INGREDIENTS`（45 条，每区 9 条）

关键字段：`id` `regionId` `name` `sprite` + 供 `TC.Pixel` 生成 16×16 像素矩形的描述字段。

### 6.5 `CUSTOMERS`（8 条）

```js
{ id: 'courier', name: '快递员', patience: 16000, tipMul: 1.15, ... }
```

- **`patience` 单位是毫秒**（16000 = 16 秒）；README 里写作秒，两者一致。
- 实际耐心 = `patience × level.patienceScale × CONFIG.patienceMul(=2)`，困难关卡再乘 `CONFIG.hard.patienceMul(=0.6)`。
- 立绘由 `P.custMatrix(c, regionId)` 合成：一张 16×24 线稿 + 职业补丁 + 地区配色 → 8 职业 × 5 地区 = 40 种造型。

### 6.6 `SPECIAL_GUESTS`（4 条）

```js
{ id: 'critic', arch: 'critic', name: '美食评论家', icon: '👨‍🍳',
  desc: '口味挑剔，但满意会给巨额小费',
  trigger: 'served:150',                       // 'served:N' | 'daily' | 'random:0.08'
  buff: { type: 'coin', mul: 1.1, ms: 30000, label: '金币 +10%' },
  tipMul: 2, patience: 26000, special: true,
  sprite: 'cust_critic_asia_street' }
```

| id | trigger | buff.type |
| --- | --- | --- |
| `critic` 美食评论家 | `served:150` | `coin`（金币 +10%） |
| `blogger` 旅行博主 | `daily`（每自然日首次开局） | `speed`（烹饪加速 50%） |
| `elder` 神秘老人 | `served:50` | `warm`（耐心不再减少） |
| `cat` 流浪猫 | `random:0.08`（困难徽章越多概率越高） | `tip`（小费 ×1.5） |

> `trigger: 'daily'` 的类型**不在 `guest.seen` 里锁死**，其余三种一出现就 `markSeen`，实现「一生一次」。

### 6.7 `UPGRADES`（23 条 = 8 手写 + 15 派生）

```js
{ id: 'stove_speed', tab: 'equipment', name: '猛火灶', icon: '⚡',
  start: 0, maxLevel: 5,
  cost:  [180, 320, 520, 760, 1100],           // 第 i 级的花费（长度 = maxLevel）
  value: [0, 0.08, 0.16, 0.24, 0.32, 0.40],    // 第 i 级的生效值（长度 = maxLevel + 1）
  effect:['烹饪提速 8%','16%','24%','32%','40%'],  // 展示文案（长度 = maxLevel）
  perRegion: false,                            // true = 按地区分别记（见 decor_bonus）
  dishId: null, regionId: null                 // 有 dishId 的项要解锁该地区才可见
}
```

`tab` 取值：`equipment` / `menu` / `decor` / `staff`（对应 `UP_TABS`）。

> **派生项**：`DISHES.forEach` 追加 `menu_<dishId>`（售价 +12%…+48%，`maxLevel 5`，`start 1`）。
> 加一道菜 → 自动多一项升级、`D.UPGRADES.length` 自动 +1。

### 6.8 `ACHIEVEMENTS`（10 条）

```js
{ id: 'traveler', name: '旅行家', icon: '🧭', desc: '累计通关 5 个关卡',
  metric: 'clears', target: 5, reward: { coins: 200 } }
```

`metric` 的 10 种取值（由 `TC.Ach.valueOf` 统一取数）：

`clears` · `perfectRuns` · `collection` · `maxCombo` · `coinsTotal` · `quickRuns` · `threeStars` · `customers` · `eggs`

`reward` 只会是 `{coins: n}` 或 `{gems: n}`。

### 6.9 `BADGES`（10 条，派生）

```js
{ id: 'bd_asia_street_clear', regionId: 'asia_street', kind: 'clear', icon: '🏮',
  name: '亚洲街边摊·通关徽章', effect: '' }
{ id: 'bd_asia_street_hard',  regionId: 'asia_street', kind: 'hard',  icon: '🔥',
  name: '亚洲街边摊·困难徽章', effect: '永久解锁流浪猫光顾 · 每枚困难徽章让猫出现概率 +1.5%' }
```

`kind` 决定 `C.badgeState` 的判定分支；普通徽章纯收藏，困难徽章带实际效果。

### 6.10 `TOOLS`（3 条）与 `DAILY_POOL`（6 条）

```js
// TOOLS
{ id: 'speed', name: '加速', icon: '⚡', cd: 30, desc: '当前锅剩余时间 −50%' }
{ id: 'warm',  name: '保温', icon: '♨️', cd: 45, desc: '最急顾客的耐心回复 50%' }
{ id: 'serve', name: '上菜', icon: '🖐',  cd: 60, desc: '把出餐台最老的一道菜送给匹配顾客' }
```

- `cd` 单位秒；每局有 `CONFIG.toolFreePerRun(=1)` 次免费，之后 `toolGemCost(=1)` 钻石一次。
- `DAILY_POOL` 6 条任务，`DAILY_COUNT = 3` —— 每天按日期哈希抽 3 条。

### 6.11 `TUTORIAL`（11 步）

```js
{ id: 't_ing1', no: 3, view: 'cook', spot: 'ingredient', ing: 0,
  check: 'ing',                      // null=讲解步（手动「下一步」）| 'ing'|'cooking'|'ready'|'plated'|'served'=动作步
  text: '开始做菜：点第 1 样配料「{ing}」' }
```

- `spot` 决定高亮块位置，`text` 里的 `{ing}` 会被替换成真实食材名。
- **讲解步点「下一步」，动作步按游戏状态自动推进** —— 这是 `tutorial.test.js` 与验收里的重点。
- `TUTORIAL_LEVEL = 'A1'`：教程跑在 A1 的教学局（`L.create(..., {tutorial:true})`，只坐 1 位顾客、倒计时不走、耐心按 8% 消耗）。

### 6.12 `CONFIG`（全部 27 个，改数值先看这里）

| 键 | 值 | 含义 |
| --- | --- | --- |
| `saveKey` | `travel-chefs:v2` | localStorage key |
| `saveVersion` | `2` | 存档版本，+1 即等于清档 |
| `perfectWindow` | `0.6` | 出锅后 ≤ 烹饪时间 × 此值内上菜算 Perfect |
| `plateLifeMs` | `12000` | 装盘基础保鲜时长（ms） |
| `expPerOrder` / `expPerStar` | `3` / `8` | 经验基数 |
| `levelExpBase` | `100` | 升级所需 = 此值 × 当前等级 |
| `firstClearCoinBonus` | `80` | 首次通关额外金币 |
| `zeroStarCoinRatio` | `0.5` | 0 星只给一半金币 |
| `comboBreakOnTimeout` | `true` | 流失/超时清零连击 |
| `patienceMul` | `2` | **普通关**顾客等待倍率 |
| `decorPrice` / `decorTipBonus` | `260` / `0.08` | 装饰价与每件小费加成 |
| `waiterManualTipMul` | `1.1` | 服务员 Lv2 起手动上菜小费倍率 |
| `waiterBoostRatio` | `0.10` | 服务员 Lv3 每 5 位顾客回复的耐心比例 |
| `queueCap` | `2` | 座位满后门口最多再站几位 |
| `queuePatienceMul` | `0.5` | 排队中耐心消耗倍率 |
| `hard` | `{patienceMul:0.6, spawnMul:0.7, extraDish:1, breakChance:0.00012, breakCooldownMs:6000}` | 挑战模式修正 |
| `loginCoinBase/Step/Cap` | `20/5/50` | 每日登录奖励 20→25→…→50 封顶 |
| `tipPerfectMul` / `tipComboStep` / `tipComboCap` | `2` / `0.2` / `3` | Perfect 与小费连击 |
| `gemPerSpecialGuest` / `gemLoginEvery` | `1` / `7` | 钻石发放规则 |
| `toolFreePerRun` / `toolGemCost` | `1` / `1` | 道具免费次数与钻石价 |

---

## 7. 存档与迁移

### 7.1 位置与形态

- **key**：`travel-chefs:v2`（`CONFIG.saveKey`），值是一段 JSON。
- 无 `localStorage`（隐私模式、Node）时自动降级到 `S.memoryStore`（内存对象），**不报错**。
- 写失败包在 `try/catch` 里 —— 隐私模式下写不进去也不影响本局可玩。

### 7.2 顶层 schema

```js
{
  version: 2,
  coins: 0, gems: 0, exp: 0, level: 1,

  regions: { asia_street: { A1: 3, A2: 2 }, ... },   // 普通星级 0~3
  hard:    { asia_street: { A1: 1 }, ... },          // 困难星级，独立存储
  decor:   { asia_street: [...] },                   // 【旧字段】只读做迁移，不再写回
  decorLv: { asia_street: 0 },                       // 「装饰布置」等级 0~5，每地区独立

  upgrades: { stove_slots: 1, stove_speed: 0, ..., menu_chowmein: 1, ... },

  lastLevelId: '',                                   // 地图页「一键重玩上一关」用

  stats: {
    customers: 0, perfect: 0, maxCombo: 0, coinsTotal: 0,
    plays: 0, perfectRuns: 0, quickRuns: 0, bestCoins: 0, lostTotal: 0,
    seenCustomers: {}, seenCounts: {}                 // 图鉴用
  },

  achievements: { first_step: true, ... },

  daily: {
    date: '', tasks: [], claimed: [],
    metrics: { plays:0, maxCombo:0, customers:0, bestCoins:0, perfect:0, upgrades:0 },
    loginDay: '', loginStreak: 0                      // 每日登录奖励
  },

  easter: { globe:0, globeDay:'', globeFired:false, globeFiredDay:'', rainbow:false, penguin:false },

  guest: { seen: {}, lastDay: '' },                   // 特殊顾客「一生一次」与博主「每天一次」

  settings: { sound: true, vibrate: true, volume: 100 },

  tutorialDone: false,
  staffRefunded: false                                 // 员工简化的退款闸门
}
```

### 7.3 迁移策略

- **`S.normalize(raw)`**：把任意形状的旧对象补成完整存档，**不丢已有值**。
  - 数字字段做 `isFinite` + 下界夹取（`coins ≥ 0`、`level ≥ 1`）。
  - 星级按 `D.REGIONS` 逐关校验，非法值丢弃、合法值 `clamp(0,3)`。
  - `upgrades` 缺项回落到该项的 `start`，越界夹到 `[start, maxLevel]`。
- **加字段的规矩**：新字段一律在 `S.blank()` 里给默认值，`normalize` 里补兜底 → **老存档无需清档即可升级**。
- **改 schema 才动版本号**：`CONFIG.saveVersion` +1，老档会被判为不兼容而重置（非必要不用）。
- **删除功能时要给退路**：例如员工线从 3 条砍到 1 条时，用 `staffRefunded` 这个**一次性闸门**把旧档已投入的金币退回，保证只退一次（`Save.normalize` 里判定）。
- **老档补默认值 = 有意的行为变化**：`tutorialDone` 缺失时补 `false`，等于让老玩家也看一次教程 —— 注释里明确写了这是有意为之，改动前请先确认这仍是期望行为。

---

## 8. 扩展手册

> 每条都列出「要动哪几处」—— **漏一处通常表现为「游戏能跑但某个页面空白/某项统计对不上」**，
> 所以加完务必 `node tests/run.js`（`data.test.js` 专查数据表自洽性）。

### 8.1 加一个地区（+5 关 +3 菜 +9 食材 +2 徽章 +3 装饰）

| 步骤 | 位置 | 说明 |
| --- | --- | --- |
| 1 | `REGIONS` 追加一条 | `prefix` 不能与现有重复（A–E 已用，下个用 `F`）；`levels` 5 个 id |
| 2 | `DISHES` 追加 3 道 | `regionId` 指向新地区，`steps` 引用新食材 id |
| 3 | `INGREDIENTS` 追加 9 条 | 3 道菜 × 3 步，可复用已有食材，但同区通常各配一套 |
| 4 | `SC.SHELLS` 加 `shellId` 对应外壳 | 漏了会退回默认店面 |
| 5 | 调试 | 徽章（2 枚）、菜单升级（3 项）、地区装饰槽位（3 件）都是 `forEach` 派生的，**不用手动加** |
| 6 | 明信片（可选） | `assets/postcards/<id>.png`，并在 `UI.postcardSrc` 的映射里加一条 |

### 8.2 加一关

在 `LEVELS` 里追加（注意 `LEVELS` 是派生数组，实际按 `REGIONS[].levels` 展开，见源码 `LEVELS = []` 之后的构建段），
或在对应地区的 `levels` 里加 id 并补该关的 `LEVELS` 条目。字段见 6.2。
**别忘了**：新关卡的 `stars.coins` 写第 1 区基准值（其他区会自动乘 `priceMul`）。

### 8.3 加一道菜

1. `DISHES` 追加一条（`id` 唯一、`sprite` 命名规范 `dish_<id>`）。
2. `TC.Pixel` 补该菜的 `dishMatrix` 图形（否则场景里画不出来）。
3. `menu_<dishId>` 升级项**自动生成**，无需手写。
4. `INGREDIENTS` 若用了新食材也要补上。
5. 回归：`data.test.js` 会校验「每道菜的 steps 都能在 INGREDIENTS 里找到」这类索引一致性。

### 8.4 加一位顾客

1. `CUSTOMERS` 追加（`patience` 用**毫秒**）。
2. 若需要新造型：`P.custParts` 加职业补丁（帽子/配饰），配色由地区自动处理 → 自动得到 5 个地区版本。
3. 回归：`pixel.test.js` 会校验「40 种顾客造型不撞款」。

### 8.5 加一项升级

在 `UPGRADES` 追加（`cost` 长度 = `maxLevel`，`value` 长度 = `maxLevel + 1`，`effect` 长度 = `maxLevel`）。
若是**分地区**的（像 `decor_bonus`）要设 `perRegion: true`，并确认 `Save.buyUpgrade` / `Calc.upLv` 里的读取分支覆盖了它。
若要真正生效，还要在 `TC.Calc` 里**接一个读取点**（例如 `C.spawnInterval` 里读 `C.upVal(save,'signboard')`）—— 数据改了不接线是没有效果的。

### 8.6 加一个成就

1. `ACHIEVEMENTS` 追加，`metric` 尽量复用 6.8 里的已有取值。
2. 若必须新 `metric`：在 `TC.Ach.valueOf` 加分支，并在 `TC.Save.stats` / `bumpDaily` 的埋点里保证该数据被记录。
3. 回归：`ach.test.js`。

### 8.7 加一个彩蛋

1. `TC.DATA.EASTER` 加定义。
2. `TC.Easter` 加判定函数（**唯一判定处**），并在 `S.blank().easter` 里补状态字段 + `normalize` 兜底。
3. `TC.UI` 接触发点（点击/连击/进度）与特效。
4. 回归：`easter.test.js`（含「每天一次」的同日锁定 / 跨天重置）。

### 8.8 加一位特殊顾客

1. `SPECIAL_GUESTS` 追加：`trigger` 用 `served:N` | `daily` | `random:p` 三种形式之一。
2. 造型：`sprite` 命名 `cust_<id>_<regionId>`，`P.custParts` 里给 `arch` 补补丁。
3. 增益：`buff.type` 若引入新类型，要在 `TC.Guest.applyBuff` / `cookMul` 里接上。
4. 回归：`guest.test.js`（含「一生一次」「每日首登」「30 秒道具」）。

---

## 9. 测试体系

### 9.1 为什么不用 jest

项目自带一套 60 行的零依赖框架（`tests/harness.js`），把 `index.html` **真实加载进 jsdom** 后测。
好处：跑测试不需要 `npm install`（除 jsdom），也不会出现「测试桩和真实代码漂移」。

### 9.2 三个基础设施

| 文件 | 作用 |
| --- | --- |
| `tests/run.js` | 入口。`run.js` / `run.js calc`（按文件名过滤）/ `run.js --list` |
| `tests/harness.js` | 断言与报告：`test` `section` `runAll` `runList` `reset` |
| `tests/helpers.js` | `loadGame()` 把 index.html 装进 jsdom 并返回 `{window, document, TC, errors, html}`；另有 `dropGame()` `freshSave()` `waitFor()` |

### 9.3 断言 API（`harness.js` 全量）

```js
ok(cond, msg)   no(cond, msg)
eq(a, b, msg)   ne(a, b, msg)     deepEq(a, b, msg)
gt / gte / lt / lte(actual, bound, msg)
approx(actual, expected, eps, msg)
inRange(actual, lo, hi, msg)
throws(fn, msg)
includes(hay, needle, msg)   includesNot(hay, needle, msg)
hasKeys(obj, keys, msg)
inspect(v)                    // 失败信息里的格式化
```

### 9.4 写一条测试

```js
const { test, section, ok, eq } = require('./harness');
const { loadGame, freshSave, dropGame } = require('./helpers');

section('我的新规则');

test('加座 Lv3 时同屏上限仍是 6', () => {
  const { TC } = loadGame();
  const s = freshSave(TC, { upgrades: Object.assign(TC.Save.blank().upgrades, { seats: 3 }) });
  eq(TC.Calc.seats(s), 6);
});

test('能开一局并推进时间', () => {
  const { TC } = loadGame();
  const run = TC.Level.create(TC.Save.blank(), 'A1', { seed: 1 });
  TC.Level.tick(run, 1000);
  ok(run.customers.length >= 0);
});
```

> `loadGame()` 默认复用单例（快）。需要干净环境（例如改存档）时用 `loadGame({ fresh: true })` 或先 `dropGame()`。
> `loadGame()` 会**主动把新手教程摘掉**（不改存档），但需要测教程的用例自己调 `TC.UI.tutStart()`。

### 9.5 当前覆盖（24 文件 / 541 断言）

| 文件 | 断言 | 覆盖 |
| --- | --- | --- |
| `ach.test.js` | 18 | 成就判定与领取 |
| `audio.test.js` | 22 | 音效合成、节流、无声环境降级 |
| `badge.test.js` | 11 | 徽章数据表与「全通才发」 |
| `calc.test.js` | 36 | 价格、小费、星级、经验、结算 |
| `codex.test.js` | 16 | 图鉴四分类渲染与切换 |
| `customer.test.js` | 11 | 顾客职业表、按地区换装、2×3 排队 |
| `daily.test.js` | 13 | 每日任务抽取与进度 |
| `data.test.js` | 29 | **数据表自洽性**（关卡/菜品/升级索引） |
| `difficulty.test.js` | 12 | 难度曲线：等待 ×2、三星「打得出也咬得人」 |
| `easter.test.js` | 16 | 三个彩蛋 + 地球仪同日锁定/跨天重置 |
| `features.test.js` | 15 | 登录奖励、满意度、一键重玩、音量、下一步提示 |
| `flow.test.js` | 34 | **端到端**：开一关 → 做单 → 上菜 → 结算 → 解锁 |
| `globe.test.js` | 16 | 地球仪球面算法（色号合法、旋转周期、飞机不越界） |
| `guest.test.js` | 11 | 特殊顾客触发、一生一次、每日首登、30s 道具 |
| `hard.test.js` | 12 | 挑战模式：解锁、独立星级、灶台故障、困难徽章 |
| `level.test.js` | 65 | 关卡状态机（备料/烹饪/装盘/上菜/道具） |
| `pixel.test.js` | 32 | 像素生成与 5 色校验（含 40 种造型不撞款） |
| `router.test.js` | 17 | 视图路由与顶栏 |
| `save.test.js` | 37 | 存档读写、归一化、迁移 |
| `scene.test.js` | 46 | 布局、命中检测、绘制不变量 |
| `simplify.test.js` | 10 | 一键下锅、多灶台逐步点亮、道具栏折叠 |
| `tutorial.test.js` | 14 | 教程步骤表、教学局规则、可重看 |
| `ui.test.js` | 35 | 页面渲染与事件翻译 |
| `upgrade.test.js` | 13 | 升级购买与数值读取 |
| **合计** | **541** | 约 2 秒跑完 |

### 9.6 回归时机

- 改 `TC.DATA` → 至少跑 `data` `calc` `level`。
- 改 `TC.Calc` → 至少跑 `calc` `difficulty` `upgrade`，再跑一次 `flow` 端到端。
- 改 `TC.Pixel` / `TC.Scene` → 跑 `pixel` `scene` `globe`。
- 改 `TC.UI` → 跑 `ui` `router` `codex` `tutorial` `features`。
- **上线前**：全量跑一遍，再进下一步的线上回读校验。

---

## 10. 部署 Runbook

### 10.1 线路总览

```
GitHub (Miacy05/travel-chefs) ──push──> Vercel 自动部署 ──> https://travel-chefs.vercel.app
                                          （主地址，海外）

本地 index.html ──工具上传──> 阿里云 OSS 香港 bucket travelchefs-bond-site-hk
                                          └─ 自定义域名 travelchefs.bond（Let's Encrypt 证书，国内直连）
```

| 线路 | 自动更新？ | 说明 |
| --- | --- | --- |
| Vercel | ✅ push `main` 即自动重建 | 唯一需要维护的线上源 |
| OSS + 自有域名 | ❌ **必须手工上传** | 改了 `index.html` 却只在 push 后忘记上传 OSS，是国内用户看到旧版的头号原因 |

### 10.2 推送到 GitHub

仓库的 remote 走 **SSH over 443**（本机到 `github.com:443` 不稳定，直连超时 / 代理 502 / TLS 重置都遇到过）：

```powershell
$git = "C:\Users\20742\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
$repo = "<repo path>"

& $git -C $repo status --porcelain          # 先看改了什么
& $git -C $repo add <files>
& $git -C $repo commit -F <msgfile>         # 中文提交信息走文件，避免命令行编码问题
& $git -C $repo push origin main
& $git -C $repo ls-remote origin main       # 核对远端确实收到了
```

- remote：`ssh://git@ssh.github.com:443/Miacy05/travel-chefs.git`
- **备用通道**：`node tools/push-to-github.js`（走可达的 `api.github.com` REST API 建仓库并生成提交）。

### 10.3 Vercel

已在网页端连好仓库。首次部署或换仓库时：

```powershell
npx vercel login
npx vercel deploy --prod --yes
```

网页端等价流程：Import 仓库 → Framework Preset 选 **Other**（纯静态，**不要**选 Next.js）→
Build Command / Output Directory **全部留空** → Deploy。

### 10.4 OSS + 自定义域名（国内直连那一条）

上传（用 `tools/aliyun.env` 里的凭据，`bucket travelchefs-bond-site-hk`，地域 `oss-cn-hongkong`）：

```
必须上传：index.html · process-record.html · 404.html · assets/（整个目录）
可选上传：9d3560146f8f08de027e1b721862757c.txt（平台域名归属验证文件，见 11.2）
```

> **踩过的坑**：只传了三个 html、漏掉 `assets/` → 5 张明信片全 404（游戏不崩，有 `onerror` 兜底，但图鉴里只剩色块）。
> 上传后**务必逐文件回读并比 sha256**，不要只看首页 200。

给自定义域名绑 HTTPS 证书：

```powershell
# 本机证书在 tools/certs/：fullchain.pem + privkey.pem（CN=travelchefs.bond，SAN 含 www）
# 用 oss2 的 put_bucket_cname 逐个域名绑定（apex 和 www 必须各绑一次）
```

**两个必踩的坑**：

1. **RAM 权限**：OSS 帮自定义域名绑证书时会去调数字证书服务，缺 `yundun-cert` 权限会直接
   `AccessDenied: You are forbidden to yundun-cert:CreateSSLCertificate`。
   需要给 RAM 子用户加系统策略 **`AliyunYundunCertFullAccess`**。
2. **证书下发有延迟**：绑定成功那一刻严格校验可能只有 3/5 通过（`Hostname mismatch`）。
   **必须连采 20+ 次等通过率收敛到 100%** 才能判定完成 —— 只请求一次会误判成失败。

### 10.5 上线后的验证矩阵（照抄）

| 检查 | 方法 | 通过标准 |
| --- | --- | --- |
| DNS 未污染 | 多家 DNS（114 / 阿里 / 腾讯 / 百度 / Google）解析同一 IP | 全部一致 |
| 内容是不是最新 | 回读线上文件，比**字节数 + sha256** | 与仓库 `index.html` 逐字节一致 |
| 静态资源 | 逐文件跑一遍（页面 + `assets/` 全量） | 全 200，**不只测首页** |
| HTTPS 证书 | **默认校验**（`ssl.create_default_context()`）连采 20+ 次 | 100% 通过，对端 CN 正确 |
| HTTP 兼容 | `http://` 也请求一遍 | 仍可访问（老链接不能挂） |
| 三个入口 | apex / `www` / vercel.app | 全部 200 |

> **只比大小不够**：缓存页会骗人。记录页 `process-record.html` 内建了这一步 ——
> 它加载时会实时回读线上文件并计算 sha256 与仓库源文件比对，结论直接显示在页面上。

---

## 11. 域名与访问

### 11.1 微信 / QQ 内的拦截

`travelchefs.bond` **没有 ICP 备案**，在微信 / QQ / QQ 浏览器内点开会命中腾讯安全拦截
（「已停止访问该网页」）。**这是域名层面的拦截，站点本身正常** —— 命令行怎么抓都是 200。

- 判定方法：**同一域名，系统浏览器能开、微信内被拦** ⇒ 就是腾讯的拦截。
- 已走申诉：2026-09-20 00:47 收到「申诉受理通知 —— 目前已为你**临时恢复访问**」。
  「临时」二字意味着这不是永久解封，**不要把交付押在它上面**。
- 腾讯的两个检测接口现在已经不能程序化调用（`validUrl` 返回「系统升级」、
  `check` 返回「验证码错误」），不要写进脚本。
- 交付材料里的口径：给 `https://travelchefs.bond/` 时注明「微信内请点右上角用系统浏览器打开」。

### 11.2 平台域名归属验证文件

平台（微信侧）要求验证域名归属时，会在**站点根目录**放一个指定文件名的 txt，内容是一串 hash：

- 文件名：`9d3560146f8f08de027e1b721862757c.txt`
- 内容：`92e3e429f78e781b302067716896aed450167ff5`（40 字节，**无 BOM、无结尾换行**）

要点：**逐字节**写入（BOM 或多余换行都会导致验证失败），并且**所有可控的根都要放**
（GitHub 仓库根 + Vercel + OSS），因为你不知道平台验的是哪个域名。**验证通过后不要删**，复验会重新拉。

---

## 12. 排错索引（按症状）

| 症状 | 最可能的原因 | 处理 |
| --- | --- | --- |
| 页面白屏 | `TC.bootError` 非空，启动链路抛异常 | 打开控制台看 `TC.bootError`；先跑 `node tests/run.js` 定位是哪个模块 |
| 测试报「找不到 jsdom」 | 未安装且托管工作区也没有 | 见 2.2 三种装法；或设 `TC_JSDOM` |
| 测试里中文乱码 | PowerShell 按 GBK 解码 | 读输出加 `-Encoding utf8`，或重定向到文件再读 |
| 线上还是旧版 | **推了 GitHub 但没传 OSS** | 重新上传 `index.html` 到 bucket，回读比 sha256 |
| 图鉴里的图是色块 | `assets/` 没上传（漏传整个目录） | 补传 `assets/`，逐文件回读校验 |
| 打开提示「连接不是私密连接」 | 自定义域名没绑证书 | 见 10.4；注意 `www` 要单独绑 |
| HTTPS 偶发报证书错误 | 证书下发未收敛 | 连采 20+ 次看通过率；不要只请求一次就下结论 |
| `https` 200 但证书报错 | 「能通」≠「证书对」（不校验时当然 200） | 用 `ssl.create_default_context()` 默认校验复测 |
| OSS 原生域名直接下载文件 | 默认域名带 `x-oss-force-download: true` | **不能用原生域名当兜底**，必须走自定义域名 |
| 微信 / QQ 内被拦 | 域名未备案，命中腾讯安全拦截 | 申诉（见 11.1）或用系统浏览器打开 |
| `git push` 超时 / TLS 重置 | 本机到 `github.com:443` 不通 | 走 SSH over 443，或用 `tools/push-to-github.js` |
| 进度丢失 | 存在 `localStorage`，换设备/清缓存会重置 | 预期行为（课程要求不引入数据库） |
| jsdom 里 canvas 报 `Not implemented` | 无 canvas 实现 | 已在 `helpers.js` 的 `NOISE` 白名单里忽略；逻辑测试不应依赖真实绘制 |

---

## 13. 开发约定

### 13.1 代码

- **ES5 语法**：`var` / `function`，不用箭头函数、模板字符串、`let/const` —— 保持老 WebView 兼容。
- 每个模块一个 IIFE，结尾 `TC.X = X;`，内部变量用**单字母别名**（`var U = {}` / `var D = TC.DATA`）。
- 中文注释写在**为什么**上（这段注释是给未来的自己看的），不要复述代码。
- 不新增资源文件：图形走 `TC.Pixel`，音效走 `TC.Audio`。
- 新增颜色前先看 5.1 调色板 —— `P.validate` 会拦住第 6 种颜色。

### 13.2 提交信息

采用约定式前缀（仓库现有 38 次提交即遵循此格式）：

```
feat(region,scene,staff): 5 个地区差异化店铺模型 + 地区专属装修 + 顾客排队动画
fix(tools): shot.js 改为等待页面就绪，支持等待较慢的线上首屏
test: 适配员工简化 / 顾客排队 / 地区专属装修，23 个文件 507 条断言全绿
docs(readme): 补上国内直连地址（travelchefs.bond）
docs(record): 记录页跟上自有域名 travelchefs.bond
chore(release): 版本号推进到 2.5.0
chore: 新增域名部署验证文件
```

- 前缀：`feat` / `fix` / `test` / `docs` / `chore`，可带模块域 `(scope)`。
- **提交信息一律走文件**：`git commit -F <file>`，避免命令行编码把中文变乱码。
- 版本号只在 `chore(release)` 里动，位置是 `TC.VERSION`。

### 13.3 上线前 checklist

1. `node tests/run.js` 全绿。
2. `TC.VERSION` 是否需要 +1。
3. `index.html` 改动 → push **并且**手工传 OSS。
4. `docs/` 里的截图是否需要重生成（`node tools/shot.js`）。
5. `README.md` / 本文件里的**数字**是否需要同步（断言数、提交数、行数、数据规模）—— 见 14.2。

---

## 14. 已知限制与路线图

### 14.1 已知限制

- 进度只存本地，**不做多端同步**（课程要求不引入数据库）。
- 音效为程序合成（8-bit 风格），未接入真实音频素材。
- 没有构建步骤 ⇒ 没有压缩/混淆，`index.html` 以源码形态公开。
- 单文件 10738 行，**IDE 里定位靠本文的模块行号表**（改代码行数后会漂移，重跑一遍统计即可）。
- `travelchefs.bond` 未备案，微信内访问依赖申诉结果（见 11.1）。

### 14.2 文档一致性（本文件与 README 的数字口径）

本文件里的数字全部由**本项目自己的装载器实测**得出（把 `index.html` 装进 jsdom 后 dump `TC`），
不是手抄。改完数据表后，这几处最容易被写旧：

| 数字 | 当前实测值 | 出现位置 |
| --- | --- | --- |
| 测试断言数 | **541** | README §六/§七、本文件 §1/§9.5 |
| 测试文件数 | **24** | 同上 |
| 升级项数 | **23**（8 手写 + 15 派生） | README §三、`TC.DATA` 模块头注释 |
| 教程步数 | **11** | README §四·补 |
| 加座满级 | **3**（+3 位顾客） | README §三 表格 |
| `index.html` 行数 | **10740** | README §七 |
| 提交数 | 见仓库实时（记录页实时读取） | 各处 |

> 建议：**断言数/文件数**这类数字只在 README 写一次，其余位置指向它，避免多处漂移。

### 14.3 可能的下一步

- 把 `index.html` 的模块拆成多个文件 + 一个极小构建（会把「单文件交付」的优点换掉，需权衡）。
- 给测试加一个 CI（GitHub Actions：装 jsdom → `node tests/run.js`），当前是手动跑。
- 存档加导出/导入（`JSON` 文本），解决换设备丢进度。
- 录屏/动图资源：`tools/shot.js` 已能截图，加个逐帧导出即可生成 gif。

---

## 15. 许可证

[MIT](../LICENSE)
