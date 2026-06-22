/**
 * canvas-rendering capability — 对外类型(L5-G3)
 *
 * 严格对齐 docs/10-business-design/graph/canvas/Canvas.md §4.1(Canvas note 内容).
 *
 * **画板实例数据类型归属**(G2-10=B 决策 + G3 v0.2 修订):
 * - V1 plugins/graph/library/types.ts 同时含 ShapeDef + SubstanceDef + Instance / InstanceEndpoint / TextNodeAtoms / InstanceKind
 * - V2 G2 已分离 ShapeDef / SubstanceDef → shape-library
 * - V2 G3 接收画板实例数据类型 → 本文件(canvas-rendering/types.ts)
 * - canvas-text-node / graph-library-store(IPC 边界仍用 unknown / CanvasDocumentJson)/
 *   future family-tree projection 等通过 `import type { Instance } from '@capabilities/canvas-rendering/types'` 拿
 *
 * **本文件 0 import three**(虽然 canvas-rendering 整体允许 import three,
 * 但 types.ts 不需要 — 暴露的是与 three 无关的画板数据类型 + 命令式 Host API).
 *
 * 详见 docs/RefactorV2/stages/L5G3-canvas-rendering-design.md v0.3 § 3.3.
 */

import type {
  ComponentType,
  ForwardRefExoticComponent,
  RefAttributes,
} from 'react';
import type { FillStyle, LineStyle, ArrowStyle, SubstanceDef } from '@capabilities/shape-library/types';

// ─────────────────────────────────────────────────────────
// Instance 系(V1 plugins/graph/library/types.ts 直迁)
// ─────────────────────────────────────────────────────────

export type InstanceKind = 'shape' | 'substance';

/**
 * 文字节点的语义内容类型(V1 M2.1 引入;decision 018 P0d hotfix 类型放宽).
 *
 * V2 sub-phase 3a-1 实际形态:DriverSerialized 信封
 *   { format:'pm-doc-json', version:'0.1', payload:{ type:'doc', content:[...] } }
 * 而非旧 V1 NoteView Atom[] 扁平形态.形态决议见 docs/RefactorV2/data-model/persistence/decisions/018.
 *
 * 此处用 unknown 是因为 canvas-rendering/types.ts 是基础类型层,不应直接依赖
 * text-editing capability;消费方(canvas-text-node 桥接 / 编辑层)做 import + 类型断言.
 *
 * 详见 docs/10-business-design/graph/canvas/Canvas-M2.1-TextNode-Spec.md §1.
 *
 * **G4 真消费**:canvas-text-node capability 承担 atom ↔ instance.doc 桥接.G3 不渲染文字.
 */
export type TextNodeAtoms = unknown;

export interface InstanceEndpoint {
  /** 连接到哪个 instance 的 id */
  instance: string;
  /** 连到该 instance 的哪个 magnet(N/S/E/W/START/END/...) */
  magnet: string;
}

/**
 * Canvas note 中的一个节点实例.
 *
 * shape / substance 实例:用 position + size 定位
 * line 实例:可用 endpoints(由两端 magnet 驱动,**G4 才支持**;G3 line 走占位)
 *           也可用 position + size(用户手动定位,无 magnet 跟随)
 */
export interface Instance {
  id: string;
  type: InstanceKind;
  /** 引用 Library 中的 shape / substance id */
  ref: string;

  /** 非 line 实例必备;line 实例若有 endpoints 可省略 */
  position?: { x: number; y: number };
  size?: { w: number; h: number };

  /**
   * 旋转(度数;顺时针方向 = 用户视觉的"顺时针")
   * 缺省 = 0(无旋转);旋转中心 = bbox 中心(position + size/2)
   * **G3 注**:渲染时尊重 rotation;但 G3 不提供 rotation handle UI(留 G4).
   */
  rotation?: number;

  /** line 实例两端连接(G4 真用;G3 不渲染 line) */
  endpoints?: [InstanceEndpoint, InstanceEndpoint];

  /** 用户调整的参数(覆盖 ShapeDef.params 的 default) */
  params?: Record<string, number>;

  /** 覆盖默认样式(对齐 Canvas.md §4.1) */
  style_overrides?: {
    fill?: Partial<FillStyle>;
    line?: Partial<LineStyle>;
    arrow?: Partial<ArrowStyle>;
  };

  /** substance 实例的业务属性(姓名 / gender / birth / death 等) */
  props?: Record<string, unknown>;

  /**
   * 文字节点语义内容(V1 M2.1 引入,G4 真消费).
   *
   * 仅当 ref === 'krig.text.label' 时生效;格式 = NoteView 同源 Atom[].
   * 详见 docs/10-business-design/graph/canvas/Canvas-M2.1-TextNode-Spec.md §1.
   */
  doc?: TextNodeAtoms;

