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

/** 匹配 markdown 中独立成行或内联的图片 `![alt](url)`(url 不含空格/右括号)。 */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * 规整 Defuddle markdown:把**与文字同行的图片** `![](url)` 拆到独立行。
 *
 * 背景:Defuddle 常把首图内联在首段开头(如 `![](img.jpg) The Fire TV app...`)。
 * 下游 markdownToProseMirror 的 block-image 只认**独占一行**的 `![](url)`,内联的会
 * 当纯文本留下(用户看到裸 `![](media://...)`)。本函数在内联图前后补换行,使其独占
 * 一行 → md-to-pm 转成 image block,文字另起段落。
 */
function isolateInlineImages(markdown: string): string {
  // 在「行内非行首的 ![](...)」前补 \n\n;在其后若紧跟非空白也补 \n\n。
  // 逐行处理避免误伤已独占行的图片。
  return markdown
    .split('\n')
    .map((line) => {
      // 整行已是单张图片(可含前后空白)→ 不动
      if (/^\s*!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/.test(line)) return line;
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

  // 诊断日志:看 Defuddle 实际抓到的 title + 正文(JSON 编码以暴露真实换行/分隔符)。
  // 定位 inline 链接/加粗/列表被当纯文本残留的根因(转换器对干净 markdown 正常,
  // 故疑 Defuddle 输出的换行/结构异常)。临时,定位后删。
  console.log(
    '[content-extraction] clip payload — title=%o domain=%o contentLen=%d',
    payload.title,
    payload.domain,
    (payload.content || '').length,
  );
  console.log('[content-extraction] RAW content (JSON):', JSON.stringify((payload.content || '').slice(0, 1500)));

  // ① 规整 markdown(把内联图拆到独立行,使其能被识别成 image block)+ 正文内嵌图本地化
  const normalized = isolateInlineImages(payload.content || '');
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
  const atoms: PmAtomDraft[] = [titleDraft, ...bodyAtoms];

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
