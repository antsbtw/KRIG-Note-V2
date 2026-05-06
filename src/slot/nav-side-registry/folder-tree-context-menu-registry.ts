/**
 * folderTreeContextMenuRegistry — FolderTree 右键菜单注册中心
 *
 * Q7=方案 2:跟 L4 contextMenuRegistry 平级(不合并 — ContextInfo 类型不一样)。
 *
 * 注册时机:view 在 self-register 时调 view 内的 register 函数(同 nav-side / commands 模式)。
 * scope 字段用 view-id 隔离不同 view 的菜单项。
 */

import type {
  ContextMenuItem,
  FolderTreeContextInfo,
} from '@slot/shared-ui/FolderTree/types';

export interface FolderTreeMenuRegistration {
  id: string;
  scope: string;
  appliesTo: ('item' | 'folder' | 'blank')[];
  /** 静态字符串或动态函数(根据 ctx 计算 — 多选时显示数量等) */
  label: string | ((ctx: FolderTreeContextInfo) => string);
  icon?: string;
  /** 仅作为分隔符渲染(label / command 等忽略) */
  separator?: boolean;
  /** 静态或动态 disabled 状态(为 true 时菜单项灰显) */
  disabled?: boolean | ((ctx: FolderTreeContextInfo) => boolean);
  /** 不满足时菜单项不出现(注意:跟 disabled 区别 — disabled 是显示但点不动) */
  enabledWhen?: (ctx: FolderTreeContextInfo) => boolean;
  /** 命令字符串(优先走 commandRegistry) */
  command?: string;
  /** commandArg:静态值或函数(常用于从 ctx 提取 targetId 等)*/
  commandArg?: unknown;
  commandArgFn?: (ctx: FolderTreeContextInfo) => unknown;
  /** 或回调(适合 clipboard / 多选删除等需要持有 ctx 的场景) */
  onSelect?: (ctx: FolderTreeContextInfo) => void;
  /** 排序数字,小的在前 */
  order?: number;
}

class FolderTreeContextMenuRegistry {
  private registrations: Map<string, FolderTreeMenuRegistration> = new Map();
  private listeners: Set<() => void> = new Set();

  register(reg: FolderTreeMenuRegistration): void {
    this.registrations.set(reg.id, reg);
    this.notify();
  }

  unregister(id: string): void {
    this.registrations.delete(id);
    this.notify();
  }

  /** 按 scope + 当前 ctx 算出可见菜单项,返回浮层组件可直接消费的 ContextMenuItem[] */
  getItems(scope: string, ctx: FolderTreeContextInfo): ContextMenuItem[] {
    const matching: FolderTreeMenuRegistration[] = [];
    for (const reg of this.registrations.values()) {
      if (reg.scope !== scope) continue;
      if (!reg.appliesTo.includes(ctx.target)) continue;
      if (reg.enabledWhen && !reg.enabledWhen(ctx)) continue;
      matching.push(reg);
    }
    matching.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return matching.map<ContextMenuItem>((reg) => {
      if (reg.separator) {
        return { id: reg.id, label: '', separator: true };
      }
      const label = typeof reg.label === 'function' ? reg.label(ctx) : reg.label;
      const disabled =
        typeof reg.disabled === 'function' ? reg.disabled(ctx) : reg.disabled === true;
      const commandArg = reg.commandArgFn ? reg.commandArgFn(ctx) : reg.commandArg;
      return {
        id: reg.id,
        label,
        icon: reg.icon,
        disabled,
        command: reg.command,
        commandArg,
        onClick: reg.onSelect ? () => reg.onSelect!(ctx) : undefined,
      };
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  get count(): number {
    return this.registrations.size;
  }
}

export const folderTreeContextMenuRegistry = new FolderTreeContextMenuRegistry();