  /**
   * 文字节点 size 锁(V1 M2.x 引入).仅 ref='krig.text.label' 用.
   * - undefined 或 false:维度未锁,adaptTextNodeSizeToContent 自动撑
   * - true:维度被用户主动 resize 锁住,内容溢出时不再自动改 size
   */
  size_lock?: { w?: boolean; h?: boolean };

  /**
   * 文字垂直对齐(V1 F-10).仅 ref='krig.text.label' 用 + size_lock.h=true 时生效.
   * - 'top'(默认 / undefined):内容顶部对齐
   * - 'middle':内容垂直居中(Sticky 默认)
   * - 'bottom':内容底部对齐
   */
  text_valign?: 'top' | 'middle' | 'bottom';

  /**
   * 字号 pt(L5-G5 Type section,画板专属).仅 ref='krig.text.label' 用.
   * 透传到 atomsToSvg baseFontSize 覆盖默认渲染字号.
   * - undefined:老画板无此字段 → sanitize 兜底 14(视觉不变,§5.4b)
   * - 新建文字节点默认 16(对齐 note 正文)
   */
  text_size?: number;

  /**
   * 字体族(L5-G5 Type section,画板专属).仅 ref='krig.text.label' 用.
   * 透传到 atomsToSvg fontFamily(CJK 字符仍强制中文字体).
   * - undefined / 'auto':自动选字(维持现状)
   * - 'sans' | 'serif' | 'mono' | 'handwriting':按打包字体族覆盖(§5.4)
   * - 'sysname:<family>':用户系统字体**记名**(L5-G7b,不嵌入;本机按名读 buffer 渲染,
   *   对方没装 / 缺字回退打包字体,不乱码;唯导出 PNG/SVG 时本机 outline 进产物)
   */
  text_font?: 'auto' | 'sans' | 'serif' | 'mono' | 'handwriting' | `sysname:${string}`;
}

// ─────────────────────────────────────────────────────────
// Host API(view 通过 ref 命令式调用 canvas-rendering)
// ─────────────────────────────────────────────────────────

/** 视口(world 坐标中心 + zoom);对齐 V1 schema_version=2 的 doc.view */
export interface Viewport {
  centerX: number;
  centerY: number;
  zoom: number;
}

/**
 * Canvas note 的内容形态(V1 schema_version=2/3 直迁,canvas-rendering 在 IPC
 * 边界外的内部表征;graph-library-store IPC 边界仍用 CanvasDocumentJson = unknown 透传).
 *
 * 详见 docs/10-business-design/graph/canvas/Canvas.md §4.1.
 */
export interface CanvasDocument {
  schema_version: number;
  view: Viewport;
  instances: Instance[];
  /**
   * 用户自创 substance 嵌入(combineSelectedToSubstance 写盘随画板).
   * - serialize:扫 instances.ref → SubstanceRegistry.get → source='user' 入此字段
   * - loadDocument:先 register 到 registry → 再 setInstances
   * V1 schema v1.x 临时字段;v1.5+ 拆独立 note 存储后此字段废弃.
   */
  user_substances?: SubstanceDef[];
}

/**
 * Picker / Toolbar 触发"添加模式"的入参(V1 AddModeSpec 直迁).
 * 详见 src/capabilities/canvas-rendering/interaction/InteractionController.ts
 */
export interface AddModeSpec {
  kind: InstanceKind;
  ref: string;
  defaultSize?: { w: number; h: number };
  presetInstance?: Partial<Instance>;
}

export interface CanvasHostProps {
  workspaceId: string;
  // G4 注入:文字节点 PM 桥接(canvas-text-node capability);G3 不用
  // textNode?: CanvasTextNodeApi;
  /** view 持久化:视口变化时推 doc_content.view */
  onViewportChange?: (vp: Viewport) => void;
  /** 选区变化(view 端 toolbar 状态用) */
  onSelectionChange?: (ids: string[]) => void;
  /** instances 变化(view 端 1s 防抖保存) */
  onInstancesChange?: (instances: Instance[]) => void;
  /** 画板右键(view 端通过 contextMenuRegistry 路由,G5 真接) */
  onContextMenu?: (e: { clientX: number; clientY: number; targetIds: string[] }) => void;
  /** addMode 状态变化(view UI 显隐 "Click to place" 提示 + crosshair cursor) */
  onAddModeChange?: (spec: AddModeSpec | null) => void;
  /**
   * 节点双击(G4.5 文字节点用):view 端拿 instanceId + 屏幕投影 → 调
   * canvas-text-node.enterEdit 打开 EditOverlay popup.
   */
  onNodeDoubleClick?: (info: {
    instanceId: string;
    screenX: number;
    screenY: number;
    screenW: number;
    screenH: number;
  }) => void;
}

