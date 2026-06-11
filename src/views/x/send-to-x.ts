/**
 * x-view.send-to-x 业务实现(X 集成 阶段 2,写方向)
 *
 * 「发到 X」统一入口(note 右键菜单 / 命令)。流程:
 *   1. 抓 note 选区 markdown;无选区 → 退而取整篇 doc markdown(「发整篇推」)。
 *   2. markdown → 推文纯文本降级(去标记符保文字,总指挥拍板)。
 *   3. 阶段 2.5-a:弹「发送前确认弹窗」(XSendConfirmPanel)——预览降级后纯文本 + 字数/
 *      超限标红 + 发送类型(普通推 / 回复给谁)+ 可临时编辑(不回写 note)。用户取消 →
 *      直接 return(不注入、不消费 pending reply);确认 → 走下面注入。
 *      (取代旧的 window.confirm 超长提示 —— 超限提示并入弹窗,仍允许继续。)
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
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { XExtractionApi } from '@capabilities/x-extraction';
import { markdownToTweetText } from '@shared/x/markdown-to-tweet';
import { showXSendConfirm } from './send-confirm-popup';

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

/**
 * 「𝕏 发到 X」note 右键入口:把 note 选区/整篇发成普通推(确认弹窗 → 注入 compose 框)。
 * (回复改走「拖 block 到某条推」交互,见 sendToXAtDropTarget;故此入口只发普通推。)
 */
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

  // 3. 弹发送前确认弹窗(预览/字数/可编辑)。确认 → onConfirm 注入;取消 → 不注入。
  showXSendConfirm({
    text,
    usedWholeDoc,
    replyPreview: null,
    onConfirm: (finalText) => performXInjection(wsId, finalText),
  });
}

/**
 * 确认后真注入普通推(由 XSendConfirmPanel 的 onConfirm 调)。
 *
 * @param finalText 弹窗里用户确认(可能已编辑)的纯文本 —— 改动只作用于这次注入,不回写 note。
 *
 * 流程:ensureXVisible → pasteTweet(按 ws 定向 targetWcId)→ 失败降级剪贴板。
 * ⚠️ 写方向红线:只注入到 X 框,绝不程序点发布。
 * (回复注入走 sendToXAtDropTarget 里的就地弹框 + pasteTweet 链路,不经本函数。)
 */
async function performXInjection(wsId: string, finalText: string): Promise<void> {
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');

  // 让 X webview 显示 + 注册(main 侧 pasteTweet 内部还会 poll 等待)
  ensureXVisible(wsId);

  // 注入目标 = 本活跃 ws 的 AI-view X 实例(治多 X 实例串扰:不再用全局「最后 navigate」)。
  // 未登记 → null,main 侧回退到旧的全局 active(单实例场景无差)并 warn。
  const targetWcId = x.getXHostWcId(wsId);
  if (targetWcId == null) {
    console.warn('[send-to-x] 未取到本 ws 的 X Host wc id,回退 main 全局 active(多实例可能串扰)');
  }

  const result = await x.pasteTweet('x', finalText, targetWcId);
  if (!result.success) {
    fallbackToClipboard(finalText, result.error || '未知错误');
    return;
  }
  // 注入成功:内容已可见地填进 X 发推框,确认弹窗里已有「需你自己点发布」红线文案,
  // 不再弹阻塞 alert 打扰(总指挥:成功告知无必要)。失败仍 fail loud(上面 fallback)。
}

/**
 * 「被拖起的 block」内容暂存(拖 block 到 X 用)。dnd.started 时抓 → 松手时用。
 * 总指挥:发的是**拖的那些 block**,不是 note 选区/整篇。
 */
let draggedBlockText: string | null = null;

/** dnd.started 时调:抓被拖起 block(单块或多选块)的降级纯文本暂存。*/
export function stashDraggedBlockText(instanceId: string, fromPos: number): void {
  draggedBlockText = null;
  try {
    const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
    const { markdown } = textEditing.api.getBlockMarkdownAt(instanceId, fromPos);
    if (markdown && markdown.trim()) {
      const text = markdownToTweetText(markdown);
      if (text.trim()) draggedBlockText = text;
    }
  } catch (err) {
    console.warn('[send-to-x] stashDraggedBlockText failed:', err);
  }
}

