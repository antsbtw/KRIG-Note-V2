/**
 * X View 命令注册(阶段 1)
 *
 * 命令字符串引用机制(charter § 1.2):跨 view 调用走 commandRegistry.execute。
 *
 * 核心命令 x-view.extract-tweet:右键 X webview → 主进程抓推文字段 → 构造 tweetBlock
 * PM 节点(铁律 2:产物是 tweet block 不是 toggle)→ 写回 Note。
 *
 * 铁律 5(多 ws 扇出守卫):X_EXTRACT_TWEET_REQUEST 是宿主 webContents 广播,若在
 * 每个并存 XView 实例的 useEffect 里订阅 → 一次右键 N 次 execute。故订阅提升到模块级
 * 单订阅入口(registerXCommands 由 views/x/index.ts import 时只调一次),命令体内用
 * getActiveId 定向到活跃 ws。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getCapabilityApi, requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi, XTweetData } from '@capabilities/x-extraction';
import { sendToX, sendToXAtDropTarget, stashDraggedBlockText } from './send-to-x';

/** dnd capability 的最小接口(subscribe)— 走 requireCapabilityApi 间接路由,不直接 import 运行时值 */
interface DndApiLite {
  subscribe(
    channel: 'dnd.started' | 'dnd.over' | 'dnd.completed',
    listener: (payload: unknown) => void,
  ): () => void;
}

/**
 * 把抓到的推文字段构造成 tweetBlock 的 PM 节点 JSON。
 *
 * activeTab 默认 'data'(离线卡片,所见即所得 — 阶段 1 用户要的是结构化字段,而非实时
 * iframe)。caption 给一个空 paragraph 占位(tweetBlock content:'block' 需一个 block 子节点;
 * block id 由 insertNodesAtCursorOrEnd 的 injectBlockIdsIntoJson 自动补 ULID,本处不填)。
 */
function buildTweetBlockNode(data: XTweetData): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    tweetUrl: data.tweetUrl ?? null,
    tweetId: data.tweetId ?? null,
    authorName: data.authorName ?? '',
    authorHandle: data.authorHandle ?? '',
    authorAvatar: data.authorAvatar ?? '',
    text: data.text ?? '',
    createdAt: data.createdAt ?? '',
    lang: data.lang ?? '',
    media: data.media ?? null,
    metrics: data.metrics ?? null,
    quotedTweet: data.quotedTweet ?? null,
    inReplyTo: data.inReplyTo ?? null,
    activeTab: 'data',
  };
  return {
    type: 'tweetBlock',
    attrs,
    content: [{ type: 'paragraph', content: [] }],
  };
}

/** 当前 ws 是否有 Note 在场(左或右槽)— 单条提取需要落点 Note */
function noteIsOpen(slotBinding: { left: string | null; right: string | null }): boolean {
  return slotBinding.left === 'note-view' || slotBinding.right === 'note-view';
}

