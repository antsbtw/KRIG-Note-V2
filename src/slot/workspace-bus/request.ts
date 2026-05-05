/**
 * RequestHub — Capability Request 子模块(请求-响应)
 *
 * 见 PROTOCOL.md(Capability Request 管道)+ DESIGN.md § 2。
 *
 * 关键:
 * - 1 handler / 1 name(冲突 → fail)
 * - slot.* 前缀禁注册(铁律 6)
 * - 调用返回 Promise<Result<T>>,不抛错
 */

import { fail, ok } from './bus-types';
import type { RequestHandler, Result } from './bus-types';

const RESERVED_PREFIX = 'slot.';

export class RequestHub {
  private handlers = new Map<string, RequestHandler>();

  /** 注册 handler — 重复 / 保留前缀返回 fail */
  registerHandler(name: string, handler: RequestHandler): Result<void> {
    if (name.startsWith(RESERVED_PREFIX)) {
      const msg = `[bus] reserved prefix '${RESERVED_PREFIX}*' cannot be registered as request handler ('${name}')`;
      if (
        typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'development'
      ) {
        console.warn(msg);
      }
      return fail('reserved-prefix', { name });
    }
    if (this.handlers.has(name)) {
      return fail('handler-already-exists', { name });
    }
    this.handlers.set(name, handler);
    return ok(undefined);
  }

  /** 取消注册 — 不存在视为 no-op */
  unregisterHandler(name: string): void {
    this.handlers.delete(name);
  }

  /** 调用 — 返回 Result(handler 抛错 / 不存在都不抛)*/
  async request(name: string, input: unknown): Promise<Result<unknown>> {
    const handler = this.handlers.get(name);
    if (!handler) return fail('no-handler', { name });

    try {
      const result = await handler(input);
      return ok(result);
    } catch (e) {
      return fail('handler-threw', { name, error: e });
    }
  }

  /** 已注册 handler 数(诊断用)*/
  get handlerCount(): number {
    return this.handlers.size;
  }

  /** 清空(Workspace 销毁时调)*/
  dispose(): void {
    this.handlers.clear();
  }
}
