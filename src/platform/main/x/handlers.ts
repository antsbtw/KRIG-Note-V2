/**
 * X(Twitter)IPC handlers(阶段 0/1/2)— 对齐 ai/handlers.ts 同模式
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts initIpcBus()
 *
 * invoke:
 * - X_EXTRACT_TWEET(阶段 1)— 按坐标定位 + 抽该条推文。
 * - X_PASTE_TWEET(阶段 2)— 把纯文本填进 compose 框(发推,用户点发布)。
 * - X_PASTE_REPLY(阶段 2)— 导航到目标推 + 填进 reply 框(回复,用户点发布)。
 * (X_*_REQUEST 是 main→renderer 广播,由 webview-hook 发,不在此 handle。)
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { extractTweetAt } from './x-extract-tweet';
import { pasteTweet, pasteReply } from './x-write';
import { driveArticlePlan, type ArticlePlanPayload } from './x-article-driver';
import { armXDragListener, resolveXDropAt, clickReplyAtDrop } from './x-drag-drop';
import { resolveMediaPath } from '../media/media-store-impl';
import { existsSync } from 'fs';
import { isAbsolute, extname } from 'path';

function isXServiceId(v: unknown): v is 'x' {
  return v === 'x';
}

/** X 视频附件支持的本地文件扩展名(校验 ytdlp localFilePath 绝对路径用)。 */
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.gif']);

/**
 * 把 renderer 传来的 media:// URL 数组解析成磁盘绝对路径(阶段 2.5-b,路线 B 喂文件需真实路径)。
 *
 * 在 main 侧解析(resolveMediaPath 在此进程、且做了越界白名单)— renderer 不接触磁盘路径,
 * 安全边界不破。解析失败的(文件不存在 / 非 media://)记进 unresolved,供 fail loud 提示,
 * **不静默丢**(铁律 4)。
 */
function resolveMediaUrlsToPaths(mediaUrls: unknown): {
  paths: string[];
  unresolved: string[];
} {
  if (!Array.isArray(mediaUrls)) return { paths: [], unresolved: [] };
  const paths: string[] = [];
  const unresolved: string[] = [];
  for (const url of mediaUrls) {
    if (typeof url !== 'string') continue;
    const p = resolveMediaPath(url);
    if (p) paths.push(p);
    else unresolved.push(url);
  }
  return { paths, unresolved };
}

/**
 * 把 renderer 传来的视频源数组解析成磁盘绝对路径(阶段 2.5-b 视频,路线 B)。
 *
 * 视频源两种形态(见 pm-to-markdown.videoLocalSource):
 * - `media://`:note 内导入的本地视频 → 走 resolveMediaPath(MEDIA_DIR 白名单内,安全)。
 * - 磁盘**绝对路径**:ytdlp 下载到系统 Downloads 的 localFilePath(不在 MEDIA_DIR,
 *   resolveMediaPath 拒绝)→ 此处单独校验:必须是绝对路径 + 文件存在 + 视频扩展名,才放行。
 *   该路径来源是「我们自己 ytdlp 下载并写进 note attrs 的本地文件」,非任意 renderer 构造的
 *   越权路径;扩展名 + 存在性双校验兜底,不放行任意绝对路径(防被诱导喂非视频/不存在文件)。
 *
 * 解析失败的记 unresolved(fail loud 提示),不静默丢(铁律 4)。
 */
function resolveVideoUrlsToPaths(videoUrls: unknown): {
  paths: string[];
  unresolved: string[];
} {
  if (!Array.isArray(videoUrls)) return { paths: [], unresolved: [] };
  const paths: string[] = [];
  const unresolved: string[] = [];
  for (const url of videoUrls) {
    if (typeof url !== 'string' || !url.trim()) continue;
    if (url.startsWith('media://')) {
      const p = resolveMediaPath(url);
      if (p) paths.push(p);
      else unresolved.push(url);
      continue;
    }
    // ytdlp 下载的本地绝对路径:绝对 + 存在 + 视频扩展名才放行。
    if (isAbsolute(url) && VIDEO_EXTS.has(extname(url).toLowerCase()) && safeExists(url)) {
      paths.push(url);
    } else {
      unresolved.push(url);
    }
  }
  return { paths, unresolved };
}

function safeExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 把「媒体解析失败」并入 pasteTweet/pasteReply 结果的 mediaWarning(fail loud,不静默丢)。
 * 已有喂媒体 warning 时拼接,无则单独成句。
 */
function mergeUnresolvedWarning<T extends { mediaWarning?: string }>(
  result: T,
  unresolved: string[],
  kind: '图' | '视频' = '图',
): T {
  if (unresolved.length === 0) return result;
  const note = `有 ${unresolved.length} 个${kind}无法解析为本地文件(已跳过)`;
  return {
    ...result,
    mediaWarning: result.mediaWarning ? `${result.mediaWarning};${note}` : note,
  };
}

