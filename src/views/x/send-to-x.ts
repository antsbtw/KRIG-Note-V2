/**
 * x-view.send-to-x 业务实现(X 集成 阶段 2,写方向)
 *
 * 「发到 X」统一入口(note 右键菜单 / 命令)。流程:
 *   1. 抓 note 选区 markdown;无选区 → 退而取整篇 doc markdown(「发整篇推」)。
 *   2. markdown → 推文纯文本降级(去标记符保文字,总指挥拍板)。
 *   3. 超长校验:超过 280 仍填入,但 alert 明示「X 不会让你发,请精简或留作 thread」
 *      (总指挥拍板:fail loud + 仍填入,不截断、不自动拆 thread)。
 *   4. 有 pending 回复目标(用户先右键某推「在 note 里写回复」)→ 走 pasteReply 注入该推
 *      reply 框;无 → 走 pasteTweet 注入 compose 框。
 *   5. 切右槽 / 主舞台到 AI view 并切到 X 入口(让 X webview 显示 + 注册)。
 *   6. 注入失败(框没找到 / 粘贴没落地 / selector 未配置 / 无活跃 X 页)→
 *      fallback:复制到剪贴板 + alert 明示走了降级(铁律 4 fail loud,不静默假装成功)。
 *
 * ⚠️ 写方向红线:全程只「填充内容」,绝不程序点发布 —— 注入成功后停在
 *    「内容已填入 X,请检查后手动点发布」。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi, getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { XExtractionApi } from '@capabilities/x-extraction';
import { markdownToTweetText, checkTweetLength } from '@shared/x/markdown-to-tweet';
import { consumePendingXReply, peekPendingXReply, setPendingXReply } from './pending-reply';

/** 取当前 note 的活跃 PM instanceId(右键命令瞬间快照优先,fallback focused) */
function getActiveNoteInstanceId(textEditing: TextEditingApi): string | null {
  const ctxPmId = contextMenuController.getState().context.custom.pmInstanceId;
  return (
    (typeof ctxPmId === 'string' ? ctxPmId : null) ??
    textEditing.instanceRegistry.getFocusedInstanceId()
  );
}

/** 确保 AI view 在台上(承载 X webview)+ 切到 X 入口 */
function ensureXVisible(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  const bus = workspaceManager.getBus(wsId);
  // AI view 既不在主舞台也不在右槽 → 召唤到右槽(用户预期:发到 X 时右栏装 X)
  if (ws.slotBinding.left !== 'ai-view' && ws.slotBinding.right !== 'ai-view') {
    bus?.slot.openRight('ai-view');
  }
  // 通过 bus 通知 AIView 切到 X 入口(setActiveLauncher('x') 在 AIView 侧执行)
  bus?.channels.emit('x.activate-launcher', { emittedAt: Date.now() });
}

/** 注入失败统一降级:复制到剪贴板 + alert 明示(fail loud)*/
function fallbackToClipboard(text: string, reason: string): void {
  try {
    void navigator.clipboard.writeText(text);
    window.alert(
      `注入 X 失败(${reason})。\n\n已改为复制到剪贴板 — 请到 X 发推/回复框手动粘贴(⌘V)。`,
    );
  } catch {
    window.alert(`注入 X 失败(${reason}),且复制剪贴板也失败,请手动复制 note 内容。`);
  }
}

export async function sendToX(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = getActiveNoteInstanceId(textEditing);
  if (!instanceId) {
    window.alert('没有活跃的 Note —— 请先在 Note 里选中要发的内容(或打开要发的整篇)');
    return;
  }

  // 1. 选区优先,无选区取整篇
  let { markdown } = textEditing.api.getSelectionMarkdown(instanceId);
  let usedWholeDoc = false;
  if (!markdown || !markdown.trim()) {
    markdown = textEditing.api.getDocMarkdown(instanceId).markdown;
    usedWholeDoc = true;
  }
  if (!markdown || !markdown.trim()) {
    window.alert('Note 内容为空,没有可发到 X 的文字');
    return;
  }

  // 2. markdown → 推文纯文本
  const text = markdownToTweetText(markdown);
  if (!text.trim()) {
    window.alert('转换后内容为空,无法发到 X');
    return;
  }

  // 3. 超长 fail loud(仍填入,不截断)
  const len = checkTweetLength(text);
  if (len.overLimit) {
    const proceed = window.confirm(
      `内容约 ${len.length} 字,超过 X 普通推 ${len.limit} 字上限。\n\n` +
      `仍会填入 X(X 会标红、不让你发)。你可在 X 里精简,或留作 thread(本期不自动拆 thread)。\n\n` +
      `继续填入?`,
    );
    if (!proceed) return;
  }

  // 4. pending 回复目标?(peek 不删 —— 注入失败时不消费,便于用户修好后重试仍走回复路径;
  //    仅注入成功后 consume)
  const replyTarget = peekPendingXReply();

  const x = requireCapabilityApi<XExtractionApi>('x-extraction');

  // 5. 让 X webview 显示 + 注册(main 侧 pasteTweet/pasteReply 内部还会 poll 等待)
  ensureXVisible(wsId);

  // 6. 注入
  if (replyTarget) {
    const result = await x.pasteReply('x', replyTarget.tweetUrl, text);
    if (!result.success) {
      fallbackToClipboard(text, result.error || '未知错误');
      return;
    }
    consumePendingXReply(); // 成功才消费(失败保留供重试)
    window.alert(
      `回复内容已填入 X(回复:${replyTarget.preview || replyTarget.tweetUrl})。\n\n` +
      `请检查后在 X 手动点「回复」发布。`,
    );
    return;
  }

  const result = await x.pasteTweet('x', text);
  if (!result.success) {
    fallbackToClipboard(text, result.error || '未知错误');
    return;
  }
  window.alert(
    `${usedWholeDoc ? '整篇内容' : '选区内容'}已填入 X 发推框。\n\n请检查后在 X 手动点「发布」。`,
  );
}

/**
 * 处理「在 note 里写回复」右键请求(X_WRITE_REPLY_REQUEST):
 *   抓被点中推文(复用 extractTweet 拿 tweetUrl + 作者/正文预览)→ 记下 pending 回复目标
 *   → 提示用户去 note 写内容,再「发到 X」即注入该推 reply 框。
 *
 * @param x guest viewport x;@param y guest viewport y
 */
export async function startReplyDraft(px: number, py: number): Promise<void> {
  const x = getCapabilityApi<XExtractionApi>('x-extraction');
  if (!x) return;
  const result = await x.extractTweet('x', px, py);
  if (!result.success || !result.data) {
    window.alert(`无法定位要回复的推文:${result.error || '未知错误'}`);
    return;
  }
  const data = result.data;
  const tweetUrl = data.tweetUrl;
  if (!tweetUrl) {
    window.alert('该推文没有可用链接(无法定位 reply 框),请换一条再试');
    return;
  }
  const author = data.authorHandle || data.authorName || '';
  const snippet = (data.text || '').slice(0, 40);
  const preview = [author, snippet].filter(Boolean).join(': ');
  setPendingXReply({ tweetUrl, preview, setAt: Date.now() });
  window.alert(
    `已记下回复目标(${preview || tweetUrl})。\n\n` +
    `请到 Note 里选中要发的回复内容,然后右键「𝕏 发到 X」即注入到该推的回复框。`,
  );
}
