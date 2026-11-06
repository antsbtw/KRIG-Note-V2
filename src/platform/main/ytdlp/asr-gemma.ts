/**
 * 没有任何字幕的视频 → 本机 Gemma 4 听写成字幕(试用版,2026-11-05)
 *
 * ── 真机实验(6abc 新闻视频,gemma4:12b,Ollama 0.32.1)──
 *  - 25 秒一段:5 段内容基本都对,每段 7~8 秒(约 3 倍于播放速度)
 *  - **切口处会听坏**:一个词被切成两半就错(「Wi-Fi hotspot」→「I've had a heart spot」)
 *    → 切点选在**说话停顿处**(ffmpeg silencedetect),每段 15~30 秒
 *  - **前面垫静音反而开始编内容**(重复句子、凭空多出原文没有的话)→ 不垫
 *  - 让它按句标时间:瞎标([00][01][02]… 一句一秒)→ **不用它标**;段起点准,段内按字数比例估
 *  - 人名会听错(Nydia Han → Nadia Khan)→ 结果必须标明「AI 识别,可能有误」
 *
 * 模型不在 / Ollama 没开 → fail loud,如实告诉用户。
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { callOllamaChat } from '../local-llm/ollama-client';

export const ASR_MODEL = 'gemma4:12b';
const CHUNK_TARGET_S = 25;
const CHUNK_MIN_S = 15;
const CHUNK_MAX_S = 30;
const PER_CHUNK_TIMEOUT_MS = 180_000;

const PROMPT =
  'Transcribe the speech in this audio exactly and completely, in its original language. ' +
  'Output only the transcript text, no speaker labels, no quotes, no commentary.';

export interface Silence { start: number; end: number }

/**
 * 纯函数:按停顿切段。从当前起点往后,在 [起点+MIN, 起点+MAX] 里找离 起点+TARGET 最近的停顿中点;
 * 没有停顿就硬切在 起点+TARGET。最后一段不足 MIN 秒就并进上一段(只要合并后不超过 MAX+MIN)。
 */
export function planChunks(duration: number, silences: readonly Silence[]): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 0;
  while (duration - start > CHUNK_MAX_S) {
    const target = start + CHUNK_TARGET_S;
    let cut = target;
    let best = Infinity;
    for (const s of silences) {
      const mid = (s.start + s.end) / 2;
      if (mid < start + CHUNK_MIN_S || mid > start + CHUNK_MAX_S) continue;
      const d = Math.abs(mid - target);
      if (d < best) { best = d; cut = mid; }
    }
    chunks.push([start, cut]);
    start = cut;
  }
  if (duration - start > 0.5) chunks.push([start, duration]);
  return chunks;
}

/** 纯函数:解析 ffmpeg silencedetect 的 stderr */
export function parseSilences(stderr: string): Silence[] {
  const out: Silence[] = [];
  let pending: number | null = null;
  for (const line of stderr.split('\n')) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (a) { pending = Math.max(0, parseFloat(a[1])); continue; }
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (b && pending !== null) { out.push({ start: pending, end: parseFloat(b[1]) }); pending = null; }
  }
  return out;
}

export function parseDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function fmt(sec: number): string {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 纯函数:一段听写文字 → 一句一行 `[MM:SS] 句子`。
 * 段起点是准的;段内每句的时间按它在全段文字里的位置(字数比例)估。
 */
export function chunkTextToLines(text: string, start: number, end: number): string[] {
  const clean = text.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.?!。？！]+[.?!。？！]+|[^.?!。？！]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const total = clean.length;
  let offset = 0;
  return sentences.map((s) => {
    const at = clean.indexOf(s, offset);
    offset = at >= 0 ? at + s.length : offset + s.length;
    const t = start + ((at >= 0 ? at : 0) / total) * (end - start);
    return `[${fmt(t)}] ${s}`;
  });
}

function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd });
    let err = '';
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, err: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

/**
 * 听写一个本地视频/音频文件(在 dir 里)。成功返 `[MM:SS] 句子` 多行;失败返 reason。
 */
export async function transcribeWithGemma(
  ffmpeg: string,
  dir: string,
  mediaFile: string,
): Promise<{ text: string } | { reason: string }> {
  const t0 = Date.now();
  // 1. 抽成 16k 单声道 wav + 顺带拿时长;再找停顿
  const ex = await run(ffmpeg, ['-hide_banner', '-y', '-i', mediaFile, '-vn', '-ac', '1', '-ar', '16000', 'asr.wav'], dir, 600_000);
  const duration = parseDuration(ex.err);
  if (ex.code !== 0 || !duration) return { reason: `抽音频失败:${ex.err.trim().split('\n').pop() ?? ''}` };
  const sd = await run(ffmpeg, ['-hide_banner', '-i', 'asr.wav', '-af', 'silencedetect=noise=-30dB:d=0.3', '-f', 'null', '-'], dir, 600_000);
  const chunks = planChunks(duration, parseSilences(sd.err));

  // 2. 逐段听写(串行:本机一个模型,并发只会互相抢)
  const lines: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const [s, e] = chunks[i];
    const name = `asr-${i}.wav`;
    const cut = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(s), '-t', String(e - s), '-i', 'asr.wav', name], dir, 120_000);
    if (cut.code !== 0) return { reason: `切第 ${i + 1} 段失败:${cut.err.trim()}` };
    const b64 = readFileSync(path.join(dir, name)).toString('base64');
    const tc = Date.now();
    let content: string;
    try {
      const r = await callOllamaChat({
        model: ASR_MODEL,
        think: false,
        temperature: 0,
        timeoutMs: PER_CHUNK_TIMEOUT_MS,
        messages: [{ role: 'user', content: PROMPT, images: [b64] }],
      });
      content = r.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[asr-gemma] 第 ${i + 1}/${chunks.length} 段失败:${msg}`);
      return { reason: /fetch failed|ECONNREFUSED/i.test(msg)
        ? 'Ollama 没在运行(本机 AI 识别需要先打开 Ollama)'
        : /not found/i.test(msg) ? `本机 Ollama 没有 ${ASR_MODEL} 模型` : `AI 识别失败:${msg}` };
    }
    const segLines = chunkTextToLines(content, s, e);
    console.log(`[asr-gemma] 第 ${i + 1}/${chunks.length} 段 ${fmt(s)}-${fmt(e)} → ${segLines.length} 句(${Date.now() - tc}ms)`);
    lines.push(...segLines);
  }
  console.log(`[asr-gemma] ✓ ${chunks.length} 段 ${lines.length} 句,视频 ${Math.round(duration)}s,用时 ${Date.now() - t0}ms`);
  if (!lines.length) return { reason: 'AI 没听出任何话(可能是纯音乐或无人声)' };
  return { text: lines.join('\n') };
}
