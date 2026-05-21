/** Slash 命令类型 */

/**
 * Slash 菜单分组(Notion 范式 — 静态分组,无 query 时全展示)
 *
 * - 'basic'    基本区块:Paragraph / H1-H3 / Bullet / Ordered / Task / Quote / Divider / Toggle
 * - 'media'    媒体:Image / Audio / Video / X Post / File / External Ref
 * - 'advanced' 高级:Code / Callout / Math / Math Visual / Mermaid / HTML / Table / 2 Columns
 *
 * 渲染时按 group 分段 + 顶部插组标题;有 query 时把模糊匹配 top-3 提到"建议"组。
 */
export type SlashGroup = 'basic' | 'media' | 'advanced';

export interface SlashItem {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry */
  command: string;
  /** 关键词(用户输入 / 后过滤)*/
  keywords?: string[];
  /** 关联 view(undefined = 全局)*/
  view?: string;
  /** 分组(Notion 范式);未填默认 'basic' */
  group?: SlashGroup;
  order?: number;
  /** lucide-react 图标名(可选);未填渲染 emoji fallback */
  icon?: string;
  /** 右侧 markdown hint(如 '#' / '###' / '```' / '-' / '1.' / '[]' / '>' / '"' / '---') */
  hint?: string;
}
