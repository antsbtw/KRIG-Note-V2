/**
 * clipboard capability — 协议地基
 *
 * 见 COMMON-PROTOCOL.md § 3.2。
 *
 * L5-A:serializer 注册表 + paste handler 注册表 + channel(无 set/do API)
 */

import { ChannelHub } from '@shared/event-bus/channel';
import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

export type ClipboardFormat = 'pm-json' | 'markdown' | 'html' | 'plain' | string;

export interface SerializerRegistration {
  contentType: string;
  format: ClipboardFormat;
  serialize: (data: unknown) => string;
}

export interface PasteHandlerRegistration {
  id: string;
  detect: (dataTransfer: DataTransfer) => boolean;
  parse: (dataTransfer: DataTransfer) => Promise<unknown> | unknown;
  priority?: number;
}

class ClipboardCapability {
  readonly id = 'clipboard';
  readonly version = '0.1.0';

  private channels = new ChannelHub();
  private serializers = new Map<string, SerializerRegistration>();
  private pasteHandlers: PasteHandlerRegistration[] = [];

  // ── 注册接口 ──
  registerSerializer(reg: SerializerRegistration): void {
    const key = `${reg.contentType}:${reg.format}`;
    this.serializers.set(key, reg);
  }

  unregisterSerializer(contentType: string, format?: ClipboardFormat): void {
    if (format) {
      this.serializers.delete(`${contentType}:${format}`);
    } else {
      // 删该 contentType 所有 format
      for (const key of this.serializers.keys()) {
        if (key.startsWith(`${contentType}:`)) this.serializers.delete(key);
      }
    }
  }

  registerPasteHandler(reg: PasteHandlerRegistration): void {
    this.pasteHandlers.push(reg);
    this.pasteHandlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  unregisterPasteHandler(id: string): void {
    this.pasteHandlers = this.pasteHandlers.filter((h) => h.id !== id);
  }

  // ── emit ──
  emit(channelName: 'clipboard.copied' | 'clipboard.pasted', payload: unknown): void {
    this.channels.emit(channelName, payload);
  }

  // ── 订阅 ──
  subscribe<T = unknown>(
    channelName: 'clipboard.copied' | 'clipboard.pasted',
    listener: (payload: T) => void,
  ): () => void {
    return this.channels.subscribe(channelName, (p) => listener(p as T));
  }

  // ── 纯读 API ──
  api = {
    getCurrentEnvelopes: (): string[] => {
      const last = this.channels.getLastValue('clipboard.copied') as { envelopes?: string[] } | undefined;
      return last?.envelopes ?? [];
    },
    hasInternalEnvelope: (): boolean => {
      return this.api.getCurrentEnvelopes().includes('pm-json');
    },
  };

  // ── 给 driver 集成用的查询(serializer / paste handlers 列表)──
  getSerializers(): SerializerRegistration[] {
    return Array.from(this.serializers.values());
  }

  getPasteHandlers(): PasteHandlerRegistration[] {
    return [...this.pasteHandlers];
  }

  get serializerCount(): number {
    return this.serializers.size;
  }

  get pasteHandlerCount(): number {
    return this.pasteHandlers.length;
  }
}

export const clipboard = new ClipboardCapability();

// Wave 1:注册到 Registry,让 install 可校验(charter § 1.2)
capabilityRegistry.register({ id: clipboard.id });
