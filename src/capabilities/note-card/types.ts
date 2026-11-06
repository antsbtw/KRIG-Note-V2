/**
 * note-card capability 对外类型 —— 「在别的画面上放一小段 note」的公共组件
 *
 * 设计稿:docs/10-business-design/note/note-card-公共组件设计.md
 *
 * 模型(用户 2026-11-06 确认):一份 note 内容 → 用 note 编辑器编辑(任何模块都能调起)
 * → 统一渲染成卡片 → 各模块只管放哪、多宽。
 */

import type { ComponentType } from 'react';
import type { CardFrameProps } from './CardFrame';
import type { TextEditingUiApi } from '@capabilities/text-editing/types';

/** note doc 信封(与 text-editing Host 的 DriverSerialized 同形;version 必填,缺了编辑器静默空白) */
export interface NoteDoc {
  format: 'pm-doc-json';
  version: '0.1';
  payload: { type: 'doc'; content: NoteNode[] };
}

/** PM JSON 节点(只声明用到的最小结构;= atomsToSvg 消费的 Atom) */
export interface NoteNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NoteNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface NoteCardRect {
  left: number;
  top: number;
  width: number;
  minHeight?: number;
}

export interface NoteCardEditorProps {
  doc: NoteDoc;
  /** 编辑框位置(屏幕像素,fixed) */
  rect: NoteCardRect;
  /** 使用方自己的 viewId —— 菜单内容按它注册(见 menuItems) */
  viewId: string;
  /** 编辑器实例 id / 撤销域;使用方保证唯一 */
  sessionKey: string;
  /** ⋮⋮ 块手柄开关;缺省 false(= 画板)。用户 2026-11-06:「手柄显示与否作为一个开关」 */
  blockHandle?: boolean;
  /** 提交给 doc;放弃给 null */
  onExit: (doc: NoteDoc | null) => void;
}

type SlashItems = ReturnType<TextEditingUiApi['slashMenu']['createTurnIntoItems']>;
type FloatingItems = ReturnType<TextEditingUiApi['floatingToolbar']['createMarkButtons']>;
type HandleItems = ReturnType<TextEditingUiApi['handleMenu']['createTurnIntoSubmenu']>;

export interface NoteCardMenuItems {
  slash: SlashItems;
  floatingToolbar: FloatingItems;
  /** 只有打开块手柄时才需要注册 */
  handle: HandleItems;
}

export interface NoteCardApi {
  // ① 内容
  emptyDoc(): NoteDoc;
  fromPlainText(text: string | undefined): NoteDoc;
  toPlainText(doc: NoteDoc | undefined): string;
  /** 卡片内容;空 doc(只有一个空段落)→ null */
  contentOf(doc: NoteDoc | undefined): NoteNode[] | null;

  // ② 显示
  renderSvg(doc: NoteDoc | NoteNode[], opts: { width: number; color?: string }):
    Promise<{ svg: string; width: number; height: number }>;

  // ③ 编辑(行为 = 画板编辑浮层;组件由使用方自己挂,不是全局单例)
  Editor: ComponentType<NoteCardEditorProps>;
  /**
   * 该 viewId 的菜单项,与画板注册的同一套(斜杠 = 过渲染闸的「转换为…」+ 块公式;
   * 浮动工具条 = 文字样式 / 公式 / 链接 / 颜色;手柄 = 转换 / 颜色 / 格式 / 块操作,「转换为…」过闸)。
   * 只生成不注册:沿用 text-editing「工厂只返回 Item[],注册源在使用方」,
   * 且 capability 不允许依赖 slot 菜单注册表。使用方注册一次(幂等由使用方保证)。
   */
  menuItems(viewId: string): NoteCardMenuItems;

  // ④ 框(屏幕像素;拖动 / 拖左右边改宽 / 双击编辑 / 右键)
  CardFrame: ComponentType<CardFrameProps>;
  /** 拖边改宽的计算(宿主做「哪边不动」的补偿时可复用) */
  resizeFromEdge(
    startLeft: number, startWidth: number, dx: number, edge: 'left' | 'right',
    minWidth?: number, maxWidth?: number,
  ): { left: number; width: number };
}

export type { CardFrameProps, CardFrameRect } from './CardFrame';
