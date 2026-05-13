/**
 * V2 ULID id 生成 — re-export 自 @shared/ulid(P0a-bis K1 抽离后)
 *
 * 历史路径:本文件原是 ulid 单一来源;P0a-bis 因 view 端 capability 也需
 * 全局唯一 id,抽到 @shared/ulid 作 capability + storage 共享。
 * 本文件保留 re-export 维持所有现有 `@storage/ulid` import 路径兼容。
 *
 * 新增引用方应直接 import from '@shared/ulid'。
 */
export { generateUlid, generateUlidAt } from '@shared/ulid';