export function registerXHandlers(): void {
  // X_EXTRACT_TWEET — 右键「提取此推文到笔记」:按坐标定位 + 抓全字段
  ipcMain.handle(IPC_CHANNELS.X_EXTRACT_TWEET, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; x?: unknown; y?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.x !== 'number' || typeof p.y !== 'number') {
      return { success: false, error: 'invalid extractTweet payload' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    return extractTweetAt(p.serviceId, p.x, p.y, targetWcId);
  });

  // X_PASTE_TWEET — 发推:把纯文本填进 compose 框(用户随后手动点发布)
  // 阶段 2.5-b:可带 mediaUrls(media:// 数组)→ main 侧解析磁盘路径 → 先喂图再填字。
  ipcMain.handle(IPC_CHANNELS.X_PASTE_TWEET, async (_e, payload: unknown) => {
    const p = payload as
      | { serviceId?: unknown; text?: unknown; targetWcId?: unknown; mediaUrls?: unknown; videoUrls?: unknown }
      | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.text !== 'string') {
      return { success: false, error: 'invalid pasteTweet payload' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    const { paths, unresolved } = resolveMediaUrlsToPaths(p.mediaUrls);
    const video = resolveVideoUrlsToPaths(p.videoUrls);
    const result = await pasteTweet(p.serviceId, p.text, targetWcId, paths, video.paths);
    return mergeUnresolvedWarning(
      mergeUnresolvedWarning(result, unresolved, '图'),
      video.unresolved,
      '视频',
    );
  });

  // X_PASTE_REPLY — 回复:导航到目标推 + 填进 reply 框(用户随后手动点回复)
  ipcMain.handle(IPC_CHANNELS.X_PASTE_REPLY, async (_e, payload: unknown) => {
    const p = payload as
      | { serviceId?: unknown; tweetUrl?: unknown; text?: unknown; targetWcId?: unknown; mediaUrls?: unknown; videoUrls?: unknown }
      | null;
    if (
      !p || !isXServiceId(p.serviceId) ||
      typeof p.tweetUrl !== 'string' || typeof p.text !== 'string'
    ) {
      return { success: false, error: 'invalid pasteReply payload' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    const { paths, unresolved } = resolveMediaUrlsToPaths(p.mediaUrls);
    const video = resolveVideoUrlsToPaths(p.videoUrls);
    const result = await pasteReply(p.serviceId, p.tweetUrl, p.text, targetWcId, paths, video.paths);
    return mergeUnresolvedWarning(
      mergeUnresolvedWarning(result, unresolved, '图'),
      video.unresolved,
      '视频',
    );
  });

  // X_DRIVE_ARTICLE — 驱动 X 原生 Insert 发长文(终态,2026-06-13)。
  // renderer 侧 buildArticlePlan 产好计划(title + 有序 steps)透传;main 侧逐 step 驱动 X DOM。
  // ⚠️ 写方向红线:driveArticlePlan 全程只插内容,绝不点 Publish。
  ipcMain.handle(IPC_CHANNELS.X_DRIVE_ARTICLE, async (_e, payload: unknown) => {
    const p = payload as
      | { serviceId?: unknown; plan?: unknown; targetWcId?: unknown; taskId?: unknown }
      | null;
    if (!p || !isXServiceId(p.serviceId)) {
      return { success: false, error: 'invalid driveArticle payload' };
    }
    const plan = p.plan as ArticlePlanPayload | undefined;
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) {
      return { success: false, error: 'invalid Article plan(缺 steps)' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    // 进度:renderer 传 taskId 则逐 step 推 PROGRESS_UPDATE 回发起窗口(复用 GlobalProgressOverlay)。
    const taskId = typeof p.taskId === 'string' ? p.taskId : undefined;
    const onProgress = taskId
      ? (current: number, total: number, label: string): void => {
          if (_e.sender.isDestroyed()) return;
          _e.sender.send(IPC_CHANNELS.PROGRESS_UPDATE, {
            taskId,
            message: `正在驱动第 ${current}/${total} 块:${label}`,
            current,
            total,
          });
        }
      : undefined;
    return driveArticlePlan(p.serviceId, plan, targetWcId, onProgress);
  });

  // X_DRAG_ARM — note 拖起:往指定 X guest 装 mousemove 监听(记录最后坐标)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_ARM, async (_e, payload: unknown) => {
    const p = payload as { targetWcId?: unknown } | null;
    if (!p || typeof p.targetWcId !== 'number') return { ok: false };
    await armXDragListener(p.targetWcId);
    return { ok: true };
  });

  // X_DRAG_RESOLVE — 松手:读回最后坐标 + 解析落点(compose / tweet / other / none)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_RESOLVE, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.targetWcId !== 'number') {
      return { kind: 'none' };
    }
    return resolveXDropAt(p.serviceId, p.targetWcId);
  });

  // X_DRAG_REPLY_HERE — 落推文:就地点该推回复按钮弹 reply 框(不跳详情页)
  ipcMain.handle(IPC_CHANNELS.X_DRAG_REPLY_HERE, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId) || typeof p.targetWcId !== 'number') {
      return { ok: false, error: 'invalid replyHere payload' };
    }
    return clickReplyAtDrop(p.serviceId, p.targetWcId);
  });
}
