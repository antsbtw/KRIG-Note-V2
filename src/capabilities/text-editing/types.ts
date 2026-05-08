/**
 * text-editing capability — 对外类型(Wave 5 / D4 强制)
 *
 * view 端 import 路径:
 *   import type { TextEditingApi, DriverSerialized, MarkName } from '@capabilities/text-editing/types';
 *
 * 注意:driver 内部模块(@drivers/text-editing-driver/*)是 capability 实现细节,
 * view 层不可见。view 通过 capability api 间接拿运行时,通过本 types.ts 拿类型。
 */

import type { ComponentType } from 'react';

// 从 driver 层 re-export 业务类型(view 端单一来源)
export type {
  DriverSerialized,
  TextEditingHostProps,
  TextEditingConfig,
} from '@drivers/text-editing-driver';
export type { MarkName, ActiveBlockType, NoteLinkSearchHandler } from '@drivers/text-editing-driver';

import type {
  TextEditingHostProps,
  NoteLinkSearchHandler,
} from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';

/** TurnInto 目标 block 类型(slash / handle 命令用)*/
export type TurnTarget =
  | 'paragraph' | 'h1' | 'h2' | 'h3'
  | 'bullet-list' | 'ordered-list' | 'task-list'
  | 'blockquote' | 'code-block' | 'horizontal-rule'
  | 'callout' | 'toggle-list';

/** Driver Host 组件 props(re-export with sane name) */
export type DriverHost = ComponentType<TextEditingHostProps>;

/** link-click 路由 handler(view 注入)*/
export interface LinkClickHandler {
  onOpenNote: (noteId: string, blockAnchor?: string) => void;
  getCurrentNoteId: () => string | null;
  resolveNoteTitle: (noteId: string) => string | null;
  onOpenWebUrl: (url: string) => void;
}

// NoteLinkSearchHandler 已从 driver 层 re-export(line 13),不再重复声明

/** 实例注册表诊断字段(view 诊断路径用 — 软取场景)*/
export interface InstanceRegistryDiagnostic {
  readonly count: number;
}

/**
 * driver api 字段类型 — 直接 typeof driver export(单一来源,driver 加 method
 * view 自动可见,避免类型漂移)。
 *
 * 注:这里 import 的是 `typeof textEditingDriverApi`,**TS 把它擦成纯类型查询**,
 * 不引入运行时依赖(view 端 typecheck OK,bundle 不会拉 driver 模块)。
 */
import type { textEditingDriverApi as DriverApiInstance } from '@drivers/text-editing-driver';
export type TextEditingDriverApi = typeof DriverApiInstance;

/**
 * text-editing capability 对外 API
 */
export interface TextEditingApi {
  /** Driver Host 组件(NoteView 渲染 PM 实例用)*/
  readonly Host: DriverHost;

  /** Driver 命令式 API(命令 handler 用)*/
  readonly api: TextEditingDriverApi;

  /** view 注入 link-click 路由 */
  readonly setLinkClickHandler: (handler: LinkClickHandler) => void;

  /** view 注入 noteLink search 路由 */
  readonly setNoteLinkSearchHandler: (handler: NoteLinkSearchHandler) => void;
  /** noteLink plugin key(NoteLinkSearchPanel 读 plugin state 用)*/
  readonly noteLinkCommandKey: unknown;
  /** 取当前 noteLink active EditorView(NoteLinkSearchPanel 用)*/
  readonly getNoteLinkActiveView: () => unknown | null;

  /** 工厂函数 */
  readonly createEmptyDoc: () => DriverSerialized;
  readonly extractFirstParagraphText: (data: DriverSerialized) => string;

  /** 实例注册表(诊断:driver instance 计数)*/
  readonly instanceRegistry: InstanceRegistryDiagnostic;
}

// (内部占位类型已清理)
