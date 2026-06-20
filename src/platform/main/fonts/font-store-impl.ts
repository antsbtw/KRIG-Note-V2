/**
 * fontStore 实现(main 进程)— L5-G7.2
 *
 * 把用户选中的系统字体二进制嵌进画板内容(可移植)。1:1 仿
 * [media-store-impl.ts](../media/media-store-impl.ts):新协议 `font://` + 新子目录
 * `krig-data/fonts/` + SHA256 去重 + IPC。**独立 font 桶**(用户拍板 G7-2:字体需独立
 * license 标记 / 索引 / 清理,不塞 media 桶)。
 *
 * 职责:
 * - 注册 font:// 协议(default + 每个 ws partition session,仿 registerMediaForSession)
 * - embed(path, fontIndex):读字体二进制(.ttc 经 ttc-extract 抽子字体)→ SHA256 落盘
 *   → 返回 { fontId, fontUrl, sizeKb, ... }
 *
 * 存储结构:
 *   {userData}/krig-data/fonts/
 *     ├── font-{hash16}.ttf / .otf
 *     └── font-index.json   { version, entries: { fontId → { family, style, sourcePath, ... } } }
 *
 * 渲染进程经 IPC FONT_EMBED 调用 + 经 font:// 协议(loadFont fetch)拿 buffer。
 * 体积守卫(8MB warn)在 UI 端(G7.4 确认弹窗);store 仅设一个宽松硬上限防病态文件。
 */

import { app, protocol, net, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { readFontBinary } from './system-font-scan';

const FONT_DIR = path.join(app.getPath('userData'), 'krig-data', 'fonts');
const INDEX_FILE = path.join(FONT_DIR, 'font-index.json');

/** 宽松硬上限(防病态超大文件;UI 的 8MB 守卫是"提示确认",非此硬限) */
const HARD_LIMIT_BYTES = 64 * 1024 * 1024;

interface FontIndexEntry {
  fontId: string;
  family: string;
  style: string;
  /** 源系统字体路径(回显 / 调试用;不构成可移植性依赖,buffer 已落盘) */
  sourcePath: string;
  fontIndex: number;
  size: number;
  ext: 'ttf' | 'otf';
  createdAt: number;
}

interface FontIndex {
  version: number;
  entries: Record<string, FontIndexEntry>;
}

export interface FontEmbedResult {
  success: boolean;
  error?: string;
  /** 嵌入字体 id(= 文件名去 ext,如 "font-ab12...");text_font 写 `embed:<fontId>` */
  fontId?: string;
  /** font:// URL,渲染进程 loadFont fetch 用 */
  fontUrl?: string;
  /** 落盘体积(KB),供 UI 体积守卫回显 */
  sizeKb?: number;
  family?: string;
  style?: string;
}

function ensureDir(): void {
  fs.mkdirSync(FONT_DIR, { recursive: true });
}

class FontStore {
  private index: FontIndex = { version: 1, entries: {} };
  private fontHandler: ((request: Request) => Promise<Response>) | null = null;
  private wiredSessions = new WeakSet<Electron.Session>();

  constructor() {
    this.ensureLoaded();
  }

  private ensureLoaded(): void {
    ensureDir();
    try {
      if (fs.existsSync(INDEX_FILE)) {
        this.index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      }
    } catch {
      this.index = { version: 1, entries: {} };
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
    } catch {
      /* non-fatal:文件已落盘,font:// 仍能取;索引仅供 UI 回显 */
    }
  }

  /**
   * 注册 font:// 协议(default + legacy webview partition)。
   * 必须在 app.whenReady 之后、第一个 webview 创建之前调(仿 mediaStore.registerProtocol)。
   */
  registerProtocol(): void {
    const handler = async (request: Request): Promise<Response> => {
      const urlPath = request.url.replace('font://', '');
      // 越界防御:解析后必须仍在 FONT_DIR 内
      const filePath = path.resolve(FONT_DIR, urlPath);
      if (!filePath.startsWith(FONT_DIR + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      return net.fetch(`file://${filePath}`);
    };

    this.fontHandler = handler;
    protocol.handle('font', handler);
    const legacySess = session.fromPartition(WEBVIEW_PARTITION);
    legacySess.protocol.handle('font', handler);
    this.wiredSessions.add(legacySess);
  }

  /** per-ws:某 ws webview 首次 attach 时对其 session 补注册 font://(WeakSet 去重) */
  registerFontForSession(sess: Electron.Session): void {
    if (this.wiredSessions.has(sess)) return;
    if (!this.fontHandler) {
      console.warn('[font] registerFontForSession 在 registerProtocol 之前调用,跳过');
      return;
    }
    this.wiredSessions.add(sess);
    sess.protocol.handle('font', this.fontHandler);
  }

  /**
   * 嵌入一个系统字体(.ttc 抽指定子字体)→ 落盘 + 返回 font:// URL。
   *
   * - 读二进制(readFontBinary 内部处理 .ttc 抽取)
   * - SHA256(抽出的 sfnt buffer)去重 → 同字体只存一份
   * - 超硬上限 → fail(UI 的 8MB 守卫在更前面拦)
   *
   * @param sourcePath 系统字体文件绝对路径
   * @param fontIndex .ttc 子字体序号(非 ttc 传 0)
   * @param meta 可选 family/style(写索引供 UI 回显)
   */
  async embed(
    sourcePath: string,
    fontIndex: number,
    meta?: { family?: string; style?: string },
  ): Promise<FontEmbedResult> {
    try {
      let buffer: Buffer;
      let ext: 'ttf' | 'otf';
      try {
        const read = readFontBinary(sourcePath, fontIndex);
        buffer = read.buffer;
        ext = read.ext;
      } catch (err) {
        // fail loud:不支持的格式 / ttc 抽取失败(红线:不静默崩)
        console.warn(`[font] embed 读取失败 path=${sourcePath} idx=${fontIndex}:`, err);
        return { success: false, error: `读取字体失败: ${(err as Error).message}` };
      }

      if (buffer.length === 0) return { success: false, error: '字体文件为空' };
      if (buffer.length > HARD_LIMIT_BYTES) {
        return {
          success: false,
          error: `字体过大(${Math.round(buffer.length / 1024 / 1024)}MB),超出硬上限`,
        };
      }

      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const fontId = `font-${hash}`;
      const fileName = `${fontId}.${ext}`;
      const filePath = path.join(FONT_DIR, fileName);
      const fontUrl = `font://${fileName}`;

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
      }

      // 写索引(去重也刷新一次,补 family/style 回显)
      this.index.entries[fontId] = {
        fontId,
        family: meta?.family || '',
        style: meta?.style || '',
        sourcePath,
        fontIndex,
        size: buffer.length,
        ext,
        createdAt: this.index.entries[fontId]?.createdAt || Date.now(),
      };
      this.saveIndex();

      return {
        success: true,
        fontId,
        fontUrl,
        sizeKb: Math.round(buffer.length / 1024),
        family: meta?.family,
        style: meta?.style,
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /** 按 fontId 取索引条目(UI 回显 / 调试) */
  getEntry(fontId: string): FontIndexEntry | undefined {
    return this.index.entries[fontId];
  }
}

export const fontStore = new FontStore();
