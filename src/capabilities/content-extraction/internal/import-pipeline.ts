/**
 * import-pipeline — 网页剪藏 renderer 编排(content-extraction 门面内部)
 *
 * 收 main 推回的 WebClipPayload(FullPageResult)→ 建一篇 note 并打开:
 *   ① 媒体本地化(D3):
 *      - 正文内嵌图(markdown `![]()`)+ contentImages → mediaDownload('image') → media://;
 *        失败 / 超 20MB → 降级保留远程 URL(不阻断整篇)。
 *      - 音频(extractedAudioUrl)→ mediaDownload('audio'),失败降级远程。
 *      - 视频默认**不下载**(多数超 200MB),video block src 存远程 URL + embedType。
 *   ② content-ingest.markdownToAtoms(content, { titleHint, from }) → 正文 drafts
 *      (内嵌图 src 已在 ① 改写为 media://,md-to-pm 原样透传)。
 *   ③ Stage 1 draft-builders 追加 video/audio block drafts(字幕进 video transcriptText)。
 *   ④ note.createNotesBatch({ items:[{ atoms, folderId:null, titleHint }] })。
 *   ⑤ commandRegistry.execute('note-view.set-active', notes[0].id) 打开。
 *
 * 能力边界:本 pipeline 单向消费 content-ingest / media-storage / note 三个下游能力
 * (requireCapabilityApi),不与它们互相 install(charter §3.2 边界澄清)。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ContentIngestApi } from '@capabilities/content-ingest/types';
import type { NoteCapabilityApi, CreateNoteBatchItem } from '@capabilities/note/types';
import type { MediaStorageApi } from '@capabilities/media-storage/types';
import { detectEmbedType } from '@drivers/text-editing-driver/blocks/video-block/helpers/embed-detection';
import type { PmAtomDraft, AtomFrom } from '@semantic/types';
import {
  buildImageBlockDraft,
  buildVideoBlockDrafts,
  buildAudioBlockDrafts,
  type TmpIdAllocator,
} from './draft-builders';
import type { WebClipPayload } from '../types';

function ingestCap(): ContentIngestApi {
  return requireCapabilityApi<ContentIngestApi>('content-ingest');
}
function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function mediaCap(): MediaStorageApi {
  return requireCapabilityApi<MediaStorageApi>('media-storage');
}

/** 把远程图片 URL 本地化为 media://;失败 / 超限降级返回原始远程 URL。 */
async function localizeImage(url: string): Promise<string> {
  try {
    const r = await mediaCap().mediaDownload(url, 'image');
    if (r.success && r.mediaUrl) return r.mediaUrl;
  } catch {
    /* 降级:保留远程 URL */
  }
  return url;
}

/** 把远程音频 URL 本地化为 media://;失败降级远程 URL。 */
async function localizeAudio(url: string): Promise<string> {
  try {
    const r = await mediaCap().mediaDownload(url, 'audio');
    if (r.success && r.mediaUrl) return r.mediaUrl;
  } catch {
    /* 降级:保留远程 URL */
  }
  return url;
}

/**
 * 去重折叠/disclosure 控件造成的重复(折叠态 + 展开态两份相同内容都在 DOM 里 →
 * Defuddle 把要点抓两遍,如 WSJ "Quick Summary":3 条要点 + AI 脚注后,首条要点
 * 又作为"展开态 teaser"重复出现 + "View more")。重复**不一定相邻**(中间隔脚注)。
 *
 * 两条保守规则,避免误删正文正常内容:
 *  1) 相邻完全相同的可去重行 → 去后一份(同段重复)。
 *  2) **列表项**全局去重:某 `- `/`1. ` 列表项的文本若与**先前出现过的列表项**完全
 *     相同(trim 后),去掉后一份。正文极少有两条一字不差的完整要点,而折叠控件
 *     的双份要点必然字面相同 → 精准命中。非列表行不做全局去重(段落可能合理重复)。
 *  另:顺带去掉孤立的 "View more" / "Show more" 残留行(折叠控件 teaser 噪音)。
 */
