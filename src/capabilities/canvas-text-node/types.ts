/**
 * canvas-text-node 对外类型(L5-G4.5)
 *
 * 职责:画板文字节点的 atom ↔ PM 桥接 + EditOverlay popup 管理.
 *
 * 设计:走 text-editing.Host 嵌入路径(G4.5 路径 A,plan v0.2 § 2 G4-2=B):
 * - 不自管 PM schema / plugins / EditorView 构建,Host 内部已封装
 * - 不自管 InlineToolbar — text-editing.Host 内部 setupFloatingToolbarTrigger
 *   已自动注册 floating-toolbar(与 NoteView 同源)
 * - instance.doc 存 DriverSerialized(PM JSON 封装),透传给 Host 作为初始 doc
 * - 编辑结束(commit)时 onChange 给的 DriverSerialized 直接写回 instance.doc
 *   无需反向 prosemirrorToAtoms
 *
 * NodeRenderer 展示态:atomsToSvgInput(instance.doc) → SerializerAtom[] → SVG → mesh
 */

import type { ComponentType } from 'react';
import type { Atom as SerializerAtom } from '../../lib/atom-serializers/svg';

/**
 * Atom-bridge API:展示态把 instance.doc 转成 SVG 序列化器消费的 Atom[]
 *
 * 输入契约:instance.doc 是 DriverSerialized(PM JSON 封装)或 V1 兼容的
 * NoteView Atom[](扁平 parentId 形态);两者都 hands off 转成 SerializerAtom[].
 */
export interface AtomBridgeApi {
  /** 展示态:instance.doc → 序列化器 Atom[](TextRenderer 消费) */
  atomsToSvgInput(doc: unknown): Promise<SerializerAtom[]>;
  /** ref 判断 helper(NodeRenderer / InteractionController 共享) */
  isTextNodeRef(ref: string | null | undefined): boolean;
}

/** 编辑会话入口选项 */
export interface EnterEditOptions {
  /** 关联的 instance id */
  instanceId: string;
  /** 初始 doc(DriverSerialized 或 V1 兼容 atoms[]) */
  initialDoc: unknown;
  /** popup 屏幕坐标(对齐节点 mesh 屏幕投影) */
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  /** Sticky 节点背景色(可选,popup 同色) */
  backgroundColor?: string;
  /** 是否固定高度(true: height + overflow auto;false: min-height 自然撑高) */
  heightFixed?: boolean;
  /** workspace id(text-editing.Host config.instanceId 用) */
  workspaceId: string;
  /** view id(text-editing 内 controller / floating-toolbar 区分用) */
  viewId: string;
  /** 编辑结束回调;commit=true 时 doc 是新 DriverSerialized,false 时丢弃 */
  onExit: (instanceId: string, doc: unknown | null) => void;
}

/** 编辑会话句柄(view 端用于主动退出) */
export interface EditSession {
  exit(commit: boolean): void;
  isActive(): boolean;
}

export interface CanvasTextNodeApi {
  /**
   * 进入编辑态:在画板上挂 popup,内嵌 text-editing.Host;返回 session 句柄.
   * 已有活跃 session 时先 commit 当前的,再开新的(V1 模式).
   */
  enterEdit(opts: EnterEditOptions): EditSession;
  /** 当前是否在编辑态(view 端浮层互斥判断用) */
  isEditing(): boolean;
  /** 订阅编辑态变化(view 端浮层互斥用,enter / exit 时触发);返回取消订阅函数 */
  onEditingChange(cb: (editing: boolean) => void): () => void;
  /** atom-bridge(NodeRenderer 展示态 + ref helper) */
  atomBridge: AtomBridgeApi;
  /** EditOverlay React 组件(view 端挂在画板顶层,canvas-rendering 内浮层归属对齐 G4-11=A) */
  EditOverlay: ComponentType<Record<string, never>>;
}
