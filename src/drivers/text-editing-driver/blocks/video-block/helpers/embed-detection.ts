/**
 * embed-detection — 视频源类型探测 + URL 解析(L5-B3.19.a)
 *
 * V1 → V2 直迁,扩展 V2 当前 node-view.ts 的内联版本。
 *
 * EmbedType:
 * - youtube  :YouTube 视频(嵌 iframe + IFrame postMessage time tracking)
 * - direct   :mp4/webm/ogg/m3u8/mpd 直链 / blob: / media://(<video>)
 * - vimeo    :Vimeo 视频(本期不渲染,fallback 占位 + Phase D 提示)
 * - generic  :未知 embed 域(本期不渲染,fallback 占位 + Phase D 提示)
 *
 * 总设计 Q4=A:不回 Vimeo / generic 渲染,但本模块仍探测 — 为 Phase D 留位。
 */

export type EmbedType = 'youtube' | 'direct' | 'vimeo' | 'generic';

export function detectEmbedType(url: string): EmbedType {
  if (/(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i.test(url)) return 'youtube';
  if (/vimeo\.com\//i.test(url)) return 'vimeo';
  if (/\.(mp4|webm|ogg|m3u8|mpd)(\?|$)/i.test(url)) return 'direct';
  if (/^(blob:|media:)/i.test(url)) return 'direct';
  return 'generic';
}

export function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

/**
 * YouTube embed URL — 启 enablejsapi=1(time-tracker 用 postMessage IFrame API)
 * rel=0 关闭"相关视频"推荐栏。
 */
export function toYouTubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}?rel=0&enablejsapi=1`;
}
