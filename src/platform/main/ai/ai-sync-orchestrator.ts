/**
 * ai-sync orchestrator —— "AI 对话自动同步到右槽 Note" 主进程编排
 *
 * 工作模式:用户在 NavSide 点 🤖 AI(左槽)+ 任意 Note(右槽),然后跟 AI 聊天 —
 * 每次 AI 回复完成时,主进程拉取这一 turn 的 user / assistant 文本,broadcast 给
 * 所有 renderer;renderer 端 ai-sync-integration 收到后把 ❓ Callout + 🔀 Toggle
 * 块追加到当前右槽 Note 末尾。
 *
 * 触发模式:renderer 端 ai-sync-integration 检测到"左 ai-view + 右 note-view"
 * 槽位组合时 startAISync(serviceId);组合一变就 stopAISync(serviceId)。orchestrator
 * 内部用 1.5s 轮询 SSECaptureManager 的 page-cache(Claude/ChatGPT)/ main 端
 * geminiResponses(Gemini),检测 streaming→complete 跃迁;以记录 id 为锚去重。
 *
 * 不重复造轮:userMessage / assistantMessage 抽取走 extractors/claude-api-extractor.ts
 * 的 extractLatestClaudeResponse(走 Claude 内部 chat_conversations API,有完整 turn 顺序)。
 * ChatGPT / Gemini 暂不抽取 userMessage(SSE record 拿不到),userMessage=''。
 *
 * 注:本期 ai-sync 走"polling getStatus()" 是因为 inject script 没有 push-back 机制;
 * Phase X 可选优化 — 给 SSECaptureManager 加 onResponseComplete 主动推送,本期先打通。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { AIServiceId } from '@shared/types/ai-service-types';
import {
  resolveAIWebContents,
  subscribeAttachAIWebContents,
} from './webview-registry';
import { getSSECaptureManager } from './ask-orchestrator';
import { extractLatestClaudeResponse } from './extractors/claude-api-extractor';
import { broadcastAISyncAppendTurn } from './broadcast';
import type { AISyncAppendTurnPayload, AISyncTurn } from '@shared/ipc/ai-types';

/** 轮询周期(ms) — AI 回复完成检测延迟上限 */
const POLL_INTERVAL_MS = 1_500;

interface RunningState {
  serviceId: AIServiceId;
  /** 本 ws 的 AI Host guest wc id(按 ws 定向轮询/抓取,治多实例串扰)*/
  targetWcId: number | undefined;
  timer: NodeJS.Timeout;
  /** 已 emit 过的 SSE record id 集合(去重,跟 page-cache MAX_RESPONSES=20 同量级,无需淘汰)*/
  syncedRecordIds: Set<string>;
  /** 已 emit 过的 Claude assistant message uuid(走 chat_conversations API 时的另一种去重锚)*/
  syncedAssistantUuids: Set<string>;
  /** 最后一次轮询时记录的 latest streaming 状态(检测 true→false 跃迁)*/
  lastStreaming: boolean;
  /** 最后一次轮询时 SSE record count(检测新增)*/
  lastCount: number;
}

/** 当前运行中的 ai-sync 实例(同一 serviceId 同一时刻最多一个)*/
const running = new Map<AIServiceId, RunningState>();

/**
 * 启动 ai-sync for 某个服务。
 *
 * 多次调用同 serviceId 幂等;调用后 1.5s 内开始检测 SSE 完成跃迁。
 */
export function startAISync(serviceId: AIServiceId, targetWcId?: number): void {
  if (running.has(serviceId)) return;

  console.log(`[ai-sync] start serviceId=${serviceId} targetWcId=${targetWcId ?? 'none'}`);

  // 初次 poll 前先记下当前 baseline,避免把"启动前已存在的旧回复"误当新 turn emit
  const state: RunningState = {
    serviceId,
    targetWcId,
    timer: setInterval(() => void pollOnce(serviceId), POLL_INTERVAL_MS),
    syncedRecordIds: new Set(),
    syncedAssistantUuids: new Set(),
    lastStreaming: false,
    lastCount: 0,
  };
  running.set(serviceId, state);
  // 立即跑一次 baseline,把已有 record 加进 syncedRecordIds(不 emit)
  void seedBaseline(serviceId);
}

/**
 * 停止 ai-sync。多次调用同 serviceId 幂等。
 */
export function stopAISync(serviceId: AIServiceId): void {
  const state = running.get(serviceId);
  if (!state) return;
  console.log(`[ai-sync] stop serviceId=${serviceId}`);
  clearInterval(state.timer);
  running.delete(serviceId);
}

/** 启动时把当前 SSE 缓存里已有的 record id 加进 syncedRecordIds — 这些是"启动前"的对话,不补 emit。*/
async function seedBaseline(serviceId: AIServiceId): Promise<void> {
  const state = running.get(serviceId);
  if (!state) return;

  const manager = getSSECaptureManager();
  // 按 ws 定向取本 ws 的 AI Host wc(治多实例串扰);未就绪 → baseline 留空,
  // 后续 pollOnce 自然会把 first record 当 baseline(非错误,故此处不 fail loud broadcast)。
  const got = resolveAIWebContents(serviceId, state.targetWcId);
  if (!manager || 'error' in got) {
    return;
  }
  const wc = got.wc;

  if (serviceId === 'gemini') {
    for (const rec of manager.getAllGeminiResponses()) {
      state.syncedRecordIds.add(rec.id);
    }
  } else {
    const records = await readPageRecords(wc);
    for (const rec of records) {
      state.syncedRecordIds.add(rec.id);
    }
  }
  state.lastCount = state.syncedRecordIds.size;
}

