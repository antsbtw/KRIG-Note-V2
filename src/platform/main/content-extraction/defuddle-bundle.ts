/**
 * defuddle-bundle — 懒加载 Defuddle UMD bundle 字符串(首次读盘后缓存)
 *
 * 蓝本:mirro fullpage-capture.ts getDefuddleBundle()。
 * 路径解析改用 ytdlp/downloader.ts getFfmpegPath() 同款范式:
 *   app.getAppPath() + node_modules,打包后回退 app.asar → app.asar.unpacked
 *   (forge.config asar.unpack 已含 defuddle)。
 *
 * 读 node_modules/defuddle/dist/index.full.js(含所有平台 extractor 的 UMD bundle)。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

let defuddleBundleCache: string | null = null;

/**
 * 解析 defuddle UMD bundle 的磁盘路径(dev + 打包都可靠);找不到返回 null。
 *
 * Vite-forge 打包**不拷 node_modules**(全 JS 依赖 bundle 进 .vite/build),故
 * asar.unpack 对 node_modules 无效。打包路径走 forge extraResource:把单个
 * index.full.js 拷进 Contents/Resources/(= process.resourcesPath)。
 * dev 环境 process.resourcesPath 指向 Electron.app 内,无此文件 → 回退 node_modules。
 */
function resolveDefuddleBundlePath(): string | null {
  const candidates = [
    // 打包后(forge extraResource 拷到 Contents/Resources/index.full.js)
    join(process.resourcesPath, 'index.full.js'),
    // dev 环境(app.getAppPath() = 项目根)
    join(app.getAppPath(), 'node_modules', 'defuddle', 'dist', 'index.full.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 读取 Defuddle UMD bundle 字符串(缓存)。
 * 读不到(打包路径没配好 / 包缺失)抛错 —— 由 captureFullPage catch 后降级返回 null。
 */
export function getDefuddleBundle(): string {
  if (!defuddleBundleCache) {
    const bundlePath = resolveDefuddleBundlePath();
    if (!bundlePath) {
      throw new Error(
        '[content-extraction] defuddle bundle (index.full.js) not found; ' +
          '检查 npm 依赖 + forge.config asar.unpack 是否含 defuddle',
      );
    }
    defuddleBundleCache = readFileSync(bundlePath, 'utf-8');
  }
  return defuddleBundleCache;
}
