/**
 * ⭐⭐ 能力控制台守卫(2026-09-15)
 *
 * 用户拍板三条,本文件各钉一条:
 * > 「建这个 view」「在这两个 button 旁边建 console」
 * > 「测试方法分控制、输入、输出三个部分来分类」
 * > 「对函数的执行结果可看到,可验证才行」
 *
 * ── 守什么 ──
 *
 * ① **进得去** —— 注册 → import → 入口,三处 id 逐字一致。
 *    缺一个,现象都是「点了没反应」且不报错,而守卫扫源码扫不出
 *    「这个组件没有触发路径」(本会话踩过:CaptureMonitorView 顶栏入口被撤,
 *     631 条守卫全绿但用户点不到)。见 [[feedback-guard-must-pin-live-code]]。
 *
 * ② **是观察窗不是演示台** —— 渲染原样返回值,不给绿灯。
 *    「满屏绿灯而真实链路零数据」是本仓明确记过的死法。
 *
 * ③ **dev-only 两端都要**:renderer 侧 `import.meta.env.DEV`,
 *    main 侧 `app.isPackaged`。只关一端等于没关。
 *
 * ④ ⭐ **一能力一通道** —— 绝不能出现「求值任意脚本」的万能通道,
 *    那等于把 `web.dom` 费力关掉的注入口重新打开
 *    (`project-x-inject-template-escape`:采集恒 0 一整天,tsc 单测全绿)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const INDEX = read('src/views/web-console/index.ts');
const VIEW = read('src/views/web-console/WebConsoleView.tsx');
const VIEW_CODE = strip(VIEW);
const CSS = read('src/views/web-console/web-console.css');
const RENDERER = read('src/platform/renderer/index.tsx');
const SOCIAL = strip(read('src/views/social/SocialView.tsx'));
const HANDLER = read('src/platform/main/ipc/web-console-handler.ts');
const HANDLER_CODE = strip(HANDLER);
/**
 * ⭐ 归类逻辑已抽成**纯模块**(`web-console-classify.ts`)。
 *
 * 抽出去的理由:这段逻辑本会话出过三次 bug(耗时写死 0 / 层归错 / 「等不到」
 * 被当成站点改版),而它当时埋在 handler 里且没导出 —— 守卫只能 grep 源码文本,
 * **两次假绿**。现在**行为断言在 `web-console-classify.test.ts` 里真调函数**,
 * 本文件只留「结构还在不在」这类源码级检查。
 */
const CLASSIFY = strip(read('src/platform/main/ipc/web-console-classify.ts'));
const BUS = strip(read('src/platform/main/ipc/ipc-bus.ts'));
const PRELOAD = read('src/platform/main/preload/main-window-preload.ts');
const DTS = read('src/shared/ipc/electron-api.d.ts');
const CHANNELS = read('src/shared/ipc/channel-names.ts');

const VIEW_ID = 'web-console-view';

describe('⭐⭐ 进得去:注册 → import → 入口', () => {
  it('⭐⭐ registerView 注册了这个 id,且挂了 component', () => {
    expect(INDEX).toContain(`id: '${VIEW_ID}'`);
    expect(INDEX, '没挂 component = 打开是空白').toMatch(/component:\s*WebConsoleView/);
  });

  it('⭐⭐ renderer 真的 import 了 —— 注册是副作用,不 import 等于没注册', () => {
    expect(
      RENDERER,
      "renderer/index.tsx 没 import '@views/web-console' —— registerView 永远不会执行",
    ).toMatch(/import '@views\/web-console'/);
  });

  it('⭐⭐ SocialView 有入口按钮,id 与注册的**逐字一致**', () => {
    expect(SOCIAL, '没有打开控制台的入口 —— 建好了没人用')
      .toContain(`openRight('${VIEW_ID}')`);
  });

  it('⭐ 入口与另外两个按钮并存(工作台 / Inbox 不许被挤掉)', () => {
    expect(SOCIAL).toContain("openRight('x-workbench-view')");
    expect(SOCIAL).toContain("openRight('x-inbox-view')");
  });

  it('⭐⭐ main 侧 handler 真的在 ipc-bus 里注册了', () => {
    // ⚠️ 写了 registerWebConsoleHandlers 却没人调 = 通道不存在,
    //    面板每次 invoke 都 reject —— 正是本会话反复遇到的「建好了没接线」
    expect(BUS).toMatch(/registerWebConsoleHandlers\s*\(\s*\)/);
    expect(BUS).toMatch(/import \{ registerWebConsoleHandlers \}/);
  });
});

