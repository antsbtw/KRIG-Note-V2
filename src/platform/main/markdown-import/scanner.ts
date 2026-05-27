/**
 * markdown-import scanner — 把用户选中的文件/目录扁平成 ScannedFile[]
 *
 * 输入:dialog.showOpenDialog 返回的 paths(可混选文件 + 目录,macOS 支持)
 * 输出:扁平 ScannedFile 列表(每条带相对路径,renderer 用相对路径重建 folder 树)
 *
 * 规则:
 * - 单文件:directly read,relPath = basename(file)
 * - 目录:递归扫描,relPath 是相对该目录根的路径(目录名作为 root segment)
 * - 黑名单目录:.git / node_modules / dist / build / 任何 . 开头
 * - 黑名单文件:.DS_Store / Thumbs.db / 任何 . 开头
 * - 只接收 .md / .markdown 扩展
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ScannedFile {
  /** 文件绝对路径(诊断 / 调试用)*/
  absPath: string;
  /** 相对路径,segment 用 '/' 分隔。
   *  - 单文件场景:basename(eg "foo.md")
   *  - 目录场景:目录名 + 子路径(eg "docs/refactor/00-总纲.md") */
  relPath: string;
  /** 文件内容(UTF-8 文本) */
  content: string;
}

export interface ScanReport {
  files: ScannedFile[];
  /** 被黑名单跳过的路径 */
  skipped: string[];
  /** 读取失败的路径 */
  failed: Array<{ path: string; reason: string }>;
}

const DIR_BLACKLIST = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);
const FILE_BLACKLIST = new Set(['.DS_Store', 'Thumbs.db']);
const MD_EXTENSIONS = new Set(['.md', '.markdown']);

function isMarkdownFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return MD_EXTENSIONS.has(ext);
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** 递归扫描目录,产出 markdown 文件相对路径 */
function walkDirectory(
  rootAbsPath: string,
  rootSegment: string,
  report: ScanReport,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootAbsPath, { withFileTypes: true });
  } catch (err) {
    report.failed.push({ path: rootAbsPath, reason: String(err) });
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    const childAbs = path.join(rootAbsPath, name);

    if (entry.isDirectory()) {
      if (DIR_BLACKLIST.has(name) || isHiddenName(name)) {
        report.skipped.push(childAbs);
        continue;
      }
      walkDirectory(childAbs, `${rootSegment}/${name}`, report);
      continue;
    }

    if (!entry.isFile()) {
      report.skipped.push(childAbs);
      continue;
    }

    if (FILE_BLACKLIST.has(name) || isHiddenName(name)) {
      report.skipped.push(childAbs);
      continue;
    }

    if (!isMarkdownFile(name)) {
      report.skipped.push(childAbs);
      continue;
    }

    try {
      const content = fs.readFileSync(childAbs, 'utf-8');
      report.files.push({
        absPath: childAbs,
        relPath: `${rootSegment}/${name}`,
        content,
      });
    } catch (err) {
      report.failed.push({ path: childAbs, reason: String(err) });
    }
  }
}

/** 扁平扫描:接收 dialog 返回的 paths 数组,统一产 ScannedFile[] */
export function scanPaths(paths: string[]): ScanReport {
  const report: ScanReport = { files: [], skipped: [], failed: [] };

  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch (err) {
      report.failed.push({ path: p, reason: String(err) });
      continue;
    }

    if (stat.isDirectory()) {
      const rootName = path.basename(p);
      walkDirectory(p, rootName, report);
      continue;
    }

    if (stat.isFile()) {
      const name = path.basename(p);
      if (!isMarkdownFile(name)) {
        report.skipped.push(p);
        continue;
      }
      try {
        const content = fs.readFileSync(p, 'utf-8');
        report.files.push({ absPath: p, relPath: name, content });
      } catch (err) {
        report.failed.push({ path: p, reason: String(err) });
      }
    }
  }

  return report;
}
