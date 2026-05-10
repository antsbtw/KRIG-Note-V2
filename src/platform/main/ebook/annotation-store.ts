/**
 * eBook 标注 store(L5-C1)
 *
 * V1 → V2 直迁:src/main/ebook/annotation-store.ts(98 行 JSON 实现)。
 * 每本书一个 JSON 文件:{userData}/krig-data/ebook/annotations/{bookId}.json
 *
 * D-7=A 决策:thumbnail 走 base64 inline 在 annotation 字段内,不挂 media://。
 * 标注区域通常 ≤100KB,且删除时不需 media GC 联动。
 *
 * 退出条件:跟 bookshelf-store 一起,W6 SurrealDB 客户端 epic 时整体迁
 * src/storage/ebook/。
 */

import { app } from 'electron';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredAnnotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
  /** EPUB 标注的 CFI 锚点 */
  cfi?: string;
  /** EPUB 标注的文本内容 */
  textContent?: string;
  /** PDF 空间标注的 OCR 文本(C5 砍 OCR 时空字符串占位)*/
  ocrText?: string;
  /** 区域截图(D-7=A base64 inline)*/
  thumbnail?: string;
  createdAt: number;
}

const ANNOTATION_DIR = path.join(
  app.getPath('userData'),
  'krig-data',
  'ebook',
  'annotations',
);

class AnnotationStore {
  private cache = new Map<string, StoredAnnotation[]>();

  private filePath(bookId: string): string {
    return path.join(ANNOTATION_DIR, `${bookId}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(ANNOTATION_DIR)) mkdirSync(ANNOTATION_DIR, { recursive: true });
  }

  private load(bookId: string): StoredAnnotation[] {
    const cached = this.cache.get(bookId);
    if (cached) return cached;

    this.ensureDir();
    const fp = this.filePath(bookId);
    if (!existsSync(fp)) {
      this.cache.set(bookId, []);
      return [];
    }

    try {
      const data = JSON.parse(readFileSync(fp, 'utf-8'));
      const list = Array.isArray(data) ? data : [];
      this.cache.set(bookId, list);
      return list;
    } catch (err) {
      console.warn(`[ebook/annotation-store] load ${bookId} failed:`, err);
      this.cache.set(bookId, []);
      return [];
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(bookId: string): void {
    try {
      this.ensureDir();
      const data = this.cache.get(bookId) ?? [];
      const fp = this.filePath(bookId);
      const tmp = fp + '.tmp';
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      renameSync(tmp, fp);
    } catch (err) {
      console.warn(`[ebook/annotation-store] save ${bookId} failed:`, err);
    }
  }

  list(bookId: string): StoredAnnotation[] {
    return this.load(bookId);
  }

  add(
    bookId: string,
    ann: Omit<StoredAnnotation, 'id' | 'createdAt'>,
  ): StoredAnnotation {
    const annotations = this.load(bookId);
    const stored: StoredAnnotation = {
      id: randomUUID(),
      ...ann,
      createdAt: Date.now(),
    };
    annotations.push(stored);
    this.cache.set(bookId, annotations);
    this.save(bookId);
    return stored;
  }

  remove(bookId: string, annotationId: string): void {
    const annotations = this.load(bookId);
    const filtered = annotations.filter((a) => a.id !== annotationId);
    this.cache.set(bookId, filtered);
    this.save(bookId);
  }
}

export const annotationStore = new AnnotationStore();
