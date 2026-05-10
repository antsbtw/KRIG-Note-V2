/**
 * yt-dlp Downloader — 视频下载 + 元数据获取 + 字幕保存(L5-B3.17)
 *
 * V1 → V2 直迁:src/main/ytdlp/downloader.ts(V1 182 行,行为不变)
 *
 * 三个对外函数:
 * - downloadVideo:spawn yt-dlp 下载视频,自动抓 YouTube 字幕保存为 .en.srt
 * - saveTranslationSubtitle:用户翻译字幕(timestampText 格式)→ .<lang>.srt
 * - getVideoInfo:--dump-json 取 metadata 不下载
 *
 * SRT 工具(formatSrtTime / segmentsToSrt / timestampTextToSrt)是内部辅助。
 *
 * 依赖 npm:youtube-transcript(用于自动抓 YouTube 字幕)— 决策 Q5 = A 装上。
 * 这是 ytdlp capability 内部细节,不暴露到 view 层(决策 Q5 P2-3 约束)。
 */

import { app } from 'electron';
import { spawn } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { getYtdlpPath } from './binary-manager';
import { fetchTranscript } from 'youtube-transcript';
// ffmpeg-static 提供 npm install 时自动下载的当前平台 + 架构 ffmpeg binary
// (macOS arm64 / x64,Linux x64 / arm64,Windows x64 全覆盖,~45MB)。
// yt-dlp 用 --ffmpeg-location 调它合并 DASH 分流(720p+ 必需)。

/**
 * 找到 ffmpeg-static 二进制路径。
 *
 * 不能直接 import ffmpeg-static!该包返回 path.join(__dirname, 'ffmpeg'),
 * Vite bundling main 进程时把 __dirname 改成 .vite/build/,导致
 * 路径变成 .vite/build/ffmpeg(不存在)。
 *
 * 走 app.getAppPath() + node_modules 显式构造,dev / 打包 都可靠:
 * - dev:    /<project>/node_modules/ffmpeg-static/ffmpeg
 * - 打包后:  /<app>/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
 *           (forge.config asar.unpack 已配)
 */
