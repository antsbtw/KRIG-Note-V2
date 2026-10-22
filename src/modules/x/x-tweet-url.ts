/**
 * 地址里的推文 id(/<handle>/status/<id>,带 /photo/1 之类也认)—— 纯函数,renderer / 主进程都能用(2026-10-22)
 */
export function tweetIdOfUrl(url: string): string | null {
  const m = /^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/.exec(url);
  return m ? m[1] : null;
}
