/**
 * media-storage capability — 对外类型(Wave 5 / D4)
 */

export type { MediaPutResult } from './index';

/** view 业务路径 API(FileTab 上传 / driver media 块用)*/
export interface MediaStorageApi {
  mediaPutBase64(
    input: string,
    explicitMime?: string,
    hintedFilename?: string,
  ): Promise<import('./index').MediaPutResult>;
  mediaDownload(
    url: string,
    type: 'audio' | 'image' | 'video',
  ): Promise<import('./index').MediaPutResult>;
  mediaResolvePath(mediaUrl: string): Promise<string | null>;
}
