/**
 * Web 能力层的运行期单例 —— 接线层共用的一套 registry / bus / recorder / probe
 *
 * 各能力本身是纯逻辑类(可 new 多个,便于单测);**生产运行时只要一套**,
 * 集中在这里,免得各消费者各建一份导致「A 登记的页面 B 查不到」。
 */

import { PageRegistry } from '../page';
import { NetworkEventBus, CdpBodyProvider } from '../net';
import { setWebRequestDiag } from './webrequest-side';
import { TraceRecorder, HealthProbe, NetMonitor } from '../trace';
import { ScriptRegistry, registerAIScripts, registerLocateScripts, registerRendererScripts } from '../dom';
import { ElectronDomRunner } from './electron-dom';
import { FsTraceSink } from './fs-trace-sink';
import { ControlEngine } from '../page';
import { InputEngine } from '../input';
import type { AnchorResolver } from '../input';
import type { PageResolver } from '../page/control-types';
import { ElectronControlHost } from './electron-control';
import { ElectronInputHost } from './electron-input';
import { lookupWebContents } from './page-hosts';

export const pageRegistry = new PageRegistry();
export const netBus = new NetworkEventBus();
/**
 * ⭐⭐ 载荷「没到手」时**落盘**,不只 console.warn —— 2026-10-02。
 *
 * ⚠️ 真机实测逼出来的:点开始捕获后接线 ✅ attach ✅ 但一条载荷都没有,
 * 而 `body-provider` 里四处静默 return 全只打 console.warn →
 * 「捕 0 条」这个结果**没有任何可读的成因**。
 *
 * ⭐ 四种 reason 各指一个方向,混在一起就查不动:
 * · get-body-failed    CDP 取 body 报错(通道还活着,单条失败)
 * · body-undecodable   拿到了但解不出
 * · oversize-kept      ⭐ **提醒,不是失败**:载荷比提醒阈值大,但已**原样完整**交出。
 *                      ⚠️ 本层既不截断也不丢弃 —— 用户 2026-10-02:
 *                      「要保持获取到的信息的完整性,而不是片段」
 * · correlate-failed   ⚠️ 配不上 webRequest 记录 —— 整条链最常见的死法
 *
 * ⚠️ 这里**不限流**:一条坏就记一条。刷屏本身就是信号
 * (「webRequest 侧零接线」那次的症状正是它刷屏)。
 */
/**
 * ⚠️ 诊断去重(2026-10-02,与 body-provider 里的 `diag-request` 一起删)。
 * X 一秒几十条请求,不去重会把留痕写爆 —— 按「type + 通过与否」只记一次,
 * 足够回答「哪些类型被挡了」这个问题。
 */
const diagSeen = new Set<string>();

/**
 * ⚠️ 诊断(2026-10-02,定位后删):webRequest 侧看见的 graphql 操作。
 * ⭐ 与 CDP 侧对照 —— 一边有一边没有,就知道是谁漏了。
 */
setWebRequestDiag((op, method) => {
  traceRecorder.lifecycle({
    layer: 'web.net',
    event: 'diag-webrequest-graphql',
    detail: { op, method },
  });
  console.log(`[web.net 诊断] webRequest 看见 graphql: ${method} ${op}`);
});