export function dedupeConsecutiveLines(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let prevKey: string | null = null;
  const seenListItems = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const isListItem = /^([-*]|\d+\.)\s+/.test(trimmed);
    const dedupable = trimmed.length > 0 && (isListItem || trimmed.length >= 12);

    // 折叠控件 teaser 噪音:孤立的 "View more" / "Show more"
    if (/^(view|show)\s+more$/i.test(trimmed)) continue;

    // 规则 1:相邻完全相同
    if (dedupable && trimmed === prevKey) continue;

    // 规则 2:列表项全局去重(去掉文本完全相同的后续列表项)
    if (isListItem) {
      const body = trimmed.replace(/^([-*]|\d+\.)\s+/, '');
      if (seenListItems.has(body)) continue;
      seenListItems.add(body);
    }

    out.push(line);
    if (dedupable) prevKey = trimmed;
    else if (trimmed.length === 0) { /* 空行不重置 prevKey */ }
    else prevKey = null;
  }
  return out.join('\n');
}

/** 匹配 markdown 中独立成行或内联的图片 `![alt](url)`(url 不含空格/右括号)。 */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * 合并被 Defuddle 拆成多行的链接图片(列表/卡片页常见):
 *   `[`\n\n`![alt](img)`\n\n`](url)`  →  `[![alt](img)](url)`(单行)
 * 不合并 → isolate/md-to-pm 会留下孤立 `[` 与 `](url)` 断裂行。合并后整行交给
 * md-to-pm 的 block linked-image 分支转成 image。
 */
export function joinSplitLinkedImages(markdown: string): string {
  return markdown.replace(
    /\[\s*\n\s*\n\s*(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))\s*\n\s*\n\s*\](\([^)\s]+(?:\s+"[^"]*")?\))/g,
    (_full, img: string, link: string) => `[${img}]${link}`,
  );
}

/**
 * 规整 Defuddle markdown:把**与文字同行的图片** `![](url)` 拆到独立行。
 *
 * 背景:Defuddle 常把首图内联在首段开头(如 `![](img.jpg) The Fire TV app...`)。
 * 下游 markdownToProseMirror 的 block-image 只认**独占一行**的 `![](url)`,内联的会
 * 当纯文本留下(用户看到裸 `![](media://...)`)。本函数在内联图前后补换行,使其独占
 * 一行 → md-to-pm 转成 image block,文字另起段落。
 */
export function isolateInlineImages(markdown: string): string {
  // 在「行内非行首的 ![](...)」前补 \n\n;在其后若紧跟非空白也补 \n\n。
  // 逐行处理避免误伤已独占行的图片。
  return markdown
    .split('\n')
    .map((line) => {
      // 整行已是单张图片(可含前后空白)→ 不动
      if (/^\s*!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/.test(line)) return line;
      // 整行是链接图片 [![alt](img)](url)(列表/卡片页)→ **不拆**,整行留给
      //   md-to-pm 的 block linked-image 分支(拆了会把外层 [ 和 ](url) 拆散成
      //   孤立 [ + 图片 + 孤立 ](url),断裂)。
      if (/^\s*\[!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/.test(line)) {
        return line;
      }
      // 行内含图片 → 用换行把每个图片隔成独立行
      if (MD_IMAGE_RE.test(line)) {
        MD_IMAGE_RE.lastIndex = 0;
        return line.replace(MD_IMAGE_RE, (m) => `\n\n${m}\n\n`);
      }
      return line;
    })
    .join('\n')
    // 压掉因拆分产生的多余空行
    .replace(/\n{3,}/g, '\n\n');
}

/** 独占一行的图片 `![alt](url)`,捕获 alt(group 1)。 */
const MD_IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/;

/**
 * 去掉「图片后紧跟的、与该图 alt 完全相同的冗余段落」。
 *
 * Defuddle 对部分站点会在 `![alt](url)` 之后又把 alt 原样输出成一段纯文本(无障碍
 * 描述回显,原网页不显示),如 WSJ 图片下重复出现 "U.S. President Donald Trump,
 * in a blue suit..."。该段是冗余噪音(图片已带 alt),删之;真 caption(图注+署名)
 * 文本与 alt 不同,不受影响,保留为正文。
 *
 * 保守:只删**紧邻图片的下一个非空行**且**完全等于 alt**(trim);不全局删,避免误伤
 * 正文里恰好与某 alt 同文的句子。需在 isolateInlineImages 之后调(图片已独占行)。
 */
export function stripRedundantImageAlt(markdown: string): string {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MD_IMAGE_LINE_RE);
    if (!m) continue;
    const alt = m[1].trim();
    if (!alt) continue;
    // 找紧邻图片的下一个非空行
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    // 完全等于 alt → 置空(join 后即空行,被 markdownToProseMirror 忽略)
    if (j < lines.length && lines[j].trim() === alt) lines[j] = '';
  }
  return lines.join('\n');
}

