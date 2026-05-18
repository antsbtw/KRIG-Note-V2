/**
 * thought-view.ask-ai-from-note 业务实现
 *
 * AI response 状态机(thought-view-port.md v0.5 §6):
 *   1. preCreatePlaceholder type='ai-response' + serviceId(从 AIView per-ws state 取活跃服务)
 *   2. addThoughtMark + updateThoughtAnchor(若有选区,inline mark)
 *   3. 开右槽 + emit 'thought.activate'(让 Thought View 滚到此卡片)
 *   4. 调 ai-conversation.askAI(serviceId, prompt) → 拿 Markdown 回复
 *   5. updateThought({ doc }) 把回复填进 thought card + emit 'thought.ai-ready'
 *
 * AI 回复格式处理:
 *   - V1 走 md → ProseMirror nodes 转换(blocks-to-pm-nodes)。
 *   - V2 Phase 4 最小集:把 markdown 按 \n\n 拆段落,丢失格式但端到端可工作;
 *     后续 sub-phase 搬 markdown 解析器实现真 PM doc 还原。
 *
 * 失败处理:任意一步失败都 updateThought 把错误信息填进卡片,让用户看到失败状态。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { ThoughtAnchor } from '@capabilities/thought/types';
import type { AIConversationApi, AIServiceId } from '@capabilities/ai-conversation/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { DEFAULT_AI_SERVICE } from '@shared/types/ai-service-types';
import { thoughtCap, preCreatePlaceholder } from './shared';

export async function askAiFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  const noteState = ws.pluginStates['note'] as { activeNoteId?: string } | undefined;
  const noteId = noteState?.activeNoteId;
  if (!noteId) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  // 优先用 context menu 抓拍(右键场景);否则当前 focused(floating/keymap 场景)
  const instanceId =
    contextMenuController.getState().context.pmInstanceId ??
    textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) return;

  // 取活跃 AI 服务(AIView per-ws state),无则 default
  const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
  const serviceId: AIServiceId = aiState?.currentServiceId ?? DEFAULT_AI_SERVICE;

  const thoughtId = await preCreatePlaceholder('ai-response', serviceId);
  if (!thoughtId) return;

  // 尝试 inline anchor;失败(无选区)则保持 unanchored
  const inlineResult = textEditing.api.addThoughtMark(
    instanceId,
    thoughtId,
    'ai-response',
  );
  if (inlineResult) {
    const anchor: ThoughtAnchor = {
      source: 'note',
      resourceId: noteId,
      locator: {
        pmPos: inlineResult.pos,
        anchorType: 'inline',
        text: inlineResult.text,
      },
    };
    await thoughtCap().updateThoughtAnchor(thoughtId, anchor);
  }

  const bus = workspaceManager.getBus(wsId);
  if (bus) {
    bus.slot.openRight('thought-view');
    bus.channels.emit('thought.activate', { thoughtId });
  }

  // 端到端 askAI(fire-and-forget;结果走 then,错误进 catch)
  const promptText = inlineResult?.text;
  if (!promptText) {
    await thoughtCap().updateThought(thoughtId, {
      doc: markdownToDoc('(无选区,请先在 Note 中选中文字再点 🤖 问 AI)'),
    });
    return;
  }

  const ai = requireCapabilityApi<AIConversationApi>('ai-conversation');
  void ai.askAI(serviceId, promptText).then(async (result) => {
    if (result.success && result.markdown) {
      await thoughtCap().updateThought(thoughtId, {
        doc: markdownToDoc(result.markdown),
      });
    } else {
      await thoughtCap().updateThought(thoughtId, {
        doc: markdownToDoc(`[AI 调用失败]\n\n${result.error ?? '未知错误'}`),
      });
    }
    bus?.channels.emit('thought.ai-ready', { thoughtId });
  }).catch(async (err) => {
    await thoughtCap().updateThought(thoughtId, {
      doc: markdownToDoc(`[AI 调用异常]\n\n${String(err)}`),
    });
    bus?.channels.emit('thought.ai-ready', { thoughtId });
  });
}

/**
 * Markdown → NoteDocEnvelope(最小集:按段落拆分,不解析 markdown 语法)
 *
 * Phase 4 端到端走通;后续 sub-phase 接 V1 blocks-to-pm-nodes 做真 md → PM 还原。
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