export const bodyProvider = new CdpBodyProvider(netBus, (miss) => {
  if (miss.reason === 'diag-cdp-graphql') {
    const key = `cdp|${miss.detail}`;
    if (diagSeen.has(key)) return;
    diagSeen.add(key);
    traceRecorder.lifecycle({
      layer: 'web.net', event: 'diag-cdp-graphql', detail: { info: miss.detail },
    });
    console.log(`[web.net 诊断] CDP 看见 graphql: ${miss.detail}`);
    return;
  }
  if (miss.reason === 'diag-request') {
    /**
     * ⚠️⚠️ 去重 key **不能只用 type** —— 上一轮栽过:
     * `.m4s` 视频分片与 `promoted_content/log.json` 都报 `type=xhr pass=true`,
     * key 完全相同 → 视频那条被去重吃掉 → 诊断里看不到它,
     * 我据此以为「视频没走这条路」,查错了方向。
     *
     * ⭐ 改成按 **host + 路径首段** 去重:既能看清有哪些来源,
     * 又不会被 X 每秒几十条同类请求刷爆。
     */
    let bucket = miss.url.slice(0, 40);
    try {
      const u = new URL(miss.url);
      const seg = u.pathname.split('/').filter(Boolean);
      // ⭐ GraphQL 要看到**操作名**(最后一段),那是判断「有没有 HomeTimeline」的关键
      bucket = u.pathname.includes('/graphql/')
        ? `${u.hostname}/graphql/${seg[seg.length - 1]}`
        : `${u.hostname}/${seg.slice(0, 3).join('/')}`;
    } catch { /* 非法 URL 用前缀兜底 */ }
    const key = `${bucket}|${miss.detail ?? ''}`;
    if (diagSeen.has(key)) return;
    diagSeen.add(key);
    traceRecorder.lifecycle({
      layer: 'web.net',
      event: 'diag-request-type',
      detail: { bucket, info: miss.detail },
    });
    return;
  }
  /**
   * ⚠️ `category` **按成因分**,不是统一一个 ——
   * 分类学在 `types.ts` 里写着各自的含义,混成一类就失去了按类统计的意义:
   * · 取 body 报错 / 解不出 → 依赖的 IPC 失败 = `resource-failure`
   * · 被自己设的上限挡了   → 不是故障,是命中了未预期的构造 = `unexpected-format`
   * · 配不上 webRequest    → 两侧编号对不上,**链路级**的失效 = `systemic`
   */
  const category = miss.reason === 'correlate-failed'
    ? 'systemic' as const
    /**
     * ⚠️ `oversize-kept` 归 `unexpected-format`:**它不是故障** ——
     * 数据完好无损地交出去了,只是比预期大。
     * ⭐ 不归 resource-failure(没有任何资源失败)、
     * 　 更不归 contract-violation(没有违反任何契约)——
     * 　 归错类会让「内存提醒」混进真故障堆里,把真的问题淹掉。
     */
    : miss.reason === 'oversize-kept'
      ? 'unexpected-format' as const
      : 'resource-failure' as const;
  traceRecorder.degradation({
    layer: 'web.net',
    operation: 'capture-body',
    category,
    reason: `${miss.reason}: ${miss.detail ?? ''}`.trim(),
    // ⚠️ `inputRef` 的注释明确说「指向输入的引用(如 bodyRef / pageId)」—— 就是为此准备的
    inputRef: String(miss.pageId),
    rawSnippet: miss.url,
  });
});
/**
 * ⭐ 诊断留痕的落盘根目录。
 *
 * ⚠️ `app` 只在主进程可用,而本文件会被单测 import ——
 * 故用 require 懒取并兜底:拿不到就退回临时目录,**不让测试因为没有 Electron 而挂**。
 * ⚠️ 兜底只在「没有 app」时发生,不是掩盖错误(fail-loud 适用于业务失败,
 * 这里是运行环境差异)。
 */
function traceRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const base = app?.getPath?.('userData');
    if (base) return `${base}/krig-data/web-trace`;
  } catch { /* 非 Electron 环境(单测) */ }
  return `${process.env.TMPDIR ?? '/tmp'}/krig-web-trace`;
}

/** ⭐ 落盘出口 —— 没有它,诊断记录进程一关全没了(见 fs-trace-sink.ts 文件头) */
export const traceSink = new FsTraceSink(traceRoot());

export const traceRecorder = new TraceRecorder({ sink: traceSink });
export const healthProbe = new HealthProbe();

