/**
 * Host 实例注册表 — 模块级单例 capability 命令 handler 通过此查找具体 EditorView
 *
 * 见 DESIGN.md v0.2.1 § 2.2(P1.2 多实例隔离修复)。
 *
 * 使用场景:
 * - Host mount 时:instanceRegistry.set(instanceId, { view })
 * - Host unmount 时:instanceRegistry.delete(instanceId)
 * - capability 命令 handler:从 selection.api.getCurrent().source 解析 instanceId,
 *   instanceRegistry.get(instanceId) 拿到具体 view
 */

import type { EditorView } from 'prosemirror-view';

interface InstanceEntry {
  view: EditorView;
  workspaceId: string;
  /**
   * 用户最后一次主动放置光标的位置(selection.from)。
   *
   * 由 Host onTransaction 在「tr.selectionSet 且 view.hasFocus()」时更新 —— 即真正由
   * 用户点击/打字造成的选区移动(排除程序化 / 冷启动默认 selection)。
   *
   * 用途:insertNodesAtCursorOrEnd 在 Note 失焦(如用户在 AI webview 右键提取)时,
   * 仍能插到用户上次在 Note 里点过的光标位置,而不是无脑插末尾。
   * undefined = 用户从未在本实例点过 → 插末尾。
   */
  lastUserSelectionFrom?: number;
}

class InstanceRegistry {
  private instances = new Map<string, InstanceEntry>();

  set(instanceId: string, entry: InstanceEntry): void {
    this.instances.set(instanceId, entry);
  }

  get(instanceId: string): InstanceEntry | undefined {
    return this.instances.get(instanceId);
  }

  delete(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  /** 记录用户最后一次主动放置的光标位置(Host onTransaction 调)*/
  setLastUserSelection(instanceId: string, from: number): void {
    const entry = this.instances.get(instanceId);
    if (entry) entry.lastUserSelectionFrom = from;
  }

  get count(): number {
    return this.instances.size;
  }

  /**
   * 遍历所有 instance(L5-B3.20b vocab broadcast 用,跨所有 PM 实例 dispatch 词表更新)
   */
  getAll(): InstanceEntry[] {
    return Array.from(this.instances.values());
  }

  /**
   * 从 selection source 字符串解析 instanceId
   * 'text-editing-driver:<instanceId>' → instanceId
   */
  parseSource(source: string): string | null {
    const prefix = 'text-editing-driver:';
    if (!source.startsWith(prefix)) return null;
    return source.slice(prefix.length);
  }

  /**
   * L5-G4.5 — 拿当前 EditorView.hasFocus()=true 的实例 id.
   *
   * **只读焦点状态,不掺杂 workspace / view 维度信息**(职责单一).
   * 调用端(如 NoteView withInstance)按需 fallback 到 workspace activeId.
   *
   * 用途:跨 view 的 PM 命令(toggleMark / setHeading 等)需要找"当前真正在编辑的
   * PM 实例" — workspace activeId 不够,因为 canvas-text-node Host 嵌入在 view
   * 内部 popup 里,instanceId 形态 = `${workspaceId}::${nodeId}`(复合),不等于
   * workspaceId.focus 是唯一可靠信号.
   *
   * 多实例同时 hasFocus 极罕见(浏览器单焦点);若发生返回找到的第一个.
   */
  getFocusedInstanceId(): string | null {
    for (const [id, entry] of this.instances) {
      if (entry.view.hasFocus()) return id;
    }
    return null;
  }

  /**
   * 反查 view 所属 instanceId(用于 NodeView 点击事件 — 此时 view 已知但
   * editor 可能因鼠标点 contentEditable=false 元素 hasFocus()=false,
   * 不能依赖 focused 路径).
   * 典型场景:callout emoji span click → onOpen(view, ...) → 需取 instanceId.
   */
  getInstanceIdByView(view: EditorView): string | null {
    for (const [id, entry] of this.instances) {
      if (entry.view === view) return id;
    }
    return null;
  }
}

export const instanceRegistry = new InstanceRegistry();
