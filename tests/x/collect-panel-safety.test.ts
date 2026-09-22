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

describe('⚠️ 按钮只在「它真起作用」的页面露出来(2026-09-22 用户:「不用三个 button 了吧?」)', () => {
  const pages = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-pages.ts'), 'utf-8'));
  const handler = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/ipc/web-console-handler.ts'), 'utf-8'));

  it('⭐⭐ 快速增量必须按页面门控 —— 不采人的页面点它等于没点', () => {
    const i = view.indexOf('collect(true)');
    expect(i, '找不到快速增量的调用').toBeGreaterThan(0);
    /**
     * ⚠️ 往前切,看它有没有被条件包住。
     * `fastIncremental` 靠 knownHandles(上次采到的**人**)判早停,
     * 12 个页面里只有 3 个采人;在别的页面上 autoCollect **静默退回全量** ——
     * 按钮长得像个选择,其实什么都没变。
     */
    const before = view.slice(Math.max(0, i - 600), i);
    expect(before, '快速增量没有页面门控 —— 在不采人的页面上点了等于没点')
      .toMatch(/peoplePages\.includes\(acPage\)/);
  });

  it('⚠️⚠️ 采人页面的清单必须来自真表,面板不许自己写一份', () => {
    /**
     * ⭐ 「清单不会自己长」是本仓栽过五次的形态:
     * 面板抄一份 ['x.followers', …],加新的采人页面时那份**天然在视野外**。
     * → 清单定义在 x-pages(页面的真源),经 IPC 下发。
     */
    expect(pages, 'x-pages 没有导出采人页面清单')
      .toMatch(/export const PEOPLE_PAGE_NAMES/);
    expect(handler, 'pageNames 没有把采人清单下发给面板')
      .toMatch(/peoplePages:\s*PEOPLE_PAGE_NAMES/);
    /** ⚠️ 面板里**不许**出现写死的页面名清单 */
    const i = view.indexOf('peoplePages.includes(acPage)');
    expect(i, '找不到门控').toBeGreaterThan(0);
    const blk = view.slice(Math.max(0, i - 1200), i);
    expect(blk, '面板自己写死了采人页面清单 —— 加新页面时它不会自己长')
      .not.toMatch(/'x\.followers'/);
  });

  it('⭐⭐ 「补长文正文」按钮必须彻底不存在 —— 采集时一次采全,没有「补」这个动作', () => {
    /**
     * ── 用户 2026-09-22 两句话定的 ──
     * > 「补长正文这个 button 才是没必要的吧?」
     * > 「长正文就不应该补,应该一次采集完毕。」
     *
     * ⭐ 实测印证:那个按钮的候选**恒为 0** —— 不是碰巧,是结构决定的。
     * `is_article` 只有采集时才写,而同一趟采集当场就把正文补了,
     * 「标了长文却缺正文」这种行几乎不可能存在。
     * 它是两步式方案的残骸,连同 IPC 通道与查库一起删了。
     */
    expect(view, '面板又出现了补长文正文按钮 —— 采集已经一次采全,不该有「补」这个动作')
      .not.toMatch(/backfillArticles/);
    expect(handler, 'handler 又注册了补长文正文通道')
      .not.toMatch(/BACKFILL_ARTICLES/);
  });

  it('⚠️ WEBC_COUNT 要跟着通道数走(删通道也要改)', () => {
    /**
     * ⚠️ 它只出现在启动日志里,漂了**不会报错**,日志就开始说假话。
     * 加通道时栽过一次(18→19),删通道同样要改回来。
     */
    const n = Number(handler.match(/WEBC_COUNT = (\d+)/)?.[1] ?? 0);
    expect(n, '找不到 WEBC_COUNT').toBeGreaterThan(0);
    const registered = (handler.match(/ipcMain\.handle\(/g) ?? []).length;
    expect(n, `WEBC_COUNT=${n} 但实际注册 ${registered} 个 —— 启动日志在说假话`)
      .toBe(registered);
  });
});