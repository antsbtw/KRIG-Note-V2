/**
 * 生词本 store(L5-B3.20a)
 *
 * V1 → V2 直迁:src/main/learning/vocabulary-store.ts(80 行,SurrealDB)→
 * V2 改 JSON 文件 + 内存 Map 缓存(用户拍板 Q-存储 = B,对齐 mediaStore.json 模式)。
 *
 * 文件位置:`{userData}/krig-data/learning/vocab.json`
 *
 * 写入策略:atomic — `vocab.json.tmp` → `fs.renameSync`(POSIX 保证原子);
 * 防"写一半挂掉损坏旧数据"(决策 Q1 = A,对齐 mediaStore)。
 *
 * 性能:几千条以下毫秒级 IO,无瓶颈。规模超 5000 时再考虑分片或 DB 升级。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface VocabEntry {
  id: string;
  /** normalized lowercase */
  word: string;
  definition: string;
  /** 添加生词时的句子上下文(可选)*/
  context?: string;
  /** 音标(可选)*/
  phonetic?: string;
  createdAt: number;
}

interface VocabFile {
  version: '1';
  /** id → entry */
  entries: Record<string, VocabEntry>;
}

const VOCAB_DIR = path.join(app.getPath('userData'), 'krig-data', 'learning');
const VOCAB_FILE = path.join(VOCAB_DIR, 'vocab.json');

class VocabStore {
  private cache: Map<string, VocabEntry> = new Map();
  private loaded = false;

  /** 启动 lazy load(首次 add/remove/list/has 触发)*/
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true; // 防并发期间多次 load(竞态:多个 await 同时进入 — Map 重建幂等,可接受)

    try {
      fs.mkdirSync(VOCAB_DIR, { recursive: true });
      if (fs.existsSync(VOCAB_FILE)) {
        const raw = fs.readFileSync(VOCAB_FILE, 'utf-8');
        const data = JSON.parse(raw) as VocabFile;
        if (data.version === '1' && data.entries && typeof data.entries === 'object') {
          for (const [id, entry] of Object.entries(data.entries)) {
            // 基础校验 — 防文件被外部篡改导致内存数据非法
            if (
              entry &&
              typeof entry.id === 'string' &&
              typeof entry.word === 'string' &&
              typeof entry.definition === 'string' &&
              typeof entry.createdAt === 'number'
            ) {
              this.cache.set(id, entry);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[vocab-store] load failed (file 损坏或权限问题):', err);
      // 不 throw — 起一个空的 store,用户后续 add 时会重写文件
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(): void {
    const data: VocabFile = {
      version: '1',
      entries: Object.fromEntries(this.cache),
    };
    const tmp = VOCAB_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, VOCAB_FILE);
    } catch (err) {
      console.warn('[vocab-store] save failed:', err);
    }
  }

  async add(
    word: string,
    definition: string,
    context?: string,
    phonetic?: string,
  ): Promise<VocabEntry | null> {
    await this.ensureLoaded();
    const normalized = word.toLowerCase().trim();
    if (!normalized || !definition) return null;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: VocabEntry = {
      id,
      word: normalized,
      definition,
      context,
      phonetic,
      createdAt: Date.now(),
    };
    this.cache.set(id, entry);
    this.save();
    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    if (this.cache.delete(id)) this.save();
  }

  /** 按 createdAt 倒序(最新加的在前)*/
  async list(): Promise<VocabEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  async has(word: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = word.toLowerCase().trim();
    for (const entry of this.cache.values()) {
      if (entry.word === normalized) return true;
    }
    return false;
  }
}

export const vocabStore = new VocabStore();
