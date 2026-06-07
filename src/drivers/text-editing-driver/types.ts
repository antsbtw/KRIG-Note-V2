/**
 * text-editing-driver 类型定义
 *
 * 见 DESIGN.md v0.2.1 § 2.1 (Host props) + BLOCK-SPEC.md v0.1.1 (BlockSpec)
 */

import type { ComponentType } from 'react';
import type { NodeSpec } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

// ── Driver 协议:DriverSerialized 信封(承袭 driver 根协议 v0.2 § 3.1.1)──
export interface DriverSerialized<TPayload = unknown> {
  format: string;
  version: string;
  payload: TPayload;
}

// ── BlockSpec(BLOCK-SPEC.md v0.1.1 § 1.1)──
export interface BlockSpec {
  /** block ID,跨 driver 唯一(也作 PM nodeSpec name)*/
  readonly id: string;
  /** 显示名(给 SlashMenu / UI 用)*/
  readonly displayName: string;
  /** PM nodeSpec(必需)*/
  readonly spec: NodeSpec;
  /** 自定义 NodeView 工厂(可选)*/
  readonly nodeView?: NodeViewFactory;
  /** block 自带 PM plugin(可选)*/
  readonly plugin?: () => Plugin | Plugin[];
  /** 容器规则 */
  readonly containerRule?: 'leaf' | 'inline-only' | 'block+';
  /** cascadeBoundary:整体不可拆 */
  readonly cascadeBoundary?: boolean;
  /**
   * 键盘行为元数据(keyboard-system.md §5.3)。
   *
   * 集中键盘模块(keyboard/)的决策链按这些声明分支,使 Enter/Backspace 行为**数据驱动**,
   * 不再每块各写 keymap。新增 block 只声明本字段即获正确键盘行为。详见 keyboard-system.md。
   *
   * Phase 0(脚手架)仅定义字段 + 标注,**不挂载**;Phase 1/2 决策链才消费。
   */
  readonly keyboard?: KeyboardMeta;
}

/**
 * 块键盘行为声明(keyboard-system.md §5.3)。全部可选,默认按「普通 textblock」处理。
 */
export interface KeyboardMeta {
  /** 内部是小 note(键盘行为递归适用 + 边界可穿越):blockquote/callout/toggle/column */
  readonly isContainer?: boolean;
  /** 小 note 但硬墙不可退出(Enter 不跳出 / Backspace 不退出):tableCell/tableHeader */
  readonly isCellLike?: boolean;
  /** 单段 caption(Enter 跳出块下方建段 / Backspace 不删块):image/html/math-visual/audio/video/tweet */
  readonly isCaption?: boolean;
  /** 内部代码区(Enter=softBreak,双回车跳出):codeBlock/math-block */
  readonly isCodeArea?: boolean;
  /** 原子卡片(仅选中/handle 删块):hr/file-block/external-ref */
  readonly isAtomCard?: boolean;
  /** 块首退格保护(不删不合并):isTitle 段落(运行时按 attrs.isTitle 判定,见决策链) */
  readonly protectStart?: boolean;
  /** 拆块/退格继承的格式 attr 列表:paragraph/heading 用 ['indent','textIndent','align'] */
  readonly formatAttrs?: readonly string[];
}

export type NodeViewFactory = NonNullable<NodeSpec['toDOM']> extends never
  ? never
  : import('prosemirror-view').NodeViewConstructor;

// ── Host props (DESIGN.md v0.2.1 § 2.1) ──
export interface TextEditingHostProps {
  config: TextEditingConfig;
  doc: DriverSerialized;
  onChange: (newDoc: DriverSerialized) => void;
  readOnly?: boolean;
  className?: string;
}

/**
 * Plugin 启停开关(L5-G4.5 引入,view 按需关闭非必要 plugin).
 *
 * **默认全开**(NoteView 全套行为零回归);其他 view 按需 opt-out.
 *
 * 当前提供的开关(default true):
 * - blockHandle:   ⋮⋮ 左侧拖动手柄 + drag source(NoteView 段落拖移用)
 * - vocabHighlight:  词汇高亮 + hover tooltip(NoteView 词汇学习用)
 * - noteLinkCommand: [[ 触发双链搜索面板(NoteView 知识图谱用)
 * - pasteMedia:     剪贴板图片 → image block(NoteView mediaStore 集成)
 * - dropCursor:     拖拽时蓝线指示插入位置
 * - slash:          / 触发 slashMenuController(turn-into 入口)
 * - blockSelection: Notion-like 同级 sibling 多块选择(Esc/Shift+Arrow/Arrow 移动/右键菜单)
 *
 * **不暴露的 plugin**(始终开,PM 编辑器必备):
 * - history / inputRules / mark+heading keymap / list+codeBlock+hardBreak keymap /
 *   linkClick / baseKeymap / 各 block plugin
 *
 * **opt-in plugin**(默认 false,view 显式 true 才挂):
 * - titleGuard:NoteView 专属"强制首块 isTitle"守门;其他 view 不需要(noteTitle 是
 *   NoteView 业务概念,泄漏给其他 view 反而错乱)。
 *   C8 (D-D):从 driver 内硬编码 `viewId === 'note-view'` 改 toggle,view 显式声明。
 *   兼容期 driver 端保留 `viewId === 'note-view'` fallback,所有 view 显式声明后可删。
 *
 * Why default 全开(opt-out plugin 部分):driver 当前已对齐 NoteView 行为,任何
 * NoteView 不传 plugins 的场景必须零回归;只有新 view(canvas-text-node 等)显式
 * opt-out 才改变.
 */
export interface TextEditingPluginToggles {
  // opt-out(默认 true,view 显式 false 关闭)
  blockHandle?: boolean;
  vocabHighlight?: boolean;
  noteLinkCommand?: boolean;
  pasteMedia?: boolean;
  dropCursor?: boolean;
  slash?: boolean;
  blockSelection?: boolean;
  /** codeBlock 内联语法高亮(Phase 2 引入);NoteView 默认开,canvas-text-node 等可关 */
  codeSyntaxHighlight?: boolean;
  /** Heading 折叠(配合 TOC 面板);NoteView 默认开,canvas-text-node / thought 等单段 view 可关 */
  headingCollapse?: boolean;
  // opt-in(默认 false,view 显式 true 开启)
  titleGuard?: boolean;
  /**
   * 底部留白 + 双击空白尾区新增段落 + 失焦 Enter 新增段落(连续文档专属)。
   * fallback:viewId === 'note-view' 时默认开;Thought 等单段 view 不适用,默认关。
   */
  bottomPad?: boolean;
}

export interface TextEditingConfig {
  /** 实例 ID(P1.3,通常用 workspaceId)— driver 用此区分多 Host 实例 */
  instanceId: string;
  /** view 提供的 undo scope 名(铁律 6b)— 如 'text-editing.pm' */
  undoScope: string;
  /** view ID(L5-B3.1 — driver 通过此把 controller 事件 attribute 给具体 view)*/
  viewId: string;
  /** L5-G4.5 plugin 启停开关;不传 = 全开(NoteView 零回归) */
  plugins?: TextEditingPluginToggles;
}

// ── Driver 主接口(DESIGN.md v0.2.1 § 1.1)──
export interface TextEditingDriver {
  readonly id: 'text-editing-driver';
  readonly version: string;
  Host: ComponentType<TextEditingHostProps>;
  serialize(payload: unknown): DriverSerialized;
  deserialize(data: DriverSerialized): unknown | null;
}
