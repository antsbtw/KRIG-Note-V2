/**
 * diglot-model — 联系线确定性 id(债 3,用户 2026-09-09 拍板 v0 做掉)
 *
 * ⚠️ **要解决的真问题**(Decision 028 §1.2 实测):
 * `putEdgeViaTx` 无 id 时走 `generateUlid() + CREATE` —— 每次 put **同一条逻辑边**
 * 都产生**新随机 id 的新行**,SurrealDB 不去重 → **重复边累积**。
 * 当年这条特性把文档结构边搞成了不可逆损坏(长笔记重启后块顺序错乱)。
 *
 * mind 的树已零边(走 parentId/order 属性),不受影响;但**联系线仍是真边**,
 * 「拖一下多一条边」照样是 bug。
 *
 * ⭐ **对策**:id 由「谁连谁」**确定性导出** —— 同一条逻辑边永远同一个 id,
 * 重复写 = **覆盖而非新增**。
 *
 * ⚠️ **调用侧配套契约**(本模块给不出,必须由写库处保证):
 * `putEdgeViaTx` 的 `input.id` 分支走的是 `UPDATE ... RETURN AFTER`,
 * **边不存在时抛 `Edge <id> not found`**。故写联系线**必须走 UPSERT 语义**
 * (仓库既有先例:`src/storage/surreal/schema.ts` 用 UPSERT 避免重复 CREATE)。
 * 否则「第一次连线」会直接失败。此契约由 M5/E1 断言守。
 */

import type { EdgeId, NodeId } from './types';

/**
 * ⭐ 方向敏感:A→B 与 B→A 是**两条不同的边**。
 *
 * 依据 `01-mind-spec.md` §3.2:「**模型统一存有向**;无向语义由渲染**弱化箭头**表达」。
 * 故此处**绝不**对两端排序后再拼 —— 那会把两个方向塌成一条,悄悄丢掉用户画的边。
 *
 * ⚠️ 分隔符取 NUL:平文本投影的 `^id` 是**用户手写**的,可能含空格/下划线/冒号。
 * 若用可打印字符作分隔,`("a b","c")` 与 `("a","b c")` 会拼成同一串 → **碰撞**。
 * NUL 不可能出现在用户 id 里,故拼接**无歧义**(此性质由 edge-id.test.ts 注入验红)。
 */
const SEP = '\u0000';

/**
 * FNV-1a 32 位。
 *
 * 为什么用它而不是 SHA-1/crypto:
 * - 本模块要在 **renderer 与 main 两侧都能跑**且**结果必须一致**,
 *   纯函数无依赖最稳(⚠️ 教训:曾因 renderer 本地算 hash 与 main 算法不同,
 *   两边永不相等 → 每次写都误判并发写)。
 * - id 不是安全边界,只需**碰撞概率足够低 + 稳定可复现**。
 *
 * ⚠️ 仍有碰撞可能 → 故最终 id **同时保留两端原文**(见 `deterministicEdgeId`),
 * hash 只作定长指纹,**不单独承担唯一性**。
 */
function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619,用移位避免 32 位溢出失真
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * SurrealDB record id 段允许的字符(保守取 `[A-Za-z0-9_]`)。
 * 节点 id 通常是 ULID(本就安全),但平文本投影的 `^id` 是**用户自己写的**,
 * 可能含中文/空格/标点 → 必须净化,否则拼出的 record id 非法。
 */
function sanitizeSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_');
}

/** 单端在 id 中的最大保留长度,防止用户写超长 `^id` 撑爆 record id。 */
const MAX_SEG = 24;

/**
 * ⭐ 由两端导出联系线的确定性 id。
 *
 * 形态:`rel_<source净化>_<target净化>_<fnv1a(source\0target)>`
 *
 * 性质(由 edge-id.test.ts 逐条验,且已验注入能红):
 * - **确定**:同样入参永远同样输出(可跨进程、跨重启)
 * - ⭐ **方向敏感**:`f(a,b) !== f(b,a)` —— 有向模型不许把两向塌成一条
 * - **可净化**:含中文/空格/`:` 的用户 id 也产出合法 record id 段
 * - **抗截断碰撞**:两端原文截断了,但 hash 吃的是**未截断全文**,
 *   故超长 id 仅前缀相同不会撞
 *
 * ⚠️ 本函数**不保证**边一定写得进库 —— 幂等落库要靠调用侧 UPSERT(见文件头契约)。
 */
export function deterministicEdgeId(source: NodeId, target: NodeId): EdgeId {
  // ⚠️ hash 必须吃**未截断、未净化**的全文,否则截断后前缀相同的两对端点会撞。
  const fingerprint = fnv1a32(`${source}${SEP}${target}`);
  const s = sanitizeSegment(source).slice(0, MAX_SEG);
  const t = sanitizeSegment(target).slice(0, MAX_SEG);
  return `rel_${s}_${t}_${fingerprint}`;
}
