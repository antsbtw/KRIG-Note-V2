/**
 * L-raw —— Web 能力层的「原始层」缓存(`01-contract.md` §13)。
 *
 * ⭐ 核心不变量:
 *  1. ⭐⭐ **无条件、无分支地收下一切** —— M1..M8 一视同仁,
 *     存储端加判断 = 拿可靠性换空间
 *  2. **七字段索引全部与站点无关** —— 站点特化的索引归 adapter
 *  3. **不设上限 ≠ 不管** —— 占用可查、可清理、将满时告警
 *  4. 写盘失败 **fail loud** —— 「以为存了、其实没存」比不存更坏
 */
export * from './types';
export {
  RawStore,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_WARN_RATIO,
} from './raw-store';
export type { RawSink, RawStoreOptions } from './raw-store';
