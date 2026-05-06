/**
 * selection capability — 协议地基(纯协议总线 + 注册表 + 纯读 API)
 *
 * 见 [COMMON-PROTOCOL.md § 3.1](../COMMON-PROTOCOL.md)。
 *
 * L5-A 实施:channel emit/subscribe + lastValue + source 注册表 + 纯读 API。
 *
 * ❌ 没有任何 set/do API(铁律 1)
 * ❌ 不"做"选中(各 source 自己执行)
 * ❌ 不持有具体内容(选区只是位置/范围)
 */

import { ChannelHub } from '@slot/workspace-bus/channel';

export type SelectionKind = 'text' | 'block' | 'multi-block' | 'graph-nodes' | 'tree-nodes' | 'empty';

export interface SelectionPayload {
  source: string;       // 'text-editing-driver:<instanceId>' / etc.
  isEmpty: boolean;
  kind: SelectionKind;
  // text 模式
  from?: number;
  to?: number;
  anchor?: number;
  head?: number;
  // block / multi-block
  positions?: number[];
  // graph
  nodeIds?: string[];
  // tree
  treeNodeIds?: string[];
}

interface SelectionSourceRegistration {
  source: string;
}

class SelectionCapability {
  readonly id = 'selection';
  readonly version = '0.1.0';

  private channels = new ChannelHub();
  private sources = new Set<string>();

  // ── 注册接口 ──
  registerSource(reg: SelectionSourceRegistration): void {
    this.sources.add(reg.source);
  }

  unregisterSource(source: string): void {
    this.sources.delete(source);
  }

  // ── emit(source 主动调)──
  emit(payload: SelectionPayload): void {
    this.channels.emit('selection.changed', payload);
  }

  // ── 订阅 ──
  subscribe(listener: (payload: SelectionPayload) => void): () => void {
    return this.channels.subscribe('selection.changed', (p) => listener(p as SelectionPayload));
  }

  // ── 纯读 API ──
  api = {
    getCurrent: (): SelectionPayload | null => {
      return (this.channels.getLastValue('selection.changed') as SelectionPayload | undefined) ?? null;
    },
    isEmpty: (): boolean => {
      const cur = this.api.getCurrent();
      return cur === null || cur.isEmpty;
    },
    getText: (): string | null => {
      // L5-A:不做实际文本提取(driver 自己提供 selection 时不带 text)
      // L5-B+ 实现
      return null;
    },
  };

  /** 已注册 source 数(诊断用)*/
  get sourceCount(): number {
    return this.sources.size;
  }
}

export const selection = new SelectionCapability();
