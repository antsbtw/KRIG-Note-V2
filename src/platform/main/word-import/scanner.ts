/**
 * docx 文件扫描器 — converter.ts(mammoth)和 converter-pandoc.ts 共用
 *
 * 职责:接收路径数组(文件 / 目录混选),递归找出所有 .docx,跳过隐藏文件/常见黑名单目录。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ScannedDocx {
  absPath: string;
  relPath: string;
}

export interface ScanFailure {
  path: string;
  reason: string;
}

const DIR_BLACKLIST = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);

export function isDocxFile(name: string): boolean {
  return path.extname(name).toLowerCase() === '.docx';
}

export function replaceDocxExtWithMd(relPath: string): string {
  return relPath.replace(/\.docx$/i, '.md');
}

/** 接收路径数组(可能含目录),递归找出所有 .docx */
export async function scanDocxPaths(paths: string[]): Promise<{
  files: ScannedDocx[];
  failed: ScanFailure[];
}> {
  const files: ScannedDocx[] = [];
  const failed: ScanFailure[] = [];

  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        await walkDirForDocx(p, path.basename(p), files, failed);
      } else if (stat.isFile() && isDocxFile(p)) {
        files.push({ absPath: p, relPath: path.basename(p) });
      } else if (stat.isFile()) {
        failed.push({ path: p, reason: 'not a .docx file' });
      }
    } catch (err) {
      failed.push({ path: p, reason: String(err) });
    }
  }

  return { files, failed };
}

async function walkDirForDocx(
  rootAbs: string,
  rootSegment: string,
  out: ScannedDocx[],
  failed: ScanFailure[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch (err) {
    failed.push({ path: rootAbs, reason: String(err) });
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    const childAbs = path.join(rootAbs, name);

    if (entry.isDirectory()) {
      if (DIR_BLACKLIST.has(name) || name.startsWith('.')) continue;
      await walkDirForDocx(childAbs, `${rootSegment}/${name}`, out, failed);
      continue;
    }

    if (!entry.isFile()) continue;
    if (name.startsWith('.')) continue;
    if (!isDocxFile(name)) continue;

    out.push({ absPath: childAbs, relPath: `${rootSegment}/${name}` });
  }
}
