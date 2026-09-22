/**
 * ⭐⭐⭐ **采集合并策略** —— 用户 2026-09-22 定的基准:
 *
 * > 「采集是基础,保证数据的完整性,是采集的基本任务。」
 * > 「要完整的画像,当然要更新这些数据,我们有时候要从这些数据中寻找规律的。」
 *
 * ── 底线:空值永远不许覆盖非空值 ──
 * 同一条推会被**不同深度的路径**反复采到:载荷路径产出 tweet_url /
 * author_avatar / conversation_id,而 **DOM 兜底路径这三样根本没有**。
 * 无条件覆盖 = 后来那趟浅的把先前采全的字段抹成 NONE。
 *
 * ⭐ 与 text 那个 bug 同类(16081 字被覆盖成 267 字),当时只修了撞见的一个。
 *
 * ── 字段分两类 ──
 *  ① 不可变事实(发出来就定了)→ 只补不覆盖
 *  ② 会变的现状(本来就该更新)→ 有新值就更新,但空值不许覆盖非空
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

const repo = strip(readFileSync(
  join(process.cwd(), 'src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8'));

/** ⚠️ 切到 ON DUPLICATE 子句再断言 —— 整文件 toMatch 会被 INSERT 段的同名字段兜住 */
const onDup = (() => {
  const i = repo.indexOf('ON DUPLICATE KEY UPDATE');
  expect(i, '找不到 ON DUPLICATE KEY UPDATE').toBeGreaterThan(0);
  const seg = repo.slice(i, repo.indexOf('`', i));
  expect(seg.length, '切出来的子句是空的').toBeGreaterThan(200);
  return seg;
})();

/** 取某个字段的更新行 */
function line(field: string): string {
  const re = new RegExp(`^\\s*${field}\\s*=.*$`, 'm');
  const m = onDup.match(re);
  expect(m, `ON DUPLICATE 子句里找不到 ${field} 的更新行`).not.toBeNull();
  return m![0];
}

describe('① 不可变事实:只补不覆盖', () => {
  // 发出来就定了的东西,老值非空就一个字都不该动
  for (const f of ['tweet_url', 'conversation_id', 'in_reply_to', 'in_reply_to_user']) {
    it(`⚠️ ${f} 不许被新值覆盖(老值优先)`, () => {
      const l = line(f);
      // 老值必须出现在「取老值」的位置:IF <老值非空> THEN <老值>
      expect(l, `${f} 是无条件覆盖 —— 浅采会抹掉已采全的字段`)
        .toMatch(new RegExp(`IF\\s+${f}\\s*!=\\s*NONE`));
    });
  }

  it('⭐ created_at 是 datetime,用 ?? 老值优先即可', () => {
    expect(line('created_at')).toMatch(/created_at\s*\?\?/);
  });
});

describe('② 会变的现状:要更新,但空值不许覆盖非空', () => {
  it('⭐ metrics 必须更新(用户要靠它找规律)', () => {
    const l = line('metrics');
    expect(l, 'metrics 不更新的话画像永远停在第一次采到的数字')
      .toMatch(/THEN\s*\$metrics/);
  });

  it('⚠️ metrics 为空时不许覆盖 —— 否则一次浅采清空已有计数', () => {
    expect(line('metrics')).toMatch(/object::len/);
  });

  for (const f of ['author_avatar', 'lang', 'author_handle']) {
    it(`⚠️ ${f} 空值不许覆盖非空`, () => {
      expect(line(f)).toMatch(new RegExp(`\\$${f}\\s*!=\\s*NONE`));
    });
  }
});

describe('③ metrics_at:没有观测时刻的计数不可比', () => {
  /**
   * ⚠️⚠️ **INSERT 段是独立的一份清单** —— 2026-09-22 实测漏掉过:
   * metrics_at 只加在 ON DUPLICATE 子句里,于是**新插入的行永远是 NONE**
   * (一趟采 22 条新行,metrics_at 全空,而守卫全绿)。
   * ⭐ 与「x_tweet 加字段要登记四处」同族;这条钉的正是「只登记了一半」。
   */
  it('⚠️⚠️ 新行也要写 metrics_at(不能只加在 UPDATE 子句)', () => {
    const ins = (() => {
      const i = repo.indexOf('INSERT INTO x_tweet');
      expect(i, '找不到 INSERT 段').toBeGreaterThan(0);
      return repo.slice(i, repo.indexOf('ON DUPLICATE KEY UPDATE', i));
    })();
    expect(ins.length).toBeGreaterThan(200);
    expect(ins, 'INSERT 段没有 metrics_at —— 新行的观测时刻会永远为空')
      .toMatch(/metrics_at\s*:/);
  });

  it('⚠️ metrics_at 必须真的绑了值(SQL 用了 $metrics_at,参数里要给)', () => {
    const params = repo.slice(repo.indexOf('tweet_id: record.tweet_id'));
    expect(params, '参数对象里没有 metrics_at —— 写进去的会是空')
      .toMatch(/metrics_at\s*:/);
  });

  it('⭐ 必须有 metrics_at', () => {
    expect(onDup, '没有 metrics_at —— 「发出10分钟的500阅读」与「半年的500阅读」在库里一样')
      .toMatch(/metrics_at\s*=/);
  });

  it('⚠️ 只在真的更新了 metrics 时才推进,否则谎报新鲜度', () => {
    expect(line('metrics_at')).toMatch(/object::len/);
  });
});

describe('④ ?? 判空的陷阱', () => {
  /**
   * ⚠️ 实测:SurrealDB 的 ?? 把**空串当成有值** ——
   * `tweet_url = tweet_url ?? $tweet_url` 在老值是空串时永远补不上。
   * 今天库里恰好 0 行空串,但写入侧随时可能产生一行,不能靠运气。
   */
  for (const f of ['tweet_url', 'conversation_id']) {
    it(`⭐ ${f} 要连空串一起判,不能只用 ??`, () => {
      expect(line(f), `${f} 只判了 NONE,老值是空串时补不上`).toMatch(/!=\s*''/);
    });
  }
});

describe('⑤ 业务字段一律不碰(回归)', () => {
  for (const f of ['accepted', 'ai_verdict', 'translation', 'replied', 'status']) {
    it(`⚠️ ${f} 不许出现在更新子句里`, () => {
      expect(onDup, `${f} 被采集覆盖 —— 人工与 AI 的结果会被清掉,不可逆`)
        .not.toMatch(new RegExp(`^\\s*${f}\\s*=`, 'm'));
    });
  }
});
