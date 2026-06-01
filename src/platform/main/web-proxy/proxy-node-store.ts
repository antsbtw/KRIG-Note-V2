/**
 * 全局代理节点表 store(per-ws 代理工程 · 阶段2)
 *
 * 复刻 web-download/download-store.ts(JSON 文件 + 内存 Map 缓存 + atomic 写)。
 *
 * 文件位置:`{userData}/krig-data/web/proxy-nodes.json`(跟 downloads.json 同目录)
 *
 * 节点表全局(跨所有 ws 共用);每个 ws 在 per-ws web state 选一个 proxyId。
 * proxyId → rules 解析放主进程(主进程持节点表),renderer 只传 proxyId,主进程
 * 查表 resolveRules → session.setProxy。
 *
 * 写入策略:atomic — `proxy-nodes.json.tmp` → `fs.renameSync`(照搬 download-store)。
 *
 * 无认证:节点只存 host:port,rules = `socks5://host:port` / `http://host:port` / `direct://`。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ProxyNode } from '@shared/types/proxy-types';

interface ProxyNodeFile {
  version: '1';
  /** id → node */
  entries: Record<string, ProxyNode>;
}

const PROXY_DIR = path.join(app.getPath('userData'), 'krig-data', 'web');
const PROXY_FILE = path.join(PROXY_DIR, 'proxy-nodes.json');

class ProxyNodeStore {
  private cache: Map<string, ProxyNode> = new Map();
  private loaded = false;

  /** 启动 lazy load(首次 list/add/remove/get/resolveRules 触发)*/
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true; // 防并发期间多次 load(Map 重建幂等,可接受)

    try {
      fs.mkdirSync(PROXY_DIR, { recursive: true });
      if (fs.existsSync(PROXY_FILE)) {
        const raw = fs.readFileSync(PROXY_FILE, 'utf-8');
        const data = JSON.parse(raw) as ProxyNodeFile;
        if (data.version === '1' && data.entries && typeof data.entries === 'object') {
          for (const [id, node] of Object.entries(data.entries)) {
            // 基础校验 — 防文件被外部篡改导致内存数据非法
            if (
              node &&
              typeof node.id === 'string' &&
              typeof node.name === 'string' &&
              (node.type === 'socks5' || node.type === 'http' || node.type === 'direct') &&
              typeof node.host === 'string' &&
              typeof node.createdAt === 'number'
            ) {
              this.cache.set(id, node);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[proxy-node-store] load failed (file 损坏或权限问题):', err);
      // 不 throw — 起一个空 store,后续 add 时会重写文件
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(): void {
    const data: ProxyNodeFile = {
      version: '1',
      entries: Object.fromEntries(this.cache),
    };
    const tmp = PROXY_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, PROXY_FILE);
    } catch (err) {
      console.warn('[proxy-node-store] save failed:', err);
    }
  }

  /** 全量列表(按 createdAt 升序)*/
  async list(): Promise<ProxyNode[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 落盘一个节点。重复 id 覆盖(幂等)。 */
  async add(node: ProxyNode): Promise<void> {
    await this.ensureLoaded();
    if (!node || typeof node.id !== 'string' || !node.id) return;
    this.cache.set(node.id, node);
    this.save();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    if (this.cache.delete(id)) this.save();
  }

  async get(id: string): Promise<ProxyNode | undefined> {
    await this.ensureLoaded();
    return this.cache.get(id);
  }

  /**
   * proxyId → setProxy 用的 rules 字符串(核心)。
   *
   * proxyId 空 / 找不到 / type==='direct' → 'direct://';
   * 否则 `${type}://${host}`(如 'socks5://192.168.1.162:1080')。
   */
  async resolveRules(proxyId: string | undefined): Promise<string> {
    if (!proxyId) return 'direct://';
    await this.ensureLoaded();
    const node = this.cache.get(proxyId);
    if (!node || node.type === 'direct' || !node.host) return 'direct://';
    return `${node.type}://${node.host}`;
  }
}

export const proxyNodeStore = new ProxyNodeStore();
