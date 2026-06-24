/// <reference types="vite/client" />
/**
 * Shape bootstrap(L5-G2)— import.meta.glob 扫所有 shape JSON 注册到 ShapeRegistry
 *
 * V1 嵌在 ShapeRegistryImpl.bootstrap() 方法里(plugins/graph/library/shapes/registry.ts);
 * V2 拆出独立文件,index.ts 顶层 side-effect 直调 — 对齐 V2 ebook / learning 模式.
 *
 * L5-G6c 阶段 A:旧 22 个测试脚手架 def 已清空;目录扫描保留(无代码加载 —
 * 丢 JSON 进 definitions/ 即注册)。空库时 warn(fail loud,不静默兜底),
 * 画板照常加载 + Picker 空,阶段 C 才填首批 shape.
 *
 * 重复调用幂等(已 bootstrap 直接返回).
 */

import type { ShapeCategory, ShapeDef } from '../types';
import { ShapeRegistry } from './registry';
import { parseSvgToShapeDef } from './svg-to-shapedef';

let bootstrapped = false;

/** 已知 ShapeCategory(目录名约定校验;未知 category 的 svg fail loud 跳过) */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set<ShapeCategory>([
  'basic', 'geometry', 'arrow', 'flowchart', 'line', 'text',
]);

export function bootstrapShapes(): void {
  if (bootstrapped) return;
  let registered = 0;

  // ── JSON def(parametric / text)──
  const jsonModules = import.meta.glob<{ default: ShapeDef }>(
    './definitions/**/*.json',
    { eager: true },
  );
  for (const path in jsonModules) {
    const def = jsonModules[path].default;
    if (!def || !def.id) {
      console.warn(`[shape-library] skipped malformed shape JSON: ${path}`);
      continue;
    }
    ShapeRegistry.register(def);
    registered++;
  }

  // ── SVG 文件(L5-G6c B1.3:无代码工作流 — 丢 .svg 进 definitions/<category>/<name>.svg
  //    即运行期解析注册,不跑脚本)。文件名约定:父目录 = category,文件名 = name。──
  const svgModules = import.meta.glob<string>(
    './definitions/**/*.svg',
    { eager: true, query: '?raw', import: 'default' },
  );
  for (const path in svgModules) {
    const meta = svgPathToMeta(path);
    if (!meta) {
      console.warn(`[shape-library] skipped .svg with bad path convention: ${path}`);
      continue;
    }
    const def = parseSvgToShapeDef(svgModules[path], meta);
    if (!def) {
      // parseSvgToShapeDef 内部已 warn(fail loud);此处不重复
      continue;
    }
    ShapeRegistry.register(def);
    registered++;
  }

  // 空库 fail loud(库清空属阶段 A/B 中间态,正常,但显式 warn 不静默)
  if (registered === 0) {
    console.warn(
      '[shape-library] bootstrap: 0 shapes registered (空库)。'
        + 'L5-G6c 阶段 A 已清空旧 def,阶段 C 填首批;Picker 暂空属预期,非 bug。',
    );
  }
  bootstrapped = true;
}

/**
 * `./definitions/<category>/<name>.svg` → { id, category, name }(SV1=a 文件名约定)。
 * category 不在已知集 → 返 null(fail loud:目录名约定错)。
 */
function svgPathToMeta(
  path: string,
): { id: string; category: ShapeCategory; name: string } | null {
  const m = /\/definitions\/([^/]+)\/([^/]+)\.svg$/.exec(path);
  if (!m) return null;
  const category = m[1];
  const name = m[2];
  if (!KNOWN_CATEGORIES.has(category)) {
    console.warn(`[shape-library] .svg unknown category dir '${category}': ${path}`);
    return null;
  }
  return { id: `krig.${category}.${name}`, category: category as ShapeCategory, name };
}
