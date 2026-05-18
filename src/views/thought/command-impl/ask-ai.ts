/**
 * thought-view.ask-ai-from-note 业务实现(Phase 5 拆分 + Phase 4 mock)
 *
 * AI response 状态机(thought-view-port.md v0.5 §6):
 *   1. preCreatePlaceholder type='ai-response' + serviceId
 *   2. addThoughtMark + updateThoughtAnchor(若有选区)
 *   3. 开右槽 + emit activate
 *   4. mock async 2s → updateThought 填 reply doc + emit 'thought.ai-ready'
 *
 * 真接入(后续 sub-phase):serviceId 路由到 webview 抓取 / API 调用。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { ThoughtAnchor } from '@capabilities/thought/types';
import type { NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { thoughtCap, preCreatePlaceholder } from './shared';

const MOCK_DELAY_MS = 2000;

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

  const thoughtId = await preCreatePlaceholder('ai-response', 'chatgpt');
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

  // mock async:延后填充 AI 回复 doc
  window.setTimeout(() => {
    void fillMockReply(thoughtId, inlineResult?.text ?? '(无选区)').then(() => {
      bus?.channels.emit('thought.ai-ready', { thoughtId });
    });
  }, MOCK_DELAY_MS);
}

async function fillMockReply(thoughtId: string, promptText: string): Promise<void> {
  const replyText =
    `[AI mock 回复] 关于「${promptText}」:\n\n` +
    `这是一个占位 AI 回复,真接入时会替换为 ChatGPT/Claude/Gemini 实际响应。\n\n` +
    `— 设计依据: thought-view-port.md v0.5 §6 + Phase 4 AI 状态机。`;
  const replyDoc: NoteDocEnvelope = {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: replyText.split('\n').map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : undefined,
      })),
    },
  };
  await thoughtCap().updateThought(thoughtId, { doc: replyDoc });
}
