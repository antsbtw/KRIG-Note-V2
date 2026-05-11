/**
 * Atom 是 KRIG 语义层的数据原子，对应 ProseMirror node JSON 形态。
 *
 * 序列化器消费 Atom[]，与具体视图（Note / Graph / ...）解耦。
 *
 * 与 `src/plugins/note` 中的 PM schema 定义保持兼容；这里只声明序列化器
 * 需要的最小结构。
 */
export type Atom = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Atom[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};