/** ⭐ 预注册脚本表 —— 业务方只能按 id 取用,拼不出坏脚本 */
export const scriptRegistry = new ScriptRegistry();
registerAIScripts(scriptRegistry);
// ⭐ 服务无关的定位脚本(三家 AI 提取器共用「按坐标定位第几条」)
registerLocateScripts(scriptRegistry);
// ⭐ renderer 侧注入脚本(双开同步内核等)—— 走 IPC 面由 renderer 触发
registerRendererScripts(scriptRegistry);
export const domRunner = new ElectronDomRunner(scriptRegistry, traceRecorder);

/**
 * per-page 的网络观测器。
 * 一个页面一个 —— 否则「这个页面近 5 分钟零捕获」会被别的页面的流量掩盖掉。
 */
const monitors = new Map<string, NetMonitor>();

export function getNetMonitor(pageId: string): NetMonitor {
  let m = monitors.get(pageId);
  if (!m) {
    m = new NetMonitor({ recorder: traceRecorder });
    monitors.set(pageId, m);
  }
  return m;
}

export function dropNetMonitor(pageId: string): void {
  monitors.delete(pageId);
}

export function listMonitoredPages(): string[] {
  return Array.from(monitors.keys());
}

/**
 * ⭐⭐ 控制 / 输入 两个引擎的运行期实例(`01-contract.md` 的「控制 · 输入 · 输出」)。
 *
 * ── 为什么到今天才有 ──
 *
 * `ControlEngine` / `InputEngine` / `ElectronControlHost` / `ElectronInputHost`
 * 四个类**早就写完并测过**,但全仓 **零处 `new`** —— 两个 Host 都要一个
 * `WebContentsLookup`,而**没有人提供它**(`pageIdByWc` 只有正向)。
 * 于是「控制/输入」整条能力线建好了却调不动,
 * 与 `recordRequestStart` 零调用、`ready`/`scrollUntil` 掉出公开面**是同一种病**。
 *
 * ⚠️ 锚点表暂时只有 X 一家(`XAnchorResolver`)。将来 AI 也要锚点时,
 * 这里要换成**按 owner 分派**的解释器 —— 而不是把 AI 的 selector 混进 X 那张表。
 * 现在只有 X 用,先不做那层间接;真要加时这一行就是唯一的改动点。
 */
/**
 * ⭐ 锚点解释器**注册表** —— 依赖方向:业务 → 底座,**绝不反过来**。
 *
 * ⚠️ 初版我在这里直接 `import { XAnchorResolver } from '../../x/x-anchors'`,
 * 那是**分层倒置**:能力层反过来依赖 X 业务层,底座从此离开 X 就不能构建。
 * `wiring/` 里其它文件全都只 import `electron` / `node:*` / 本层 —— 没有先例,
 * 而且**没有任何守卫会拦它**(守卫盯的是 Electron 与脚本文本,不是依赖方向),
 * 所以它只会悄悄烂掉。改成注册表后,X 在启动时把自己的表**推**进来。
 *
 * 查不到锚点返回 null —— 调用方据此 Failed。**绝不原样回显锚点名**:
 * 那会让「没注册表」表现成「元素不在页面上」,两者排查方向完全相反。
 */
const anchorTables = new Map<string, AnchorResolver>();

/** 业务侧注册自己的锚点表(如 X 在启动时调一次)。同名覆盖 */
export function registerAnchorTable(owner: string, resolver: AnchorResolver): void {
  anchorTables.set(owner, resolver);
}

/** 已注册的 owner —— 验收台列给人看 */
export function listAnchorOwners(): string[] {
  return Array.from(anchorTables.keys());
}

/**
 * ⭐ 已注册的**锚点名**(按 owner 分组)。
 *
 * 给控制台的下拉用 —— ⚠️ 必须从**真表**读,不许面板自己抄一份:
 * 抄一份就会漂,而漂的表现是「面板上有这个名字、点下去说没登记」。
 * ⚠️ 解释器不一定实现 `names()`(接口只要求 `resolve`),没有就跳过。
 */
