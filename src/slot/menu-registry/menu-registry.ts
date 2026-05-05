/**
 * MenuRegistry — Application Menu 注册中心(主进程)
 *
 * V1 main/menu/registry.ts(85 行)沿用思路 + V2 改进:
 * - V1 含 handler 函数(运行时决议)
 * - V2 改为 command 字符串引用(charter § 1.2)
 *
 * 注:本模块在主进程,主进程的 commandRegistry 与 renderer 不同进程
 *     当前 L4 阶段用主进程内 commands 闭包(简化),后续可加 IPC bridge。
 */

import { Menu, MenuItemConstructorOptions } from 'electron';
import type { MenuRegistration, MenuItem, RoleMenu } from './menu-types';

class MenuRegistry {
  private menus: MenuRegistration[] = [];
  private roleMenus: RoleMenu[] = [];
  /** 主进程命令(主进程菜单 command 字符串引用)*/
  private commands: Map<string, () => void> = new Map();

  /** 注册自定义菜单 */
  register(reg: MenuRegistration): void {
    this.menus.push(reg);
  }

  /** 注册 Electron role 菜单(系统自动处理) */
  registerRoleMenu(id: string, label: string, order: number, role: string): void {
    this.roleMenus.push({ id, label, order, role });
  }

  /** 注册主进程命令(主进程菜单 command 调用此命令)*/
  registerCommand(id: string, handler: () => void): void {
    this.commands.set(id, handler);
  }

  /** 触发命令 */
  executeCommand(id: string): void {
    const handler = this.commands.get(id);
    if (handler) handler();
    else console.warn(`[L4] MenuRegistry: command '${id}' not registered`);
  }

  /** 重建 Application Menu(应用启动 / 菜单变化时调) */
  rebuild(): void {
    const allEntries: Array<{ order: number; template: MenuItemConstructorOptions }> = [];

    // 自定义菜单
    for (const m of this.menus) {
      allEntries.push({
        order: m.order,
        template: {
          label: m.label,
          submenu: m.items.map((item) => this.itemToTemplate(item)),
        },
      });
    }

    // Role 菜单(Electron 自动处理快捷键 — 如 Edit 含 Cmd+C/X/V/Z)
    for (const r of this.roleMenus) {
      allEntries.push({
        order: r.order,
        template: { label: r.label, role: r.role as MenuItemConstructorOptions['role'] },
      });
    }

    // 按 order 排序
    allEntries.sort((a, b) => a.order - b.order);

    const menu = Menu.buildFromTemplate(allEntries.map((e) => e.template));
    Menu.setApplicationMenu(menu);
  }

  private itemToTemplate(item: MenuItem): MenuItemConstructorOptions {
    if (item.separator) {
      return { type: 'separator' };
    }
    return {
      label: item.label,
      accelerator: item.accelerator,
      click: item.command ? () => this.executeCommand(item.command!) : undefined,
      submenu: item.submenu?.map((sub) => this.itemToTemplate(sub)),
    };
  }

  get count(): number {
    return this.menus.length + this.roleMenus.length;
  }
}

/** 主进程单例 */
export const menuRegistry = new MenuRegistry();
