/**
 * 联系线确定性 id — 断言(债 3)
 *
 * ⚠️ 每条断言都已**故意注入违规验过能红**(HANDOFF §5)。
 * 自检问句:**「如果被测逻辑是错的,这条断言还会成立吗?」**
 *
 * 注入记录见文件末尾 §注入验证台账。
 */
import { describe, it, expect } from 'vitest';
import { deterministicEdgeId } from '@capabilities/diglot-model/edge-id';

describe('deterministicEdgeId — 债 3:重复写同一条逻辑边必须覆盖而非新增', () => {
  it('E1 确定性:同样两端,反复调用永远同一 id', () => {
    const a = deterministicEdgeId('nodeA', 'nodeB');
    const b = deterministicEdgeId('nodeA', 'nodeB');
    const c = deterministicEdgeId('nodeA', 'nodeB');
    expect(a).toBe(b);
    expect(b).toBe(c);
    // ⚠️ 注入验红:若实现掺入 ULID/随机/时间戳,三者不等 → 红。
    // 这正是 028 §1.2 那条 bug 的形态(generateUlid() + CREATE)。
  });

  it('E1b 跨"进程"稳定:不依赖任何模块内可变状态', () => {
    // 先算一批别的,污染任何潜在内部计数器/缓存
    for (let i = 0; i < 50; i++) deterministicEdgeId(`x${i}`, `y${i}`);
    const after = deterministicEdgeId('nodeA', 'nodeB');
    // 与 E1 中同样入参的结果必须一致
    expect(after).toBe(deterministicEdgeId('nodeA', 'nodeB'));
    // ⚠️ 注入验红:若实现里藏了自增序号,50 次污染后必然漂移 → 红。
  });

  it('⭐ E2 方向敏感:A→B 与 B→A 是两条不同的边', () => {
    const ab = deterministicEdgeId('nodeA', 'nodeB');
    const ba = deterministicEdgeId('nodeB', 'nodeA');
    expect(ab).not.toBe(ba);
    // ⚠️ 这条守的是真丢数据的 bug:01 §3.2 明定「模型统一存有向」。
    // 注入验红:实现改成 [source,target].sort() 后再拼 → 两者相等 → 红。
    // 若没有这条,用户画的 B→A 会被 A→B 悄悄覆盖掉。
  });

  it('E3 不同端点 → 不同 id(单端变化也要区分)', () => {
    const base = deterministicEdgeId('n1', 'n2');
    expect(deterministicEdgeId('n1', 'n3')).not.toBe(base);
    expect(deterministicEdgeId('n9', 'n2')).not.toBe(base);
  });

  it('⭐ E4 分隔符无歧义：("a_b","c") 与 ("a","b_c") 不得撞', () => {
    // ⚠️ 分隔符若是**可能出现在 id 里的字符**，
    // ("a_b","c") 与 ("a","b_c") 拼出的串完全相同 → 两条不同的边共用一个 id。
    //
    // ⚠️⚠️ 用例必须**含分隔符本身**才造得出碰撞。
    // 初版写的是 ('a b','c') vs ('a','b c') —— 空格不是分隔符，
    // 两串原文本就不同，SEP 改成 '_' 后测试**照样绿**（实测），
    // 即「样本里根本没有该现象」。已按真碰撞对改写。
    const left = deterministicEdgeId('a_b', 'c');
    const right = deterministicEdgeId('a', 'b_c');
    expect(left).not.toBe(right);
    // 注入验红：SEP 改成 '_' → 拼接串同为 'a_b_c' → hash 相等 → 红。
  });

  it('⭐ E4b 分隔符无歧义（空格版）：SEP 若取空格同样要红', () => {
    // 守的是「SEP 取了另一个可打印字符」这条分支。
    const left = deterministicEdgeId('a b', 'c');
    const right = deterministicEdgeId('a', 'b c');
    expect(left).not.toBe(right);
    // 注入验红：SEP 改成 ' ' → 拼接串同为 'a b c' → 红。
  });

  it('⭐ E5 抗截断碰撞:超长 id 仅前缀相同不得撞', () => {
    // 单端保留上限 24 字符。若 hash 吃的是**截断后**的串,这两条会撞。
    const long1 = 'n'.repeat(30) + 'AAAA';
    const long2 = 'n'.repeat(30) + 'BBBB';
    expect(deterministicEdgeId(long1, 'tgt')).not.toBe(
      deterministicEdgeId(long2, 'tgt'),
    );
    // 注入验红:把 fingerprint 改成吃 sanitize+slice 后的值 → 两者全等 → 红。
  });

  it('E6 用户手写 id(中文/空格/冒号)产出合法 record id 段', () => {
    const id = deterministicEdgeId('主题:架构 设计', '子项/一');
    // SurrealDB record id 段:此处保守要求仅 [A-Za-z0-9_]
    expect(id).toMatch(/^[A-Za-z0-9_]+$/);
    // ⚠️ 注入验红:去掉 sanitizeSegment → 中文与空格原样进串 → 正则不匹配 → 红。
  });

  it('E6b 净化后仍保留可读性(便于排查,非硬约束)', () => {
    const id = deterministicEdgeId('arch', 'todo');
    expect(id).toContain('arch');
    expect(id).toContain('todo');
    expect(id.startsWith('rel_')).toBe(true);
  });

  it('E7 空串端点不产出退化 id', () => {
    const bothEmpty = deterministicEdgeId('', '');
    const oneEmpty = deterministicEdgeId('', 'x');
    expect(bothEmpty).not.toBe(oneEmpty);
    expect(bothEmpty).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

/**
 * §注入验证台账 —— 每条都真跑过（不是声称）
 *
 * | # | 注入 | 期望 | 实测 |
 * |---|---|---|---|
 * | 1 | id 里掺 `Math.random()`（=028 的 generateUlid+CREATE 形态） | E1/E1b 红 | ✅ 4 红 |
 * | 2 | 两端 `.sort()` 后再拼 | E2 红 | ✅ 1 红（精确命中） |
 * | 3 | `SEP` 改 `'_'` | E4 红 | ⚠️ **初次全绿 → 见下** |
 * | 3b | `SEP` 改 `' '` | E4b 红 | ✅ 1 红 |
 * | 4 | fingerprint 吃截断后的串 | E5 红 | ✅ 1 红 |
 * | 5 | 去掉 `sanitizeSegment` | E6 红 | ✅ 1 红 |
 *
 * ⚠️⚠️ **注入 3 抓到一个真缺口（本轮第 1 个）**：
 * E4 初版用 `('a b','c')` vs `('a','b c')` —— 空格**不是分隔符**，
 * 两串原文本就不同，把 SEP 换成 `'_'` 后**测试照样全绿**，
 * 即这条断言对它声称守护的缺陷**零区分力**。
 * 形态 = HANDOFF §5 的「**样本里根本没有该现象**」。
 * 已改为真碰撞对 `('a_b','c')` vs `('a','b_c')`（含分隔符本身），
 * 并补 E4b 覆盖空格分支。改后注入 3 / 3b 各自精确变红。
 *
 * ⚠️ 未覆盖（诚实记账，不假装）：
 * - **落库幂等本身**没在这验 —— 那要真库，且依赖调用侧走 UPSERT
 *   （`putEdgeViaTx` 的 id 分支是 `UPDATE`，边不存在时抛 `Edge <id> not found`）。
 *   本文件只保证「id 稳定」这一半；另一半由接线时的 M5 断言守。
 * - **hash 碰撞**：FNV-1a 32 位有理论碰撞，但 id 同时保留两端原文，
 *   hash 不单独承担唯一性。
 */
