/**
 * 网页剪藏里的 `blob:` 视频 → 真实视频直链
 *
 * ── 为什么 ──
 * 新闻站等的播放器(MSE / HLS)把视频切片拼进 `blob:https://站点/uuid` 播放。
 * 这个地址**只在那个页面里活着**:剪进 note 后 video block 播不了、也下载不了
 * (2026-11-05 实测 6abc.com:clip 结果 `<video src="blob:https://6abc.com/…">`,contentVideos 为空)。
 *
 * ── 怎么做 ──
 * 页面里有 blob 视频时,用 yt-dlp 从**页面地址**解析真实直链(`-g -f b`,单文件最好格式),
 * 换进正文 / contentVideos。6abc 实测得到 `https://vcl.abcotv.net/…/xxx.mp4`(不签名、不过期)。
 *
 * 解析不出(yt-dlp 没装 / 站点不支持 / 超时)→ **不留一个放不了的空视频块**,
 * 换成一行看得见的「视频无法提取,请到原网页观看」+ 原网页链接,并在终端留痕。
 */

import { spawn } from 'child_process';
import { getYtdlpPath } from '../ytdlp/binary-manager';
import type { FullPageResult } from './types';

/** 解析等多久:剪藏是用户点了在等的,不能无限挂着 */
const RESOLVE_TIMEOUT_MS = 45_000;

const BLOB_SRC_RE = /\bsrc\s*=\s*"(blob:[^"]*)"/g;
/** 整个 <video …>…</video>(或自闭合)且其中含 blob: */
const BLOB_VIDEO_TAG_RE = /<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/>/g;

/** yt-dlp -g:返回页面里视频的直链(按页面顺序,可能多条);失败返 reason */
function resolveDirectUrls(pageUrl: string): Promise<{ urls: string[] } | { reason: string }> {
  const bin = getYtdlpPath();
  if (!bin) return Promise.resolve({ reason: 'yt-dlp 未安装' });
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-g', '-f', 'b', '--no-warnings', pageUrl]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ reason: `yt-dlp 超时(${RESOLVE_TIMEOUT_MS / 1000}s)` });
    }, RESOLVE_TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ reason: `yt-dlp 启动失败: ${e.message}` }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const urls = out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l));
      if (code === 0 && urls.length > 0) resolve({ urls });
      else resolve({ reason: `yt-dlp 退出码 ${code}:${err.trim().split('\n').pop() ?? ''}` });
    });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** 纯函数:按解析结果改写正文 + contentVideos(单测钉这里)*/
export function applyBlobVideoResolution(
  result: FullPageResult,
  urls: readonly string[],
): FullPageResult {
  // 第 i 个 blob 视频 ↔ 第 i 条直链;多出来的 blob(直链不够)当解析失败处理
  const blobOrder: string[] = [];
  for (const m of result.content.matchAll(BLOB_SRC_RE)) {
    if (!blobOrder.includes(m[1])) blobOrder.push(m[1]);
  }
  for (const v of result.contentVideos ?? []) {
    if (v?.src?.startsWith('blob:') && !blobOrder.includes(v.src)) blobOrder.push(v.src);
  }
  const directFor = new Map<string, string>();
  blobOrder.forEach((b, i) => { if (urls[i]) directFor.set(b, urls[i]); });

  const unresolvedNote =
    `\n\n> ⚠️ 视频无法提取(网页播放器的临时地址),请到原网页观看:[${result.url}](${result.url})\n\n`;

  const content = result.content.replace(BLOB_VIDEO_TAG_RE, (tag) => {
    if (!/blob:/.test(tag)) return tag;
    let missing = false;
    const replaced = tag.replace(BLOB_SRC_RE, (_all, blob: string) => {
      const direct = directFor.get(blob);
      if (!direct) { missing = true; return _all; }
      return `src="${escapeAttr(direct)}"`;
    });
    return missing ? unresolvedNote : replaced;
  });

  const contentVideos = result.contentVideos
    ?.map((v) => (v?.src?.startsWith('blob:') ? (directFor.has(v.src) ? { ...v, src: directFor.get(v.src)! } : null) : v))
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return { ...result, content, ...(contentVideos ? { contentVideos } : {}) };
}

/** 有 blob 视频才调 yt-dlp;没有就原样返回(不拖慢普通剪藏)*/
export async function resolveBlobVideos(result: FullPageResult): Promise<FullPageResult> {
  const hasBlob =
    /<video\b[^>]*\bsrc\s*=\s*"blob:/.test(result.content) ||
    /<video\b[\s\S]*?blob:[\s\S]*?<\/video>/.test(result.content) ||
    (result.contentVideos ?? []).some((v) => v?.src?.startsWith('blob:'));
  if (!hasBlob) return result;

  const t0 = Date.now();
  const r = await resolveDirectUrls(result.url);
  if ('reason' in r) {
    console.warn(`[content-extraction] blob 视频解析失败,改成「请到原网页观看」:${r.reason} url=${result.url}`);
    return applyBlobVideoResolution(result, []);
  }
  console.log(`[content-extraction] blob 视频 → 直链 ${r.urls.join(' ')}(${Date.now() - t0}ms)`);
  return applyBlobVideoResolution(result, r.urls);
}
