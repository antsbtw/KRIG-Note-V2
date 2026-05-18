/**
 * slash-menu item 工厂(C3 上提,D-B 决议)
 *
 * 任何 PM-using view 可调本工厂拼装自己的 slash 菜单:
 *
 *   slashRegistry.register([
 *     ...createTurnIntoItems('note-view'),     // 11 项 turn-into
 *     createMathBlockItem('note-view'),         // math-block
 *     ...createMyBusinessInsertItems('note-view'),  // view 自己的业务插入(image/table/...)
 *   ]);
 *
 * 设计原则:
 * - 工厂只返回 Item[],不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.slash.h1`)+ item.view 字段
 * - command 走 C1 重命名后的 text-editing.* 命名空间
 *
 * 业务插入(image/table/audio/video/tweet/file-block/external-ref)留 view 自注册:
 * 它们依赖 mediaStore / tweetFetcher / ytdlp 等业务 capability,非 PM 通用,
 * canvas-text-node / thought-view 不必有(见 C0 §三 §🟢 决议 D-3)。
 */

import type { SlashItem } from '@slot/interaction-registries/slash-registry/slash-types';

/** 11 项 turn-into:Paragraph / H1-H3 / Bullet / Ordered / Task / Quote / Code / Divider / Callout / Toggle */
export function createTurnIntoItems(viewId: string): SlashItem[] {
  return [
    {
      id: `${viewId}.slash.p`,
      label: 'Paragraph',
      command: 'text-editing.slash-turn-paragraph',
      keywords: ['p', 'paragraph', 'text', 'plain'],
      view: viewId,
      order: 10,
    },
    {
      id: `${viewId}.slash.h1`,
      label: 'Heading 1',
      command: 'text-editing.slash-turn-h1',
      keywords: ['h1', 'heading', 'title', 'header'],
      view: viewId,
      order: 20,
    },
    {
      id: `${viewId}.slash.h2`,
      label: 'Heading 2',
      command: 'text-editing.slash-turn-h2',
      keywords: ['h2', 'heading', 'header'],
      view: viewId,
      order: 30,
    },
    {
      id: `${viewId}.slash.h3`,
      label: 'Heading 3',
      command: 'text-editing.slash-turn-h3',
      keywords: ['h3', 'heading', 'header'],
      view: viewId,
      order: 40,
    },
    {
      id: `${viewId}.slash.bullet`,
      label: 'Bullet List',
      command: 'text-editing.slash-turn-bullet',
      keywords: ['bullet', 'ul', 'list', 'unordered'],
      view: viewId,
      order: 50,
    },
    {
      id: `${viewId}.slash.ordered`,
      label: 'Numbered List',
      command: 'text-editing.slash-turn-ordered',
      keywords: ['ordered', 'ol', 'list', 'number'],
      view: viewId,
      order: 60,
    },
    {
      id: `${viewId}.slash.task`,
      label: 'Task List',
      command: 'text-editing.slash-turn-task',
      keywords: ['task', 'todo', 'checkbox', 'check'],
      view: viewId,
      order: 70,
    },
    {
      id: `${viewId}.slash.quote`,
      label: 'Quote',
      command: 'text-editing.slash-turn-quote',
      keywords: ['quote', 'blockquote'],
      view: viewId,
      order: 80,
    },
    {
      id: `${viewId}.slash.code`,
      label: 'Code Block',
      command: 'text-editing.slash-turn-code',
      keywords: ['code', 'codeblock', 'pre'],
      view: viewId,
      order: 90,
    },
    {
      id: `${viewId}.slash.divider`,
      label: 'Divider',
      command: 'text-editing.slash-turn-divider',
      keywords: ['divider', 'hr', 'horizontal', 'rule', 'separator'],
      view: viewId,
      order: 100,
    },
    {
      id: `${viewId}.slash.callout`,
      label: 'Callout',
      command: 'text-editing.slash-turn-callout',
      keywords: ['callout', 'tip', 'warning', 'note', 'admonition'],
      view: viewId,
      order: 110,
    },
    {
      id: `${viewId}.slash.toggle`,
      label: 'Toggle List',
      command: 'text-editing.slash-turn-toggle',
      keywords: ['toggle', 'fold', 'collapse', 'expand', 'detail'],
      view: viewId,
      order: 120,
    },
  ];
}

/**
 * Math Block(行内公式在 floating toolbar,不在 slash)
 *
 * 数学公式画板节点也常用 — canvas-text-node / thought-view 同样想插入数学公式块,
 * 故视为 PM 通用(决议 D-3 例外)。
 */
export function createMathBlockItem(viewId: string): SlashItem {
  return {
    id: `${viewId}.slash.math-block`,
    label: 'Math Block',
    command: 'text-editing.slash-insert-math-block',
    keywords: ['math', 'latex', 'equation', 'formula', '公式'],
    view: viewId,
    order: 140,
  };
}

/**
 * Mermaid Block (V1 → V2 直迁)
 *
 * Mermaid 图表块也常用 — flowchart / sequence / class / ER / Gantt / pie / mindmap 等。
 * 视为 PM 通用(同 Math 思路)。
 */
export function createMermaidBlockItem(viewId: string): SlashItem {
  return {
    id: `${viewId}.slash.mermaid-block`,
    label: 'Mermaid Diagram',
    command: 'text-editing.slash-insert-mermaid-block',
    keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart', 'graph', '图表', '流程图'],
    view: viewId,
    order: 142,
  };
}

/**
 * HTML Preview Block (V1 → V2 直迁)
 *
 * sandbox iframe 渲染 AI 生成的 HTML artifact(D3 / Chart.js / UI 原型等)。
 * 视为 PM 通用(同 Math / Mermaid 思路)。
 */
export function createHtmlBlockItem(viewId: string): SlashItem {
  return {
    id: `${viewId}.slash.html-block`,
    label: 'HTML Preview',
    command: 'text-editing.slash-insert-html-block',
    keywords: ['html', 'web', 'preview', 'artifact', '网页', '预览'],
    view: viewId,
    order: 144,
  };
}

/**
 * Math Visual Block(V1 → V2 迁移 Phase 1B,走 math-rendering capability)
 *
 * 交互式函数图 Block — Mafs 画布 + mathjs 求值 + LaTeX 公式输入。
 * 与 Math Block(KaTeX 公式静态渲染)是不同节点:Math Visual 是动态绘图。
 * 视为 PM 通用(同 Math / Mermaid / HTML 思路)。
 */
export function createMathVisualBlockItem(viewId: string): SlashItem {
  return {
    id: `${viewId}.slash.math-visual`,
    label: 'Function Graph',
    command: 'text-editing.slash-insert-math-visual',
    keywords: ['graph', 'plot', 'function', 'math', 'visual', 'mafs', '函数图', '绘图'],
    view: viewId,
    order: 146,
  };
}
