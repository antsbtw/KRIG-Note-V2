/**
 * Application Menu 类型(macOS / Win / Linux 系统级菜单)
 *
 * V1 menu/registry.ts 思路沿用 + 扩展:
 * - V1 含 handler 函数(运行时决议)
 * - V2 改为 command 字符串引用(charter § 1.2 注册原则)
 */

export interface MenuItem {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry(主进程命令) */
  command?: string;
  /** 快捷键 */
  accelerator?: string;
  /** 分隔线(label / command 等不生效)*/
  separator?: boolean;
  /** 子菜单 */
  submenu?: MenuItem[];
}

export interface MenuRegistration {
  id: string;
  label: string;
  /** 排序值(小在前)*/
  order: number;
  items: MenuItem[];
}

/** Electron role 菜单(系统自动处理快捷键)*/
export interface RoleMenu {
  id: string;
  label: string;
  order: number;
  /** Electron role 名(如 'editMenu' / 'windowMenu')*/
  role: string;
}