describe('⭐⭐ dev-only:两端都要关,只关一端等于没关', () => {
  it('⭐⭐ renderer 侧按 import.meta.env.DEV 决定注不注册', () => {
    expect(INDEX, 'view 在生产构建里也注册了 —— 用户会看到排查工具')
      .toMatch(/import\.meta\.env\.DEV/);
  });

  it('⭐⭐ 入口按钮同样 dev-only', () => {
    expect(SOCIAL, '按钮在生产构建里还在 —— 点了会 reject')
      .toMatch(/import\.meta\.env\.DEV[\s\S]{0,400}web-console-view/);
  });

  it('⭐⭐ main 侧按 app.isPackaged 决定注不注册', () => {
    expect(HANDLER_CODE, 'main 侧没关 —— 生产构建里通道照样在')
      .toMatch(/app\.isPackaged/);
    // 且必须是「打包就直接返回」,不是只打个日志
    expect(HANDLER_CODE).toMatch(/if\s*\(app\.isPackaged\)\s*\{[\s\S]{0,120}return;/);
  });
});

describe('⭐⭐ 按契约三分法分类:控制 / 输入 / 输出', () => {
  it('⭐⭐ 三个标签页都在', () => {
    for (const t of ['control', 'input', 'output']) {
      expect(VIEW_CODE, `缺 ${t} 标签页`).toMatch(new RegExp(`'${t}'`));
    }
    expect(VIEW).toMatch(/控制/);
    expect(VIEW).toMatch(/输入/);
    expect(VIEW).toMatch(/输出/);
  });

  it('⭐ 控制页跑的是底座已有的原子能力(不自己再写一份)', () => {
    for (const fn of ['ready', 'scrollUntil', 'tap', 'press']) {
      expect(VIEW_CODE, `控制页没有 ${fn}`).toMatch(new RegExp(`api\\(\\)!\\.${fn}\\(`));
    }
  });
});

describe('⭐⭐ 是观察窗,不是演示台', () => {
  it('⭐⭐ 渲染**原样返回值**,入参也留着', () => {
    expect(VIEW_CODE, '没渲染返回值原文').toMatch(/JSON\.stringify\(r\.output/);
    expect(VIEW_CODE, '没渲染入参 —— 只看结果分不清是参数错还是函数错')
      .toMatch(/JSON\.stringify\(r\.input/);
  });

  it('⭐⭐ 不拿绿灯冒充结果', () => {
    expect(
      VIEW_CODE,
      '面板出现了成功标记 —— 结果区只该显示原样返回值,让人自己判断',
    ).not.toMatch(/['"`](?:✅|❌|通过|PASS|成功)['"`]/);
    expect(CSS, 'CSS 里做了绿灯/红灯样式 —— 演示台的开端')
      .not.toMatch(/\.krig-webc__[\w-]*--(?:ok|pass|success|fail|error)/);
  });

  it('⭐⭐ 三态必须原样透出 —— 尤其 degraded 不许被压掉', () => {
    // degraded = 做了但不完整。当成功会掩盖漏采,当失败会丢掉已有进度。
    expect(HANDLER_CODE, 'handler 把 Result 压成了两态')
      .not.toMatch(/status\s*===\s*'ok'\s*\?\s*true\s*:\s*false/);
    expect(DTS, 'd.ts 没说明三态 —— 调用方会当成两态用').toMatch(/degraded/);
  });

  it('⭐ 通道没接时照实说,不编结果', () => {
    expect(VIEW_CODE).toMatch(/没有返回/);
  });
});

describe('⭐⭐ 红线:不许有「求值任意脚本」的万能通道', () => {
  it('⭐⭐ 一能力一通道,且零处接收脚本字符串', () => {
    // 万能通道的形态:payload 里带 script/code/js,然后直接 executeJavaScript
    expect(
      HANDLER_CODE,
      '出现了从 payload 取脚本文本的写法 —— 这会把 web.dom 关掉的注入口重新打开',
    ).not.toMatch(/p\.(script|code|js)\b(?![\w-])/);
  });

  it('⭐ 读 tabbar 用的是预置常量,不是调用方传进来的脚本', () => {
    expect(HANDLER_CODE).toMatch(/READ_APP_TAB_BAR/);
    expect(HANDLER_CODE, 'executeJavaScript 的入参必须是预置常量')
      .toMatch(/executeJavaScript\(READ_APP_TAB_BAR\)/);
  });
});

describe('⭐⭐ 四端名字一致(?. 会让不一致静默失败)', () => {
  it('⭐⭐ 九个通道:channel / preload / d.ts 三处对得上', () => {
    const chans = [
      'WEBC_READY', 'WEBC_SCROLL_UNTIL', 'WEBC_TAP', 'WEBC_PRESS', 'WEBC_HOVER',
      'WEBC_TYPE', 'WEBC_PAGES', 'WEBC_ANCHORS', 'WEBC_READ_TABBAR',
    ];
    for (const c of chans) {
      expect(CHANNELS, `channel-names 缺 ${c}`).toMatch(new RegExp(`${c}:`));
      expect(PRELOAD, `preload 没用 ${c}`).toMatch(new RegExp(`IPC_CHANNELS\\.${c}`));
      expect(HANDLER, `handler 没注册 ${c}`).toMatch(new RegExp(`IPC_CHANNELS\\.${c}`));
    }
  });

  it('⭐⭐ preload 的方法名与 d.ts 对得上(面板调的是 d.ts 那份)', () => {
    for (const fn of ['ready', 'scrollUntil', 'tap', 'press', 'hover', 'type',
      'pages', 'anchors', 'readTabBar']) {
      expect(PRELOAD, `preload 缺 ${fn}`).toMatch(new RegExp(`\\b${fn}\\s*[:(]`));
      expect(DTS, `d.ts 缺 ${fn}`).toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
  });
});

describe('⭐⭐ 两个「成不成」分开:通道 vs 能力', () => {
  it('⭐⭐ 通道层用 channelOk,不与能力层的 result.status 同名', () => {
    // 用户 2026-09-15:「ok:true 配 status:failed 读起来别扭」——
    // 同一屏两个不同的问题用同一个词,是让人误读的最短路径
    expect(HANDLER_CODE, 'handler 还在用裸 ok').not.toMatch(/return \{ ok:/);
    expect(HANDLER_CODE).toMatch(/channelOk/);
    expect(DTS, 'd.ts 没跟着改 —— 面板按老形状读会恒 undefined').toMatch(/channelOk/);
  });
});

describe('⭐⭐ 参数不许出现「配不到一起」的组合', () => {
  it('⭐⭐ URL 片段与锚点名分开存 —— 共用一个格子就是那个 bug 的根源', () => {
    // 初版三种判据共用 readyValue,默认 anchorAppears + "/home" 直接失败
    expect(VIEW_CODE).toMatch(/readyAnchor/);
    expect(VIEW_CODE, 'anchor 分支仍在读 readyValue —— 老 bug 还在')
      .not.toMatch(/kind: readyKind, anchor: readyValue/);
  });

  it('⭐⭐ 锚点用下拉,名字来自**真表**(面板不抄一份)', () => {
    expect(VIEW_CODE).toMatch(/function AnchorSelect/);
    // 必须从 anchors() 返回的 tables 取,不许硬编码一份名单
    expect(VIEW_CODE).toMatch(/o\?\.tables/);
    expect(VIEW_CODE, '面板里硬编码了锚点名 —— 会与真表漂移')
      .not.toMatch(/\[\s*'nav\.profile'\s*,/);
  });

  it('⭐ 表没读到时明说,不渲染空下拉', () => {
    // 空下拉看起来像「没有任何锚点」,而实际可能只是还没读到
    expect(VIEW_CODE).toMatch(/names\.length === 0/);
    expect(VIEW).toMatch(/锚点表还没读到/);
  });
});

describe('⭐⭐ 日志要能替代口头描述', () => {
  /**
   * 用户 2026-09-15:「我建议你在后台能够 log 这些操作,而不是靠我口头描述,
   * 这是不健康的。」—— 那么日志就必须**带得出判定所需的全部事实**。
   */
  it('⭐⭐ ready / scrollUntil 打耗时 —— 判定常常全在耗时上', () => {
    // 「等满 6s 才 failed」与「立刻 failed」是两件完全不同的事:
    // 前者说明轮询在工作,后者说明第一次没命中就放弃了。只打 status 分不出来。
    const body = HANDLER_CODE.slice(
      HANDLER_CODE.indexOf('WEBC_READY'),
      HANDLER_CODE.indexOf('WEBC_TAP'),
    );
    expect(body.length, '锚点过时').toBeGreaterThan(100);
    expect(body, 'ready 没计时 —— 超时真假无从判断').toMatch(/Date\.now\(\) - t0/);
  });

  it('⭐⭐ 失败要打**原因**,不只打 status', () => {
    // failed 有两种成因,现象一样但排查方向相反:
    //   锚点没登记(改锚点表) vs 等不到(改等待时机)
    expect(CLASSIFY).toMatch(/function describeWhy/);
    expect(CLASSIFY, 'failed 不带 reason,日志里两种成因分不开')
      .toMatch(/r\.status === 'failed'[\s\S]{0,80}r\.reason/);
  });

  it('⭐⭐ degraded 的 missing 也要打 —— 不打等于没报', () => {
    expect(CLASSIFY).toMatch(/r\.status === 'degraded'[\s\S]{0,80}missing/);
  });
});

describe('⭐⭐ 留痕要活过重启(遥测的前提)', () => {
  /**
   * 用户 2026-09-15:「这些数据应该记录到 log,这样你直接读取,
   * 未来可能需要遥测的这些能力来发现并迭代 app。」
   *
   * ⚠️ `console.log` 进程一关就没了,替代不了「我直接读取」。
   */
  const RUNTIME = strip(read('src/platform/main/web-capability/wiring/runtime.ts'));
  const SINK = read('src/platform/main/web-capability/wiring/fs-trace-sink.ts');

  it('⭐⭐ TraceRecorder 真的接了落盘 sink(不接 = 进程一关全没)', () => {
    expect(
      RUNTIME,
      'new TraceRecorder() 没传 sink —— writeDegradation 是空操作,记录活不过重启',
    ).toMatch(/new TraceRecorder\(\s*\{[^}]*sink/);
  });

  it('⭐⭐ 每次调用都落痕 —— 成功也记(否则算不出成功率)', () => {
    expect(HANDLER_CODE).toMatch(/function recordRun/);
    // ⭐ 行为断言在 web-console-classify.test.ts(真调 planTrace);这里只钉结构还在
    expect(CLASSIFY, 'ok 不记 recovery —— 只有失败记录就算不出成功率')
      .toMatch(/status === 'ok'[\s\S]{0,200}outcome: 'recovered'/);
    expect(HANDLER_CODE, 'handler 没把判断派发给 planTrace —— 又埋回去了')
      .toMatch(/planTrace\(/);
    // 五个能力都要落
    for (const fn of ['ready', 'scrollUntil', 'tap', 'press', 'type']) {
      expect(HANDLER_CODE, `${fn} 没落痕`).toMatch(new RegExp(`recordRun\\('${fn}'`));
    }
  });

  it('⭐⭐ 耗时不许写死 —— 假事实比没有更坏', () => {
    // 初版 tap/press/type 传了字面量 0,查「tap 要多久」会读到 0ms
    expect(HANDLER_CODE, '还有 recordRun(..., 0) 这种写死耗时')
      .not.toMatch(/recordRun\([^)]*,\s*0\s*\)/);
  });

  it('⭐⭐ 按能力真正所属的层归类,不是一律 web.page', () => {
    // 归错层会让按层的查询直接说谎
    expect(CLASSIFY).toMatch(/LAYER_OF/);
    expect(CLASSIFY).toMatch(/tap:\s*'web\.input'/);
    expect(CLASSIFY).toMatch(/ready:\s*'web\.page'/);
  });

  it('⭐ 落盘按天分片 + 坏行跳过计数(照 FsRawSink 已验证的做法)', () => {
    expect(SINK).toMatch(/\.jsonl/);
    expect(SINK, '追加行不自带换行 —— 两条会黏成一行').toMatch(/\\n`/);
    expect(SINK, '读回没有坏行计数 —— 断电截断会静默丢').toMatch(/badLines/);
    expect(SINK, '没有老化 —— 诊断模块自己会把磁盘吃满').toMatch(/dropShardsBefore/);
  });

  it('⭐⭐ 老化**有人调** —— 只有方法存在等于没老化', () => {
    /**
     * ⚠️ 本条是修出来的:初版只验 `SINK` 里有 `dropShardsBefore`,
     * 而那只证明**方法被定义了**。实测 `grep` 全仓 → **零调用**,
     * 磁盘照样无限涨,守卫却全绿。
     * 本会话第七次同形态(建好了、测过了、没接线)。
     */
    const WATCH = strip(read('src/platform/main/web-capability/wiring/health-watch.ts'));
    const MAIN = strip(read('src/platform/main/index.ts'));
    expect(WATCH, '没有人调 dropShardsBefore —— 老化写了不跑')
      .toMatch(/traceSink\.dropShardsBefore\(/);
    expect(WATCH).toMatch(/export function startTraceSweep/);
    // ⭐ 常驻 timer 铁律:必须有停止调用,且在 before-quit 被调到
    expect(WATCH, '没有停止调用 —— Ctrl+C 退不掉').toMatch(/export function stopTraceSweep/);
    expect(MAIN, 'index.ts 没启动老化').toMatch(/startTraceSweep\(\)/);
    expect(MAIN, 'before-quit 没停老化 timer(常驻 timer 铁律)').toMatch(/stopTraceSweep\(\)/);
  });

  it('⭐⭐ 各条流保留期不同 —— 一刀切要么误删故障史要么撑爆磁盘', () => {
    // §3.2:lifecycle/network 是高频流水(短),degradation 低频高价值(长)
    const WATCH = strip(read('src/platform/main/web-capability/wiring/health-watch.ts'));
    expect(WATCH).toMatch(/RETAIN_DAYS/);
    expect(WATCH, 'degradation 没留得比流水久 —— 趋势会被删掉')
      .toMatch(/degradation:\s*(?:[3-9]\d|\d{3,})/);
  });

  it('⭐⭐ 落盘失败**不抛**但要出声(诊断不许成为故障源)', () => {
    expect(SINK).toMatch(/console\.warn/);
    expect(SINK, '落盘失败抛出去会让一次导航跟着失败').toMatch(/catch \(err\)/);
  });

  it('⭐⭐ 读回通道四端齐(内存 + 磁盘两份对账)', () => {
    expect(CHANNELS).toMatch(/WEBC_TRACE:/);
    expect(PRELOAD).toMatch(/IPC_CHANNELS\.WEBC_TRACE/);
    expect(HANDLER).toMatch(/IPC_CHANNELS\.WEBC_TRACE/);
    expect(DTS).toMatch(/trace\(sinceMs/);
    // 两份都要给:对不上就说明落盘坏了
    expect(HANDLER_CODE).toMatch(/memory:/);
    expect(HANDLER_CODE).toMatch(/disk:/);
  });
});

describe('⭐⭐ 归类要能支撑遥测,不能自我污染', () => {
  /**
   * 2026-09-15 读**真实留痕**时发现:
   * 「anchorGone 等推文消失、推文一直在」被记成了 `unexpected-format`。
   * 那是完全正常的否定结果,而 `unexpected-format` 是**站点改版探测器** ——
   * 拿正常超时喂它,X 真改版时指标早被顶高,涨上去也看不出来。
   */
  it('⭐⭐ 纯粹「等不到」不记 degradation(记 recovery:failed)', () => {
    /**
     * ⚠️⚠️ **只扫 `recordRun` 函数体里那个分支**,不扫整个文件。
     *
     * 初版写成扫全文件 `toMatch(/outcome: 'failed'/)` —— **假绿**:
     * 文件里 `outcome:` 出现三处(注释一处 + recovered 一处 + failed 一处),
     * 把「等不到」那条从 failed 改成 recovered,守卫照样全绿。
     * 注入验证当场抓到(2026-09-15)。
     *
     * ⭐ 本会话第八次同款教训,规律已经很清楚:
     * **整文件 `toMatch` 在 token 出现多次时永远不够** ——
     * 必须缩到被守的那一段,并钉住**分支**而不是**字面量**。
     */
    const body = CLASSIFY.slice(
      CLASSIFY.indexOf('export function planTrace('),
      CLASSIFY.indexOf('export function describeWhy('),
    );
    expect(body.length, '锚点过时:找不到 recordRun 函数体').toBeGreaterThan(200);

    // 「非锚点错 + 非注入异常 + failed」这一支,必须走 recovery 且 outcome 是 failed
    const branch = body.slice(
      body.indexOf('!isAnchorMiss && !hadInjectionError'),
      body.indexOf('traceRecorder.degradation'),
    );
    expect(branch.length, '「等不到」那条分支不见了 —— 它又掉回 degradation 了')
      .toBeGreaterThan(50);
    /**
     * ⚠️ 抽成纯函数后契约变了:`planTrace` **返回** `{kind:'recovery'}`,
     * 它自己**绝不调** `traceRecorder` —— 判断与副作用分开正是抽取的目的。
     * 初版这条仍断言 `traceRecorder.recovery(`,于是**为了过时的理由恒红** ——
     * 而恒红的守卫和假绿一样瞎:注入验证(删掉整条分支)它一样不会变化。
     */
    expect(branch, '等不到没归成 recovery —— 会污染改版探测器')
      .toMatch(/kind: 'recovery'/);
    expect(branch, "等不到被记成 recovered —— 那是把否定结果说成成功")
      .toMatch(/outcome: 'failed'/);
  });

  it('⭐⭐ 三种失败分三类,不一律 unexpected-format', () => {
    expect(CLASSIFY).toMatch(/isAnchorMiss[\s\S]{0,120}'contract-violation'/);
    expect(CLASSIFY).toMatch(/hadInjectionError[\s\S]{0,120}'resource-failure'/);
  });
});

describe('⭐⭐ lifecycle 流不许是空的(「当时在哪个页面」)', () => {
  const LC = strip(read('src/platform/main/web-capability/wiring/trace-lifecycle.ts'));
  const MAIN2 = strip(read('src/platform/main/index.ts'));

  it('⭐⭐ 真的有人订阅 pageRegistry 的生命周期', () => {
    // 事件一直在发,`subscribeLifecycle` 一直存在,但此前**零订阅者**
    expect(LC).toMatch(/pageRegistry\.subscribeLifecycle\(/);
    expect(LC).toMatch(/traceRecorder\.lifecycle\(/);
  });

  it('⭐⭐ 起停成对,且在 before-quit 停(常驻订阅同铁律)', () => {
    expect(MAIN2).toMatch(/startTraceLifecycle\(\)/);
    expect(MAIN2, 'before-quit 没退订').toMatch(/stopTraceLifecycle\(\)/);
  });
});

describe('⭐ pageId 不透明 —— 面板只传 wcId', () => {
  it('⭐⭐ 面板不构造、不解析 pageId', () => {
    expect(
      VIEW_CODE,
      '面板自己拼 pageId 会复活 targetWcId 那套身份透传(不变量 3)',
    ).not.toMatch(/pageId\s*:/);
  });

  it('⭐ pageId 由主侧用 xPageId 取', () => {
    expect(HANDLER_CODE).toMatch(/xPageId\(/);
  });
});
