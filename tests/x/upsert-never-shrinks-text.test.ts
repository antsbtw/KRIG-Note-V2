/**
 * ⚠️⚠️ **重采不许把正文变短** —— 2026-09-22 实测的数据损坏。
 *
 * ── 现象(同一批 tweet_id,前后对照)──
 *   2099916828529082572: 16081 字 → **267 字**(标题+摘要,断在句中)
 *   2102084427903860755:  6812 字 → **295 字**
 *   2102058908387094563:   782 字 → **278 字**(长推被 full_text 截断)
 * 同批的普通推毫发无伤 —— 只有「拿到过全文」的那些中招。
 *
 * ── 真因 ──
 * 主页时间线(UserOriginalsTimeline)给的长文只有 title + preview_text,
 * 而 upsert 里 `text = $text` 是**无条件覆盖** → **浅数据盖掉深数据**。
 *
 * ⭐⭐ 这是修 bug ④(INSERT IGNORE → ON DUPLICATE)**换来的副作用**:
 * 那次只想到「补全(空→有)」,没想到「降级(深→浅)」。
 * ⚠️ INSERT IGNORE 时代反而不会丢 —— 修一个 bug 开了另一个洞。
 *
 * ── 判据为什么用「长度」──
 * 采集侧分不清这次拿到的是全文还是摘要(同一个 article 字段,不同接口深度不同)。
 * **长度是唯一不依赖接口语义的判据**:更长 = 信息更多,永远不亏。
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

describe('upsert 不许让 text 变短', () => {
  const repo = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8'));

  /** ⚠️ 切到 ON DUPLICATE 子句再断言 —— 整文件 toMatch 会被 INSERT 段里的同名字段兜住 */
  const onDup = (() => {
    const i = repo.indexOf('ON DUPLICATE KEY UPDATE');
    expect(i, '找不到 ON DUPLICATE KEY UPDATE').toBeGreaterThan(0);
    const seg = repo.slice(i, repo.indexOf('`', i));
    expect(seg.length, '切出来的子句是空的').toBeGreaterThan(50);
    return seg;
  })();

  it('⚠️⚠️ text 不能是无条件覆盖(`text = $text` 正是数据损坏的根因)', () => {
    // 允许 `text = IF ...`,禁止裸的 `text = $text,`
    expect(onDup, 'text 被无条件覆盖 —— 浅摘要会盖掉已拿到的长文正文')
      .not.toMatch(/(^|\s)text\s*=\s*\$text\s*[,\n]/);
  });

  it('⭐ text 的覆盖必须带长度比较', () => {
    const line = onDup.split('\n').find((l) => /(^|\s)text\s*=/.test(l)) ?? '';
    expect(line, '找不到 text 的更新行').not.toBe('');
    expect(line).toMatch(/string::len/);
    expect(line).toMatch(/IF/);
  });

  it('⚠️ 必须有 ?? 兜 NONE —— string::len(NONE) 会抛错,整条 upsert 失败', () => {
    const line = onDup.split('\n').find((l) => /(^|\s)text\s*=/.test(l)) ?? '';
    expect(line, "老行 text 可能是 NONE,不兜会让整条 upsert 抛错").toMatch(/\?\?/);
  });

  /**
   * ⭐⭐ **行为测试** —— 源码扫描看不见「会不会真的挡住」。
   * 这里复刻那条判据的语义,喂真实的损坏场景。
   */
  describe('判据行为(复刻 SQL 语义)', () => {
    const decide = (oldText: string | undefined, newText: string): string =>
      (newText ?? '').length > (oldText ?? '').length ? newText : (oldText ?? '');

    it('⚠️⚠️ 深→浅必须挡住(16081 字不许被 267 字盖掉)', () => {
      expect(decide('x'.repeat(16081), 'y'.repeat(267))).toHaveLength(16081);
    });

    it('⭐ 浅→深必须放行(这是 bug ④ 修复要的「补全老数据」)', () => {
      expect(decide('y'.repeat(267), 'x'.repeat(16081))).toHaveLength(16081);
    });

    it('⭐ 空 / undefined 老值必须放行', () => {
      expect(decide('', 'newvalue')).toBe('newvalue');
      expect(decide(undefined, 'newvalue')).toBe('newvalue');
    });

    it('⭐ 等长时保持原值(不做无谓写入)', () => {
      expect(decide('abc', 'xyz')).toBe('abc');
    });
  });
});
