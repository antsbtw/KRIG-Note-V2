/**
 * Capability 定义类型(对齐 charter § 5.4)
 */

import type { CommandHandler } from '../command-registry/command-handler';

export interface CapabilityDefinition {
  /** 能力 ID(命名空间形如 'capability.<x>' 或简单 '<x>')*/
  id: string;
  /**
   * 对外 API(Wave 5 新增)— view 通过 getCapabilityApi / requireCapabilityApi
   * 拿到此对象。capability 自由组织内部结构(可含方法 / 组件 / 字段引用)。
   *
   * 实际类型由 capability 暴露给消费者:`api as XApi` 或通过 helpers 的泛型参数。
   *
   * 注:这是 V2 工程实施增量,charter v0.4 line 92-105 没列此字段。详见
   * docs/RefactorV2/audit/wave5-design/Wave5-strict-compliance.md。
   */
  api?: unknown;
  /** 实例工厂(L5 view 调用获得可挂载的实例)*/
  createInstance?: (host: HTMLElement, options: unknown) => unknown;
  /** 能力暴露的命令(注册时自动加入 commandRegistry)*/
  commands?: Record<string, CommandHandler>;
  /** Schema 贡献(如 ProseMirror block/mark 定义)*/
  schema?: unknown;
  /** 数据转换(atom ↔ 内部表征)*/
  converters?: unknown;
}
