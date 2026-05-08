/**
 * Result<T> — 统一错误处理类型
 *
 * 见 slot/workspace-bus/PROTOCOL.md § 4(类型契约)。
 *
 * 历史:Wave 3.3 之前位于 src/slot/workspace-bus/bus-types.ts,因 capabilities/insertion
 * 反向 import 形成"能力层 → L4"逆流(audit P2-6 同根问题)。Result 是
 * 纯类型 + 纯工厂函数,无 workspace 语义,与 ChannelHub 同等下沉到 shared/。
 */

/** 统一错误处理类型 — 所有 bus 操作返回 Result,不抛错 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail?: unknown };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (reason: string, detail?: unknown): Result<never> => ({
  ok: false,
  reason,
  detail,
});
