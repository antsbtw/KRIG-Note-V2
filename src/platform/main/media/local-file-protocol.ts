/**
 * localfile:// —— note 里直接放本机的视频 / 音频,只记链接、不拷进媒体库
 * (用户 2026-11-05:「本地视频增加链接就可以了吧？不用添加到数据库。」)
 *
 * 起因(11-05 日志):274MB 本地视频走 mediaPutBase64 超 200MB 上限没存成,
 * 旧代码失败后把整段 data URL 塞进 src → 播放器黑屏。
 *
 * 地址形状:`localfile://media/<encodeURIComponent(绝对路径)>`(standard scheme 会改写 host,
 * 所以路径整段编码放在 path 里,host 固定 media)。
 *
 * 安全:
 *   - 只在 default session 注册(主窗口 renderer);X / AI / 浏览器的 webview 各有自己的
 *     partition session,不注册 → 网页拿不到本机文件。
 *   - 只放行视频 / 音频扩展名,别的文件一律 403。
 */
import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCAL_FILE_SCHEME = 'localfile';

/** 放行的扩展名(视频 + 音频) */
const ALLOWED_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i;

/** 绝对路径 → localfile:// 地址(renderer 也用同样的写法,见 capabilities/media-storage 的 localFileUrl) */
export function toLocalFileUrl(absPath: string): string {
  return `${LOCAL_FILE_SCHEME}://media/${encodeURIComponent(absPath)}`;
}

/** localfile:// 地址 → 绝对路径;不合规(不是绝对路径 / 扩展名不放行)→ null */
export function fromLocalFileUrl(url: string): string | null {
  const m = /^localfile:\/\/media\/([^?#]*)/i.exec(url);
  if (!m) return null;
  let p: string;
  try { p = decodeURIComponent(m[1]); } catch { return null; }
  if (!path.isAbsolute(p) || !ALLOWED_EXT.test(p)) return null;
  return path.normalize(p);
}

export function registerLocalFileProtocol(): void {
  protocol.handle(LOCAL_FILE_SCHEME, async (request) => {
    const p = fromLocalFileUrl(request.url);
    if (!p) {
      console.warn(`[localfile] 拒绝:${request.url.slice(0, 200)}(只放行本机视频 / 音频的绝对路径)`);
      return new Response('forbidden', { status: 403 });
    }
    if (!fs.existsSync(p)) {
      console.warn(`[localfile] 文件不在了:${p}`);
      return new Response('not found', { status: 404 });
    }
    /** 交给 file:// 读:带 Range,<video> 拖进度条不用整个读进内存 */
    return net.fetch(pathToFileURL(p).toString(), { headers: request.headers });
  });
}
