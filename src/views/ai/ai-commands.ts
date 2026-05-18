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
import { getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { AIConversationApi } from '@capabilities/ai-conversation/types';
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
   * 端到端 askAI:给当前 ws 的活跃 AI 服务发 prompt,等回复(broadcast 自动推 onAIResponseReady)。
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
