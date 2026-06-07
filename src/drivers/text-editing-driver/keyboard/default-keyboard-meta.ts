/**
 * default-keyboard-meta — 内置块的键盘元数据集中表(keyboard-system.md §5.3)
 *
 * 为什么集中在此而非散到 18 个 spec.ts:Phase 0 元数据尚未被决策链消费,集中一处
 * 便于审阅/迭代;BlockSpec.keyboard 仍可对单块**覆盖**(buildKeyboardMetaLookup 合并)。
 * 未来若希望块自描述,可逐步把条目迁回各 spec.ts 的 keyboard 字段。
 *
 * 字段含义见 types.ts 的 KeyboardMeta。键 = BlockSpec.id(= PM node type name)。
 */

import type { KeyboardMeta } from '../types';

const FORMAT_ATTRS = ['indent', 'textIndent', 'align'] as const;

export const DEFAULT_KEYBOARD_META: Readonly<Record<string, KeyboardMeta>> = {
  // 文本类:拆块/退格继承格式
  paragraph: { formatAttrs: FORMAT_ATTRS },
  heading: { formatAttrs: FORMAT_ATTRS },

  // 容器类:内部小 note,可穿越边界
  blockquote: { isContainer: true },
  callout: { isContainer: true },
  toggleList: { isContainer: true },
  columnList: { isContainer: true },
  column: { isContainer: true },

  // 表格:cell 小 note 但硬墙
  tableCell: { isCellLike: true },
  tableHeader: { isCellLike: true },

  // caption 类:单段,Enter 跳出 / Backspace 不删块
  image: { isCaption: true },
  htmlBlock: { isCaption: true },
  mathVisual: { isCaption: true },
  audioBlock: { isCaption: true },
  videoBlock: { isCaption: true },
  tweetBlock: { isCaption: true },

  // 代码区:Enter=softBreak,双回车跳出
  codeBlock: { isCodeArea: true },
  mathBlock: { isCodeArea: true },

  // 原子卡片:仅选中/handle 删块
  horizontalRule: { isAtomCard: true },
  fileBlock: { isAtomCard: true },
  externalRef: { isAtomCard: true },

  // 列表项:退格退出列表 / Enter 拆项(决策链按 type 名识别 listItem/taskItem)
  // (无需特殊 meta 字段,决策链直接按 type 名分支)
};