export function listAnchorNames(): Array<{ owner: string; names: string[] }> {
  const out: Array<{ owner: string; names: string[] }> = [];
  for (const [owner, table] of anchorTables.entries()) {
    const withNames = table as { names?: () => string[] };
    out.push({ owner, names: typeof withNames.names === 'function' ? withNames.names() : [] });
  }
  return out;
}

/**
 * 合并解释器:按注册顺序问每一张表,第一个命中即返回。
 *
 * ⚠️ 目前只有 X 一家,所以「谁的表」不会撞。真出现两家都认同一个锚点名时,
 * 这里要改成**按页面 owner 分派**(pageFacts.owner),而不是让顺序决定 ——
 * 那是「悄悄替你挑」,与 `find` 的铁律同源。到那天再改,不预先造间接层。
 */
const mergedAnchors: AnchorResolver = {
  resolve(anchor: string): string | null {
    for (const table of anchorTables.values()) {
      const hit = table.resolve(anchor);
      if (hit) return hit;
    }
    return null;
  },
};

/**
 * ⭐⭐ 控制 / 输入 两个引擎的运行期实例(契约的「控制 · 输入 · 输出」)。
 *
 * ── 为什么到今天才有 ──
 *
 * `ControlEngine` / `InputEngine` / `ElectronControlHost` / `ElectronInputHost`
 * 四个类**早就写完并测过**,但全仓 **零处 `new`** —— 两个 Host 都要一个
 * `WebContentsLookup`,而**没有人提供它**(`pageIdByWc` 只有正向)。
 * 于是「控制/输入」整条能力线建好了却调不动,
 * 与 `recordRequestStart` 零调用、`ready`/`scrollUntil` 掉出公开面**是同一种病**。
 */
/**
 * ⭐ 语义页面表注册表 —— 与锚点表同款依赖倒置:业务推进来,底座**不 import 业务**。
 *
 * ⚠️ 合并解释器按注册顺序问,第一个命中即返回。目前只有 X 一家不会撞;
 * 真出现两家都认同一个页面名时,要改成按页面 owner 分派,
 * 而不是让顺序决定 —— 那是「悄悄替你挑」,与 `find` 的铁律同源。
 */
const pageTables = new Map<string, PageResolver>();

/** 业务侧注册自己的语义页面表(如 X 在启动时调一次)。同名覆盖 */
export function registerPageTable(owner: string, resolver: PageResolver): void {
  pageTables.set(owner, resolver);
}

