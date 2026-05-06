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

  get count(): number {
    return this.instances.size;
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
}

export const instanceRegistry = new InstanceRegistry();