/** 取并清空暂存的被拖 block 文本(松手消费一次)*/
function consumeDraggedBlockText(): string | null {
  const t = draggedBlockText;
  draggedBlockText = null;
  return t;
}

/** 取当前活跃 note 的待发纯文本(选区优先,无选区取整篇)。失败 alert 并返 null。*/
function getPendingTweetText(): { text: string; usedWholeDoc: boolean } | null {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = getActiveNoteInstanceId(textEditing);
  if (!instanceId) {
    window.alert('没有活跃的 Note —— 请先在 Note 里选中要发的内容(或打开要发的整篇)');
    return null;
  }
  let { markdown } = textEditing.api.getSelectionMarkdown(instanceId);
  let usedWholeDoc = false;
  if (!markdown || !markdown.trim()) {
    markdown = textEditing.api.getDocMarkdown(instanceId).markdown;
    usedWholeDoc = true;
  }
  if (!markdown || !markdown.trim()) {
    window.alert('Note 内容为空,没有可发到 X 的文字');
    return null;
  }
  const text = markdownToTweetText(markdown);
  if (!text.trim()) {
    window.alert('转换后内容为空,无法发到 X');
    return null;
  }
  return { text, usedWholeDoc };
}

/**
 * 拖 note block 到 X view 松手时调(dnd.completed)。总指挥定义的操作:
 *   - 对准「What's happening?」发推框松手 → 把**被拖起 block** 内容填入发推框 → 用户点 Post。
 *   - 对准某条推松手 → **就地点该推回复按钮弹出 reply 框**(不跳详情页)→ 填入 → 用户点 Reply。
 * 内容 = 被拖起的 block(dnd.started 时 stash);落点解析靠 guest 自报的拖拽期最后坐标。
 *
 * ⚠️ 落点不是发推框/推文(拖到空白/导航栏、或 guest 没收到坐标)→ 静默不发。
 * 写方向红线:只填入,用户点发布/回复。
 */
export async function sendToXAtDropTarget(): Promise<void> {
  const draggedText = consumeDraggedBlockText(); // 消费本次拖拽 stash(无论落点如何都清掉)
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');
  const targetWcId = x.getXHostWcId(wsId);
  if (targetWcId == null) return; // 本 ws 无在台上的 X Host → 非拖到 X,忽略

  const drop = await x.dragResolve('x', targetWcId);
  // 落点不是发推框/推文(拖到空白/导航栏、或没拿到坐标)→ 静默不发
  if (drop.kind !== 'compose' && drop.kind !== 'tweet') return;

  // 内容 = 被拖起的 block(总指挥:拖什么发什么)。stash 没拿到(罕见)→ 退回选区/整篇兜底。
  let text = draggedText;
  if (!text) {
    const pending = getPendingTweetText();
    if (!pending) return; // 内容为空已 alert
    text = pending.text;
  }

  if (drop.kind === 'compose') {
    // 落发推框 → 发普通推
    showXSendConfirm({
      text,
      usedWholeDoc: false,
      replyPreview: null,
      onConfirm: (finalText) => performXInjection(wsId, finalText),
    });
    return;
  }

  // 落某条推 → 就地回复(点该推 reply 按钮弹框,不跳详情页)。
  showXSendConfirm({
    text,
    usedWholeDoc: false,
    replyPreview: drop.author || '该推文',
    onConfirm: async (finalText) => {
      // 1. 就地点回复按钮弹 reply 框(main 侧 poll 等框出现)
      const r = await x.dragReplyHere('x', targetWcId);
      if (!r.ok) {
        fallbackToClipboard(finalText, r.error || '回复框未弹出');
        return;
      }
      // 2. reply 框已弹出(= 当前 compose 框)→ 注入。复用 pasteTweet(填的就是这个 reply 框)。
      const result = await x.pasteTweet('x', finalText, targetWcId);
      if (!result.success) {
        fallbackToClipboard(finalText, result.error || '未知错误');
        return;
      }
      // 成功:内容已可见填进回复框,确认弹窗已有「需你点回复」红线,不弹阻塞 alert(同发推)。
    },
  });
}
