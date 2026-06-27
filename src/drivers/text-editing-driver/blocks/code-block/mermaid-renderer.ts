/**
 * Mermaid 渲染核心 — 模块单例 (V1 → V2 直迁;Phase 2 接入 graph-layout capability)
 *
 * V1 源:src/plugins/note/blocks/code-plugins/mermaid-plugin.ts
 *
 * 负责:
 * - lazy 初始化 mermaid + 通过 graph-layout capability 注入 ELK loader
 * - 渲染 mermaid 源到容器 (renderMermaidDiagram)
 * - 暴露 themes / templates 常量给 fullscreen 编辑器
 *
 * NodeView / Fullscreen 通过本模块的 getMermaidModule() 拿到全局 mermaid 实例,
 * 不重复 init.
 *
 * **Phase 2 重构**(原 `await import('@mermaid-js/layout-elk')`):
 * 改走 `requireCapabilityApi<GraphLayoutApi>('graph-layout').getMermaidElkLoader()` —
 * @mermaid-js/layout-elk 的 import 收敛到 capabilities/graph-layout/ 内,driver 层
 * ESLint 屏障禁止重复 import(详见 docs/tasks/cm6-elk-capability-refactor.md §Task C)。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { GraphLayoutApi } from '@capabilities/graph-layout/types';

let mermaidInitialized = false;
let mermaidModule: typeof import('mermaid').default | null = null;
let mermaidIdCounter = 0;

export type MermaidTheme = 'dark' | 'default' | 'forest' | 'neutral' | 'base';

export const MERMAID_THEMES: readonly MermaidTheme[] = [
  'dark', 'default', 'forest', 'neutral', 'base',
];

export const MERMAID_TEMPLATES: { label: string; code: string }[] = [
  { label: 'Flowchart', code: 'graph TD\n  A[开始] --> B{条件}\n  B -->|是| C[操作]\n  B -->|否| D[跳过]\n  C --> E[结束]\n  D --> E' },
  { label: 'Sequence', code: 'sequenceDiagram\n  participant A as 用户\n  participant B as 服务器\n  A->>B: 请求\n  B-->>A: 响应' },
  { label: 'Class', code: 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog {\n    +bark()\n  }\n  Animal <|-- Dog' },
  { label: 'State', code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start\n  Processing --> Done : finish\n  Done --> [*]' },
  { label: 'ER', code: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains\n  USER {\n    int id\n    string name\n  }' },
  { label: 'Gantt', code: 'gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  任务A :a1, 2024-01-01, 7d\n  任务B :after a1, 5d\n  section 阶段二\n  任务C :2024-01-15, 10d' },
  { label: 'Pie', code: 'pie title 分布\n  "A" : 40\n  "B" : 30\n  "C" : 20\n  "D" : 10' },
  { label: 'Mindmap', code: 'mindmap\n  root((主题))\n    分支A\n      叶子1\n      叶子2\n    分支B\n      叶子3' },
];

export function buildMermaidConfig(theme: MermaidTheme = 'dark') {
  return {
    startOnLoad: false,
    theme,
    darkMode: theme === 'dark',
    securityLevel: 'loose' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'monotoneY' as const,
      diagramPadding: 16,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 15,
      wrappingWidth: 400,
      defaultRenderer: 'elk' as const,
    },
  };
}

async function ensureMermaidInit(): Promise<void> {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaidModule = (await import('mermaid')).default;

  try {
    // Phase 2 重构:走 graph-layout capability 拿 ELK loader,@mermaid-js/layout-elk
    // 的 import 收敛到 capabilities/graph-layout/ 内(ESLint 单点屏障)。
    // getMermaidElkLoader 返回 Promise<unknown>(adapter 内 lazy import + 缓存)。
    const layoutApi = requireCapabilityApi<GraphLayoutApi>('graph-layout');
    const elkLayouts = await (layoutApi.getMermaidElkLoader() as Promise<unknown>);
    // registerLayoutLoaders 仅在 mermaid v11+ 上存在,types 未导出
    (mermaidModule as unknown as { registerLayoutLoaders: (l: unknown) => void })
      .registerLayoutLoaders(elkLayouts);
  } catch (e) {
    console.warn('[Mermaid] ELK layout not available, using dagre:', e);
  }

  mermaidModule.initialize(buildMermaidConfig('dark'));
}

/**
 * 渲染 Mermaid 为**纯 SVG 字符串**(导出成图用,X Articles 渲图兜底)。
 *
 * ★ 关键(2026-06-13 实机修「Tainted canvases may not be exported」):编辑器渲染用
 *   `htmlLabels:true`(节点标签走 `<foreignObject>` 包 HTML)→ 该 HTML 引外部样式/字体
 *   → 把 SVG 画进 canvas 时**污染 canvas**,`canvas.toDataURL()` 被安全策略拒 → SVG→PNG 失败。
 *   导出这条路改用 `htmlLabels:false`(纯 SVG `<text>` 标签,无 foreignObject)→ canvas 不污染。
 *
 * 临时把全局 mermaid 切到 htmlLabels:false 渲一次,渲完恢复(编辑器渲染是 lazy 的,
 * 这个短暂窗口不影响;X 导出是一次性操作)。语法错 throw(调用方 fail loud)。
 *
 * @returns 纯 SVG 字符串(无 foreignObject)。
 */
