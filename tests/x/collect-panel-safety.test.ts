/**
 * ⚠️⚠️ 采集面板的三个「说好一件事、做了另一件事」的坑 —— 2026-09-22 用户实测。
 *
 * 用户报:「第三任务不会自动跳转,后来又是在用户自己的主页上爬取数据,
 *          而且约定 30 轮也不停止」——**三个现象,一个根因 + 一个 UI 陷阱**。
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

const view = strip(readFileSync(
  join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));

describe('⚠️ 跟着左边走:首次读到不许覆盖右边的选择', () => {
  /** ⚠️ 切到那个 effect 里再断言 —— 整文件 toMatch 会被别处的同名符号兜住 */
  const effect = (() => {
    const i = view.indexOf('lastSeenUrl');
    expect(i, '找不到 lastSeenUrl').toBeGreaterThan(0);
    const seg = view.slice(i, i + 1400);
    expect(seg.length).toBeGreaterThan(200);
    return seg;
  })();

  it('⚠️⚠️ 必须有「首次不覆盖」的闸 —— 否则右边选好的页面会被改写成 x.home', () => {
    // 事故:lastSeenUrl 初值 undefined,第一次读到任何 URL 都被当成「左边刚导航」
    // → 覆盖右边 → 采首页(无限流,永远不停),还标着目标 handle 的归属
    // ⚠️ 不能只搜 'undefined'/'first' —— 别处也有这些词,注入真 bug 时仍会绿
    //    (实测:退回「首次就覆盖」时这条没红,是下面那条抓住的)
    //    必须钉「把首次判据算出来」这个行为本身
    expect(effect, '首次读到就覆盖右边 —— 用户选的页面会被静默改掉')
      .toMatch(/lastSeenUrl\.current\s*===\s*undefined/);
  });

  it('⭐ 首次那一下必须 return,不能继续往下 setAcPage', () => {
    const idx = effect.search(/const first|first\s*=/);
    expect(idx, '没有 first 判据').toBeGreaterThan(-1);
    const after = effect.slice(idx, idx + 220);
    expect(after).toMatch(/if\s*\(\s*first\s*\)\s*return/);
  });
});

describe('⭐ 三个数字框必须有可见标签(不能只靠 placeholder)', () => {
  /**
   * 事故:三个框长得一样,「轮数填 30」被填进第三个框(翻页),
   * 轮数一直是空的 → 5000 轮上限 → 「说好 30 轮却一直跑」。
   * ⚠️ placeholder 在填了字之后就消失,正是最需要确认的时候。
   */
  const row = (() => {
    // ⚠️ 必须锚到 **JSX**,不能锚 `setAcRounds` —— 那会命中 useState 声明处
    // (踩过:切出来的是一堆 useState,三个标签一个都不在里面)
    const i = view.indexOf('onChange={(e) => setAcRounds(e.target.value)}');
    expect(i, '找不到轮数输入框的 JSX').toBeGreaterThan(0);
    const seg = view.slice(i - 600, i + 1600);
    expect(seg.length).toBeGreaterThan(400);
    return seg;
  })();

  it('⚠️ 轮数 / 秒 / 翻页 三个标签都要作为可见文本存在', () => {
    // ⭐ 钉「标签作为 JSX 文本节点出现」,不钉具体缩进(缩进会随格式化漂)
    for (const label of ['轮数', '秒', '翻页']) {
      const re = new RegExp(`>\\s*${label}\\s*<input`);
      expect(re.test(row), `「${label}」没有作为可见标签包住输入框`).toBe(true);
    }
  });

  it('⚠️ 翻页框的提示要点明它不是轮数(两者最容易混)', () => {
    const i = row.indexOf('setAcPages');
    const near = row.slice(Math.max(0, i - 400), i + 200);
    expect(near).toMatch(/不是轮数/);
  });
});

describe('⭐ 「已在目标页」与「落地校验」两处判据必须一致', () => {
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

  it('⚠️ already 判据要忽略大小写 —— X 的 handle 大小写不敏感', () => {
    const i = harvester.indexOf('const already');
    expect(i, '找不到 already').toBeGreaterThan(0);
    const seg = harvester.slice(i, i + 700);
    // 落地校验本来就 toLowerCase,两处不一致会出现「判不在→跳→落地判在」
    const lowers = (seg.match(/toLowerCase/g) ?? []).length;
    expect(lowers, 'already 的 path 比对没有 toLowerCase,与落地校验不一致')
      .toBeGreaterThanOrEqual(2);
  });
});
