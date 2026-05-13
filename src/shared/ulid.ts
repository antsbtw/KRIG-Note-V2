/**
 * V2 ULID id 生成(shared 层 — capability / storage 共享)
 * 按 docs/RefactorV2/data-model/persistence/decisions/006-id-generation.md
 *
 * - uppercase (ULID 官方规范)
 * - monotonic (同毫秒批量插入严格单调)
 * - 26 字符 Crockford Base32
 *
 * 抽到 shared 层的动机(P0a-bis K1):view 端 capability (canvas-rendering)
 * 也需要生成全局唯一 id(graph instance client-side id),与 storage 层同源。
 * storage 跨层 import 违反 decision 008 §4 capability 边界,故抽到 @shared/ulid。
 */
import { ulid, monotonicFactory } from 'ulid';

const generateMonotonicUlid = monotonicFactory();

export function generateUlid(): string {
  return generateMonotonicUlid();
}

/** 给定时间戳生成 ULID(测试 / 迁移用) */
export function generateUlidAt(timestamp: number): string {
  return ulid(timestamp);
}
