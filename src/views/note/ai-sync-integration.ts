/**
 * ai-sync 集成 — NoteView 端"AI 对话自动同步到右槽 Note"接收侧
 *
 * 工作模式:用户 NavSide 点 🤖 AI(左槽)+ 任意 Note(右槽),Note 端订阅 main 端
 * broadcast 的 AI_SYNC_APPEND_TURN,拿到 turn payload 后用 buildAITurnPmNodes 拼装
 * ❓ Callout + 🔀 Toggle + ─ 块,driver insertNodesAtEnd 落到当前右槽 Note 末尾。
 *
 * 触发逻辑:
 *   订阅 workspaceManager → 检查 active workspace 的 slotBinding
 *   - left='ai-view' + right='note-view'   → 启动 ai-sync(serviceId=该 ws AI 服务)
 *   - 任何其他组合 / 切 ws / 关 left=ai-view → 停止 ai-sync
 *
 * 多 ws:本期只跟踪 active workspace(假设用户同时只跟一个 ws 对话)。
 * 切换 active ws 时,自动 stop 上一个 + 重判新 active ws 是否符合 ai-sync 组合。
 *
 * 安装入口:src/views/note/index.ts import 'ai-sync-integration' 副作用(参考
 * link-click-integration 同模式)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  AIConversationApi,
  AISyncAppendTurnPayload,
} from '@capabilities/ai-conversation/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { buildAITurnPmNodes } from './ai-sync-blocks';
import { DEFAULT_AI_SERVICE, type AIServiceId } from '@shared/types/ai-service-types';

/**
 * 读 ws.pluginStates['ai'].currentServiceId — 不跨 view import @views/ai 的 data-model
 * (V2 view 间 import 屏障)。fallback DEFAULT_AI_SERVICE 等价 AIView 自己的兜底。
 */
function readWorkspaceAIService(ws: WorkspaceState): AIServiceId {
  const persisted = (ws.pluginStates?.['ai'] as { currentServiceId?: unknown } | undefined) ?? {};
  const v = persisted.currentServiceId;
  if (v === 'chatgpt' || v === 'claude' || v === 'gemini') return v;
  return DEFAULT_AI_SERVICE;
}

const AI_VIEW_ID = 'ai-view';
const NOTE_VIEW_ID = 'note-view';

/** 当前 ai-sync 锁定的 (workspaceId, serviceId);null = 未启动 */
let active: { workspaceId: string; serviceId: AIServiceId } | null = null;

/** main 端 AI_SYNC_APPEND_TURN 全局订阅 unsubscriber;null = 未挂 */
let appendTurnUnsub: (() => void) | null = null;

/** workspaceManager 订阅 unsubscriber;模块级单例,只挂一次 */
let workspaceUnsub: (() => void) | null = null;

/**
 * 判断 ws 是否满足 ai-sync 触发条件:
 *   - left = 'ai-view'
 *   - right = 'note-view'
 *
 * 反向(left=note + right=ai)不触发 — 那是 V1 "問 AI" 路径,用户不期望 ai-sync。
 */
function matchesAISyncCombo(ws: WorkspaceState): boolean {
  return ws.slotBinding.left === AI_VIEW_ID && ws.slotBinding.right === NOTE_VIEW_ID;
}

/**
 * 处理一次 active workspace 状态变更 — 决定 start / stop / 切 service。
 */
function reconcileForActive(): void {
  const aiCap = requireCapabilityApi<AIConversationApi>('ai-conversation');
  const activeId = workspaceManager.getActiveId();
  if (!activeId) {
    void stopActive(aiCap);
    return;
  }
  const ws = workspaceManager.get(activeId);
  if (!ws) {
    void stopActive(aiCap);
    return;
  }
  if (!matchesAISyncCombo(ws)) {
    void stopActive(aiCap);
    return;
  }

  const serviceId = readWorkspaceAIService(ws);

  // 已经在跑同样的 (ws, service) — 无操作
  if (active && active.workspaceId === activeId && active.serviceId === serviceId) {
    return;
  }

  // 跑的是其他 (ws, service) — 先 stop 再 start
  if (active) {
    const prev = active.serviceId;
    void aiCap.stopAISync(prev);
  }

  active = { workspaceId: activeId, serviceId };
  console.log(
    `[ai-sync-integration] start ai-sync ws=${activeId} service=${serviceId}`,
  );
  void aiCap.startAISync(serviceId);
}

async function stopActive(aiCap: AIConversationApi): Promise<void> {
  if (!active) return;
  const { serviceId, workspaceId } = active;
  active = null;
  console.log(`[ai-sync-integration] stop ai-sync ws=${workspaceId} service=${serviceId}`);
  await aiCap.stopAISync(serviceId);
}

/**
 * 处理 main 端推送的 turn:落到 active workspace 的 right slot Note PM 实例。
 */
function handleAppendTurn(payload: AISyncAppendTurnPayload): void {
  if (!active) return; // 已停止,跳过
  if (payload.serviceId !== active.serviceId) return; // 别的 service 的回复(并发场景)
  const activeId = workspaceManager.getActiveId();
  if (!activeId || activeId !== active.workspaceId) return; // active ws 已切

  const ws = workspaceManager.get(activeId);
  if (!ws || !matchesAISyncCombo(ws)) return; // slot 组合已变(reconcile 之前抢跑一帧)

  // NoteView 用 instanceId = workspaceId(NoteView.tsx Host config);右槽 note-view
  // 与左槽共享 workspaceId,driver instance registry 里只有一个 entry.
  const instanceId = activeId;
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const nodes = buildAITurnPmNodes(payload.serviceId, payload.turn);
  if (nodes.length === 0) return;

  const ok = textEditing.api.insertNodesAtEnd(instanceId, nodes);
  if (!ok) {
    console.warn(
      `[ai-sync-integration] insertNodesAtEnd failed instance=${instanceId} (PM 实例未注册?Note 未打开?)`,
    );
  }
}

/**
 * 副作用入口 — note view index.ts 起 import 触发模块级 subscribe。
 *
 * 幂等:多次调用安全(workspaceUnsub 防重)。
 */
export function registerAISyncIntegration(): void {
  if (workspaceUnsub) return; // 已注册

  // 订阅 main 端推送(全局只挂一次)
  if (!appendTurnUnsub) {
    const aiCap = requireCapabilityApi<AIConversationApi>('ai-conversation');
    appendTurnUnsub = aiCap.onAppendTurn(handleAppendTurn);
  }

  // 订阅 workspace 状态(active 切换 / slotBinding 变 / pluginStates ai.currentServiceId 变)
  workspaceUnsub = workspaceManager.subscribe(() => reconcileForActive());

  // 首次同步一次(import 时 workspace 可能已经在 ai-sync 组合)
  reconcileForActive();
}
