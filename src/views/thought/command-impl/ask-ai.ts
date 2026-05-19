/**
 * thought-view.ask-ai-from-note 业务实现(Phase 7 重写为"弹 panel 让用户确认")
 *
 * 流程(对齐 V1 AskAIPanel + 你的设计):
 *   1. 抓 Note 选区 → text-editing.api.getSelectionMarkdown + getSelectionDocJSON
 *   2. 执行 commandRegistry.execute('note-view.open-ask-ai-popup', { selectionMarkdown,
 *      selectionDocJSON, defaultServiceId, anchorX, anchorY })
 *      → AskAIPanel popup 弹起
 *   3. 用户在 panel 内编辑 instruction(可空)+ 选服务 + 点发送
 *   4. AskAIPanel 拼 prompt(instruction + 渲染预览 + 完整 JSON)→
 *      bus.slot.openRight('ai-view') + bus.channels.emit('ai.paste-and-send')
 *   5. AIView 订阅收到 → host.pasteAndSend 自动 paste + send
 *   6. 用户在 AI Web 里看 AI 回复、追问 → 满意后点 toolbar "提取整页对话"
 *
 * 跨 view 调用走 commandRegistry.execute('note-view.open-ask-ai-popup', ...) —
 * V2 lint 屏障禁 thought-view 直 import note-view 模块(audit P1-4)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { AIServiceId } from '@capabilities/ai-conversation/types';
import { DEFAULT_AI_SERVICE } from '@shared/types/ai-service-types';

export async function askAiFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  // 优先用 context menu 抓拍(右键场景);否则当前 focused(floating/keymap 场景)
  const cmState = contextMenuController.getState();
  const instanceId =
    cmState.context.pmInstanceId ?? textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) {
    console.warn('[ask-ai] no active PM instance');
    return;
  }

  // 抓选区双格式(无损传递)
  const { markdown } = textEditing.api.getSelectionMarkdown(instanceId);
  const docJSON = textEditing.api.getSelectionDocJSON(instanceId);

  if (!markdown && !docJSON) {
    // 无选区 — 直接开 AI Web 让用户手动跟 AI 对话(不弹 panel,空 prompt 没意义)
    const bus = workspaceManager.getBus(wsId);
    bus?.slot.openRight('ai-view');
    return;
  }

  // 取活跃 AI 服务(AIView per-ws state),无则 default — panel 内可改
  const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
  const defaultServiceId: AIServiceId = aiState?.currentServiceId ?? DEFAULT_AI_SERVICE;

  // 走 commandRegistry 跨 view 调用(避免 thought-view 直 import note-view 模块)
  commandRegistry.execute('note-view.open-ask-ai-popup', {
    selectionMarkdown: markdown,
    selectionDocJSON: docJSON,
    defaultServiceId,
    anchorX: cmState.x,
    anchorY: cmState.y,
  });
}
