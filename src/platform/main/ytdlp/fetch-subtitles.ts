/**
 * 任意视频抓字幕(非 YouTube)—— yt-dlp 问字幕清单 → 挑一份 → 下到临时目录 → 转 `[MM:SS] 文字`
 *
 * 2026-11-05:📝 原先写死只给 YouTube(用 youtube-transcript 库)。用户原话(11-05):
 * 「这个不能写死，这是个人学习的关键」。yt-dlp 支持上千个站点,都按同一结构给字幕清单:
 *   info.subtitles / info.automatic_captions = { 语言: [{ ext, url, name }] }
 * ⚠️ 自动字幕的 url 可能是 HLS 分段清单不是字幕文件 → **不自己 fetch**,让 yt-dlp 下文件。
 *
 * 没有单独的字幕文件时,再看**视频流里嵌着的电视隐藏字幕**(EIA-608 / CC):
 *   2026-11-05 实测 6abc:yt-dlp 说 no subtitles,但 Chrome 播放器有 CC —— ffprobe 显示视频流带
 *   `Closed Captions`。yt-dlp 只认独立字幕轨,看不见这种。→ yt-dlp 把视频下到临时目录,
 *   ffmpeg `movie=v.mp4[out0+subcc]` 抽成 SRT(滚动式:每条重复前两行 + 底下新一行)。
 * 两样都没有 → 如实返回「这个视频没有字幕」;语音识别以后再加。
 */

import { spawn } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getYtdlpPath } from './binary-manager';
import { getFfmpegPath } from './downloader';

const PROBE_TIMEOUT_MS = 60_000;
/** 为查嵌入字幕要把视频下下来:新闻短片几 MB,长视频给足时间 */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

type SubTrack = { ext?: string; url?: string; name?: string };
type SubMap = Record<string, SubTrack[] | undefined>;

export interface PickedSubtitle {
  lang: string;
  /** true = 自动生成的字幕(automatic_captions) */
  auto: boolean;
}

/** 语言优先级:英文 → 中文 → 其它(个人学习场景以英文原声为主) */
function langRank(lang: string): number {
  const l = lang.toLowerCase();
  if (l === 'en' || l.startsWith('en-') || l.startsWith('en_')) return 0;
  if (l === 'zh' || l.startsWith('zh-') || l.startsWith('zh_')) return 1;
  if (l === 'live_chat') return 99; // 直播弹幕不是字幕
  return 2;
}

/** 有可用文件格式(yt-dlp 能给 vtt/srt,或能转)的语言才算 */
function usableLangs(map: SubMap | undefined): string[] {
  if (!map) return [];
  return Object.keys(map)
    .filter((lang) => langRank(lang) < 99 && (map[lang] ?? []).length > 0)
    .sort((a, b) => langRank(a) - langRank(b));
}

/** 纯函数:人工字幕优先于自动字幕;同类里按语言优先级 */
export function pickSubtitle(info: { subtitles?: SubMap; automatic_captions?: SubMap }): PickedSubtitle | null {
  const manual = usableLangs(info.subtitles);
  if (manual.length) return { lang: manual[0], auto: false };
  const auto = usableLangs(info.automatic_captions);
  if (auto.length) return { lang: auto[0], auto: true };
  return null;
}

function toSeconds(ts: string): number {
  // 00:01:02.345 / 01:02.345 / 00:01:02,345
  const parts = ts.trim().replace(',', '.').split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 纯函数:VTT / SRT → `[MM:SS] 文字` 多行(与 fetchYouTubeTranscript 同格式,字幕栏/翻译直接吃)。
 * 去掉 <c>/<00:00:01.000> 等行内标签;自动字幕常见「上一条的字又滚一遍」→ 跳过与上一条相同的文字。
 */
export function subtitleFileToTranscript(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let lastText = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*/);
    if (!m) continue;
    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) {
      if (/-->/.test(lines[j])) break;
      textLines.push(lines[j]);
      i = j;
    }
    const text = textLines
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text === lastText) continue;
    lastText = text;
    out.push(`[${fmt(toSeconds(m[1]))}] ${text}`);
  }
  return out.join('\n');
}

