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
import type { RenderableBlock, BlockRenderFailure } from '@capabilities/x-extraction';
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

/** X 推文媒体上限(图片)。超出只带前 N 张,其余提示用户(不静默丢)。*/
const X_MAX_IMAGES = 4;

/**
 * 把 note 图 + 渲染图(公式/代码/Mermaid 转的图)合并成最终媒体清单。
 *
 * - note 图(media://,2.5-b)在前,渲染图在后,按各自文档顺序;合并后截至 X_MAX_IMAGES。
 *   (真正的「note 图与渲染图交错的全局文档顺序」需位置信息,本期简化为「先 note 图后渲染图」,
 *    记 TODO;两者都已各自按文档先后,超 4 张时弹窗会提示总数。)
 * - 公式/代码图与普通图**共占 4 张额度**(总指挥拍板:渲染图也算附件数)。
 * - http(s) 外链图无法当本地文件喂 X,不进(只取 media://)。
 *
 * @returns { mediaUrls: 截后清单, totalImageCount: 截前总数(>4 时弹窗提示用)}
 */
function combineMedia(
  noteImages: string[],
  renderedMediaUrls: string[],
): { mediaUrls: string[]; totalImageCount: number } {
  const noteMedia = noteImages.filter((src) => typeof src === 'string' && src.startsWith('media://'));
  const all = [...noteMedia, ...renderedMediaUrls];
  return {
    mediaUrls: all.slice(0, X_MAX_IMAGES),
    totalImageCount: all.length,
  };
}

/**
 * 统一构造「发到 X」载荷:渲染公式/代码/Mermaid block → media:// 图,合并 note 图,
 * 同时把已转图的 block 源码从正文删掉(不裸奔 $$..$$ / 代码),fail loud 退源码。
 *
 * @param markdown    选区/整篇/拖块的 markdown
 * @param noteImages  序列化器收集的 image src(media:// 清单)
 * @param blocks      可渲染 block(公式/代码/Mermaid),与 markdown 同源
 */
async function buildXPayload(
  markdown: string,
  noteImages: string[],
  blocks: RenderableBlock[],
): Promise<{
  text: string;
  mediaUrls: string[];
  totalImageCount: number;
  renderFailures: BlockRenderFailure[];
}> {
  // 1. 渲染公式/代码/Mermaid → media://(失败的记 failed,不中断)。走 x-extraction capability
  //    (渲染要 import driver mermaid + media-storage 运行时,view 不可直 import,故归 capability)。
  const { rendered, failed } = blocks.length > 0
    ? await requireCapabilityApi<XExtractionApi>('x-extraction').renderBlocksToMedia(blocks)
    : { rendered: [] as { mediaUrl: string; source: string }[], failed: [] as BlockRenderFailure[] };

  // 2. 正文:已转图的 block 源码整块删(图走附件);失败的保留源码(fail loud)。
  const text = markdownToTweetText(markdown, {
    renderedBlockSources: rendered.map((r) => r.source),
  });

  // 3. 媒体清单:note 图 + 渲染图,合并截 4。
  const { mediaUrls, totalImageCount } = combineMedia(
    noteImages,
    rendered.map((r) => r.mediaUrl),
  );

  return { text, mediaUrls, totalImageCount, renderFailures: failed };
}

