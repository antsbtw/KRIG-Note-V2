/**
 * Web 全局设置 store(per-ws 代理工程 · 阶段3)
 *
 * 复刻 web-proxy/proxy-node-store.ts(JSON 文件 + 内存缓存 + atomic 写)。
 *
 * 文件位置:`{userData}/krig-data/web/settings.json`(跟 proxy-nodes.json / downloads.json 同目录)
 *
 * 全局设置(跨所有 ws 共用):默认搜索引擎模板 + 默认主页 URL。
 * renderer 侧靠 web-settings-cache.ts 启动 await 拉一次后同步读(omnibox / data-model
 * 是 renderer 同步函数,不能 await IPC)。
 *
 * 写入策略:atomic — `settings.json.tmp` → `fs.renameSync`(照搬 proxy-node-store)。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { WebGlobalSettings } from '@shared/types/web-settings-types';

interface WebSettingsFile {
  version: '1';
  settings: WebGlobalSettings;
}

/** 默认值 = 现有写死常量(保证未配置/文件缺失时行为不变)*/
const DEFAULT_SETTINGS: WebGlobalSettings = {
  searchEngineTemplate: 'https://www.google.com/search?q=%s',
  defaultUrl: 'https://www.google.com',
};

const SETTINGS_DIR = path.join(app.getPath('userData'), 'krig-data', 'web');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

class WebSettingsStore {
  private cache: WebGlobalSettings = { ...DEFAULT_SETTINGS };
  private loaded = false;

  /** 启动 lazy load(首次 get/update 触发)*/
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const data = JSON.parse(raw) as WebSettingsFile;
        if (data.version === '1' && data.settings && typeof data.settings === 'object') {
          const s = data.settings;
          // 缺字段用默认兜底(容错,不 throw)
          this.cache = {
            searchEngineTemplate:
              typeof s.searchEngineTemplate === 'string' && s.searchEngineTemplate
                ? s.searchEngineTemplate
                : DEFAULT_SETTINGS.searchEngineTemplate,
            defaultUrl:
              typeof s.defaultUrl === 'string' && s.defaultUrl
                ? s.defaultUrl
                : DEFAULT_SETTINGS.defaultUrl,
          };
        }
      }
    } catch (err) {
      console.warn('[web-settings-store] load failed (file 损坏或权限问题):', err);
      // 不 throw — 用默认设置,后续 update 时会重写文件
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(): void {
    const data: WebSettingsFile = { version: '1', settings: this.cache };
    const tmp = SETTINGS_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, SETTINGS_FILE);
    } catch (err) {
      console.warn('[web-settings-store] save failed:', err);
    }
  }

  /** 取全量设置 */
  async get(): Promise<WebGlobalSettings> {
    await this.ensureLoaded();
    return { ...this.cache };
  }

  /** 合并 patch + save + 返回全量 */
  async update(patch: Partial<WebGlobalSettings>): Promise<WebGlobalSettings> {
    await this.ensureLoaded();
    if (patch && typeof patch === 'object') {
      if (typeof patch.searchEngineTemplate === 'string' && patch.searchEngineTemplate) {
        this.cache.searchEngineTemplate = patch.searchEngineTemplate;
      }
      if (typeof patch.defaultUrl === 'string' && patch.defaultUrl) {
        this.cache.defaultUrl = patch.defaultUrl;
      }
    }
    this.save();
    return { ...this.cache };
  }
}

export const webSettingsStore = new WebSettingsStore();
