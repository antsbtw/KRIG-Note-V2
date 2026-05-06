/**
 * text-editing-driver 类型定义
 *
 * 见 DESIGN.md v0.2.1 § 2.1 (Host props) + BLOCK-SPEC.md v0.1.1 (BlockSpec)
 */

import type { ComponentType } from 'react';
import type { NodeSpec } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

// ── Driver 协议:DriverSerialized 信封(承袭 driver 根协议 v0.2 § 3.1.1)──
export interface DriverSerialized<TPayload = unknown> {
  format: string;
  version: string;
  payload: TPayload;
}

// ── BlockSpec(BLOCK-SPEC.md v0.1.1 § 1.1)──
export interface BlockSpec {
  /** block ID,跨 driver 唯一(也作 PM nodeSpec name)*/
  readonly id: string;
  /** 显示名(给 SlashMenu / UI 用)*/
  readonly displayName: string;
  /** PM nodeSpec(必需)*/
  readonly spec: NodeSpec;
  /** 自定义 NodeView 工厂(可选)*/
  readonly nodeView?: NodeViewFactory;
  /** block 自带 PM plugin(可选)*/
  readonly plugin?: () => Plugin | Plugin[];
  /** 容器规则 */
  readonly containerRule?: 'leaf' | 'inline-only' | 'block+';
  /** cascadeBoundary:整体不可拆 */
  readonly cascadeBoundary?: boolean;
}

export type NodeViewFactory = NonNullable<NodeSpec['toDOM']> extends never
  ? never
  : import('prosemirror-view').NodeViewConstructor;

// ── Host props (DESIGN.md v0.2.1 § 2.1) ──
export interface TextEditingHostProps {
  config: TextEditingConfig;
  doc: DriverSerialized;
  onChange: (newDoc: DriverSerialized) => void;
  readOnly?: boolean;
  className?: string;
}

export interface TextEditingConfig {
  /** 实例 ID(P1.3,通常用 workspaceId)— driver 用此区分多 Host 实例 */
  instanceId: string;
  /** view 提供的 undo scope 名(铁律 6b)— 如 'note-view.pm' */
  undoScope: string;
}

// ── Driver 主接口(DESIGN.md v0.2.1 § 1.1)──
export interface TextEditingDriver {
  readonly id: 'text-editing-driver';
  readonly version: string;
  Host: ComponentType<TextEditingHostProps>;
  serialize(payload: unknown): DriverSerialized;
  deserialize(data: DriverSerialized): unknown | null;
}
