/**
 * Schema 拼装 — 收集所有 block.spec + marks 拼装 PM Schema
 *
 * 见 DESIGN.md v0.2.1 § 3 + L5B2 设计 § 3.1。
 *
 * L5-A:只 textBlock + 无 marks
 * L5-B2:加 4 marks(bold/italic/strike/code)
 */

import { Schema, Node as PMNode, type NodeSpec } from 'prosemirror-model';
import type { BlockSpec, DriverSerialized } from './types';
import { MARKS } from './marks';

/** 框架强制 attrs(注入到所有 group='block' 节点) */
function injectFrameworkAttrs(spec: NodeSpec): NodeSpec {
  if (spec.group !== 'block') return spec;
  return {
    ...spec,
    attrs: {
      ...(spec.attrs || {}),
      indent: spec.attrs?.indent ?? { default: 0 },
      // L5-B+ 加:fromPage / frameColor / frameStyle / frameGroupId / frameThoughtId
    },
  };
}

/**
 * 拼装 PM Schema
 *
 * @param blocks 启用的 BlockSpec 列表
 * @returns PM Schema
 */
export function buildSchema(blocks: BlockSpec[]): Schema {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: 'block+' },
    text: { group: 'inline' },
  };

  for (const block of blocks) {
    nodes[block.id] = injectFrameworkAttrs(block.spec);
  }

  return new Schema({ nodes, marks: MARKS });
}

/**
 * DriverSerialized → PMDoc(反序列化)
 *
 * 不识别 format/version 返 null(driver 协议铁律 9 Result 风格)
 */
export function deserializeDoc(data: DriverSerialized, schema: Schema): PMNode | null {
  if (data.format !== 'pm-doc-json') return null;
  if (data.version !== '0.1') return null;
  try {
    return PMNode.fromJSON(schema, data.payload as Parameters<typeof PMNode.fromJSON>[1]);
  } catch (err) {
    console.error('[text-editing-driver] deserializeDoc failed:', err);
    return null;
  }
}

/**
 * PMDoc → DriverSerialized(序列化)
 */
export function serializeDoc(doc: PMNode): DriverSerialized {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: doc.toJSON(),
  };
}