/** 已注册的语义页面名(按 owner 分组)—— 验收台列给人看,免得靠记忆猜 */
export function listPageNames(): Array<{
  owner: string;
  names: string[];
  /**
   * ⭐ 每个页面要哪些参数 —— **面板据此渲染输入框**,不许自己抄一份。
   *
   * ⚠️ 旧实现栽过(原文):面板有**四处写死的正则**决定「要不要显示 handle
   * 输入框」,新页面不在里面 → 框不显示 → 参数不传 → resolve 返 null。
   * 「写死清单不会自己长」同族第五刀。
   *
   * ⚠️ 解释器**不一定**实现 `paramsOf`(接口只要求 `resolve`)——
   * 没有就给空表,而不是假装每个页面都零参数。
   */
  params: Record<string, string[]>;
  /**
   * ⭐ 每个参数该填什么样的值 —— 面板当 placeholder 用。
   * ⚠️ 提示放在**业务的表**里,不放面板:面板里写
   * `k === 'handle' ? … : …` 就是「写死清单」的开端。
   */
  hints: Record<string, string>;
  /**
   * ⭐⭐ **哪些参数不填也能跑** —— 面板据此决定「缺不缺参数」。
   *
   * ⚠️ 2026-10-02 补。起因:`x.search` 的 `f`(live/top)与 `days`(时间窗)
   * 都有默认值,但面板的判据是「`params` 里的全填满才让点」——
   * 于是这两个成了事实上的必填,人不填就点不了,**而面板不说为什么**。
   *
   * ⚠️ 旧实现栽过同一刀(原文):
   * > 面板原来把这个清单**写死成只有 `'f'`**,于是新增可选参数(如 `days`)
   * > 会被当成必填 → 不填就禁用按钮,而人根本不知道该填什么。
   *
   * ⭐ 所以真源在**业务的页面表**里,面板问它要。
   * ⚠️ 解释器不一定实现 `optionalOf` —— 没有就给空数组
   * (= 全部必填,与改这版之前的行为一致,不会突然放宽)。
   */
  optional: Record<string, string[]>;
}> {
  return Array.from(pageTables.entries()).map(([owner, t]) => {
    const names = typeof t.names === 'function' ? t.names() : [];
    const withParams = t as {
      paramsOf?: (n: string) => readonly string[];
      hintOf?: (p: string) => string;
      /** ⭐ 可选参数 —— 与 `paramsOf` 同款鸭子类型,底座不认识任何业务 */
      optionalOf?: (n: string) => readonly string[];
    };
    const params: Record<string, string[]> = {};
    const hints: Record<string, string> = {};
    const optional: Record<string, string[]> = {};
    if (typeof withParams.paramsOf === 'function') {
      for (const n of names) {
        const ps = [...withParams.paramsOf(n)];
        params[n] = ps;
        if (typeof withParams.hintOf === 'function') {
          for (const k of ps) hints[k] = withParams.hintOf(k);
        }
        /**
         * ⚠️ 只收**本页真有的**可选参数 —— 业务方可能回一张全局表
         * (如 `['f','days','since']`),直接透传会让面板以为
         * `x.profile` 的 handle 也有个叫 `days` 的可选参数。
         * ⭐ 与 `params[n]` 取交集,面板拿到的就一定是这一页的事。
         */
        if (typeof withParams.optionalOf === 'function') {
          const opt = new Set(withParams.optionalOf(n));
          optional[n] = ps.filter((k) => opt.has(k));
        } else {
          optional[n] = [];
        }
      }
    }
    return { owner, names, params, hints, optional };
  });
}

/**
 * ⭐ 语义页面名 → URL —— 导出给**需要 URL 而不是导航**的消费者。
 *
 * ⚠️ 加这个导出是因为:面板**不许自己拼 x.com URL**(守卫钉着),
 * 而无人工采集要把 URL 交给 `harvestTimeline`(它自己会导航)。
 * 没有这个出口,消费者就只能在自己那边抄一份 URL —— 那正是守卫要防的。
 */
export function resolveSemanticPage(
  name: string, params: Readonly<Record<string, string>> = {},
): { url: string; describe: string } | null {
  const hit = mergedPages.resolve(name, params);
  return hit ? { url: hit.url, describe: hit.describe } : null;
}

/**
 * ⭐ 反向:当前 URL → 语义名 + 参数(问每一张表,第一个认出来的赢)。
 *
 * 用户 2026-09-18:「点击左边时,右边自动填充变量,点击采集,即可采集。」
 */
export function identifySemanticPage(
  url: string,
): { name: string; params: Record<string, string> } | null {
  for (const t of pageTables.values()) {
    const hit = t.identify?.(url);
    if (hit) return hit;
  }
  return null;
}

const mergedPages: PageResolver = {
  resolve(name, params) {
    for (const t of pageTables.values()) {
      const hit = t.resolve(name, params);
      if (hit) return hit;
    }
    return null;
  },
  names() {
    return Array.from(pageTables.values()).flatMap((t) => t.names?.() ?? []);
  },
};

export const controlEngine = new ControlEngine(
  new ElectronControlHost(lookupWebContents),
  mergedAnchors,
  undefined,        // CustomScriptSource —— 暂无 custom 判据的消费者
  mergedPages,      // ⭐ 语义页面表(`goto` 靠它把语义名翻成 URL)
);
export const inputEngine = new InputEngine(
  new ElectronInputHost(lookupWebContents),
  mergedAnchors,
);