/**
 * Host 命令式 API(view 通过 ref 调用).
 *
 * G3 范围:loadDocument / serialize / setViewport / fitToContent / zoomTo /
 * deleteSelected / clearSelection / getInstance(s).
 * G4 扩展:line 创建 / rewire / addMode / combineSelected / updateInstance(Inspector) /
 * enterTextEdit / 等.
 */
export interface CanvasHostHandle {
  /** 从画板 JSON 反序列化 — 切画板 / 重启恢复用 */
  loadDocument(doc: CanvasDocument): void;
  /** 序列化当前状态 — view 防抖保存用 */
  serialize(): CanvasDocument;
  /** 直接设视口 — view 端 toolbar zoom 滑块用 */
  setViewport(vp: Viewport): void;
  /** Fit-to-content;true 表示成功 fit,false 表示空画板/退化几何跳过 */
  fitToContent(padding?: number): boolean;
  /** zoom 百分比(100 = zoom=1) */
  zoomTo(percent: number): void;
  /** 删除当前选中 */
  deleteSelected(): void;
  /** 清空选中 */
  clearSelection(): void;
  /** 取单 instance 原始数据(view 端 Inspector G4 用,G3 不消费) */
  getInstance(id: string): Instance | null;
  /** 取全 instances 原始数据(view 端序列化 fallback,正常走 serialize) */
  getInstances(): Instance[];
  /** 进入"添加模式" — Picker 选好 shape/substance 后调,等用户点击画布放置 */
  enterAddMode(spec: AddModeSpec): void;
  /** 退出"添加模式"(view 端 ESC 兜底 / Picker 切换 / 主动取消) */
  exitAddMode(): void;
  /** 是否在添加模式(view 端 toolbar 高亮 Picker 按钮用) */
  isAddMode(): boolean;
  /**
   * 浅合并 patch 到 instance + 重新渲染.
   * Inspector 改 position/size/style_overrides 等都走这条.
   * 不存在的 id 静默忽略.
   */
  updateInstance(id: string, patch: Partial<Instance>): void;
  /**
   * Combine to Substance:把当前选中的 shape 实例打包成一个新 substance
   * 返回新 substance / instance id;失败(少于 2 个 shape 实例)返 null.
   * 详见 src/capabilities/canvas-rendering/combine.ts.
   */
  combineSelected(params: {
    name: string;
    category: string;
    description: string;
  }): { substanceId: string; newInstanceId: string; consumedIds: string[] } | null;
  /**
   * G4.5 P4:view 端 mount 后注入 canvas-text-node.atomBridge.atomsToSvgInput.
   * NodeRenderer 文字节点真渲染需此函数把 instance.doc → SerializerAtom[].
   * 不调时 text 节点降级为占位灰矩形.
   */
  setAtomBridge(fn: ((doc: unknown) => Promise<unknown[]>) | null): void;
  /**
   * G5 node-toolbar:选中节点的屏幕 AABB(容器内 CSS 像素,已处理旋转 OBB).
   * 浮条贴选中框正下方居中用.无选中 / 拿不到 mesh 返 null.
   * view 在 onSelectionChange / onViewportChange 时拉一次重定位.
   */
  getSelectedScreenAABB(): { x: number; y: number; w: number; h: number } | null;
}

// ─────────────────────────────────────────────────────────
// Registry API
// ─────────────────────────────────────────────────────────

export interface CanvasRenderingApi {
  Host: ForwardRefExoticComponent<CanvasHostProps & RefAttributes<CanvasHostHandle>>;
  /** Library Picker(画板内浮层,view 控 open/anchor 状态;G4.4a) */
  LibraryPicker: ComponentType<LibraryPickerComponentProps>;
  /** Create Substance Dialog(模态;G4.4c) */
  CreateSubstanceDialog: ComponentType<CreateSubstanceDialogComponentProps>;
  // FloatingInspector(G4.4b 右上角 Format Shape 浮窗)L5-G5 删除 — 被 node-toolbar
  // 选中框跟随浮条取代。
}

// UI 组件 props 形态(给 CanvasRenderingApi 用,实际类型在各组件文件)

export interface LibraryPickerComponentProps {
  open: boolean;
  anchorRect: { left: number; top: number; width: number; height: number } | null;
  onPick: (spec: AddModeSpec) => void;
  onClose: () => void;
}

export interface CreateSubstanceDialogComponentProps {
  open: boolean;
  defaultName?: string;
  defaultCategory?: string;
  onCreate: (result: { name: string; category: string; description: string }) => void;
  onCancel: () => void;
}
