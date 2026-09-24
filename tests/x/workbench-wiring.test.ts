/**
 * ⭐⭐ X 工作台:接线守卫(2026-09-15 重构第一版)
 *
 * ── 为什么这个文件必须存在 ──
 *
 * ⚠️ 本次会话刚栽过一次:改了 `CaptureMonitorView` 的内部,typecheck 干净、
 * 631 条守卫全绿,但它**没有顶栏入口**(`view === 'capture'` 分支永远走不到),
 * 用户点不进去。守卫扫源码,扫不出「这个组件没有触发路径」。
 *
 * ⭐ 所以新面板的守卫第一条不是「功能对不对」,而是**「进得去吗」**:
 * 注册 → import → 入口 → id 一致,四者缺一,现象都是「点了没反应」且不报错。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const INDEX = read('src/views/x-workbench/index.ts');
const VIEW = read('src/views/x-workbench/XWorkbenchView.tsx');
const VIEW_CODE = strip(VIEW);
const CSS = read('src/views/x-workbench/x-workbench.css');
const RENDERER = read('src/platform/renderer/index.tsx');
const SOCIAL = strip(read('src/views/social/SocialView.tsx'));

const VIEW_ID = 'x-workbench-view';

describe('⭐⭐ 进得去:注册 → import → 入口,三处 id 必须一致', () => {
  it('⭐⭐ registerView 注册了这个 id', () => {
    expect(INDEX).toContain(`id: '${VIEW_ID}'`);
    expect(INDEX, '没挂 component = 打开是空白').toMatch(/component:\s*XWorkbenchView/);
  });

  it('⭐⭐ renderer 真的 import 了 —— 注册是副作用,不 import 等于没注册', () => {
    expect(
      RENDERER,
      "renderer/index.tsx 没 import '@views/x-workbench' —— registerView 永远不会执行",
    ).toMatch(/import '@views\/x-workbench'/);
  });

  it('⭐⭐ SocialView 有入口按钮,且 id 与注册的**逐字一致**', () => {
    expect(SOCIAL, '没有打开工作台的入口 —— 建好了没人用').toContain(`openRight('${VIEW_ID}')`);
  });

  it('⭐ 入口与旧面板并存(迁移完成前不许撤掉 Inbox)', () => {
    // 用户 2026-09-15:「保留一个旧界面的切换 button,这样就不会中断原来的一些操作」
    expect(SOCIAL, '旧面板入口被撤了 —— 收件箱/拟回复/标注还在那边').toContain("openRight('x-inbox-view')");
  });

  it('⭐⭐ 工作台内有「旧版」按钮能切回去', () => {
    expect(VIEW_CODE, '切不回旧面板 —— 日常操作会被中断').toContain("openRight('x-inbox-view')");
    expect(VIEW).toMatch(/旧版/);
  });
});

describe('⭐ 配色与 X 统一,但不污染全局 token', () => {
  it('⭐⭐ 不改 theme.css 的全局变量(会波及所有 view)', () => {
    // 沿用 x-send-confirm-popup.css 已验证的做法:独立 class 前缀 + 局部色值
    expect(CSS).toMatch(/\.krig-xwb\s*\{/);
    expect(CSS, '在 :root 上定义会污染全局').not.toMatch(/:root\s*\{/);
  });

  it('⭐ 用的是 X 的深色(纯黑底 / #2f3336 线 / X 蓝),不是 theme 的蓝灰', () => {
    expect(CSS).toMatch(/--xwb-bg:\s*#000000/);
    expect(CSS).toMatch(/--xwb-line:\s*#2f3336/);
    expect(CSS).toMatch(/--xwb-blue:\s*#1d9bf0/);
    expect(CSS, 'theme 的 --bg #0f172a 是蓝灰,与左侧 X 贴一起会突兀')
      .not.toMatch(/--xwb-bg:\s*#0f172a/);
  });
});

describe('⭐⭐ 盯人:过滤在呈现层 + 补全字段真的渲染', () => {
  it('⭐⭐ 过滤在呈现层,列表用的是过滤后的结果', () => {
    // 采集层无条件全收(「丢掉的永远查不回来」),盯人只是少显示
    expect(VIEW_CODE).toMatch(/const shown = \(snap\?\.recent \?\? \[\]\)\.filter/);
    expect(VIEW_CODE, '列表没用 shown —— 过滤白做').toMatch(/\{shown\.map\(/);
  });

  it('⭐⭐ 补全的字段**真的显示**了 —— 传了不用等于白补', () => {
    for (const f of ['inReplyToScreenName', 'inReplyToStatusId', 'hasMedia', 'isLongText']) {
      expect(VIEW_CODE, `面板没用 t.${f}`).toMatch(new RegExp(`t\\.${f}`));
    }
    expect(VIEW_CODE).toMatch(/t\.metrics\?\.retweets/);
    expect(VIEW_CODE).toMatch(/t\.self\?\./);
  });

  it('⭐⭐ 计数口径说得清:不拿全局采集率冒充「他的 N 条」', () => {
    // 否则会出现「列表 3 条、采集率 99%」这种对不上的账
    expect(VIEW_CODE).toMatch(/shown\.length/);
    expect(VIEW).toMatch(/采集率\(全部\)/);
    expect(VIEW).toMatch(/屏幕共/);
  });

  it('⭐ 抓画像是手动触发(它会导航,自动跑会顶掉左侧浏览)', () => {
    expect(VIEW_CODE).toMatch(/onClick=\{fetchProfile\}/);
    expect(VIEW_CODE, '抓画像进了自动执行路径').not.toMatch(/useEffect\([\s\S]{0,200}fetchProfile\(\)/);
  });
});

describe('⚠️ 边界:数据必须是真的,不塞假数据', () => {
  /**
   * ⚠️⚠️ 2026-09-24 这条守卫**使命变了**,不是放宽:
   *
   * 原来要求那块 pane 里写着「还没接上」—— 那是当时**留空的实现手段**,
   * 真正要防的是第二句:**不许塞假数据**(「看着有、实际没有」比「明说没有」更难查)。
   * 现在 pane 已接上真实的编排执行(onFlowProgress + runFlow),数据是真的,
   * 再要求「写着还没接上」就成了**要求代码说谎**。
   *
   * ⭐ 所以保留**意图**(不许假数据),换掉**手段**(不再钉那句话),
   * 并补上「数据必须来自真实链路」的正面判据。
   */
  it('⭐⭐ 不许塞假任务数据', () => {
    expect(VIEW_CODE, '塞了假任务数据').not.toMatch(/mockTasks|fakeTasks|DEMO_TASKS|SAMPLE_/);
  });

  it('⭐⭐ 编排数据必须来自真实链路(广播 + IPC),不是本地编的', () => {
    /** ⚠️ 正面判据:接的是真通道,而不是「看着有数据」 */
    /**
     * ⚠️ 2026-09-24 实测:写成 `/onFlowProgress/` 会被 `onFlowProgressXX`
     * **包含匹配**,改错了名字照样绿 —— 必须钉**完整的调用形态**。
     */
    expect(VIEW_CODE, '没订阅真实进度广播').toMatch(/onFlowProgress\?\.\(/);
    expect(VIEW_CODE, '没调真实的 runFlow 通道').toMatch(/runFlow\?\.\(|runFlow\(/);
  });
});
