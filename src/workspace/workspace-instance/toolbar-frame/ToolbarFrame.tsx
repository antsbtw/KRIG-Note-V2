/**
 * ToolbarFrame — 顶部 Toolbar 容器(式样)
 *
 * 按 charter § 1.4:式样在本组件,内容由 toolbarRegistry 通过 ToolbarBinding 渲染。
 *
 * V1 vs V2:
 * - V1 Toolbar 是各 view 自带(NoteToolbar / GraphToolbar 各自实现)
 * - V2 Toolbar 式样统一,view 通过 Registry 注册内容(view 平等,无 variant)
 */

import { ToolbarBinding } from '@slot/frame-bindings/ToolbarBinding';
import './toolbar-frame.css';

interface ToolbarFrameProps {
  /** 当前 view ID */
  viewId: string | null;
}

export function ToolbarFrame({ viewId }: ToolbarFrameProps) {
  return (
    <div className="krig-toolbar-frame">
      <ToolbarBinding viewId={viewId} />
    </div>
  );
}
