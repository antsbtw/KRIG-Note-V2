/**
 * ⭐⭐⭐ `x_tweet` 写库的**契约守卫**
 *
 * ⚠️ 为什么是结构守卫而不是行为测试:要连真库才跑得起来,
 * 而这两类 bug **当年都是真机实采才发现的** —— 等真机太晚。
 *
 * 钉的是三条用血换来的规矩:
 * ① `INSERT IGNORE` 不是 upsert(`project-x-upsert-insert-ignore`)
 * ② 业务字段**一个都不许**出现在更新语句里(覆盖不可逆)
 * ③ 正文**只在变长时**覆盖(`project-x-upsert-overwrites-richer-text`)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTED_FIELDS, BUSINESS_FIELDS } from '@modules/x/x-tweet-repo';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'src/modules/x/x-tweet-repo.ts'),
  'utf-8',
);
/** ⚠️ 剥注释 —— 否则注释里提到 `INSERT IGNORE` 自己会被判违规 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('⭐⭐⭐ 写库不许用 INSERT IGNORE', () => {
  /**
   * ⚠️⚠️ 旧实现用 `INSERT IGNORE INTO x_tweet`:
   * tweet_id 已存在 → **整条跳过、一个字段不更新、不抛错**
   * → 调用方 `saved += 1` 照加,报告显示「入库 50 条」而**库里纹丝不动**。
   * 后果:`conversation_id` 卡 9%、`tweet_url` 卡 76%,重采永远补不上。
   */
  it('⭐⭐⭐ 没有 INSERT IGNORE —— 它会让重采**永远补不上**老数据', () => {
    expect(
      CODE,
      '又用了 INSERT IGNORE —— 已存在就整条跳过且不报错，'
      + '报告会说「入库 N 条」而库里一个字段没变',
    ).not.toMatch(/INSERT\s+IGNORE/i);
  });

  it('⭐⭐ 用的是 UPSERT —— 存在就更新', () => {
    expect(CODE, '不是 UPSERT —— 重采补不上老数据').toMatch(/UPSERT\s+x_tweet/);
  });
});

describe('⭐⭐⭐ 业务字段一个都不许被覆盖', () => {
  /** ⭐ 切出 UPSERT 那条语句 —— 整文件扫会把类型定义也圈进来 */
  const stmt = (): string => {
    const i = CODE.indexOf('UPSERT x_tweet SET');
    expect(i, 'UPSERT 语句不见了 —— 本条要重写').toBeGreaterThan(-1);
    const end = CODE.indexOf('`', i);
    return CODE.slice(i, end > i ? end : undefined);
  };

  it('⭐⭐⭐ accepted / ai_verdict / replied / translation **不在更新语句里**', () => {
    const s = stmt();
    expect(s.length, '切片空了 —— 断言会恒真').toBeGreaterThan(200);
    for (const f of BUSINESS_FIELDS) {
      expect(
        s,
        `更新语句里有业务字段 \`${f}\` —— 它是人工或 AI 填的，`
        + '覆盖不可逆（AI 要重跑、人工采纳直接丢）',
      ).not.toMatch(new RegExp(`\\b${f}\\s*=`));
    }
  });

  /** ⚠️ 反向也要钉:采集字段漏了就是**静默丢数据** */
  it('⭐⭐ 采集字段**一个不漏**地出现在更新语句里', () => {
    const s = stmt();
    const missing = COLLECTED_FIELDS.filter((f) => !new RegExp(`\\b${f}\\s*=`).test(s));
    expect(
      missing,
      '这些采集字段没写进 UPSERT —— 采到了但存不进去，而且**静默**：\n  '
      + missing.join('\n  ')
      + '\n⭐ project-x-field-four-place-registration：加字段要登记四处',
    ).toEqual([]);
  });

  it('⚠️ 两张清单不许重叠 —— 一个字段不能既是采集的又是业务的', () => {
    const both = COLLECTED_FIELDS.filter((f) => (BUSINESS_FIELDS as readonly string[]).includes(f));
    expect(both, '字段同时在两张清单里 —— 语义自相矛盾').toEqual([]);
  });
});

describe('⭐⭐⭐ 正文只在变长时覆盖', () => {
  /**
   * ⚠️⚠️ 实测的数据损坏:重采把 **16081 字正文覆盖成 267 字**
   * (列表页只给标题+摘要)。⭐ 不是「新值优先」,是「**更全的优先**」。
   */
  it('⭐⭐⭐ 有「旧的更长就留旧的」这道闸', () => {
    expect(
      CODE,
      '正文无条件覆盖 —— 重采会把 16081 字的长文正文打成 267 字的摘要',
    ).toMatch(/oldText\.length\s*>\s*r\.text\.length/);
  });
});

describe('⭐⭐ 存库的字段名要对得上 schema', () => {
  const SCHEMA = readFileSync(
    join(__dirname, '..', '..', 'src/storage/surreal/x-schema.ts'),
    'utf-8',
  );
  /**
   * ⭐⭐ **两张清单对照** —— repo 写的字段必须在 schema 里定义过。
   * ⚠️ 不对照的话:写一个 schema 没有的字段,SCHEMAFULL 表会**整条拒收**,
   * 而那时才发现就晚了。
   */
  it('⭐⭐⭐ repo 写的每个采集字段,schema 里都 DEFINE 过', () => {
    const defined = new Set(
      [...SCHEMA.matchAll(/EXISTS\s+(\w+)\s+ON x_tweet/g)].map((m) => m[1]),
    );
    expect(defined.size, 'schema 里一个 x_tweet 字段都没解析到 —— 本条要重写')
      .toBeGreaterThan(20);
    const missing = COLLECTED_FIELDS.filter((f) => !defined.has(f));
    expect(
      missing,
      'repo 要写这些字段，但 schema 里没定义 —— SCHEMAFULL 表会整条拒收：\n  '
      + missing.join('\n  '),
    ).toEqual([]);
  });
});
