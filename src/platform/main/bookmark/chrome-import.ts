/**
 * Chrome 书签导入(web 书签步骤3 · feat/web-downloads)
 *
 * 从 Chrome 的 `Bookmarks` JSON 文件导入书签 + 文件夹,**完整保留 Chrome 文件夹层级**,
 * 落库到步骤1 的 bookmark / folder capability(viewType='web')。
 *
 * 两块:
 * 1. parseChromeBookmarks(json):纯函数,递归走 roots.bookmark_bar / other /(synced)
 *    的 children,folder → ParsedFolder,url → ParsedBookmark。不碰 fs / capability,可单测。
 * 2. importChromeBookmarks(mainWindow):主进程流程 —— 默认路径 fs.existsSync → 不存在弹
 *    dialog → readFile + JSON.parse + parse → **主进程直调 main 端 capability-impl 落库**
 *    (createFolder 维护 tempId→realId 映射,再 add bookmark)→ broadcast folder + bookmark
 *    onListChanged 刷新 NavSide。
 *
 * 设计决策(实现包 §4.1):
 * - **bookmark_bar / other / synced 各作一个顶层 folder 建**(名取 Chrome 的 name,如
 *   "书签栏" / "其他书签"),其下 children 递归 —— 完整保留 Chrome 结构。
 * - **不去重**(MVP):多次导入产生重复书签 / folder,用户可手动删(登记在汇报)。
 *
 * 坑:
 * - Chrome 文件**无扩展名**:dialog filters 用 'All Files' (*),别挡住 Bookmarks 文件。
 * - JSON 兜底:缺 children 当空、缺 name 用 url host、非 url/folder type 跳过,别因脏数据崩。
 * - 层级顺序:先建 parent folder 再建 child(parentTempId → realId);bookmark 最后建。
 * - broadcast:导入完必须 folder + bookmark 两条 onListChanged,否则 NavSide 不刷新。
 */