function getFfmpegPath(): string | null {
  const appPath = app.getAppPath();
  console.log('[ffmpeg path] app.getAppPath() =', appPath);
  // 打包后 appPath 是 app.asar 路径,需要走 asar.unpack
  const candidates = [
    // dev 环境
    join(appPath, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    // 打包后(asar.unpack 自动重定向)
    join(appPath.replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ];
  for (const p of candidates) {
    console.log('[ffmpeg path] checking:', p, 'exists:', existsSync(p));
    if (existsSync(p)) return p;
  }
  console.warn('[ffmpeg path] none of candidates exist — ffmpeg not available');
  return null;
}

export interface DownloadProgress {
  url: string;
  status: 'downloading' | 'complete' | 'error';
  percent: number;
  filename?: string;
  subtitleFile?: string;     // 原文字幕 .srt 路径
  subtitleText?: string;     // 原文字幕文本([MM:SS] 格式)
  error?: string;
}

// ── SRT 格式工具 ──

function formatSrtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const msRem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRem).padStart(3, '0')}`;
}

function segmentsToSrt(segments: Array<{ text: string; offset: number; duration: number }>): string {
  return segments
    .map((seg, i) => {
      const start = formatSrtTime(seg.offset);
      const end = formatSrtTime(seg.offset + seg.duration);
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join('\n');
}

function timestampTextToSrt(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim());
  const entries: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)/);
    if (!m) continue;
    const startSec =
      m[3] !== undefined
        ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
        : parseInt(m[1]) * 60 + parseInt(m[2]);
    // 估算结束时间:下一条的开始,或 +5s
    let endSec = startSec + 5;
    if (i + 1 < lines.length) {
      const nextM = lines[i + 1].match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
      if (nextM) {
        endSec =
          nextM[3] !== undefined
            ? parseInt(nextM[1]) * 3600 + parseInt(nextM[2]) * 60 + parseInt(nextM[3])
            : parseInt(nextM[1]) * 60 + parseInt(nextM[2]);
      }
    }
    const start = formatSrtTime(startSec * 1000);
    const end = formatSrtTime(endSec * 1000);
    entries.push(`${entries.length + 1}\n${start} --> ${end}\n${m[4]}\n`);
  }
  return entries.join('\n');
}

/** 下载视频,自动下载 YouTube 字幕(走 youtube-transcript)*/
export async function downloadVideo(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  outputPath?: string,
): Promise<DownloadProgress> {
  const binPath = getYtdlpPath();
  if (!binPath) {
    return { url, status: 'error', percent: 0, error: 'yt-dlp not installed' };
  }

  const outputTemplate = outputPath || join(app.getPath('downloads'), '%(title)s.%(ext)s');

  return new Promise((resolve) => {
    let lastPercent = 0;
    let downloadedFilename: string | undefined = outputPath || undefined;

    const ffmpegPath = getFfmpegPath();

    // format 选择优先级(从高到低,带 ffmpeg 时拿 720p+ DASH 合并):
    // 1. bv*[height<=?720]+ba — best video-only ≤720p + best audio-only,yt-dlp 调
    //    ffmpeg 合并(YouTube 720p+ 都是 DASH 分流必需 ffmpeg)
    // 2. best[ext=mp4]       — 单文件 mp4 兜底(360p,无需 ffmpeg)
    // 3. best                — 任意源(非 YouTube 直链等)
    //
    // 没装 ffmpeg(ffmpegPath null,不太可能 — ffmpeg-static 内置)yt-dlp
    // 自动跳过 #1 走 #2,降级到 360p 单文件。
    const formatSelector = ffmpegPath
      ? 'bv*[height<=?720]+ba/best[ext=mp4]/best'
      : 'best[ext=mp4]/best';

    const args = [
      '-f',
      formatSelector,
      '--no-mtime',
      '--no-check-certificates',
      // 只下当前视频,忽略 URL 里的 &list=... 播放列表参数
      // (否则 YouTube radio mix 之类会下载几百个视频)
      '--no-playlist',
      // 合并输出统一为 mp4(DASH 合并默认 mkv,我们要 mp4 让 video-block 直播)
      '--merge-output-format',
      'mp4',
      '-o',
      outputTemplate,
      url,
    ];

    // 把 ffmpeg-static 路径传给 yt-dlp(让它做 video+audio 合并)
    if (ffmpegPath) {
      args.unshift('--ffmpeg-location', ffmpegPath);
    }

    console.log('[ytdlp download] spawning yt-dlp:', binPath, 'args:', args.join(' '));
    const proc = spawn(binPath, args);

    const parseLine = (line: string): void => {
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (progressMatch) {
        lastPercent = parseFloat(progressMatch[1]);
        onProgress?.({ url, status: 'downloading', percent: lastPercent });
      }
      const destMatch = line.match(/\[download\] Destination:\s+(.+)/);
      if (destMatch) downloadedFilename = destMatch[1].trim();
      const existsMatch = line.match(/\[download\]\s+(.+) has already been downloaded/);
      if (existsMatch) downloadedFilename = existsMatch[1].trim();
      const mergerMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergerMatch) downloadedFilename = mergerMatch[1].trim();
    };

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      // 实时把 yt-dlp stdout 也打印到主进程终端,看是不是 stuck
      process.stdout.write('[yt-dlp stdout] ' + text);
      parseLine(text);
    });
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write('[yt-dlp stderr] ' + text);
      parseLine(text);
    });

    proc.on('error', (err) => {
      console.error('[ytdlp download] spawn error:', err);
    });

    proc.on('close', async (code) => {
      console.log('[ytdlp download] yt-dlp closed, exit code=', code);
      if (code !== 0) {
        resolve({ url, status: 'error', percent: lastPercent, error: `yt-dlp exited with code ${code}` });
        return;
      }

      // 下载字幕并保存为 .srt 文件
      let subtitleText: string | undefined;
      let subtitleFile: string | undefined;
      try {
        const segments = await fetchTranscript(url);
        if (segments && segments.length > 0) {
          // 生成 [MM:SS] 格式文本
          subtitleText = segments
            .map((seg: { text: string; offset: number }) => {
              const s = Math.floor(seg.offset / 1000);
              const mm = String(Math.floor(s / 60)).padStart(2, '0');
              const ss = String(s % 60).padStart(2, '0');
              return `[${mm}:${ss}] ${seg.text}`;
            })
            .join('\n');

          // 保存为 .en.srt(和视频同目录)
          if (downloadedFilename) {
            const dir = dirname(downloadedFilename);
            const base = basename(downloadedFilename, extname(downloadedFilename));
            subtitleFile = join(dir, `${base}.en.srt`);
            const srtContent = segmentsToSrt(
              segments as Array<{ text: string; offset: number; duration: number }>,
            );
            writeFileSync(subtitleFile, srtContent, 'utf-8');
          }
        }
      } catch {
        /* fetchTranscript 失败:某些视频禁用字幕或不支持语言 — 不影响视频下载本身 */
      }

      resolve({
        url,
        status: 'complete',
        percent: 100,
        filename: downloadedFilename,
        subtitleFile,
        subtitleText,
      });
    });

    proc.on('error', (err) => {
      resolve({ url, status: 'error', percent: 0, error: err.message });
    });
  });
}

/** 保存翻译字幕为 .srt 文件(timestampText [MM:SS] 文本 → .srt 标准格式)*/
export function saveTranslationSubtitle(
  videoFilePath: string,
  langCode: string,
  timestampText: string,
): string {
  const dir = dirname(videoFilePath);
  const base = basename(videoFilePath, extname(videoFilePath));
  const srtPath = join(dir, `${base}.${langCode}.srt`);
  const srtContent = timestampTextToSrt(timestampText);
  writeFileSync(srtPath, srtContent, 'utf-8');
  return srtPath;
}

/** 获取视频元数据(--dump-json,不下载)*/
export async function getVideoInfo(url: string): Promise<Record<string, unknown> | null> {
  const binPath = getYtdlpPath();
  if (!binPath) return null;

  return new Promise((resolve) => {
    const proc = spawn(binPath, ['--dump-json', '--no-download', url]);
    let output = '';

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}
