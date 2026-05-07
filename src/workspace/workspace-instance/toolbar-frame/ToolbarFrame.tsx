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
}

export function ToolbarFrame({ viewId }: ToolbarFrameProps) {
  // 订阅 toolbarRegistry 变化(view 注册/卸载 items 时触发重渲)
  useToolbarVersion();

  // view 未激活 / 没注册任何 toolbar items 时整 frame 不渲染
  if (!viewId) return null;
  const items = toolbarRegistry.getItemsForView(viewId);
  if (items.length === 0) return null;

  return (
    <div className="krig-toolbar-frame">
      <ToolbarBinding viewId={viewId} />
    </div>
  );
}