import { dialog, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { add } from './capability-impl';
import { createFolder } from '../folder/capability-impl';
import { broadcastBookmarkListChanged } from './broadcast';
import { broadcastFolderListChanged } from '../folder/broadcast';

// ── 解析产物类型 ──

/** 解析出的 folder(tempId 临时,落库后映射真实 folderId) */
export interface ParsedFolder {
  tempId: string;
  name: string;
  /** null = 顶层(无 parent) */
  parentTempId: string | null;
}

/** 解析出的书签(parentTempId 映射所属 folder 的临时 id;null = 根) */
export interface ParsedBookmark {
  url: string;
  title: string;
  parentTempId: string | null;
}

export interface ParsedChromeBookmarks {
  folders: ParsedFolder[];
  bookmarks: ParsedBookmark[];
}

// ── 解析纯函数 ──

/** 从 url 兜底取 host 作标题(name 缺失时用) */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Chrome 节点的窄化辅助(脏数据兜底,字段缺失不崩) */
interface ChromeNode {
  type?: unknown;
  name?: unknown;
  url?: unknown;
  children?: unknown;
}

function asNode(v: unknown): ChromeNode | null {
  return v && typeof v === 'object' ? (v as ChromeNode) : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * 递归解析一个 Chrome 节点的 children,把 folder / url 收集进 out。
 * @param children 当前节点的 children(unknown,兜底当空)
 * @param parentTempId 当前 children 所属 folder 的 tempId
 * @param out 收集器
 * @param nextId tempId 自增器(闭包共享)
 */
function walkChildren(
  children: unknown,
  parentTempId: string | null,
  out: ParsedChromeBookmarks,
  nextId: () => string,
): void {
  if (!Array.isArray(children)) return; // 缺 children / 非数组 → 当空
  for (const raw of children) {
    const node = asNode(raw);
    if (!node) continue; // 脏元素跳过
    const type = asString(node.type);
    if (type === 'folder') {
      const tempId = nextId();
      const name = asString(node.name) || 'Untitled folder';
      out.folders.push({ tempId, name, parentTempId });
      // 递归子树(缺 children → walkChildren 内当空)
      walkChildren(node.children, tempId, out, nextId);
    } else if (type === 'url') {
      const url = asString(node.url);
      if (!url) continue; // url 节点缺 url → 跳过(无法落库)
      const title = asString(node.name) || hostFromUrl(url);
      out.bookmarks.push({ url, title, parentTempId });
    }
    // 其它 type(脏数据 / 未来字段)→ 跳过
  }
}

/**
 * 解析 Chrome Bookmarks JSON(已 JSON.parse 的对象)。
 *
 * 把 roots 下每个顶层 root(bookmark_bar / other / synced ...)各作一个**顶层 folder**
 * 建(name 取 root.name,如 "书签栏"),其下 children 递归。完整保留 Chrome 层级。
 *
 * 纯函数:不碰 fs / capability。脏数据兜底(缺字段不崩)。
 */
export function parseChromeBookmarks(json: unknown): ParsedChromeBookmarks {
  const out: ParsedChromeBookmarks = { folders: [], bookmarks: [] };

  const root = asNode(json);
  const roots = root ? asNode((root as Record<string, unknown>).roots) : null;
  if (!roots) return out; // 无 roots → 空结果(不崩)

  let counter = 0;
  const nextId = (): string => `t${counter++}`;

  // 顶层 roots 遍历:bookmark_bar / other / synced(及任意其它 key 兜底)。
  // 顺序固定常见三个在前,保证导入结果稳定。
  const knownKeys = ['bookmark_bar', 'other', 'synced'];
  const rootRecord = roots as Record<string, unknown>;
  const seen = new Set<string>();
  const orderedKeys = [
    ...knownKeys.filter((k) => k in rootRecord),
    ...Object.keys(rootRecord).filter((k) => !knownKeys.includes(k)),
  ];

  for (const key of orderedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const rootNode = asNode(rootRecord[key]);
    if (!rootNode) continue;
    if (asString(rootNode.type) !== 'folder') continue; // 顶层非 folder 跳过
    const tempId = nextId();
    const name = asString(rootNode.name) || key;
    out.folders.push({ tempId, name, parentTempId: null });
    walkChildren(rootNode.children, tempId, out, nextId);
  }

  return out;
}

// ── 主进程导入流程 ──

/** Chrome 默认书签路径(macOS):~/Library/Application Support/Google/Chrome/Default/Bookmarks */
function defaultChromeBookmarksPath(): string {
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'Default',
    'Bookmarks',
  );
}

/**
 * 让用户手选 Bookmarks 文件(默认路径不存在时)。
 * filters 用 'All Files' (*) —— Chrome 文件无扩展名,具体扩展名会挡住它。
 */
async function pickBookmarksFile(focused: BrowserWindow | null): Promise<string | null> {
  const win = focused ?? BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(
    win ?? new BrowserWindow({ show: false }),
    {
      title: 'Select Chrome Bookmarks File',
      buttonLabel: 'Import',
      properties: ['openFile'],
      // Chrome 的 Bookmarks 文件无扩展名 → All Files 在前,不被具体扩展名挡。
      filters: [{ name: 'All Files', extensions: ['*'] }],
    },
  );
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

/** 提示对话框(成功/失败),失败别崩 */
async function showInfo(
  focused: BrowserWindow | null,
  title: string,
  message: string,
  detail?: string,
): Promise<void> {
  try {
    await dialog.showMessageBox(focused ?? new BrowserWindow({ show: false }), {
      type: 'info',
      title,
      message,
      detail,
    });
  } catch (err) {
    console.warn('[chrome-import] showInfo failed:', err);
  }
}

/**
 * Chrome 书签导入主流程。
 *
 * 1. 默认路径 fs.existsSync → 不存在弹 dialog 手选(取消 → 中止)。
 * 2. readFile + JSON.parse + parseChromeBookmarks。
 * 3. 落库(主进程直调 capability-impl,保留层级):
 *    - 先按层级顺序建 folder(parent 必在 child 前),维护 tempId → realFolderId 映射。
 *    - 再建 bookmark,folderId 用映射后的真实 id。
 * 4. broadcast folder + bookmark onListChanged 刷新 NavSide。
 * 5. 任何阶段失败 → 主进程 log + dialog 提示,别崩。
 */
export async function importChromeBookmarks(
  mainWindow: BrowserWindow | null,
): Promise<void> {
  const focused = mainWindow ?? BrowserWindow.getFocusedWindow();

  // 1. 定位文件
  let filePath = defaultChromeBookmarksPath();
  if (!fs.existsSync(filePath)) {
    console.log(
      `[chrome-import] default path not found (${filePath}), prompting file picker`,
    );
    const picked = await pickBookmarksFile(focused);
    if (!picked) {
      console.log('[chrome-import] user canceled file picker');
      return;
    }
    filePath = picked;
  }

  // 2. 读 + 解析
  let parsed: ParsedChromeBookmarks;
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const json: unknown = JSON.parse(raw);
    parsed = parseChromeBookmarks(json);
  } catch (err) {
    console.error('[chrome-import] read/parse failed:', err);
    await showInfo(
      focused,
      'Import Chrome Bookmarks',
      'Failed to read or parse the bookmarks file.',
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  if (parsed.folders.length === 0 && parsed.bookmarks.length === 0) {
    console.log('[chrome-import] nothing to import (empty parse result)');
    await showInfo(
      focused,
      'Import Chrome Bookmarks',
      'No bookmarks or folders found in the selected file.',
    );
    return;
  }

  // 3. 落库 —— folder 先(按层级:parentTempId 已在 folders 数组中先于 child 出现,
  //    因为 parseChromeBookmarks 是前序 push,parent 总在 child 之前)。
  const tempIdToRealId = new Map<string, string>();
  let folderCount = 0;
  let bookmarkCount = 0;
  let folderFail = 0;
  let bookmarkFail = 0;

  try {
    for (const f of parsed.folders) {
      const realParentId =
        f.parentTempId !== null ? tempIdToRealId.get(f.parentTempId) ?? null : null;
      try {
        const info = await createFolder(f.name, realParentId, 'web');
        tempIdToRealId.set(f.tempId, info.id);
        folderCount++;
      } catch (err) {
        folderFail++;
        console.warn(`[chrome-import] createFolder failed for "${f.name}":`, err);
        // 子 folder / bookmark 会因映射缺失落到根,不崩。
      }
    }

    for (const b of parsed.bookmarks) {
      const realFolderId =
        b.parentTempId !== null ? tempIdToRealId.get(b.parentTempId) ?? null : null;
      try {
        await add(b.url, b.title, realFolderId);
        bookmarkCount++;
      } catch (err) {
        bookmarkFail++;
        console.warn(`[chrome-import] add bookmark failed for "${b.url}":`, err);
      }
    }
  } catch (err) {
    console.error('[chrome-import] import failed mid-way:', err);
    // 已落部分仍 broadcast 让 UI 反映,下面继续。
  }

  // 4. broadcast 刷新 NavSide(folder + bookmark 两条,否则不刷新 —— ebook 同款坑)
  await broadcastFolderListChanged();
  await broadcastBookmarkListChanged();

  console.log(
    `[chrome-import] done: ${folderCount} folders, ${bookmarkCount} bookmarks imported` +
      (folderFail || bookmarkFail
        ? ` (${folderFail} folder fail, ${bookmarkFail} bookmark fail)`
        : ''),
  );

  await showInfo(
    focused,
    'Import Chrome Bookmarks',
    `Imported ${bookmarkCount} bookmark(s) and ${folderCount} folder(s).`,
    'Switch to the web view to see them in the sidebar.',
  );
}
