/**
 * yt-dlp Binary Manager — 下载、安装、版本检测(L5-B3.17)
 *
 * V1 → V2 直迁:src/main/ytdlp/binary-manager.ts(V1 86 行,行为不变)
 *
 * 存储位置:{userData}/bin/yt-dlp
 * 下载源:GitHub Releases(macOS universal binary,~22MB,无需 Python)
 *
 * 平台限制:本阶段沿用 V1,仅支持 macOS。Windows/Linux 用户调 install 会因
 * URL 不匹配而下载失败的 binary(execFile 探测时 checkStatus 返回 installed:false)。
 * 跨平台支持留 Phase E。
 *
 * 安装防重入(决策 Q3):main 侧维护 installPromise 单例,二次调用返回相同 promise。
 */

import { app, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, execSync } from 'child_process';

const BIN_DIR = path.join(app.getPath('userData'), 'bin');
const YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp');
const DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

export interface YtdlpStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

/** 检查 yt-dlp 是否已安装 + 版本号(execFile 探测,确保二进制可执行)*/
export async function checkStatus(): Promise<YtdlpStatus> {
  if (!fs.existsSync(YTDLP_PATH)) {
    return { installed: false };
  }
  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile(YTDLP_PATH, ['--version'], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return { installed: true, version, path: YTDLP_PATH };
  } catch {
    return { installed: false };
  }
}

// 安装防重入:同时只允许一个 install 进行中,后续调用复用同 promise
let installPromise: Promise<YtdlpStatus> | null = null;

/**
 * 下载并安装 yt-dlp 二进制(从 GitHub release latest)
 *
 * @param onProgress 进度 callback(0-100)— 每个 chunk 触发一次
 */
export async function install(
  onProgress?: (percent: number) => void,
): Promise<YtdlpStatus> {
  if (installPromise) return installPromise;

  installPromise = doInstall(onProgress).finally(() => {
    installPromise = null;
  });
  return installPromise;
}

async function doInstall(
  onProgress?: (percent: number) => void,
): Promise<YtdlpStatus> {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const response = await net.fetch(DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloadedBytes += value.length;
    if (totalBytes > 0 && onProgress) {
      onProgress(Math.round((downloadedBytes / totalBytes) * 100));
    }
  }

  // 合并 chunks 写入文件
  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(YTDLP_PATH, buffer);
  fs.chmodSync(YTDLP_PATH, 0o755);

  // macOS:移除 Gatekeeper 隔离属性,允许 spawn 执行
  try {
    execSync(`xattr -dr com.apple.quarantine "${YTDLP_PATH}"`, { stdio: 'ignore' });
  } catch {
    /* 非 macOS 或 xattr 不存在时静默忽略 */
  }

  return checkStatus();
}

/** 获取 binary 路径(未安装返回 null)*/
export function getYtdlpPath(): string | null {
  return fs.existsSync(YTDLP_PATH) ? YTDLP_PATH : null;
}
