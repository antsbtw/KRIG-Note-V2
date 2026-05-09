/**
 * subtitle-parser — `[MM:SS] text` / `[HH:MM:SS] text` 字幕格式解析(L5-B3.19.a)
 *
 * V1 → V2 直迁(算法对齐,无改动)。
 *
 * findActiveCue:**线性扫描**(对齐 V1 实现)— cues 升序时单趟 forward 取
 * 最后一个 startTime <= currentTime 的;遇到 startTime > currentTime 直接 break。
 * O(N) 但短路,实测几千行 transcript 仍在 ms 级。
 */

export interface SubtitleCue {
  startTime: number; // seconds
  text: string;
}

/** 解析 `[MM:SS] text` 或 `[HH:MM:SS] text` 行;无效行(注释 / 空行 / 不规范)静默跳过 */
export function parseSubtitleCuesFromText(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)/);
    if (!m) continue;
    const seconds =
      m[3] !== undefined
        ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)
        : parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const content = m[4].trim();
    if (content) cues.push({ startTime: seconds, text: content });
  }
  return cues;
}

/** 当前激活的 cue(线性扫描,假设 cues 已按 startTime 升序)*/
export function findActiveCue(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  let active: SubtitleCue | null = null;
  for (const cue of cues) {
    if (cue.startTime <= currentTime) active = cue;
    else break;
  }
  return active;
}
