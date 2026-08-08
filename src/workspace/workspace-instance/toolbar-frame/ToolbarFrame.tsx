/**
 * ToolbarFrame — 顶部 Toolbar 容器(式样)
 *
 * 按 charter § 1.4:式样在本组件,内容由 toolbarRegistry 通过 ToolbarBinding 渲染。
 *
 * V1 vs V2:
 * - V1 Toolbar 是各 view 自带(NoteToolbar / GraphToolbar 各自实现)
 * - V2 Toolbar 式样统一,view 通过 Registry 注册内容(view 平等,无 variant)
 *
 * L5-B4:view 没注册 toolbar items 时整 frame 不渲染(不占 36px 高度)。
 * 适用 view 内自带 toolbar 的场景(如 web view 的 WebToolbar 沿用 V1 风格紧贴 workspace bar)。
 */

import { ToolbarBinding } from '@slot/frame-bindings/ToolbarBinding';
import { useToolbarVersion } from '@slot/frame-bindings/use-registry';
import { toolbarRegistry } from '@slot/toolbar-registry/toolbar-registry';
import './toolbar-frame.css';

interface ToolbarFrameProps {
  /** 当前 view ID */
  viewId: string | null;
  /** 本 frame 所属槽(SlotArea 透传)*/
  slot?: 'left' | 'right';
  /**
   * 本槽是否是活跃槽(feat/slot-navside-follow-active)。
   *
   * false 时整条工具栏压暗(标题变灰 + 底色降一档 + 按钮图标一起变灰)——
   * navSide 会随点击整个换掉,没有视觉锚点用户无法预判点击结果。
   *
   * 按钮跟着变灰是**诚实表达**而非 bug:点非活跃栏的按钮会先激活那一栏,
   * 语义上确实是"半禁用"。仍然可点(pointer-events 不动)。
   *
   * 省略(非 SlotArea 调用方)= 视为活跃,不压暗。
   */
  active?: boolean;
}

export function ToolbarFrame({ viewId, slot, active = true }: ToolbarFrameProps) {
  // 订阅 toolbarRegistry 变化(view 注册/卸载 items 时触发重渲)
  useToolbarVersion();

  // view 未激活 / 没注册任何 toolbar items 时整 frame 不渲染
  if (!viewId) return null;
  const items = toolbarRegistry.getItemsForView(viewId);
  if (items.length === 0) return null;

  return (
    <div className={`krig-toolbar-frame${active ? '' : ' krig-toolbar-frame--inactive'}`}>
      <ToolbarBinding viewId={viewId} slot={slot} />
    </div>
  );
}
