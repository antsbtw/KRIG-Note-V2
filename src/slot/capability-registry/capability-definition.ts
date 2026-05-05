/**
 * Capability 定义类型(对齐 charter § 5.4)
 */

import type { CommandHandler } from '../command-registry/command-handler';

export interface CapabilityDefinition {
  /** 能力 ID(命名空间形如 'capability.<x>' 或简单 '<x>')*/
  id: string;
  /** 实例工厂(L5 view 调用获得可挂载的实例)*/
  createInstance?: (host: HTMLElement, options: unknown) => unknown;
  /** 能力暴露的命令(注册时自动加入 commandRegistry)*/
  commands?: Record<string, CommandHandler>;
  /** Schema 贡献(如 ProseMirror block/mark 定义)*/
  schema?: unknown;
  /** 数据转换(atom ↔ 内部表征)*/
  converters?: unknown;
}
