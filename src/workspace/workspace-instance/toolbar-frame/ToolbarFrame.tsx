/**
 * ToolbarFrame — 顶部 Toolbar 容器(式样)
 *
 * 按 charter § 1.4:
 * - 式样由 Workspace Container 提供
 * - 内容由 L4 toolbarRegistry 注册(L3 阶段:占位)
 *
 * V1 vs V2:
 * - V1 Toolbar 是各 view 自带(NoteToolbar / GraphToolbar 各自实现)
 * - V2 Toolbar 式样统一,view 通过 Registry 注册内容(view 平等,无 variant)
 */

import './toolbar-frame.css';

export function ToolbarFrame() {
  return (
    <div className="krig-toolbar-frame">
      <div className="krig-toolbar-empty">Toolbar (待 L4 Registry 注册内容)</div>
    </div>
  );
}
