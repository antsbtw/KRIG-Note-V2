#!/usr/bin/env node
/**
 * build-lucide-manifest.mjs — D023 Step 5.7
 *
 * 一次性脚本:从 lucide GitHub repo 拉 1952 个 icon 的 categories/tags 元数据,
 * 字面 build 单文件 manifest 塞 V2 仓库,供 Icons tab 全库分组 + 搜索使用。
 *
 * 数据来源:
 * 1. icon 名清单字面来自本地 `node_modules/lucide-react/dist/esm/dynamicIconImports.mjs`
 *    (1952 kebab-name + Pascal 双向映射 — 字面 lucide-react 1.14.0 字面锁定版本)
 * 2. categories/tags 字面来自 `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.json`
 *    (CDN raw,字面无 API rate-limit,字面对应 lucide repo main 分支头)
 * 3. commit-sha 字面 pinning 走 `https://api.github.com/repos/lucide-icons/lucide/commits/main`
 *    (字面单 API 调用,unauth 60req/h 字面够用)
 *
 * 限流策略:并发 20 + 失败重试 3 次 + 失败收集,总耗时 ~2 分钟
 *
 * 输出:src/capabilities/text-editing/ui/emoji-picker/lucide-manifest.json
 *
 * 用法:npm run build:lucide-manifest
 *
 * 字面只跑一次(SDK 升级时重跑);commit manifest 后字面后续不重跑。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DYNAMIC_IMPORTS_PATH = path.join(
  REPO_ROOT,
  'node_modules/lucide-react/dist/esm/dynamicIconImports.mjs',
);
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  'src/capabilities/text-editing/ui/emoji-picker/lucide-manifest.json',
);

const RAW_BASE = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons';
const COMMIT_API = 'https://api.github.com/repos/lucide-icons/lucide/commits/main';
const CONCURRENCY = 20;
const RETRY = 3;
const RETRY_DELAY_MS = 500;

/** kebab-name → PascalName (与 lucide-react 字面 named export 对齐) */
function kebabToPascal(kebab) {
  return kebab
    .split('-')
    .map((part) => {
      // 字面纯数字段:lucide 把 '1-2-3' 字面 export 成 '_123' 不是数字 — 但实际
      // 字面 named export 字面是按 PascalCase + 数字前缀 _ 处理。我们的 manifest
      // 字面给消费方按 kebab 查,pascalName 字段字面只用作展示/兜底。
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/** 从 dynamicIconImports.mjs 解析 1952 个 kebab-name */
async function loadIconNames() {
  const content = await fs.readFile(DYNAMIC_IMPORTS_PATH, 'utf-8');
  // 匹配 "kebab-name": () => import(...) 行
  const re = /"([a-z0-9-]+)":\s*\(\)\s*=>\s*import\(/g;
  const names = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  if (names.length === 0) {
    throw new Error('字面解析 dynamicIconImports.mjs 字面 0 命中,检查 lucide-react 版本');
  }
  return names;
}

async function fetchCommitSha() {
  const res = await fetch(COMMIT_API, {
    headers: { 'User-Agent': 'krig-note-v2-build-script' },
  });
  if (!res.ok) {
    console.warn(`[manifest] 字面 commit-sha fetch 失败(${res.status}),使用 'main' fallback`);
    return 'main';
  }
  const json = await res.json();
  return json.sha || 'main';
}

async function fetchIconMeta(kebabName, attempt = 1) {
  const url = `${RAW_BASE}/${kebabName}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null; // icon 字面 .json 不存在(老 icon 字面 deprecated)
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return {
      tags: Array.isArray(json.tags) ? json.tags : [],
      categories: Array.isArray(json.categories) ? json.categories : [],
    };
  } catch (err) {
    if (attempt < RETRY) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      return fetchIconMeta(kebabName, attempt + 1);
    }
    throw err;
  }
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const total = items.length;
  const progress = () => {
    if (done % 100 === 0 || done === total) {
      process.stdout.write(`\r[manifest] ${done}/${total}`);
    }
  };

  async function pull() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = { __error: err.message };
      }
      done++;
      progress();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, pull));
  process.stdout.write('\n');
  return results;
}

async function main() {
  console.log('[manifest] 字面读 dynamicIconImports.mjs...');
  const names = await loadIconNames();
  console.log(`[manifest] 字面解析得 ${names.length} 个 icon 名`);

  console.log('[manifest] 字面拉 commit sha...');
  const sha = await fetchCommitSha();
  console.log(`[manifest] lucide-icons/lucide@${sha.slice(0, 7)}`);

  console.log(`[manifest] 字面 fetch 元数据(并发 ${CONCURRENCY},预计 ~2 分钟)...`);
  const metas = await runWithConcurrency(
    names,
    (name) => fetchIconMeta(name),
    CONCURRENCY,
  );

  const icons = {};
  const categorySet = new Set();
  const failures = [];
  let withMeta = 0;
  let withoutMeta = 0;

  names.forEach((name, i) => {
    const meta = metas[i];
    if (meta && meta.__error) {
      failures.push({ name, error: meta.__error });
      icons[name] = { pascalName: kebabToPascal(name), tags: [], categories: [] };
      withoutMeta++;
      return;
    }
    if (!meta) {
      icons[name] = { pascalName: kebabToPascal(name), tags: [], categories: [] };
      withoutMeta++;
      return;
    }
    icons[name] = {
      pascalName: kebabToPascal(name),
      tags: meta.tags,
      categories: meta.categories,
    };
    meta.categories.forEach((c) => categorySet.add(c));
    withMeta++;
  });

  const manifest = {
    version: `lucide-icons/lucide@${sha}`,
    builtAt: new Date().toISOString(),
    iconCount: names.length,
    iconsWithMeta: withMeta,
    iconsWithoutMeta: withoutMeta,
    categories: [...categorySet].sort(),
    icons,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[manifest] 字面写入 ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(`[manifest]   total: ${names.length}`);
  console.log(`[manifest]   with-meta: ${withMeta}`);
  console.log(`[manifest]   without-meta: ${withoutMeta}`);
  console.log(`[manifest]   categories: ${manifest.categories.length}`);
  if (failures.length > 0) {
    console.warn(`[manifest] 字面 ${failures.length} 个 icon fetch 失败:`);
    failures.slice(0, 10).forEach((f) => console.warn(`  - ${f.name}: ${f.error}`));
    if (failures.length > 10) console.warn(`  ... +${failures.length - 10} more`);
  }
}

main().catch((err) => {
  console.error('[manifest] 字面失败:', err);
  process.exit(1);
});
