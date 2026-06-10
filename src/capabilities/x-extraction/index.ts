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
  XWriteReplyRequest,
} from './types';
import { Host } from './Host';

export type {
  XExtractionApi,
  XServiceId,
  XTweetData,
  XExtractTweetResult,
  XExtractTweetRequest,
  XWriteResult,
  XWriteReplyRequest,
  XHostHandle,
  XHostProps,
} from './types';

async function extractTweet(
  serviceId: XServiceId,
  x: number,
  y: number,
): Promise<XExtractTweetResult> {
  return window.electronAPI.xExtractTweet(serviceId, x, y);
}

function onExtractTweetRequest(
  callback: (payload: XExtractTweetRequest) => void,
): () => void {
  return window.electronAPI.onXExtractTweetRequest(callback);
}

// ── 写方向(阶段 2)──
async function pasteTweet(serviceId: XServiceId, text: string): Promise<XWriteResult> {
  return window.electronAPI.xPasteTweet(serviceId, text);
}

async function pasteReply(
  serviceId: XServiceId,
  tweetUrl: string,
  text: string,
): Promise<XWriteResult> {
  return window.electronAPI.xPasteReply(serviceId, tweetUrl, text);
}

function onWriteReplyRequest(
  callback: (payload: XWriteReplyRequest) => void,
): () => void {
  return window.electronAPI.onXWriteReplyRequest(callback);
}

export const xExtractionCapability: XExtractionApi = {
  extractTweet,
  onExtractTweetRequest,
  pasteTweet,
  pasteReply,
  onWriteReplyRequest,
  Host,
};

capabilityRegistry.register({
  id: 'x-extraction',
  api: xExtractionCapability,
});