/** 把渲染失败的 block 汇成一句提示(fail loud:告知用户哪些没转成图、以源码发出)。 */
function renderFailureNote(failures: BlockRenderFailure[]): string | null {
  if (failures.length === 0) return null;
  const kinds = failures.map((f) => (f.kind === 'mermaid' ? 'Mermaid' : f.kind === 'math' ? '公式' : '代码'));
  const uniq = [...new Set(kinds)].join(' / ');
  return `有 ${failures.length} 处${uniq}未能渲染成图,已以源码文本发出(可在 X 手动处理)`;
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

  // 1. 选区优先,无选区取整篇。同源拿 images(media:// 图清单)+ renderableBlocks(公式/代码)。
  let { markdown, images } = textEditing.api.getSelectionMarkdown(instanceId);
  let blocks = textEditing.api.getSelectionRenderableBlocks(instanceId);
  let usedWholeDoc = false;
  if (!markdown || !markdown.trim()) {
    const doc = textEditing.api.getDocMarkdown(instanceId);
    markdown = doc.markdown;
    images = doc.images;
    blocks = textEditing.api.getDocRenderableBlocks(instanceId);
    usedWholeDoc = true;
  }
  if (!markdown || !markdown.trim()) {
    window.alert('Note 内容为空,没有可发到 X 的文字');
    return;
  }

  // 2. 渲染公式/代码/Mermaid → media:// 图 + 删源码 + 合并 note 图(2.5-b 同管道)。
  const { text, mediaUrls, totalImageCount, renderFailures } = await buildXPayload(
    markdown,
    images,
    blocks,
  );
  if (!text.trim() && mediaUrls.length === 0) {
    window.alert('转换后内容为空,无法发到 X');
    return;
  }

  // 3. 渲染失败 fail loud:先告知用户哪些以源码发出(不静默),再进确认弹窗。
  const failNote = renderFailureNote(renderFailures);
  if (failNote) window.alert(`${failNote}。`);

  // 4. 弹发送前确认弹窗(预览/字数/缩略图/可编辑)。确认 → onConfirm 注入;取消 → 不注入。
  showXSendConfirm({
    text,
    usedWholeDoc,
    replyPreview: null,
    mediaUrls,
    totalImageCount,
    onConfirm: (finalText, finalMedia) => performXInjection(wsId, finalText, finalMedia),
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
async function performXInjection(
  wsId: string,
  finalText: string,
  mediaUrls: string[] = [],
): Promise<void> {
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');

  // 让 X webview 显示 + 注册(main 侧 pasteTweet 内部还会 poll 等待)
  ensureXVisible(wsId);

  // 注入目标 = 本活跃 ws 的 AI-view X 实例(治多 X 实例串扰:不再用全局「最后 navigate」)。
  // 未登记 → null,main 侧回退到旧的全局 active(单实例场景无差)并 warn。
  const targetWcId = x.getXHostWcId(wsId);
  if (targetWcId == null) {
    console.warn('[send-to-x] 未取到本 ws 的 X Host wc id,回退 main 全局 active(多实例可能串扰)');
  }

  const result = await x.pasteTweet('x', finalText, targetWcId, mediaUrls);
  if (!result.success) {
    fallbackToClipboard(finalText, result.error || '未知错误');
    return;
  }
  // 文字落地成功,但图没带上(selector 失效 / X 没接住)→ fail loud 明示,让用户手动拖图。
  // 不当成完全失败(文字已在框里),也不静默假装图也成功了(铁律 4)。
  if (result.mediaWarning) {
    window.alert(
      `文字已填入 X,但图片没能带上(${result.mediaWarning})。\n\n` +
        `请在 X 发推框手动拖入图片,再检查后点发布。`,
    );
    return;
  }
  // 全部成功:内容(含图)已可见地填进 X 发推框,确认弹窗里已有「需你自己点发布」红线文案,
  // 不再弹阻塞 alert 打扰(总指挥:成功告知无必要)。失败仍 fail loud(上面 fallback)。
}

/**
 * 「𝕏 发布为 X 文章」(终态,2026-06-13):整篇 note → 驱动 X 原生 Insert 发长文。
 *
 * 与「发到 X」(发推/回复,纯文本降级)不同:这条走 X Article 编辑器,逐 block 驱动原生
 * Insert(LaTeX/Table/Code/Posts/Media),保真、可搜索可复制。
 *
 * 流程:
 *  1. 取活跃 note 整篇。
 *  2. 取「渲图兜底块」(只 Mermaid/mathVisual,X 无原生对应)→ renderBlocksToMedia 渲成 media://。
 *  3. buildDocArticlePlan(注入兜底 mediaMap)→ 纯数据计划(title + 有序 steps)。
 *  4. ensureXVisible(让 X webview 在台上)。
 *  5. driveArticle(按 ws 定向)→ 驱动器自动导航到 Article 编辑器(composeUrl)+ 等就绪 +
 *     逐 block 插入(无权限账号 → 等不到编辑器 fail loud 提示无 Article 权限)。
 *  6. 部分块降级/失败 → fail loud 汇总提示(用户在 X 手动补);整体失败 → alert。
 *
 * ⚠️ 写方向红线:driveArticle 全程只插内容,绝不程序点 Publish —— 用户在 X 编辑器看成品 + 手动发布。
 */
export async function publishToXArticle(): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;

  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = getActiveNoteInstanceId(textEditing);
  if (!instanceId) {
    window.alert('没有活跃的 Note —— 请先打开要发布为 X 文章的整篇 Note');
    return;
  }

  // 1+2. 渲图兜底块(只 Mermaid/mathVisual)→ media://。其余块走 X 原生 Insert,不渲。
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');
  const fallbackBlocks = textEditing.api.getDocArticleFallbackBlocks(instanceId);
  let rendered: { kind: string; source: string; mediaUrl: string }[] = [];
  let renderFailures: BlockRenderFailure[] = [];
  if (fallbackBlocks.length > 0) {
    const res = await x.renderBlocksToMedia(fallbackBlocks);
    rendered = res.rendered.map((r) => ({ kind: r.kind, source: r.source, mediaUrl: r.mediaUrl }));
    renderFailures = res.failed;
  }

  // 3. 构计划(纯数据,IPC 可序列化)。
  const plan = textEditing.api.buildDocArticlePlan(instanceId, rendered);
  if (!plan || plan.steps.length === 0) {
    window.alert('Note 内容为空,没有可发布为 X 文章的内容');
    return;
  }

  // 渲图失败 fail loud:先告知哪些兜底图没渲出(已以源码/占位形式插入)。
  const failNote = renderFailureNote(renderFailures);
  if (failNote) window.alert(`${failNote}。`);

  // 4. 让 X webview 在台上。
  ensureXVisible(wsId);

  // 5. 驱动。按 ws 定向取本 ws 的 X Host wcId。
  const targetWcId = x.getXHostWcId(wsId);
  if (targetWcId == null) {
    console.warn('[publish-x-article] 未取到本 ws 的 X Host wc id,回退 main 全局 active');
  }
  const result = await x.driveArticle('x', plan, targetWcId);

  // 6. 结果处理(fail loud)。
  // 驱动器已自动导航到 Article 编辑器;失败时 result.error 多为「无 Article 权限 / X 改版」,直接透出。
  if (!result.success) {
    window.alert(`发布为 X 文章失败:${result.error || '未知错误'}`);
    return;
  }
  if (result.warnings && result.warnings.length > 0) {
    window.alert(
      `已驱动 ${result.drivenSteps ?? 0} 处内容进 X 文章,但有部分块没成功(请在 X 手动补):\n\n` +
        result.warnings.map((w) => `· ${w}`).join('\n') +
        `\n\n⚠️ 内容已插入 X Article 编辑器,请检查/调整后**自己手动点 Publish**(本工具绝不自动发布)。`,
    );
    return;
  }
  // 全部成功:内容已插进 X Article 编辑器。红线:用户自己点 Publish。
  window.alert(
    `已把整篇驱动进 X Article 编辑器(${result.drivenSteps ?? 0} 处内容)。\n\n` +
      `请在 X 检查/调整后**自己手动点 Publish**(本工具只插内容,绝不自动发布)。`,
  );
}

/**
 * 「被拖起的 block」原始载荷暂存(拖 block 到 X 用)。dnd.started 时抓 → 松手时用。
 * 总指挥:发的是**拖的那些 block**,不是 note 选区/整篇。
 *
 * 注:渲染图是异步 + 较重,放松手(drop)时做,不卡 drag-start;故此处只暂存
 * **原始 markdown / images / renderableBlocks**,buildXPayload 在 drop 时统一跑。
 */
interface DraggedRaw {
  markdown: string;
  images: string[];
  blocks: RenderableBlock[];
}
let draggedRaw: DraggedRaw | null = null;

/** dnd.started 时调:抓被拖起 block(单块或多选块)的原始 markdown / 图 / 可渲染块暂存。*/
export function stashDraggedBlockText(instanceId: string, fromPos: number): void {
  draggedRaw = null;
  try {
    const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
    const { markdown, images } = textEditing.api.getBlockMarkdownAt(instanceId, fromPos);
    if (markdown && markdown.trim()) {
      const blocks = textEditing.api.getBlockRenderableBlocksAt(instanceId, fromPos);
      draggedRaw = { markdown, images, blocks };
    }
  } catch (err) {
    console.warn('[send-to-x] stashDraggedBlockText failed:', err);
  }
}

/** 取并清空暂存的被拖 block 原始载荷(松手消费一次)*/
function consumeDraggedRaw(): DraggedRaw | null {
  const r = draggedRaw;
  draggedRaw = null;
  return r;
}

/** 取当前活跃 note 的原始待发载荷(选区优先,无选区取整篇)。失败 alert 并返 null。*/
function getPendingRaw(): { raw: DraggedRaw; usedWholeDoc: boolean } | null {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const instanceId = getActiveNoteInstanceId(textEditing);
  if (!instanceId) {
    window.alert('没有活跃的 Note —— 请先在 Note 里选中要发的内容(或打开要发的整篇)');
    return null;
  }
  let { markdown, images } = textEditing.api.getSelectionMarkdown(instanceId);
  let blocks = textEditing.api.getSelectionRenderableBlocks(instanceId);
  let usedWholeDoc = false;
  if (!markdown || !markdown.trim()) {
    const doc = textEditing.api.getDocMarkdown(instanceId);
    markdown = doc.markdown;
    images = doc.images;
    blocks = textEditing.api.getDocRenderableBlocks(instanceId);
    usedWholeDoc = true;
  }
  if (!markdown || !markdown.trim()) {
    window.alert('Note 内容为空,没有可发到 X 的文字');
    return null;
  }
  return { raw: { markdown, images, blocks }, usedWholeDoc };
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
  const draggedRawPayload = consumeDraggedRaw(); // 消费本次拖拽 stash(无论落点如何都清掉)
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');
  const targetWcId = x.getXHostWcId(wsId);
  if (targetWcId == null) return; // 本 ws 无在台上的 X Host → 非拖到 X,忽略

  const drop = await x.dragResolve('x', targetWcId);
  // 落点不是发推框/推文(拖到空白/导航栏、或没拿到坐标)→ 静默不发
  if (drop.kind !== 'compose' && drop.kind !== 'tweet') return;

  // 内容 = 被拖起的 block(总指挥:拖什么发什么)。stash 没拿到(罕见)→ 退回选区/整篇兜底。
  const raw = draggedRawPayload ?? getPendingRaw()?.raw;
  if (!raw) return; // 内容为空已 alert(getPendingRaw 内)

  // 渲染公式/代码/Mermaid → media:// 图 + 删源码 + 合并 note 图(与发推主链同管道)。
  const { text, mediaUrls, totalImageCount, renderFailures } = await buildXPayload(
    raw.markdown,
    raw.images,
    raw.blocks,
  );
  if (!text.trim() && mediaUrls.length === 0) {
    window.alert('转换后内容为空,无法发到 X');
    return;
  }
  const failNote = renderFailureNote(renderFailures);
  if (failNote) window.alert(`${failNote}。`);

  if (drop.kind === 'compose') {
    // 落发推框 → 发普通推
    showXSendConfirm({
      text,
      usedWholeDoc: false,
      replyPreview: null,
      mediaUrls,
      totalImageCount,
      onConfirm: (finalText, finalMedia) => performXInjection(wsId, finalText, finalMedia),
    });
    return;
  }

  // 落某条推 → 就地回复(点该推 reply 按钮弹框,不跳详情页)。
  showXSendConfirm({
    text,
    usedWholeDoc: false,
    replyPreview: drop.author || '该推文',
    mediaUrls,
    totalImageCount,
    onConfirm: async (finalText, finalMedia) => {
      // 1. 就地点回复按钮弹 reply 框(main 侧 poll 等框出现)
      const r = await x.dragReplyHere('x', targetWcId);
      if (!r.ok) {
        fallbackToClipboard(finalText, r.error || '回复框未弹出');
        return;
      }
      // 2. reply 框已弹出(= 当前 compose 框)→ 注入(含图)。复用 pasteTweet(填的就是这个 reply 框)。
      const result = await x.pasteTweet('x', finalText, targetWcId, finalMedia);
      if (!result.success) {
        fallbackToClipboard(finalText, result.error || '未知错误');
        return;
      }
      // 文字落地但图没带上 → fail loud 明示(同 performXInjection),让用户手动拖图。
      if (result.mediaWarning) {
        window.alert(
          `回复文字已填入 X,但图片没能带上(${result.mediaWarning})。\n\n` +
            `请在回复框手动拖入图片,再检查后点回复。`,
        );
        return;
      }
      // 成功:内容(含图)已可见填进回复框,确认弹窗已有「需你点回复」红线,不弹阻塞 alert(同发推)。
    },
  });
}
