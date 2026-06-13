/**
 * x-extraction capability — renderer 端薄包装(X 集成 阶段 0/1)
 *
 * 职责:从 x.com 网页「提取推文」的统一能力 + 嵌 X 网页的 Host 组件。
 * 与 ai-extraction 完全独立(铁律 3):X 走自己的命令 / 类型 / 提取产物路径,
 * 不污染 AI 问答语义。
 *
 * 边界(对齐 ai-extraction):
 * - view 业务路径走 requireCapabilityApi<XExtractionApi>('x-extraction')
 * - 模块级 export 同时保留
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  XExtractionApi,
  XServiceId,
  XExtractTweetResult,
  XExtractTweetRequest,
  XWriteResult,
  XDriveArticleResult,
  XDropTarget,
} from './types';
import type { ArticlePlan } from '@drivers/text-editing-driver/serializers/note-to-article-plan';
import { Host } from './Host';
import { registerXHostWcId, clearXHostWcId, getXHostWcId } from './x-host-registry';
import { renderBlocksToMedia } from './render-blocks-to-media';

export type {
  XExtractionApi,
  XServiceId,
  XTweetData,
  XExtractTweetResult,
  XExtractTweetRequest,
  XWriteResult,
  XDriveArticleResult,
  XDropTarget,
  XHostHandle,
  XHostProps,
  RenderableBlock,
  ArticlePlan,
  RenderBlocksResult,
  RenderedBlockMedia,
  BlockRenderFailure,
} from './types';

async function extractTweet(
  serviceId: XServiceId,
  x: number,
  y: number,
  targetWcId?: number | null,
): Promise<XExtractTweetResult> {
  return window.electronAPI.xExtractTweet(serviceId, x, y, targetWcId ?? undefined);
}

function onExtractTweetRequest(
  callback: (payload: XExtractTweetRequest) => void,
): () => void {
  return window.electronAPI.onXExtractTweetRequest(callback);
}

// ── 写方向(阶段 2)──
async function pasteTweet(
  serviceId: XServiceId,
  text: string,
  targetWcId?: number | null,
  mediaUrls?: string[],
): Promise<XWriteResult> {
  return window.electronAPI.xPasteTweet(serviceId, text, targetWcId ?? undefined, mediaUrls);
}

async function pasteReply(
  serviceId: XServiceId,
  tweetUrl: string,
  text: string,
  targetWcId?: number | null,
  mediaUrls?: string[],
): Promise<XWriteResult> {
  return window.electronAPI.xPasteReply(serviceId, tweetUrl, text, targetWcId ?? undefined, mediaUrls);
}

async function driveArticle(
  serviceId: XServiceId,
  plan: ArticlePlan,
  targetWcId?: number | null,
): Promise<XDriveArticleResult> {
  return window.electronAPI.xDriveArticle(serviceId, plan, targetWcId ?? undefined);
}

// ── 拖拽落点 ──
async function dragArm(targetWcId: number): Promise<void> {
  await window.electronAPI.xDragArm(targetWcId);
}

async function dragResolve(serviceId: XServiceId, targetWcId: number): Promise<XDropTarget> {
  return window.electronAPI.xDragResolve(serviceId, targetWcId) as Promise<XDropTarget>;
}

async function dragReplyHere(
  serviceId: XServiceId,
  targetWcId: number,
): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI.xDragReplyHere(serviceId, targetWcId);
}

export const xExtractionCapability: XExtractionApi = {
  extractTweet,
  onExtractTweetRequest,
  pasteTweet,
  pasteReply,
  driveArticle,
  registerXHostWcId,
  clearXHostWcId,
  getXHostWcId,
  dragArm,
  dragResolve,
  dragReplyHere,
  renderBlocksToMedia,
  Host,
};

capabilityRegistry.register({
  id: 'x-extraction',
  api: xExtractionCapability,
});