function stripCaptionMarkup(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\an\d\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 纯函数:电视滚动字幕(SRT)→ 一句一行的 `[MM:SS] 文字`。
 *
 * 滚动式(实测 6abc):每条显示 2~3 行,上面几行是前一条的重复,只有最底下是新的。
 *   → 每条只取「前一条末尾没出现过」的行(按最长重叠去掉重复的头部)
 *   → 碎行拼成句子:遇到句末标点 / 换人说话(`>>`)/ 过长就断句,时间取这句第一行出现的时刻。
 */
export function rollupCaptionsToTranscript(srt: string): string {
  const blocks = srt.replace(/\r/g, '').split(/\n\s*\n/);
  type Piece = { t: number; text: string };
  const pieces: Piece[] = [];
  let prev: string[] = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const ti = lines.findIndex((l) => /-->/.test(l));
    if (ti < 0) continue;
    const m = lines[ti].match(/^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/);
    if (!m) continue;
    const cur = lines.slice(ti + 1).map(stripCaptionMarkup).filter(Boolean);
    let k = Math.min(prev.length, cur.length);
    while (k > 0) {
      let same = true;
      for (let i = 0; i < k; i++) if (prev[prev.length - k + i] !== cur[i]) { same = false; break; }
      if (same) break;
      k--;
    }
    for (const text of cur.slice(k)) pieces.push({ t: toSeconds(m[1]), text });
    prev = cur;
  }

  const out: string[] = [];
  let buf: Piece[] = [];
  const flush = () => {
    if (buf.length) out.push(`[${fmt(buf[0].t)}] ${buf.map((p) => p.text).join(' ')}`);
    buf = [];
  };
  for (const p of pieces) {
    if (p.text.startsWith('>>') && buf.length) flush(); // 换人说话
    buf.push(p);
    const joined = buf.map((x) => x.text).join(' ');
    if (/[.?!]["'’”]?$/.test(p.text) || joined.length > 200) flush();
  }
  flush();
  return out.join('\n');
}

/** 视频流里嵌着的电视字幕(EIA-608):yt-dlp 下到临时目录 → ffmpeg 抽 SRT。没有返 null */
async function fetchEmbeddedCaptions(bin: string, url: string, dir: string): Promise<string | null> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    console.warn('[ytdlp subs] 没有 ffmpeg,查不了嵌入字幕');
    return null;
  }
  const t0 = Date.now();
  const dl = await run(bin, ['-q', '--no-warnings', '--no-playlist', '-f', 'b', '-o', path.join(dir, 'v.%(ext)s'), url], DOWNLOAD_TIMEOUT_MS);
  const video = readdirSync(dir).find((f) => f.startsWith('v.'));
  if (!video) {
    console.warn(`[ytdlp subs] 为查嵌入字幕下载视频失败 code=${dl.code} ${lastLine(dl.err)}`);
    return null;
  }
  // movie 滤镜的文件名在 cwd 里用相对名,免去路径里特殊字符的转义
  const ff = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `movie=${video}[out0+subcc]`, '-map', '0:1', 'cc.srt'], DOWNLOAD_TIMEOUT_MS, dir);
  let srt = '';
  try { srt = readFileSync(path.join(dir, 'cc.srt'), 'utf-8'); } catch { /* 没产出 = 没有嵌入字幕 */ }
  const text = srt ? rollupCaptionsToTranscript(srt) : '';
  console.log(`[ytdlp subs] 嵌入字幕 ${text ? `✓ ${text.split('\n').length} 句` : `无(ffmpeg code=${ff.code} ${lastLine(ff.err)})`}(${Date.now() - t0}ms)`);
  return text || null;
}

function run(
  bin: string,
  args: string[],
  timeoutMs = PROBE_TIMEOUT_MS,
  cwd?: string,
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, cwd ? { cwd } : undefined);
    let out = '';
    let err = '';
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function lastLine(s: string): string {
  return s.trim().split('\n').pop() ?? '';
}

export async function fetchSubtitlesViaYtdlp(
  url: string,
): Promise<{ transcriptText: string | null; error: string | null }> {
  const bin = getYtdlpPath();
  if (!bin) return { transcriptText: null, error: '需要先装 yt-dlp(点一次 ⬇ 下载按钮会自动装)' };

  // 1. 问字幕清单
  const probe = await run(bin, ['-J', '--skip-download', '--no-warnings', '--no-playlist', url]);
  if (probe.code !== 0) {
    console.warn(`[ytdlp subs] 读视频信息失败 code=${probe.code} ${lastLine(probe.err)} url=${url}`);
    return { transcriptText: null, error: `读不到视频信息:${lastLine(probe.err) || '未知错误'}` };
  }
  let info: { subtitles?: SubMap; automatic_captions?: SubMap; entries?: unknown[] };
  try {
    info = JSON.parse(probe.out);
  } catch {
    return { transcriptText: null, error: '视频信息格式不对' };
  }
  if (Array.isArray(info.entries) && info.entries[0]) info = info.entries[0] as typeof info;
  const picked = pickSubtitle(info);
  const dir = mkdtempSync(path.join(tmpdir(), 'krig-subs-'));
  try {
    if (!picked) {
      // 没有独立字幕轨 → 看视频流里嵌着的电视字幕(CC)
      const embedded = await fetchEmbeddedCaptions(bin, url, dir);
      if (embedded) return { transcriptText: embedded, error: null };
      console.log(`[ytdlp subs] 没有字幕轨也没有嵌入字幕 url=${url}`);
      return { transcriptText: null, error: '这个视频没有字幕(没有字幕文件,视频里也没嵌字幕;语音识别以后加)' };
    }

    // 2. 让 yt-dlp 下这一份(自动字幕可能是分段清单,只有它会拼)
    const dl = await run(bin, [
      '--skip-download', '--no-warnings', '--no-playlist',
      picked.auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs', picked.lang,
      '--sub-format', 'vtt/srt/best',
      '-o', path.join(dir, 'sub'),
      url,
    ]);
    const file = readdirSync(dir).find((f) => /\.(vtt|srt)$/i.test(f));
    if (!file) {
      console.warn(`[ytdlp subs] 下载字幕没有得到 vtt/srt code=${dl.code} files=${readdirSync(dir).join(',')} ${lastLine(dl.err)}`);
      return { transcriptText: null, error: `字幕下载失败:${lastLine(dl.err) || '没有可读的字幕文件'}` };
    }
    const transcriptText = subtitleFileToTranscript(readFileSync(path.join(dir, file), 'utf-8'));
    if (!transcriptText) return { transcriptText: null, error: '字幕文件是空的' };
    console.log(`[ytdlp subs] ✓ ${picked.auto ? '自动' : '人工'}字幕 ${picked.lang},${transcriptText.split('\n').length} 行 url=${url}`);
    return { transcriptText, error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
