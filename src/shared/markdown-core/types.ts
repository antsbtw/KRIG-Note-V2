/**
 * markdown-core 共享类型
 *
 * PMNode = 纯数据 ProseMirror JSON 节点（不依赖 prosemirror-model），与
 * `@capabilities/text-editing/converters/md-to-pm` 的 PMNode 结构一致。
 */

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/**
 * 「未覆盖」出口哨兵节点。
 *
 * markdownCore 是 B1 地基，只规范解析 B1 block（heading/paragraph/horizontalRule/
 * codeBlock/mathBlock + 基础 inline mark）。遇到 B1 未覆盖的 block 类型（list/table/
 * callout/image/blockquote/media…），**绝不静默吞** —— 产出本哨兵节点，把原始 markdown
 * 源行原样带出，交由 caller（②外壳 / ①外壳）用各自现有逻辑处理。
 *
 * B2–B4 会逐类把 uncovered block 收进核，届时本哨兵对应分支消失。
 *
 * 注意：本节点**不是** PM schema 合法节点，caller 必须在拿到 markdownCore 输出后
 * 把每个 uncovered 节点替换掉（用 rawLines 重新走自己的解析），不能直接落库。
 */
export const UNCOVERED_TYPE = '__markdown_core_uncovered__' as const;

export interface UncoveredNode extends PMNode {
  type: typeof UNCOVERED_TYPE;
  attrs: {
    /** 未覆盖块的原始 markdown 行（换行拼接），供 caller 重新解析，不丢内容 */
    rawLines: string;
  };
}

export function isUncovered(node: PMNode): node is UncoveredNode {
  return node.type === UNCOVERED_TYPE;
}

export function uncoveredNode(rawLines: string): UncoveredNode {
  return { type: UNCOVERED_TYPE, attrs: { rawLines } };
}
