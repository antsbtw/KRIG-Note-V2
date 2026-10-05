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
    /**
     * ⚠️⚠️ 必须是 `UPSERT type::record(...)`,**不能是** `UPSERT x_tweet ... WHERE`。
     * 真机 2026-10-05 实证:后者返回 `[[]]` —— **不报错、不插入、什么都不写**,
     * 面板照样显示「新入库 44 条」而库里 **0 行**。
     * ⭐ 带 WHERE 的 UPSERT 只更新已匹配的行,没匹配就什么都不做。
     */
    expect(CODE, '不是 UPSERT —— 重采补不上老数据').toMatch(/UPSERT\s+type::record/);
    expect(
      CODE,
      '用了 `UPSERT x_tweet ... WHERE` —— 它什么都不写且不报错（真机实证：库里 0 行）',
    ).not.toMatch(/UPSERT\s+x_tweet\b/);
  });
});

describe('⭐⭐⭐ 业务字段一个都不许被覆盖', () => {
  /** ⭐ 切出 UPSERT 那条语句 —— 整文件扫会把类型定义也圈进来 */
  const stmt = (): string => {
    const i = CODE.indexOf("UPSERT type::record('x_tweet', $id) SET");
    expect(i, 'UPSERT 语句不见了 —— 本条要重写').toBeGreaterThan(-1);
    const end = CODE.indexOf('`', i);
    return CODE.slice(i, end > i ? end : undefined);
  };

  it('⭐⭐⭐ accepted / ai_verdict / replied / translation **不在更新语句里**', () => {
    const s = stmt();
    expect(s.length, '切片空了 —— 断言会恒真').toBeGreaterThan(200);
    /**
     * ⚠️ `status` 是**唯一的例外**:它在 BUSINESS_FIELDS 里,
     * 但 schema 把它定成 `TYPE string` 非 option 无 DEFAULT ——
     * 不给的话**每一条都写不进去**。
     * ⭐ 所以它出现在语句里,但值是 `oldStatus`(已有行原样沿用,
     * 新建才给 pending)—— 下一条测试钉这个。
     */
    const EXEMPT = new Set(['status']);
    for (const f of BUSINESS_FIELDS) {
      if (EXEMPT.has(f)) continue;
      expect(
        s,
        `更新语句里有业务字段 \`${f}\` —— 它是人工或 AI 填的，`
        + '覆盖不可逆（AI 要重跑、人工采纳直接丢）',
      ).not.toMatch(new RegExp(`\\b${f}\\s*=`));
    }
  });

  it('⭐⭐⭐ status 必填但**不许重采时打回 pending**', () => {
    expect(
      CODE,
      'status 写死成 pending —— 重采会把已判过的 worth/skip 打回去，'
      + '人工判断和 AI 判断白做一遍',
    ).not.toMatch(/status:\s*'pending'/);
    expect(CODE, '没有「已有行沿用旧 status」这道闸').toMatch(/oldStatus/);
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

/**
 * ⭐⭐⭐ **三条真机实证的写库规矩** —— 2026-10-05
 *
 * ⚠️⚠️ 这三条**结构守卫一条都没抓到**:7 条守卫全绿、tsc 0 错、
 * 面板显示「新入库 44 条」—— 而库里 **0 行**。
 * 全是我拿真库发语句才查出来的。
 *
 * ⭐ 教训:**写库语句的正确性,只有真库答得出** ——
 * 守卫能钉「用没用对关键字」,钉不了「这条语句到底写没写进去」。
 */
describe('⭐⭐⭐ 三条只有真库能验的规矩', () => {
  /**
   * ⭐⭐⭐ **清单从 schema 推,不写死** —— 2026-10-05 的教训。
   *
   * ⚠️⚠️ 第一版这条守卫写死了 `['fetched_at', 'metrics_at']`,
   * 于是 `created_at` **天然在视野之外** —— 它也是 datetime,也没 cast,
   * **41 条推文全军覆没**而守卫全绿。
   * ⭐ `feedback-guard-hardcoded-list-never-grows`:
   * 修法是**换信息来源**(从 schema 真表推),不是补清单。
   */
  it('⭐⭐⭐ ① 每个 datetime 字段都要 cast —— 清单从 schema 推', () => {
    const SCHEMA = readFileSync(
      join(__dirname, '..', '..', 'src/storage/surreal/x-schema.ts'),
      'utf-8',
    );
    /** ⭐ schema 里所有 `ON x_tweet TYPE ...datetime` 的字段 */
    const dtFields = [...SCHEMA.matchAll(/EXISTS\s+(\w+)\s+ON x_tweet TYPE[^;]*datetime/g)]
      .map((m) => m[1]);
    expect(dtFields.length, 'schema 里一个 datetime 字段都没解析到 —— 本条要重写')
      .toBeGreaterThan(2);

    const i = CODE.indexOf("UPSERT type::record('x_tweet', $id) SET");
    const stmt = CODE.slice(i, CODE.indexOf('`', i));
    /** ⚠️ 只查**语句里真的写了**的那些 —— 没写的由「必填字段」那条管 */
    const written = dtFields.filter((f) => new RegExp(`\\b${f}\\s*=`).test(stmt));
    const notCast = written.filter((f) => !new RegExp(`${f}\\s*=[^,]*type::datetime`).test(stmt));
    expect(
      notCast,
      '这些 datetime 字段没 cast —— 传 ISO 字符串会被库**整条拒收**（真机实证：41 条全失败）：\n  '
      + notCast.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐⭐ ② 必填字段一个都不能漏 —— 漏一个整行写不进去', () => {
    /**
     * `x_tweet` 里非 option 且无 DEFAULT 的字段:
     * tweet_id / author_handle / text / fetched_at / metrics / source / status
     * ⚠️ 真机实证:漏 `status` → `Expected \`string\` but found \`NONE\``。
     */
    const REQUIRED = ['tweet_id', 'author_handle', 'text', 'fetched_at', 'metrics', 'source', 'status'];
    const i = CODE.indexOf("UPSERT type::record('x_tweet', $id) SET");
    const stmt = CODE.slice(i, CODE.indexOf('`', i));
    const missing = REQUIRED.filter((f) => !new RegExp(`\\b${f}\\s*=`).test(stmt));
    expect(
      missing,
      '这些**必填**字段没写进语句 —— 整行会被拒收（不是少几个字段，是一条都存不进）：\n  '
      + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ ③ 用 record id 落行 —— tweet_id 天然唯一,重采落同一行', () => {
    expect(
      CODE,
      '没用 tweet_id 当 record id —— 重采会生成新行而不是更新',
    ).toMatch(/type::record\('x_tweet',\s*\$id\)/);
  });
});

/**
 * ⭐⭐⭐ **落库要留痕** —— 2026-10-05 的教训
 *
 * 两跑「面板报入库 44/45 条、库里 0 行」,而留痕里只有 `harvest-ok`,
 * 没有一条跟写库有关 —— 「压根没调」和「调了但每条都失败」长得一模一样,
 * 只能去真库里猜。
 */
describe('⭐⭐⭐ 写库要留痕,不能只在失败时留', () => {
  it('⭐⭐ 每次落库都打一行 —— 成功路径也要留痕', () => {
    expect(
      CODE,
      '落库不留痕 —— 「没调」和「调了全失败」分不出来，下次又要去库里猜',
    ).toMatch(/console\.(log|warn)[\s\S]{0,120}落库/);
  });

  it('⭐⭐ 留痕里要有**三个数** —— 新增/更新/失败', () => {
    /**
     * ⚠️ 切片要**切到 console.log 那条语句为止** ——
     * 第一版切到「下一行 +200 字」,把后面的代码也圈了进来,
     * 于是删掉失败那段**照样全绿**(`failed` 在别处还有)。
     * ⭐ `feedback-guard-scope-to-the-branch`:整段扫必然假绿。
     */
    const start = CODE.lastIndexOf('console.log(', CODE.indexOf('[x.tweet-repo] 落库'));
    expect(start, '留痕那行不见了 —— 本条要重写').toBeGreaterThan(-1);
    const line = CODE.slice(start, CODE.indexOf(');', start) + 2);
    expect(line.length, '切片空了 —— 断言会恒真').toBeGreaterThan(40);
    for (const [v, what] of [['inserted', '新增'], ['updated', '更新'], ['failed', '失败']] as const) {
      expect(line, `留痕没带 ${what} —— 只报好消息等于没留`).toContain(v);
    }
  });
});
