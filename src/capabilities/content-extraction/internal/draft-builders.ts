/**
 * draft-builders — image / video / audio block → PmAtomDraft 构造 helper
 *
 * 网页剪藏(Defuddle → Note)Stage 1 产物。
 *
 * 背景:markdown 只天然表达图片(`![]()`),视频/音频/字幕无 markdown 原生语法。
 * 故 renderer 拿到 `markdownToAtoms` 的正文 `PmAtomDraft[]` 后,**追加** video/audio
 * block draft(见设计 §3.5 / D2)。本文件把"block → PmAtomDraft"固化成 helper。
 *
 * ── 形态纪律(对齐 SSOT,见 capability-impl.createSingleNoteFromDrafts +
 *    assemble-pm-doc.buildPmNode)──
 *
 * 三种 block 的 spec content 约束不同,直接决定 draft 形态:
 *   - image  : `content: 'block?'`(0 或 1 个 caption,可空)→ 叶子,无需 caption 子 draft。
 *              storage 内单 atom,assemble 时 stripAssemblyHints 原样返回。
 *   - video  : `content: 'block'`(**必须 1 个** caption block)→ 容器。
 *   - audio  : `content: 'block'`(**必须 1 个** caption block)→ 容器。
 *
 * 容器型 block(video/audio)的 atom payload.content 字面应是 `[]`(decision 026 §3.4);
 * 其 caption 子节点(一个 paragraph)走 **独立子 draft + parentTmpId childOf 边** 表达。
 * assemble-pm-doc.buildPmNode 读时按 childOf 边展开 content。若缺这个 caption 子 draft,
 * 渲染时 video/audioBlock 的 `content:'block'`(1 个必填)约束不满足 → setNodeMarkup
 * 重校验崩溃(参 assemble-pm-doc 对空 table 的同类处理)。故 video/audio 必须配 caption draft。
 *
 * 每个 draft 携带统一 `from` 元数据(extractionType:'web-clip' 等),由调用方注入。
 */

import type { PmAtomDraft, PmPayload, AtomFrom } from '@semantic/types';

/** tmpId 分配器(本批 atoms 内唯一,如 'tmp-0' / 'tmp-1');对齐 markdown-to-atoms 同款。 */
export type TmpIdAllocator = () => string;

/** image block 构造入参(media:// 本地化 src 由调用方填好,失败时可填远程 URL)。 */
export interface ImageBlockInput {
  src: string;
  alt?: string;
  title?: string;
  width?: number | null;
  height?: number | null;
  alignment?: 'left' | 'center' | 'right';
}

/** video block 构造入参(src 默认远程 URL,见 D3;字幕进 transcriptText)。 */
export interface VideoBlockInput {
  src: string;
  embedType?: 'youtube' | 'direct' | 'vimeo' | 'generic' | null;
  title?: string;
  mimeType?: string | null;
  duration?: number | null;
  /** 字幕原文(YouTube transcript 等);进 video draft 的 transcriptText 属性。 */
  transcriptText?: string | null;
}

/** audio block 构造入参(src 优先 media:// 本地化,失败降级远程,见 D3)。 */
export interface AudioBlockInput {
  src: string;
  title?: string;
  mimeType?: string | null;
  duration?: number | null;
}

/** 构造一个空段落 caption 子 draft(挂到 video/audio 容器 block 下)。 */
function buildCaptionDraft(
  parentTmpId: string,
  alloc: TmpIdAllocator,
  from: AtomFrom,
): PmAtomDraft {
  const payload: PmPayload = {
    type: 'paragraph',
    attrs: {},
    content: [],
  };
  return {
    tmpId: alloc(),
    parentTmpId,
    payload: { domain: 'pm', payload },
    from,
  };
}

/**
 * image block → 单个 PmAtomDraft(叶子,content:'block?' 允许无 caption)。
 *
 * 返回 1 个 draft;调用方把它 append 进正文 drafts 即可。
 */
export function buildImageBlockDraft(
  input: ImageBlockInput,
  alloc: TmpIdAllocator,
  from: AtomFrom,
): PmAtomDraft {
  const payload: PmPayload = {
    type: 'image',
    attrs: {
      src: input.src,
      alt: input.alt ?? '',
      title: input.title ?? '',
      width: input.width ?? null,
      height: input.height ?? null,
      alignment: input.alignment ?? 'center',
      id: null,
      sourcePages: null,
      thoughtId: null,
      bookAnchor: null,
    },
    // 叶子无 caption:content 留空数组(image content:'block?' 容忍 0 个)
    content: [],
  };
  return {
    tmpId: alloc(),
    payload: { domain: 'pm', payload },
    from,
  };
}

/**
 * video block → PmAtomDraft[](容器:block draft + 必填 caption 子 draft)。
 *
 * 返回 [videoDraft, captionDraft];二者通过 parentTmpId(childOf 边)关联。
 * videoBlock spec content:'block'(必须 1 个 caption block),故必须配 caption。
 */
export function buildVideoBlockDrafts(
  input: VideoBlockInput,
  alloc: TmpIdAllocator,
  from: AtomFrom,
): PmAtomDraft[] {
  const tmpId = alloc();
  const payload: PmPayload = {
    type: 'videoBlock',
    attrs: {
      src: input.src,
      embedType: input.embedType ?? null,
      title: input.title ?? 'Video',
      mimeType: input.mimeType ?? null,
      duration: input.duration ?? null,
      id: null,
      activeTab: 'play',
      transcriptText: input.transcriptText ?? null,
      translationTexts: null,
      segmentDuration: 60,
      memoryLastStep: 0,
      localFilePath: null,
      bookAnchor: null,
    },
    // 容器:content 留空,caption 走 childOf 子 draft 表达(decision 026 §3.4)
    content: [],
  };
  const videoDraft: PmAtomDraft = {
    tmpId,
    payload: { domain: 'pm', payload },
    from,
  };
  return [videoDraft, buildCaptionDraft(tmpId, alloc, from)];
}

/**
 * audio block → PmAtomDraft[](容器:block draft + 必填 caption 子 draft)。
 *
 * 返回 [audioDraft, captionDraft];audioBlock spec content:'block' 同 video。
 */
export function buildAudioBlockDrafts(
  input: AudioBlockInput,
  alloc: TmpIdAllocator,
  from: AtomFrom,
): PmAtomDraft[] {
  const tmpId = alloc();
  const payload: PmPayload = {
    type: 'audioBlock',
    attrs: {
      src: input.src,
      title: input.title ?? 'Audio',
      mimeType: input.mimeType ?? null,
      duration: input.duration ?? null,
      id: null,
      bookAnchor: null,
    },
    content: [],
  };
  const audioDraft: PmAtomDraft = {
    tmpId,
    payload: { domain: 'pm', payload },
    from,
  };
  return [audioDraft, buildCaptionDraft(tmpId, alloc, from)];
}
