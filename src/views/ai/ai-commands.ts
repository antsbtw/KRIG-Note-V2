/**
 * AI View 命令注册
 *
 * 命令字符串引用机制(charter § 1.2 注册原则):
 * - 跨 view 调用走 commandRegistry.execute('ai-view.<action>', ...args)
 * - 其他 view (Note / Thought) 走 'ai-view.ask' 把选中文字发给 AI
 *
 * Phase 3:仅注册基础命令(ask / switch-service)。Phase 4 加 Note 集成路径。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getCapabilityApi, requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { AIConversationApi } from '@capabilities/ai-conversation/types';
import type { ThoughtCapabilityApi } from '@capabilities/thought/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { setAIServiceId, getAIWsState } from './data-model';
import type { AIServiceId } from '@shared/types/ai-service-types';

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

export function registerAICommands(): void {
  /**
   * 把当前 ws 的活跃 AI 服务切到 serviceId。
   */
  commandRegistry.register('ai-view.switch-service', (idArg: unknown) => {
    if (!isServiceId(idArg)) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setAIServiceId(wsId, idArg);
  });

  /**
   * SlotToggle dropdown — 在 right slot 打开指定 view(空白,无 payload)。
   * commandArg = 目标 viewId(e.g. 'note-view' / 'thought-view')。
   * 仿 note-view.open-right-slot 模式,本地版本服务 AI View 自身 toolbar SlotToggle。
   */
  commandRegistry.register('ai-view.open-right-slot', (viewId: unknown) => {
    if (typeof viewId !== 'string' || !viewId) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const bus = workspaceManager.getBus(wsId);
    if (!bus) return;
    bus.slot.openRight(viewId);
  });

  /**
   * 关 right slot。SlotToggle 再次点击已激活项时触发。
   */
  commandRegistry.register('ai-view.close-right-slot', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const bus = workspaceManager.getBus(wsId);
    if (!bus) return;
    bus.slot.closeRight();
  });

  /**
   * 提取整页对话 → 创建 type='ai-response' thought atom → 切右槽到 Thought View。
   *
   * 本期简化版:从 SSE 缓存取"最新一次 AI 完整回复"作为 thought 内容。
   * - 优点:零依赖 V1 重型 extractor(~1800 行),立即可用
   * - 限制:只能拿最新一条 AI 回复(SSECaptureManager.getLatestResponse);
   *   多轮对话场景丢历史(仅记最近一次)
   * - 后续 sub-phase 接 V1 chatgpt-content-extractor / claude-api-extractor 等
   *   做完整 conversation 抓取(含所有 turn / artifact)
   */
  commandRegistry.register('ai-view.extract-conversation', async () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
    const serviceId = aiState?.currentServiceId;

    const ai = requireCapabilityApi<AIConversationApi>('ai-conversation');
    const markdown = await ai.getLatestResponse();
    if (!markdown) {
      window.alert(
        '尚未抓到 AI 回复:\n\n' +
        '- 请先在 AI Web 中跟 AI 完成至少一次对话\n' +
        '- 或确认 AI 回复已结束(streaming 完成)',
      );
      return;
    }

    const thought = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    const doc = markdownToDoc(markdown);

    // 路径分支:有 pending(场景 A:Note Ask AI)→ update 已 preCreate 的 atom
    //         无 pending(场景 B:独立 AI 聊天)→ createNew 独立 atom
    const pendingThoughtId = serviceId ? ai.consumePendingAIThought(serviceId) : null;
    let thoughtIdToActivate: string;
    if (pendingThoughtId) {
      const updated = await thought.updateThought(pendingThoughtId, { doc });
      if (!updated) {
        // pending atom 已被外部删了(罕见):回退创新
        console.warn('[ai-view.extract] pending thought gone, fallback createNew');
        const created = await thought.createThought({
          type: 'ai-response',
          resolved: false,
          pinned: false,
          serviceId,
          doc,
          folderId: null,
          anchor: null,
        });
        thoughtIdToActivate = created.id;
      } else {
        thoughtIdToActivate = pendingThoughtId;
      }
    } else {
      const created = await thought.createThought({
        type: 'ai-response',
        resolved: false,
        pinned: false,
        serviceId,
        doc,
        folderId: null,
        anchor: null,
      });
      thoughtIdToActivate = created.id;
    }

    const bus = workspaceManager.getBus(wsId);
    if (bus) {
      bus.slot.openRight('thought-view');
      bus.channels.emit('thought.activate', { thoughtId: thoughtIdToActivate });
    }
  });

  /**
   * 端到端 askAI:给当前 ws 的活跃 AI 服务发 prompt,等回复(broadcast 自动推 onAIResponseReady)。
   *
   * Phase 6 改"问 AI"为对话式(开 AI Web + paste + 用户主导)后,本命令保留作为
   * "静默 askAI"路径(供测试 / 程序化调用),不被 UI 直接触发。
   *
   * 调用方式:
   *   commandRegistry.execute('ai-view.ask', '请总结这段话')
   *   commandRegistry.execute('ai-view.ask', { prompt: '...', serviceId: 'chatgpt' })
   */
  commandRegistry.register('ai-view.ask', async (arg: unknown) => {
    const ai = getCapabilityApi<AIConversationApi>('ai-conversation');
    if (!ai) {
      console.warn('[ai-view.ask] ai-conversation capability not registered');
      return;
    }
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const wsState = getAIWsState(ws);

    let prompt: string;
    let serviceId: AIServiceId = wsState.currentServiceId;
    if (typeof arg === 'string') {
      prompt = arg;
    } else if (arg && typeof arg === 'object') {
      const a = arg as { prompt?: unknown; serviceId?: unknown };
      if (typeof a.prompt !== 'string' || !a.prompt) return;
      prompt = a.prompt;
      if (isServiceId(a.serviceId)) serviceId = a.serviceId;
    } else {
      return;
    }
    // fire-and-forget — 结果通过 onAIResponseReady / onAIError 广播
    void ai.askAI(serviceId, prompt);
  });
}

/**
 * Markdown → NoteDocEnvelope(本期最小集:按段落拆分,不解析 markdown 语法)
 *
 * 与 thought/command-impl/ask-ai.ts 旧版 markdownToDoc 同模式。
 * 后续 sub-phase 接 V1 blocks-to-pm-nodes 做真 md → PM 还原。
 */
function markdownToDoc(markdown: string): NoteDocEnvelope {
  const paragraphs = markdown.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  if (paragraphs.length === 0) paragraphs.push('(空回复)');
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: paragraphs.map((p) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: p }],
      })),
    },
  };
}
