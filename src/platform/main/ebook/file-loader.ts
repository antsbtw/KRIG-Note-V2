/**
 * eBook 文件加载器(L5-C1)
 *
 * V1 → V2 直迁:src/main/ebook/file-loader.ts(44 行)。
 * 职责:读取电子书文件到 Buffer + 管理"当前打开"状态。
 * 文件对话框由 IPC handler(EBOOK_PICK_FILE)负责,本模块只做纯文件加载。
 *
 * 单实例模式:同一时刻只有一本书被加载到内存(切书时旧 buffer 释放)。
 * 后续如要支持多本同时打开,需要按 bookId 索引(留给 W6 storage epic)。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface EBookFileState {
  filePath: string;
  fileName: string;
  buffer: Buffer;
}

let currentFile: EBookFileState | null = null;

/** 加载指定路径的电子书 */
export async function loadEBook(filePath: string): Promise<{
  filePath: string;
  fileName: string;
}> {
  const buffer = await readFile(filePath);
  const fileName = path.basename(filePath);
  currentFile = { filePath, fileName, buffer };
  return { filePath, fileName };
}

/**
 * 获取当前电子书数据。
 * 直接返回 Buffer,Electron IPC 会自动序列化为 Uint8Array。
 */
export function getEBookData():
  | { filePath: string; fileName: string; data: Buffer }
  | null {
  if (!currentFile) return null;
  const { filePath, fileName, buffer } = currentFile;
  return { filePath, fileName, data: buffer };
}

/** 关闭当前电子书,释放 Buffer */
export function closeEBook(): void {
  currentFile = null;
}
