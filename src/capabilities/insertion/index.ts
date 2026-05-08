/**
 * insertion capability — 协议地基
 *
 * 见 COMMON-PROTOCOL.md § 3.5。
 *
 * L5-A:safeguard 注册表 + safeInsert 协议守卫包装(driver 占位 noop safeguard)。
 */

import { ChannelHub } from '@slot/workspace-bus/channel';
import { fail, type Result } from '@slot/workspace-bus/bus-types';
import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

export interface SafeguardRegistration {
  id: string;
  check: (input: {
    target: { pos: number; type: string };
    content: unknown;
    contentType: string;
    docContext: unknown;
  }) => { safe: boolean; reason?: string };
}

class InsertionCapability {
  readonly id = 'insertion';
  readonly version = '0.1.0';

  private channels = new ChannelHub();
  private safeguards = new Map<string, SafeguardRegistration>();

  registerSafeguard(reg: SafeguardRegistration): void {
    this.safeguards.set(reg.id, reg);
  }

  unregisterSafeguard(id: string): void {
    this.safeguards.delete(id);
  }

  emit(payload: { target: { type: string; pos: number }; contentType: string; success: boolean }): void {
    this.channels.emit('insertion.inserted', payload);
  }

  subscribe(listener: (payload: { target: { type: string; pos: number }; contentType: string; success: boolean }) => void): () => void {
    return this.channels.subscribe('insertion.inserted', (p) => listener(p as Parameters<typeof listener>[0]));
  }

  api = {
    /**
     * 协议守卫包装器(driver 协议 § 3.5)
     *
     * 跑所有 safeguard.check,通过则调用方提供的 perform()。
     * capability 不知道具体怎么 insert,只跑协议。
     */
    safeInsert: <T>(input: {
      target: { pos: number; type: string };
      content: unknown;
      contentType: string;
      docContext: unknown;
      perform: () => Result<T>;
    }): Result<T> => {
      // 跑所有 safeguard
      for (const guard of this.safeguards.values()) {
        const result = guard.check({
          target: input.target,
          content: input.content,
          contentType: input.contentType,
          docContext: input.docContext,
        });
        if (!result.safe) {
          return fail('safeguard-rejected', { id: guard.id, reason: result.reason });
        }
      }

      // 全部通过 → 调用方执行
      const performResult = input.perform();
      if (performResult.ok) {
        this.emit({
          target: input.target,
          contentType: input.contentType,
          success: true,
        });
      } else {
        this.emit({
          target: input.target,
          contentType: input.contentType,
          success: false,
        });
      }
      return performResult;
    },
    listSafeguards: (): SafeguardRegistration[] => Array.from(this.safeguards.values()),
  };

  get safeguardCount(): number {
    return this.safeguards.size;
  }
}

export const insertion = new InsertionCapability();

// Wave 1:注册到 Registry,让 install 可校验(charter § 1.2)
capabilityRegistry.register({ id: insertion.id });
