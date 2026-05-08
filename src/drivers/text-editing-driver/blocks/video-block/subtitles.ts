/**
 * 字幕引擎 utility(L5-B3.19.1)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/video-block.ts:19-80
 * (SubtitleCue interface + parseSubtitleCuesFromText + findActiveCue)
 *
 * 纯函数 + 0 副作用 + 0 外部依赖。
 *
 * 后续 sub-stage 消费方:
 * - B3.19.2 CC 浮层:`findActiveCue(cues, video.currentTime)` → 渲染浮层文字
 * - B3.19.3 ytdlp.fetchTranscript:抓回 [MM:SS] 格式 → parseSubtitleCuesFromText 解析
 * - B3.19.4 翻译:每语言一条 transcript 字符串 → parseSubtitleCuesFromText 各自解析
 *
 * Phase D 抽到独立 capability 也无成本(无内部依赖,API 稳定)。
 */

export interface SubtitleCue {
  /** 起始时间(秒)*/
  startTime: number;
  /** 字幕文字内容 */
  text: string;
}

/**
 * 从 transcript 文本解析字幕 cues
 *
 * 支持格式(每行一条):
 *   `[MM:SS] text`
 *   `[HH:MM:SS] text`
 *
 * 不匹配的行**静默忽略**(用户可在 textarea 写注释行)。
 */
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

/**
 * 找当前时间对应的 active cue(线性扫,O(n))
 *
 * 返回 startTime ≤ currentTime 的最后一条 cue。
 * cues 假定已按 startTime 升序(parseSubtitleCuesFromText 输出天然有序)。
 *
 * 性能:本段不优化为二分;短视频(< 1k cue)线性扫毫秒级。
 * Phase D 处理长视频(全场电影)时可加二分优化。
 */
export function findActiveCue(cues: SubtitleCue[], currentTime: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  let active: SubtitleCue | null = null;
  for (const cue of cues) {
    if (cue.startTime <= currentTime) active = cue;
    else break;
  }
  return active;
}
