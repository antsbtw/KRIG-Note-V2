/**
 * thought-view.ask-ai-from-note 业务实现(Phase 9 加 V1 同款选区 mark + anchor)
 *
 * 流程:
 *   1. 抓 Note 选区 markdown(text-editing.api.getSelectionMarkdown)
 *   2. preCreatePlaceholder type='ai-response' + serviceId → 拿空 thought atom id
 *   3. addThoughtMark(instanceId, thoughtId, 'ai-response') → 选区紫色下划线
 *      ⚠️ 这步必须在 selection 还在的时候调(右键命令触发时选区仍存活,
 *         弹 popup 后 focus 转移 selection 丢)
 *   4. updateThoughtAnchor(thoughtId, {source:'note', resourceId:noteId,
 *      locator:{pmPos, anchorType:'inline', text}})
 *      → atom 与 Note 选区双向关联(Thought tab 卡片点击 → Note 跳转,
 *         Note mark 点击 → Thought tab 滚到卡片)
 *   5. 执行 commandRegistry.execute('note-view.open-ask-ai-popup', {
 *      selectionMarkdown, defaultServiceId, anchorX, anchorY, thoughtId, instanceId
 *      })
 *   6. 用户在 panel 内编辑 instruction → 点发送
 *   7. panel handleSend:emit ai.paste-and-send + setPendingAIThoughtId(serviceId, thoughtId)
 *      → AIView host.pasteAndSend 自动塞 AI
 *   8. 用户在 AI Web 看 AI 回复、追问
 *   9. 用户点 toolbar "提取整页对话" → ai-view.extract-conversation 读 pending thoughtId
 *      → 有 → thoughtUpdate(thoughtId, { doc })(不重复创 atom)
 *      → 无 → createThought 新建独立 (未来场景 B 走这路径)
 *
 * cancel 路径:用户在 panel 点 × / Esc / 点击外部 → onClose 调命令
 *   'note-view.cancel-ask-ai',传 thoughtId + instanceId → 反向清空 atom + mark。
 *   空 atom + 无人引用 mark = 数据垃圾,主动清除。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { ThoughtAnchor, ThoughtCapabilityApi } from '@capabilities/thought/types';
import { DEFAULT_AI_SERVICE, type AIServiceId } from '@shared/types/ai-service-types';

export async function askAiFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  const noteState = ws.pluginStates['note'] as { activeNoteId?: string } | undefined;
  const noteId = noteState?.activeNoteId;
  if (!noteId) {
    console.warn('[ask-ai] no active note');
    return;
  }

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const cmState = contextMenuController.getState();
  const instanceId =
    cmState.context.pmInstanceId ?? textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) {
    console.warn('[ask-ai] no active PM instance');
    return;
  }

  // 入口立即切 right slot 到 AI View(用户契约:🤖 问 AI 一点 right slot 就装 AI View,
  // 不管原来是空 / Thought / 别的 Note / eBook / 画板等)。
  // openRight 幂等;handleSend 时还会再调一次保险。
  const bus = workspaceManager.getBus(wsId);
  bus?.slot.openRight('ai-view');

  // 1. 抓选区 markdown
  const { markdown } = textEditing.api.getSelectionMarkdown(instanceId);
  if (!markdown) {
    // 无选区 — AI View 已切好,用户手动跟 AI 对话(不弹 panel,空 prompt 没意义)
    return;
  }

  // 2. 取活跃 AI 服务
  const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
  const defaultServiceId: AIServiceId = aiState?.currentServiceId ?? DEFAULT_AI_SERVICE;

  // 3. 创空 thought atom 拿 id(用户取消时 cancel 命令会反向 delete)
  const thoughtCap = requireCapabilityApi<ThoughtCapabilityApi>('thought');
  const placeholder = await thoughtCap.createThought({
    type: 'ai-response',
    resolved: false,
    pinned: false,
    serviceId: defaultServiceId,
    doc: {
      format: 'pm-doc-json',
      version: '0.1',
      payload: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
    folderId: null,
    anchor: null,
  });
  const thoughtId = placeholder.id;

  // 4. addThoughtMark 选区(必须在 selection 还在时调)
  const markResult = textEditing.api.addThoughtMark(
    instanceId,
    thoughtId,
    'ai-response',
  );
  if (markResult) {
    // 5. 写 anchor 边(source=note,locator=inline pos+text)
    const anchor: ThoughtAnchor = {
      source: 'note',
      resourceId: noteId,
      locator: {
        pmPos: markResult.pos,
        anchorType: 'inline',
        text: markResult.text,
      },
    };
    await thoughtCap.updateThoughtAnchor(thoughtId, anchor);
  }

  // 6. 弹 panel(panel handleSend 时把 thoughtId 塞进 ai-extraction pending)
  commandRegistry.execute('note-view.open-ask-ai-popup', {
    selectionMarkdown: markdown,
    defaultServiceId,
    anchorX: cmState.x,
    anchorY: cmState.y,
    thoughtId,
    instanceId,
  });
}