/**
 * 正文内嵌图本地化:扫描 markdown 所有 `![]()`,逐个 mediaDownload('image'),
 * 把 url 改写为 media://(失败降级远程)。返回改写后的 markdown。
 * 跳过 data: / media:(data: 留给 md-to-pm 自己 putBase64;media: 已本地)。
 */
async function localizeInlineImages(markdown: string): Promise<string> {
  const urls = new Set<string>();
  for (const m of markdown.matchAll(MD_IMAGE_RE)) {
    const url = m[2];
    if (!url || url.startsWith('data:') || url.startsWith('media:')) continue;
    urls.add(url);
  }
  if (urls.size === 0) return markdown;

  const map = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      map.set(url, await localizeImage(url));
    }),
  );

  return markdown.replace(MD_IMAGE_RE, (full, alt: string, url: string) => {
    const local = map.get(url);
    if (!local || local === url) return full;
    return `![${alt}](${local})`;
  });
}

/**
 * 收 WebClipPayload → 建 note 并打开。
 * 失败(payload 为 null / markdownToAtoms 空 / createNotesBatch 失败)时 console.error
 * 并静默返回(本期不做 toast,D5 TODO)。
 */
export async function runImportPipeline(payload: WebClipPayload | null): Promise<void> {
  // TODO(D5):此处首版无"剪藏中…" toast;后续接 V2 进度/通知机制。
  if (!payload) {
    console.error('[content-extraction] clip failed: empty payload (capture returned null)');
    return;
  }

  const title = (payload.title || '').trim() || payload.domain || 'Web Clip';
  const from: AtomFrom = {
    extractionType: 'web-clip',
    extractedAt: Date.now(),
  };

  // 诊断:概要 1 行(完整原始 FullPageResult 已由 main 侧 clip-cache 落盘,
  // 离线看 <userData>/web-clip-cache/<epochMs>-<domain>.json 调优格式)。
  console.log(
    '[content-extraction] clip — title=%o domain=%o contentLen=%d',
    payload.title,
    payload.domain,
    (payload.content || '').length,
  );

  // ① 规整 markdown:合并被拆多行的链接图片 → 去相邻重复行(折叠控件双份)
  //    → 内联图拆行 → 去图片 alt 冗余回显 → 内嵌图本地化
  const joined = joinSplitLinkedImages(payload.content || '');
  const deduped = dedupeConsecutiveLines(joined);
  const isolated = isolateInlineImages(deduped);
  const normalized = stripRedundantImageAlt(isolated);
  const localizedMarkdown = await localizeInlineImages(normalized);

  // ② markdownToAtoms 正文 drafts。**不传 titleHint** —— 否则它会把正文首段(可能是
  //    图片/噪音行)误标为 title。标题改由下方用 Defuddle 的 payload.title 显式前置。
  const { atoms: bodyAtoms, warnings } = await ingestCap().markdownToAtoms(localizedMarkdown, {
    from,
  });
  if (warnings.length) {
    console.warn('[content-extraction] markdownToAtoms warnings:', warnings);
  }

  // tmpId 分配器:从正文 atoms 数量续号,保证整数组内唯一(对齐 markdown-to-atoms 命名)
  let counter = bodyAtoms.length;
  const alloc: TmpIdAllocator = () => `tmp-${counter++}`;

  // 显式标题段落(isTitle):用 Defuddle 的 result.title,前置到正文最前。
  // 顶层 paragraph + isTitle 是 V2 note 标题约定(对齐 markdown-to-atoms titleHint 分支产物)。
  const titleDraft: PmAtomDraft = {
    tmpId: alloc(),
    payload: {
      domain: 'pm',
      payload: {
        type: 'paragraph',
        attrs: { isTitle: true },
        content: [{ type: 'text', text: title }],
      },
    },
    from,
  };
  // 副标题/导语(Defuddle 的 description)→ 标题下一段普通正文。
  // Defuddle 常把文章 deck(如 WSJ 标题下那句)放 description 而非正文 content;
  // 去重:与 title 相同(部分站点拿 title 填 description)则不插,避免重复。
  const deck = (payload.description || '').trim();
  const lead: PmAtomDraft[] =
    deck && deck !== title
      ? [
          {
            tmpId: alloc(),
            payload: {
              domain: 'pm',
              payload: { type: 'paragraph', attrs: {}, content: [{ type: 'text', text: deck }] },
            },
            from,
          },
        ]
      : [];

  // 列表页/无正文页提示:Defuddle 为单篇文章正文设计,栏目页/首页/搜索页这类
  // "卡片流"没有正文,wordCount 极低(如 WSJ /world 仅 33)。仍允许剪(用户主动
  // 触发),但前置一行斜体提示,说明这页可能不是文章、内容可能不完整。
  const LOW_CONTENT_WORDS = 50;
  const lowContent = (payload.wordCount ?? 0) < LOW_CONTENT_WORDS;
  if (lowContent) {
    console.warn(
      `[content-extraction] low word count (${payload.wordCount}); 可能是列表/栏目页而非文章,剪藏内容可能不完整`,
    );
  }
  const notice: PmAtomDraft[] = lowContent
    ? [
        {
          tmpId: alloc(),
          payload: {
            domain: 'pm',
            payload: {
              type: 'paragraph',
              attrs: {},
              content: [
                {
                  type: 'text',
                  text: '⚠️ 此页正文很少(可能是列表/栏目页而非文章),剪藏内容可能不完整。',
                  marks: [{ type: 'italic' }],
                },
              ],
            },
          },
          from,
        },
      ]
    : [];

  const atoms: PmAtomDraft[] = [titleDraft, ...lead, ...notice, ...bodyAtoms];

  // ③a contentImages(Defuddle 遗漏的正文图)→ image block draft(本地化)
  for (const img of payload.contentImages ?? []) {
    if (!img.src || img.src.startsWith('data:')) continue;
    const src = await localizeImage(img.src);
    atoms.push(
      buildImageBlockDraft(
        { src, alt: img.alt || '', width: img.w || null, height: img.h || null },
        alloc,
        from,
      ),
    );
  }

  // ③b contentVideos → video block drafts(默认远程 + embedType;字幕进首个 video)
  const videos = payload.contentVideos ?? [];
  videos.forEach((v, idx) => {
    if (!v.src) return;
    atoms.push(
      ...buildVideoBlockDrafts(
        {
          src: v.src,
          embedType: detectEmbedType(v.src),
          title: v.title || 'Video',
          duration: v.duration ?? null,
          // YouTube 字幕只对应页面级单视频,挂到第一个 video draft
          transcriptText: idx === 0 ? payload.youtubeTranscript ?? null : null,
        },
        alloc,
        from,
      ),
    );
  });

  // ③c extractedAudioUrl → audio block draft(本地化,失败降级远程)
  if (payload.extractedAudioUrl) {
    const src = await localizeAudio(payload.extractedAudioUrl);
    atoms.push(...buildAudioBlockDrafts({ src, title: 'Audio' }, alloc, from));
  }

  if (atoms.length === 0) {
    console.error('[content-extraction] clip produced 0 atoms; skip note creation');
    return;
  }

  // ④ createNotesBatch(根级,不去重 — D4)
  const item: CreateNoteBatchItem = { atoms, folderId: null, titleHint: title };
  const result = await noteCap().createNotesBatch({ items: [item] });
  if (result.failures.length > 0 || result.notes.length === 0) {
    console.error('[content-extraction] createNotesBatch failed:', result.failures);
    return;
  }

  // ⑤ 打开新 note —— 对照布局:web 钉 left,note 开 right(方便左右比对原网页与剪藏稿)。
  //    web-view.pin-left 把 web 搬到 left(若在 right 则腾出 right);
  //    note-view.set-active-in-right 把 note 装到 right slot 并设为 active(不掩盖 left)。
  const noteId = result.notes[0].id;
  console.log('[content-extraction] clip → note', noteId, `(${atoms.length} atoms)`);
  commandRegistry.execute('web-view.pin-left');
  commandRegistry.execute('note-view.set-active-in-right', noteId);
}
