/**
 * pandoc 二进制探测(主进程)
 *
 * 用于"高质量 Word 导入"路径(Pandoc-first + mammoth fallback)。
 *
 * 探测策略(按优先级):
 * 1. 进程级缓存(同会话只探一次)
 * 2. `which pandoc` / `where pandoc`(Windows)— 注意 Electron 生产环境 PATH 极简,
 *    通常只有 /usr/bin:/bin:/usr/sbin:/sbin,不含 /opt/homebrew/bin
 * 3. 已知路径白名单(覆盖 macOS Intel/M1 brew + Linux + Windows 常见装路径)
 *
 * 返回结构清晰:available + path + version + reason。
 * 失败时 reason 字段给具体诊断信息(用于上层友好弹窗引导)。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PandocStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  /** 探测失败原因(仅 available=false 时有意义)*/
  reason?: string;
}

const IS_WINDOWS = process.platform === 'win32';

/** 已知路径白名单 — Electron 生产 PATH 不含这些,必须显式 fallback */
const KNOWN_PATHS: readonly string[] = IS_WINDOWS
  ? [
      'C:\\Program Files\\Pandoc\\pandoc.exe',
      'C:\\Program Files (x86)\\Pandoc\\pandoc.exe',
    ]
  : [
      '/opt/homebrew/bin/pandoc', // macOS Apple Silicon brew
      '/usr/local/bin/pandoc',    // macOS Intel brew / 通用 manual install
      '/usr/bin/pandoc',          // Linux apt/yum
      '/opt/pandoc/bin/pandoc',   // tarball install
    ];

let cached: PandocStatus | null = null;

/**
 * 探测 pandoc 是否可用。结果按进程缓存(用户装好后菜单二次点击立即生效需调 resetCache)。
 */
export async function detectPandoc(): Promise<PandocStatus> {
  if (cached) return cached;

  // 1. which / where 探测(用 execFile 不依赖 shell PATH 跑 which 本身)
  const fromWhich = await probeViaWhich();
  if (fromWhich) {
    cached = fromWhich;
    return cached;
  }

  // 2. 已知路径白名单
  for (const candidate of KNOWN_PATHS) {
    if (existsSync(candidate)) {
      const version = await readVersion(candidate);
      if (version) {
        cached = { available: true, path: candidate, version };
        return cached;
      }
    }
  }

  cached = {
    available: false,
    path: null,
    version: null,
    reason: 'pandoc not found in PATH or known install locations',
  };
  return cached;
}

/** 强制重新探测(用户装好后立即生效)*/
export function resetPandocDetectionCache(): void {
  cached = null;
}

async function probeViaWhich(): Promise<PandocStatus | null> {
  const probeCmd = IS_WINDOWS ? 'where' : '/usr/bin/which';
  try {
    const { stdout } = await execFileAsync(probeCmd, ['pandoc'], {
      timeout: 3000,
    });
    const firstLine = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!firstLine) return null;
    if (!existsSync(firstLine)) return null;

    const version = await readVersion(firstLine);
    if (!version) return null;
    return { available: true, path: firstLine, version };
  } catch {
    return null;
  }
}

async function readVersion(absPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(absPath, ['--version'], {
      timeout: 3000,
    });
    // 第一行格式:`pandoc 3.9.0.2`
    const firstLine = stdout.split(/\r?\n/)[0]?.trim() ?? '';
    const match = /^pandoc\s+([\d.]+)/i.exec(firstLine);
    return match ? match[1] : firstLine || null;
  } catch {
    return null;
  }
}
