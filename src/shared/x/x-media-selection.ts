/**
 * X 发推媒体取舍(纯逻辑层)— 图清单合并 / 视频收集 / 图视频互斥(X 集成 阶段 2.5-b)
 *
 * 从 views/x/send-to-x.ts 抽出的**纯函数**:不依赖 renderer 运行时(capability / workspace /
 * window),便于单测。send-to-x 编排时 import 这些算子,再配合 capability 渲图 / 弹窗。
 *
 * 守的规则(决策点 §4,本期定):
 * - 图片上限 4(X_MAX_IMAGES);只取 media:// 本地图(外链图无法当文件喂 X)。渲染图(公式/
 *   代码/Mermaid 转的 media://)与普通图共占 4 张额度。
 * - 视频上限 1(X_MAX_VIDEOS);源由序列化器(pm-to-markdown.videos)预筛(localFilePath /
 *   media://,外链不吐),此处只做上限收口。
 * - 图视频互斥(X 规则:一推要么 ≤4 图、要么 1 视频,不能混)。**有视频 → 优先视频、弃图并提示**
 *   (droppedImageCount 记被弃图数,fail loud 不静默丢)。
 */

/** X 推文图片上限。超出只带前 N 张,其余提示用户(不静默丢)。 */
export const X_MAX_IMAGES = 4;

/** X 推文视频上限(一条推最多 1 个视频)。 */
export const X_MAX_VIDEOS = 1;

/**
 * 把 note 图 + 渲染图(公式/代码/Mermaid 转的图)合并成最终图片清单。
 *
 * - note 图(media://)在前,渲染图在后,按各自文档顺序;合并后截至 X_MAX_IMAGES。
 * - 公式/代码图与普通图**共占 4 张额度**。
 * - http(s) 外链图无法当本地文件喂 X,不进(只取 media://)。
 *
 * @returns { mediaUrls: 截后清单, totalImageCount: 截前总数(>4 时弹窗提示用)}
 */
export function combineMedia(
  noteImages: string[],
  renderedMediaUrls: string[],
): { mediaUrls: string[]; totalImageCount: number } {
  const noteMedia = (noteImages ?? []).filter(
    (src) => typeof src === 'string' && src.startsWith('media://'),
  );
  const all = [...noteMedia, ...(renderedMediaUrls ?? [])];
  return {
    mediaUrls: all.slice(0, X_MAX_IMAGES),
    totalImageCount: all.length,
  };
}

/**
 * 收集 note 选区/整篇里「能当 X 视频附件」的本地视频源(已被序列化器预筛)。
 * 此处只做 X 视频上限收口(截至 X_MAX_VIDEOS)。
 *
 * @returns { videos: 截后(≤1)清单, totalVideoCount: 截前总数(>1 时提示用)}
 */
export function collectNoteVideos(serializedVideos: string[]): {
  videos: string[];
  totalVideoCount: number;
} {
  const local = (serializedVideos ?? []).filter((s) => typeof s === 'string' && s.trim());
  return { videos: local.slice(0, X_MAX_VIDEOS), totalVideoCount: local.length };
}

export interface ExclusiveMediaResult {
  mediaUrls: string[];
  totalImageCount: number;
  videoUrls: string[];
  totalVideoCount: number;
  /** 因「有视频」而被忽略的图片数(>0 → 互斥取舍生效,提示用户)。 */
  droppedImageCount: number;
}

/**
 * X 媒体互斥规则收口(决策点 §4.1,本期定):
 *   **一条推要么最多 4 图、要么 1 视频,不能图视频混。有视频 → 优先视频,忽略全部图并提示。**
 *
 * 理由:视频信息量/制作成本通常 > 顺手的配图;「丢图保视频」比反之更符合用户发视频的意图。
 * 被忽略的图不静默丢 —— droppedImageCount 让弹窗/调用方明示(铁律 4 fail loud)。
 *
 * @returns 取舍后的最终媒体 + 提示所需计数。mediaUrls 与 videoUrls 至多一方非空。
 */
export function combineExclusiveMedia(
  noteImages: string[],
  renderedMediaUrls: string[],
  serializedVideos: string[],
): ExclusiveMediaResult {
  const { mediaUrls, totalImageCount } = combineMedia(noteImages, renderedMediaUrls);
  const { videos, totalVideoCount } = collectNoteVideos(serializedVideos);

  // 互斥:有视频 → 弃图(droppedImageCount 记被弃图数,fail loud 提示)。
  if (videos.length > 0) {
    return {
      mediaUrls: [],
      totalImageCount: 0,
      videoUrls: videos,
      totalVideoCount,
      droppedImageCount: totalImageCount,
    };
  }
  return {
    mediaUrls,
    totalImageCount,
    videoUrls: [],
    totalVideoCount: 0,
    droppedImageCount: 0,
  };
}

/**
 * X 互斥取舍 / 视频超限的 fail loud 提示文案(铁律 4:被忽略的媒体不静默丢)。
 * 返 null = 无需提示。
 */
export function mediaTradeoffNote(
  droppedImageCount: number,
  totalVideoCount: number,
): string | null {
  const parts: string[] = [];
  if (droppedImageCount > 0) {
    parts.push(
      `这条推带了视频,X 不允许图片和视频混发 —— 已忽略 ${droppedImageCount} 张图,只发视频。` +
        `如需发图,请去掉视频后重发。`,
    );
  }
  if (totalVideoCount > X_MAX_VIDEOS) {
    parts.push(`选区共 ${totalVideoCount} 个本地视频,X 一条推只能带 1 个,只发第 1 个。`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}
