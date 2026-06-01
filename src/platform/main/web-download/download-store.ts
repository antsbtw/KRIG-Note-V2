/**
 * Web 下载历史 store(Phase 3 收尾)
 *
 * 复刻 learning/vocab-store.ts(JSON 文件 + 内存 Map 缓存 + atomic 写)。
 *
 * 文件位置:`{userData}/krig-data/web/downloads.json`
 *
 * 为何存主进程而非 renderer localStorage:done 事件在主进程 will-download
 * 回调里产生,**同进程落盘无 IPC 时序丢失**(localStorage 方案有"done 时
 * NavSide 未 mount 就丢"的脆弱性)。
 *
 * 写入策略:atomic — `downloads.json.tmp` → `fs.renameSync`(POSIX 保证原子);
 * 防"写一半挂掉损坏旧数据"(照搬 vocab-store,别简化成直接 writeFile)。
 *
 * 只存**终态**(completed/cancelled/interrupted),进行中态在 renderer 内存维护。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface DownloadEntry {
  /** 与 WebDownloadEvent.id 同源(主进程自增 downloadId,转字符串)*/
  id: string;
  filename: string;
  /** 下载来源 URL(item.getURL())*/
  url: string;
  /** 完成保存路径(仅 completed 有效;cancelled/interrupted 为空)*/
  savePath: string;
  /** 总字节(item.getTotalBytes(),未知为 0)*/
  total: number;
  completedAt: number;
  state: 'completed' | 'cancelled' | 'interrupted';
}

interface DownloadFile {
  version: '1';
  /** id → entry */
  entries: Record<string, DownloadEntry>;
}

const DOWNLOAD_DIR = path.join(app.getPath('userData'), 'krig-data', 'web');
const DOWNLOAD_FILE = path.join(DOWNLOAD_DIR, 'downloads.json');

class DownloadStore {
  private cache: Map<string, DownloadEntry> = new Map();
  private loaded = false;

  /** 启动 lazy load(首次 add/remove/list 触发)*/
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true; // 防并发期间多次 load(Map 重建幂等,可接受)

    try {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      if (fs.existsSync(DOWNLOAD_FILE)) {
        const raw = fs.readFileSync(DOWNLOAD_FILE, 'utf-8');
        const data = JSON.parse(raw) as DownloadFile;
        if (data.version === '1' && data.entries && typeof data.entries === 'object') {
          for (const [id, entry] of Object.entries(data.entries)) {
            // 基础校验 — 防文件被外部篡改导致内存数据非法
            if (
              entry &&
              typeof entry.id === 'string' &&
              typeof entry.filename === 'string' &&
              typeof entry.url === 'string' &&
              typeof entry.savePath === 'string' &&
              typeof entry.total === 'number' &&
              typeof entry.completedAt === 'number' &&
              typeof entry.state === 'string'
            ) {
              this.cache.set(id, entry);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[download-store] load failed (file 损坏或权限问题):', err);
      // 不 throw — 起一个空的 store,后续 add 时会重写文件
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(): void {
    const data: DownloadFile = {
      version: '1',
      entries: Object.fromEntries(this.cache),
    };
    const tmp = DOWNLOAD_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, DOWNLOAD_FILE);
    } catch (err) {
      console.warn('[download-store] save failed:', err);
    }
  }

  /** 落盘一条终态下载记录。重复 id 覆盖(幂等)。 */
  async add(entry: DownloadEntry): Promise<DownloadEntry | null> {
    await this.ensureLoaded();
    if (!entry || typeof entry.id !== 'string' || !entry.id) return null;
    this.cache.set(entry.id, entry);
    this.save();
    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    if (this.cache.delete(id)) this.save();
  }

  /** 按 completedAt 倒序(最新完成的在前)*/
  async list(): Promise<DownloadEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.values()).sort((a, b) => b.completedAt - a.completedAt);
  }
}

export const downloadStore = new DownloadStore();