/**
 * 读 page-level cache(window.__krig_sse_responses)— Claude / ChatGPT。
 */
async function readPageRecords(
  wc: Electron.WebContents,
): Promise<Array<{ id: string; streaming: boolean; markdown: string; service: string }>> {
  try {
    const result = (await wc.executeJavaScript(`
      (function() {
        var arr = window.__krig_sse_responses || [];
        return arr.map(function(r) {
          return { id: r.id, streaming: r.streaming, markdown: r.markdown, service: r.service };
        });
      })()
    `)) as Array<{ id: string; streaming: boolean; markdown: string; service: string }> | null;
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * 单次轮询:检测有没有新的 streaming=false 完成 record,有则 emit。
 */
async function pollOnce(serviceId: AIServiceId): Promise<void> {
  const state = running.get(serviceId);
  if (!state) return;

  // 按 ws 定向取本 ws 的 AI Host wc;未就绪/未命中 → 等下次轮询(本 ws 实例尚未 ready,
  // 非用户可见错误,轮询型路径静默等待而非 broadcast error)。
  const got = resolveAIWebContents(serviceId, state.targetWcId);
  if ('error' in got) return;
  const wc = got.wc;

  const manager = getSSECaptureManager();
  if (!manager) return;

  // 取 records — gemini 走 main 端缓存,claude/chatgpt 走 page-cache
  const records: Array<{ id: string; streaming: boolean; markdown: string }> =
    serviceId === 'gemini'
      ? manager.getAllGeminiResponses().map((r) => ({
          id: r.id,
          streaming: r.streaming,
          markdown: r.markdown,
        }))
      : await readPageRecords(wc);

  if (records.length === 0) return;

  // 找已完成 + 未 emit 过的 record(streaming=false + id 不在 syncedRecordIds)
  for (const rec of records) {
    if (rec.streaming) continue;
    if (state.syncedRecordIds.has(rec.id)) continue;
    state.syncedRecordIds.add(rec.id);

    try {
      await emitTurn(serviceId, rec.markdown, wc);
    } catch (err) {
      console.error('[ai-sync] emit failed:', err);
    }
  }

  state.lastCount = records.length;
}

/**
 * 构造 turn payload 并 broadcast。
 *
 * Claude:走 chat_conversations API 拿最新 (user, assistant) 一对(走完整对话保证不脱
 * 序);用 assistantMessage uuid 作辅助去重锚(SSE record id 可能 reset 但 message uuid
 * 不会重复)。
 *
 * ChatGPT/Gemini:暂只用 SSE record markdown 当 assistantMessage,userMessage=''。
 * 后续若用户验证需要 user 文本,可接入 chatgpt-full-extraction / gemini-full-extraction
 * 的轻量版抽取(代价:每 turn 一次 IPC + 全对话拉取)。
 */
async function emitTurn(
  serviceId: AIServiceId,
  sseMarkdown: string,
  wc: Electron.WebContents,
): Promise<void> {
  const state = running.get(serviceId);
  if (!state) return;

  let userMessage = '';
  let assistantMessage = sseMarkdown;

  if (serviceId === 'claude') {
    const latest = await extractLatestClaudeResponse(wc);
    if (latest) {
      // 用 raw conversation 里 last assistant message 的 uuid 二次去重(防 SSE record
      // id reset 后误 emit;chat_conversations API 多次拉取同一 turn 的 uuid 稳定)
      const lastUuid =
        latest.raw?.messages?.length
          ? latest.raw.messages[latest.raw.messages.length - 1].uuid
          : null;
      if (lastUuid && state.syncedAssistantUuids.has(lastUuid)) {
        return; // 已 emit 过(SSE record id 变了但内容没变,跳过)
      }
      if (lastUuid) state.syncedAssistantUuids.add(lastUuid);
      userMessage = latest.userMessage;
      assistantMessage = latest.assistantMessage || sseMarkdown;
    }
  }

  const turn: AISyncTurn = {
    userMessage,
    markdown: assistantMessage,
    timestamp: Date.now(),
  };
  const payload: AISyncAppendTurnPayload = {
    serviceId,
    turn,
  };
  console.log(
    `[ai-sync] emit serviceId=${serviceId} userLen=${userMessage.length} mdLen=${assistantMessage.length}`,
  );
  broadcastAISyncAppendTurn(payload);
}

/**
 * 注册 ai-sync 的 IPC handlers(start / stop)。
 *
 * 调用入口:src/platform/main/ai/handlers.ts registerAIHandlers() 内挂接。
 */
export function registerAISyncHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AI_SYNC_START, (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; targetWcId?: unknown } | null;
    if (!p || !isServiceId(p.serviceId)) return { success: false, error: 'invalid serviceId' };
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    startAISync(p.serviceId, targetWcId);
    return { success: true };
  });
  ipcMain.handle(IPC_CHANNELS.AI_SYNC_STOP, (_e, serviceId: unknown) => {
    if (!isServiceId(serviceId)) return { success: false, error: 'invalid serviceId' };
    stopAISync(serviceId);
    return { success: true };
  });
}

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

/**
 * 注册"webContents 切换时重置 baseline"。模块加载即生效。
 *
 * 当用户点 NavSide 切换 AI 服务,webview-registry 把活跃 wc 换掉时,要把对应
 * serviceId 的 syncedRecordIds / lastCount 清掉,新 wc 上的 record id 会进新一轮
 * baseline。
 */
subscribeAttachAIWebContents((serviceId) => {
  const state = running.get(serviceId);
  if (!state) return;
  state.syncedRecordIds.clear();
  // 重新 seed baseline 让"切 webview 时已有的对话"不重 emit
  void seedBaseline(serviceId);
});
