/**
 * thought-view.ask-ai-from-note 业务实现(Phase 6 重写)
 *
 * 新流程("用户主导"对话式 AI):
 *   1. 抓 Note 选区 → text-editing.api.getSelectionMarkdown + getSelectionDocJSON
 *   2. 拼"无损 prompt":渲染预览 markdown + 原始结构 JSON
 *   3. 在 Note 选区加 thoughtMark(type='ai-response')留下选区痕迹
 *      [本期不创建 thought atom,等用户"提取整页对话"时再创]
 *   4. bus.slot.openRight('ai-view') 把 AI Web 拉到右槽
 *   5. bus.channels.emit('ai.paste-and-send', { prompt, serviceId })
 *      → AIView 订阅收到 → 调 host.pasteAndSend 自动 paste + click send
 *   6. 用户在 AI Web 里看 AI 回复、追问、对话
 *   7. 满意后点 toolbar"提取整页对话" → ai-view.extract-conversation 命令
 *      (Phase 6.5 实现)→ 从 SSE 缓存抓全部回复 → 创建 type='ai-response' thought atom
 *
 * 与 Phase 4 旧实现差异:
 *   - 旧:后台静默 askAI 等回复 → 直接落 thought atom(用户看不到 AI 聊天过程)
 *   - 新:开 AI Web View 让用户实时看 AI 聊天 + 多轮对话 + 用户确认后提取
 *
 * thought atom 创建从"问 AI 即建"推迟到"用户点提取按钮"创建,匹配你的设计。
 *
 * 选区场景三态(都走 PM Slice → sliceToMarkdown):
 *   - 部分字符:slice openStart>0,仅 inline + marks
 *   - 1 block:slice 含 1 个完整 block
 *   - 多 blocks:slice 含多个 block
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { AIServiceId } from '@capabilities/ai-conversation/types';
import { DEFAULT_AI_SERVICE } from '@shared/types/ai-service-types';

/**
 * 构造无损 prompt:渲染预览 + 原始结构 JSON。
 *
 * AI 第一时间能读懂(markdown),需精确修改时能看清原结构(JSON 含所有 attrs)。
 */
function buildPrompt(markdown: string, docJSON: unknown): string {
  const jsonStr = JSON.stringify(docJSON, null, 2);
  return [
    '请帮我理解 / 讨论 Note 中的以下内容:',
    '',
    '【渲染预览】',
    markdown,
    '',
    '【完整结构 JSON(如需精确修改 / 引用原始结构请参考)】',
    '```json',
    jsonStr,
    '```',
  ].join('\n');
}

export async function askAiFromNote(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const ws = workspaceManager.get(wsId);
  if (!ws) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  // 优先用 context menu 抓拍(右键场景);否则当前 focused(floating/keymap 场景)
  const instanceId =
    contextMenuController.getState().context.pmInstanceId ??
    textEditing.instanceRegistry.getFocusedInstanceId();
  if (!instanceId) {
    console.warn('[ask-ai] no active PM instance');
    return;
  }

  // 抓选区双格式(无损传递)
  const { markdown, images } = textEditing.api.getSelectionMarkdown(instanceId);
  const docJSON = textEditing.api.getSelectionDocJSON(instanceId);
  void images; // 本期不发图片(multimodal 留下一 sub-phase)

  if (!markdown && !docJSON) {
    // 无选区(光标态)— V1 同款体验:仍然开 AI Web 让用户手动输入
    const bus = workspaceManager.getBus(wsId);
    bus?.slot.openRight('ai-view');
    return;
  }

  // 取活跃 AI 服务(AIView per-ws state),无则 default
  const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
  const serviceId: AIServiceId = aiState?.currentServiceId ?? DEFAULT_AI_SERVICE;

  const prompt = buildPrompt(markdown, docJSON);

  // 开右槽 + 跨槽发 prompt(AIView 订阅 'ai.paste-and-send' 接到后调 host.pasteAndSend)
  const bus = workspaceManager.getBus(wsId);
  if (!bus) return;
  bus.slot.openRight('ai-view');
  // payload 加 emittedAt 时间戳,让 receiver 去重(避免 mount 时 getLastValue 重放老消息)
  bus.channels.emit('ai.paste-and-send', { prompt, serviceId, emittedAt: Date.now() });
}
