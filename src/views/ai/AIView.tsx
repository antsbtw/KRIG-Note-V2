/**
 * AIView — AI 主舞台视图(NavSide tab 🤖 AI)
 *
 * 职责(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期 +
 * 服务切换 + URL 同步等编排全部封装在 ai-extraction capability 的 <Host /> 组件内。
 *
 * View 持有:
 * - per-ws state 订阅(currentServiceId)
 * - slotBinding 订阅(activeRightViewId + isInRightSlot 决定 toolbar 行为)
 * - 命令路由(命令式 ref 调 host)
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import type {
  AIConversationApi,
  AIHostHandle,
} from '@capabilities/ai-extraction/types';
import {
  AI_SERVICE_PROFILES,
  type AIServiceId,
} from '@shared/types/ai-service-types';
import { getAIWsState, setAIServiceId } from './data-model';
import './ai.css';

const VIEW_ID = 'ai-view';

interface AIViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function AIView({ workspaceId, payload }: AIViewProps) {
  const aiApi = useMemo(
    () => requireCapabilityApi<AIConversationApi>('ai-extraction'),
    [],
  );
  const Host = aiApi.Host;
  const hostRef = useRef<AIHostHandle | null>(null);

  // AI Host wc 登记由 capability Host 内部在 dom-ready/navigate 时做;
  // AIView 只负责卸载时清掉本 ws 登记,避免 stale wc id 残留。
  useEffect(() => {
    return () => aiApi.clearAIHostWcId(workspaceId);
  }, [aiApi, workspaceId]);

  // payload.subId → 切换到指定 AI 服务（SlotPicker 子项选择时传入）
  useEffect(() => {
    if (!payload || typeof payload !== 'object') return;
    const { subId } = payload as { subId?: string };
    if (subId && (subId === 'claude' || subId === 'chatgpt' || subId === 'gemini')) {
      setAIServiceId(workspaceId, subId);
    }
  }, [payload, workspaceId]);

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getAIWsState(ws) : null;
    },
  );

  /**
   * 订阅 slotBinding.right 拿当前右槽 viewId(给 SlotToggle 高亮 + close 行为用)。
   *
   * 注:useSyncExternalStore 必须返回稳定基本值,不返新对象 — 此处直接返 string|null
   * 字面值,React 默认 Object.is 比较不会死循环。
   */
  const activeRightViewId = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right ?? null,
  );

  const isInRightSlot = activeRightViewId === VIEW_ID;

  const handleSelectService = useCallback(
    (id: AIServiceId) => {
      setAIServiceId(workspaceId, id);
    },
    [workspaceId],
  );

  /**
   * 订阅跨槽消息 'ai.paste-and-send' — Note "🤖 问 AI" 触发 ask-ai.ts 发的:
   * payload: { prompt: string, serviceId?: AIServiceId, emittedAt: number }
   *
   * 收到 → 调 host.pasteAndSend(prompt, serviceId) → 自动 paste + send。
   * Host 内部排队等 webview dom-ready,所以 ai.paste-and-send 早于 dom-ready 也可。
   *
   * mount 时 getLastValue 兜底取一次 last-known(模块级 push 必须配合 receiver init pull,
   * memory feedback_module_push_pull_both):应对"用户首次启动 app 后第一次 ask-ai 时
   * AIView 还没 mount 完 subscribe 错过 emit"边角。
   *
   * emittedAt 去重:lastHandledAtRef 跟踪最后处理的时间戳,避免 mount 时 getLastValue
   * 拿到老消息重放(SlotArea 扁平列表让 AIView 一直在 mount,但 ws 切换 / hot reload
   * 等场景仍可能重入)。
   */
  const lastHandledAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as {
        prompt?: string;
        serviceId?: AIServiceId;
        emittedAt?: number;
      };
      if (typeof p.prompt !== 'string' || !p.prompt) return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastHandledAtRef.current) return; // 已处理过(去重)
      lastHandledAtRef.current = ts;
      void hostRef.current?.pasteAndSend(p.prompt, p.serviceId);
    };
    // 1. last-known pull(若 emit 已在 mount 前发生)
    const last = bus.channels.getLastValue('ai.paste-and-send');
    if (last) handle(last);
    // 2. 后续 emit 走 subscribe
    const unsub = bus.channels.subscribe('ai.paste-and-send', handle);
    return () => unsub();
  }, [workspaceId]);

  // 右键「📥 提取此对话到笔记」(AI_EXTRACT_TURN_REQUEST 广播)的订阅**不在此处**:
  // 它曾在 useEffect 里订阅 → 每个并存 AIView 实例各订阅一次 → 一次右键 N 次 execute、
  // 并发往右槽 Note 塞重复块。已收口为模块级单订阅,见 ai-commands.ts registerAICommands()。
  // (规则:命令型广播一律在模块级 registerXxx 订阅一次,不进 view 组件 useEffect。)

  const handleExtractFull = useCallback(() => {
    void commandRegistry.execute('ai-view.extract-conversation');
  }, []);

  const handleCloseRightSlot = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    bus?.slot.closeRight();
  }, [workspaceId]);

  /**
   * ⊞ 右栏视图切换 —— 复用全局 SlotPicker(与 Note toolbar 同一套机制,铁律:同功能同逻辑)。
   * 点击先把本 view 的 open-right-slot 命令注入 slotPickerContext,再弹 SlotPicker popup;
   * popup 从 viewTypeRegistry 动态列出所有 view(Note/eBook/Web/Graph/Claude/…),
   * 选中项回调该命令 → bus.slot.openRight。不自造 toggle 逻辑。
   */
  const handleOpenSlotPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    slotPickerContext.setCommandId('ai-view.open-right-slot');
    popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
  }, []);

  if (!wsState) {
    return <div className="krig-ai-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-ai-view">
      {/* 服务 tab 行：三家 AI + 右侧操作按钮 */}
      <div className="krig-ai-view__tabbar">
        <div className="krig-ai-view__tabs">
          {AI_SERVICE_PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`krig-ai-view__tab${p.id === wsState.currentServiceId ? ' krig-ai-view__tab--active' : ''}`}
              onClick={() => handleSelectService(p.id)}
              title={p.name}
            >
              <span>{p.icon}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="krig-ai-view__tabbar-actions">
          <button
            type="button"
            className="krig-ai-view__tabbar-btn krig-ai-view__tabbar-btn--primary"
            onClick={handleExtractFull}
            title="提取整页对话到 Note"
          >
            提取整页对话
          </button>
          <button
            type="button"
            className="krig-ai-view__tabbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleOpenSlotPicker}
            title="在右栏打开视图"
          >
            ⊞
          </button>
          {isInRightSlot && (
            <button
              type="button"
              className="krig-ai-view__tabbar-btn krig-ai-view__tabbar-btn--close"
              onClick={handleCloseRightSlot}
              title="关闭此面板"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        serviceId={wsState.currentServiceId}
        className="krig-ai-view__webview"
        onUrlChanged={() => {}}
        onLoadingChanged={() => {}}
      />
    </div>
  );
}
