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
  TextEditingPluginToggles,
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

/**
 * thought-anchor 路由 handler(view 注入,thought-view-port.md v0.5 §5.5)
 *
 * driver 内 anchor 点击 / decoration type 解析都通过这个 callback 让 view 决定:
 * - onAnchorClick:用户点 mark/node anchor → view 开 right slot ThoughtView + 激活卡片
 * - resolveThoughtType:driver decoration render 用,view 从 thoughtCapability 本地缓存查
 */
export type { ThoughtAnchorHandler, ThoughtAnchorClickPayload } from '@drivers/text-editing-driver';

// NoteLinkSearchHandler 已从 driver 层 re-export(line 13),不再重复声明

/**
 * 实例注册表诊断 + 焦点查询(view 用)
 *
 * L5-G4.5 加 getFocusedInstanceId:跨 view 命令(toggleMark / setHeading 等)
 * 通过此找到"当前真正持有焦点的 PM 实例",避开"workspace activeId 不等于 driver
 * instanceId"的场景(canvas-text-node Host 用复合 id `${ws}::${node}`).
 */
export interface InstanceRegistryDiagnostic {
  readonly count: number;
  readonly getFocusedInstanceId: () => string | null;
}

/**
 * Atom JSON 输入(L5-C6 PDF 提取契约 § 三)
 *
 * 见 docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md
 */
export interface AtomInput {
  id?: string;
  type: string;
  content?: Record<string, unknown>;
  parentId?: string;
  from?: { extractionType?: string; pdfPage?: number; extractedAt?: number };
  meta?: Record<string, unknown>;
}

/** PM doc 节点(atomsToProseMirror 输出) */
export interface PMDocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMDocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
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
 * PM 通用菜单 item 工厂集(C8 W5 整改 W-1)
 *
 * view 端不可直 import @capabilities/text-editing/ui/* 运行时值(W5 规则),
 * 改走 requireCapabilityApi<TextEditingApi>('text-editing').ui.<sub>.createX(viewId)。
 *
 * typeof namespace import 设计:
 * - 工厂模块加新 export view 自动可见,无需手列签名
 * - import type 编译期擦除,view bundle 不引入 ui/* 运行时模块
 */
import type * as FloatingToolbarFactory from './ui/floating-toolbar/items';
import type * as ToolbarFactory from './ui/toolbar/items';
import type * as SlashMenuFactory from './ui/slash-menu/items';
import type * as HandleMenuFactory from './ui/handle-menu/items';
import type * as ContextMenuFactory from './ui/context-menu/items';

export interface TextEditingUiApi {
  readonly floatingToolbar: typeof FloatingToolbarFactory;
  readonly toolbar: typeof ToolbarFactory;
  readonly slashMenu: typeof SlashMenuFactory;
  readonly handleMenu: typeof HandleMenuFactory;
  readonly contextMenu: typeof ContextMenuFactory;
}

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

  /** thought-view Phase 3:view 注入 thought-anchor 路由(点击 mark/node + decoration 色解析) */
  readonly setThoughtAnchorHandler: (
    handler: import('@drivers/text-editing-driver').ThoughtAnchorHandler | null,
  ) => void;

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

  /**
   * L5-C6:Atom JSON → PM doc 节点数组
   *
   * 输入契约:docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md
   * 输出可直接装 doc.content,再封 DriverSerialized 信封。
   * 调用前应先用 sanitizeAtoms 清洗。
   */
  readonly atomsToProseMirror: (input: { atoms: AtomInput[] }) => Promise<PMDocNode[]>;

  /**
   * L5-C6:Atom 清洗(契约 § 9 八条容错)
   *
   * 处理 v1→v2 类型迁移、document root 过滤、空 text 节点过滤等。
   * 必须在 atomsToProseMirror 之前调用。
   */
  readonly sanitizeAtoms: (atoms: AtomInput[]) => AtomInput[];

  /**
   * PM 通用菜单 item 工厂(C8 W5 整改 W-1)
   *
   * view 拼装 floating-toolbar / toolbar / slash-menu / handle-menu / context-menu
   * 时调本字段下的工厂函数(传 viewId),不直接 import @capabilities/text-editing/ui/*。
   */
  readonly ui: TextEditingUiApi;
}

// (内部占位类型已清理)