export function registerXCommands(): void {
  /**
   * 在 X webview 里打开某条推文(tweet block「Open original」用,替代弹外部/系统浏览器)。
   *
   * 参数:tweetUrl 字符串。流程:
   * 1. 确保 AI view 在台上(若主舞台/右槽都不是 ai-view → 切上主舞台);
   * 2. 经 bus 'x.open-tweet' 通知 AIView → AIView 切到 X 入口 + 把 X webview 导航到该推文。
   *
   * 走 bus 而非直接拿 X Host ref:tweet block 在 Note 里,跨 view 不直接持有 X Host。
   */
  commandRegistry.register('x-view.open-tweet', (arg: unknown): boolean => {
    const url = typeof arg === 'string' ? arg : '';
    if (!url) return false;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return false;
    const ws = workspaceManager.get(wsId);
    if (!ws) return false;
    // 确保 AI view 在台上(它承载 X webview)
    if (ws.slotBinding.left !== 'ai-view' && ws.slotBinding.right !== 'ai-view') {
      workspaceManager.update(
        wsId,
        {
          slotBinding: { left: 'ai-view', leftPayload: undefined, right: null, rightPayload: undefined },
        },
        { source: 'bus' },
      );
    }
    const bus = workspaceManager.getBus(wsId);
    bus?.channels.emit('x.open-tweet', { url, emittedAt: Date.now() });
    return true;
  });

  /**
   * 右键「提取此推文到笔记」:按坐标抓推文 → tweetBlock → 写回 Note。
   *
   * 参数:{ x, y } guest viewport 坐标(由 X webview-hook 经 X_EXTRACT_TWEET_REQUEST 透传)。
   *
   * fail loud(铁律 4):非推文 / 抓空 / 没开 Note / PM 未挂 → alert 明确报错,不插空 block。
   */
  commandRegistry.register('x-view.extract-tweet', async (arg: unknown) => {
    const p = (arg ?? {}) as { x?: unknown; y?: unknown };
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;

    // 落点前置:必须有 Note 在场(单条提取语义 = 把这条推接到我正在写的 Note)
    if (!noteIsOpen(ws.slotBinding)) {
      window.alert('请先打开 Note(左栏或右栏),再提取此推文');
      return;
    }

    const x = requireCapabilityApi<XExtractionApi>('x-extraction');
    // 按活跃 ws 定向取本 ws 的 X Host wcId(收口 ②:治多 X 实例串扰,提取打到正确实例)
    const result = await x.extractTweet('x', p.x, p.y, x.getXHostWcId(wsId));
    if (!result.success || !result.data) {
      window.alert(`提取失败:${result.error || '未知错误'}`);
      return;
    }

    const node = buildTweetBlockNode(result.data);
    const ok = commandRegistry.execute('note-view.append-pm-nodes', {
      nodes: [node],
      mode: 'cursor-or-end',
    });
    if (!ok) {
      // PM 实例没挂(罕见,Note 还没加载完?)— 不静默丢,提示用户
      window.alert('插入失败:Note 尚未就绪,请稍候再试');
    }
  });

  /**
   * 「𝕏 发到 X」(写方向,阶段 2):note 选区/整篇 → 降级纯文本 → 注入 X compose 框
   * (或有 pending 回复目标时注入该推 reply 框)。全程「填充内容,用户点发布」。
   *
   * 实现见 send-to-x.ts(选区/整篇取 markdown + 降级 + 超长 fail loud + 剪贴板降级)。
   */
  commandRegistry.register('x-view.send-to-x', () => {
    void sendToX();
  });

  // ── 右键「提取此推文到笔记」(X_EXTRACT_TWEET_REQUEST 广播)模块级单订阅 ──
  // (铁律 5:命令型广播一律在模块级 registerXxx 订阅一次,不进 view 组件 useEffect;
  //  命令体内用 getActiveId 定向到活跃 ws。)
  if (!extractTweetUnsub) {
    const x = getCapabilityApi<XExtractionApi>('x-extraction');
    if (x) {
      extractTweetUnsub = x.onExtractTweetRequest((payload) => {
        void commandRegistry.execute('x-view.extract-tweet', {
          x: payload.x,
          y: payload.y,
        });
      });
    }
  }

  // ── 拖 note block 到 X view:订阅 dnd.started / dnd.completed(模块级单订阅) ──
  // started:若当前活跃 ws 的 X Host 在台上,往其 guest 装 mousemove 监听(记录拖拽期最后坐标)。
  // completed:读回最后坐标解析落点 → compose=发推 / tweet=回复(走 sendToXAtDropTarget)。
  // (X guest 收不到原生 drag 事件,故靠 guest 自报 mousemove —— 见落点定位 spike 结论。)
  const dndApi = getCapabilityApi<DndApiLite>('drag-and-drop');
  if (dndApi && !dndStartUnsub) {
    dndStartUnsub = dndApi.subscribe('dnd.started', (payload: unknown) => {
      const x = getCapabilityApi<XExtractionApi>('x-extraction');
      const wsId = workspaceManager.getActiveId();
      if (!x || !wsId) return;
      // 抓「被拖起的 block」内容(总指挥:发的是拖的那些 block,不是选区/整篇)→ 暂存,
      // 松手时用。payload.source.data = { fromPos, instanceId }(handle 插件 emit)。
      const src = (payload as { source?: { type?: string; data?: unknown } } | null)?.source;
      if (src?.type === 'block') {
        const d = src.data as { fromPos?: unknown; instanceId?: unknown } | undefined;
        if (d && typeof d.fromPos === 'number' && typeof d.instanceId === 'string') {
          stashDraggedBlockText(d.instanceId, d.fromPos);
        }
      }
      const wcId = x.getXHostWcId(wsId);
      if (wcId == null) return; // 本 ws X Host 未登记(没切到 X)→ 不 arm
      void x.dragArm(wcId);
    });
  }
  if (dndApi && !dndDoneUnsub) {
    dndDoneUnsub = dndApi.subscribe('dnd.completed', () => {
      void sendToXAtDropTarget();
    });
  }

  // ── 宿主 iframe(tweet block 嵌入卡片)弹 x.com 链接 → 改在 X webview 打开 ──
  // (main 的 win.webContents.setWindowOpenHandler deny 弹窗后经 X_OPEN_TWEET_REQUEST 推来。
  //  模块级单订阅,复用 x-view.open-tweet 命令在 X webview 内导航。)
  if (!openTweetUnsub) {
    openTweetUnsub = window.electronAPI?.onXOpenTweetRequest?.((payload) => {
      if (payload?.url) commandRegistry.execute('x-view.open-tweet', payload.url);
    }) ?? null;
  }
}

/** 模块级单订阅句柄(防 registerXCommands 万一被调多次重复订阅)*/
let extractTweetUnsub: (() => void) | null = null;
let openTweetUnsub: (() => void) | null = null;
let dndStartUnsub: (() => void) | null = null;
let dndDoneUnsub: (() => void) | null = null;
