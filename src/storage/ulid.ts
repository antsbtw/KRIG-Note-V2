/**
 * V2 ULID id 生成
 * 按 docs/RefactorV2/data-model/persistence/decisions/006-id-generation.md
 *
 * - uppercase (ULID 官方规范)
 * - monotonic (同毫秒批量插入严格单调)
 * - 26 字符 Crockford Base32
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
