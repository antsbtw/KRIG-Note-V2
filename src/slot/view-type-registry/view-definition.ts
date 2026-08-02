/**
 * ViewDefinition 类型
 *
 * L5 view 注册自身的声明(charter § 1.4 view 是能力组合声明)。
 */

import type { ComponentType } from 'react';
import type { ContextMenuItem } from '../interaction-registries/context-menu-registry/context-menu-types';
import type { SlashItem } from '../interaction-registries/slash-registry/slash-types';
import type { HandleItem } from '../interaction-registries/handle-registry/handle-types';
import type { FloatingToolbarItem } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-types';
import type { ToolbarItem } from '../toolbar-registry/toolbar-types';
import type { KeymapBinding } from '../keymap-registry/keymap-types';

/** view 组件 props — payload 由 bus.slot.openRight 传入,view 实例 mount 时拿到 */
export interface ViewComponentProps {
  /** Workspace ID(view 用来调 bus / 读 pluginStates)*/
  workspaceId: string;
  /** bus.slot.openRight 传入的 payload(可选)*/
  payload?: unknown;
}

/** ViewSwitcher Tab 信息(NavSide 顶部 view 切换条用)*/
export interface NavSideTab {
  /** 显示文字(如 "Note" / "eBook")*/
  label: string;
  /** 图标 — emoji 或 资源 URL(import 进来的图片)*/
  icon: string;
  /** 排序(小的在前,5 个内置 view 顺序固定:Note<eBook<Web<AI<Graph)*/
  order: number;
  /**
   * 切到此 view 时 NavSide 的行为。
   * - 'expand'（默认）：强制展开 NavSide
   * - 'collapse'：强制折叠 NavSide
   */
  navSideOnSwitch?: 'expand' | 'collapse';
  /**
   * 此 view 没有 NavSide 内容，禁止通过点击已激活 tab 展开 NavSide。
   * 独立于 navSideOnSwitch（Web 切换时收起但仍可手动 toggle）。
   */
  navSideDisabled?: boolean;
  /**
   * SlotPicker 展开子项（可选）。
   * 填写后 SlotPicker 不显示 view 本身，而是展开为这些子项。
   * 子项点击时打开 right slot 并通过 payload 传递 subId。
   */
  slotPickerChildren?: Array<{ subId: string; label: string; icon: string }>;
}

export interface ViewDefinition {
  /** view ID(命名反映能力组合,如 'note' / 'graph-canvas')*/
  id: string;
  /** install 的能力 ID 列表 */
  install: string[];
  /**
   * view 主体组件(可选 — L3.5 不强制,L5 view 注册时必填)
   *
   * SlotArea 渲染时按 viewId 查 component,**实例按 viewId 缓存**(铁律 7),
   * right→left 升级时位置变但实例不重建,状态保留。
   */
  component?: ComponentType<ViewComponentProps>;
  /** ViewSwitcher 显示用(可选 — 不填的 view 不出现在切换条,如 L5 内部辅助 view)*/
  navSideTab?: NavSideTab;
  /**
   * SlotPicker 独立入口(可选)— **只**出现在 right slot 选择器,不上 NavSide 切换条。
   *
   * 给 thought-view 这类 hidden view 用:无 navSideTab(不占左侧导航),但用户需要
   * 能手动把它召回右槽(如问 AI 后回看 pending thought)。有 navSideTab 的 view
   * 不需要此字段 — SlotPicker 本就列出它们。
   */
  slotPickerEntry?: { label: string; icon: string; order: number };
  /** view 独有右键菜单项(可选;注册时自动拆到 contextMenuRegistry,view 字段补为 id)*/
  contextMenu?: Omit<ContextMenuItem, 'view'>[];
  /** view 独有 Toolbar 项 */
  toolbar?: Omit<ToolbarItem, 'view'>[];
  /** view 独有 Slash 项 */
  slash?: Omit<SlashItem, 'view'>[];
  /** view 独有 Handle 项 */
  handle?: Omit<HandleItem, 'view'>[];
  /** view 独有 FloatingToolbar 项 */
  floatingToolbar?: Omit<FloatingToolbarItem, 'view'>[];
  /** view 全局快捷键(可选;只在该 view 是当前活跃 view 时生效)— W4.1 */
  keymap?: KeymapBinding[];
}