export async function renderMermaidToExportSvg(source: string): Promise<string> {
  const trimmed = source.replace(/[​‌‍﻿]/g, '').trim();
  if (!trimmed) throw new Error('Mermaid 源为空');
  await ensureMermaidInit();
  if (!mermaidModule) throw new Error('mermaid 模块未初始化');
  const renderId = `mermaid-export-${++mermaidIdCounter}`;
  try {
    // ★ 字号 = 编辑器一致(2026-06-13 第三轮):导出**完全照搬编辑器配置**(htmlLabels:true +
    //   useMaxWidth:true + 默认 fontSize)→ SVG 与编辑器里那张**一模一样**(字号/节点比例完全相同)。
    //   之前切 htmlLabels:false 改变了文字度量 = 字号对不上;现靠 svgToPngDataUrl 的 **data URI**
    //   解 canvas 污染(blob URL 才污染,data URI 同源不污染),所以可以放心用 htmlLabels:true。
    //   ⚠️ 若 foreignObject 仍致 tainted(HTML 引外部字体)→ svgToPng 会抛错,届时再考虑内联字体。
    mermaidModule.initialize(buildMermaidConfig('dark'));
    const { svg } = await mermaidModule.render(renderId, trimmed);
    return svg;
  } finally {
    document.getElementById('d' + renderId)?.remove();
  }
}

export const LS_MERMAID_THEME = 'krig-mermaid-theme';

export function readMermaidTheme(): MermaidTheme {
  const raw = localStorage.getItem(LS_MERMAID_THEME) as MermaidTheme | null;
  return raw && (MERMAID_THEMES as readonly string[]).includes(raw) ? raw : 'default';
}

export function saveMermaidTheme(theme: MermaidTheme): void {
  localStorage.setItem(LS_MERMAID_THEME, theme);
}

/** 渲染 Mermaid 图表到容器 */
export async function renderMermaidDiagram(
  source: string,
  container: HTMLElement,
  theme?: MermaidTheme,
): Promise<void> {
  const trimmed = source.replace(/[​‌‍﻿]/g, '').trim();
  if (!trimmed) {
    container.style.display = 'flex';
    container.innerHTML = '<div class="krig-code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
    return;
  }

  await ensureMermaidInit();
  if (!mermaidModule) return;
  const resolvedTheme = theme ?? readMermaidTheme();
  mermaidModule.initialize(buildMermaidConfig(resolvedTheme));
  const renderId = `mermaid-${++mermaidIdCounter}`;
  try {
    const { svg } = await mermaidModule.render(renderId, trimmed);
    container.style.display = 'flex';
    container.innerHTML = svg;
  } catch {
    container.style.display = 'flex';
    container.innerHTML = '<div class="krig-code-block__mermaid-error">Mermaid 语法错误</div>';
    document.getElementById('d' + renderId)?.remove();
  }
}

/** 获取 mermaid 模块(供 fullscreen 重新 initialize 不同主题用) */
export async function getMermaidModule(): Promise<typeof import('mermaid').default> {
  await ensureMermaidInit();
  if (!mermaidModule) throw new Error('mermaid module not initialized');
  return mermaidModule;
}
