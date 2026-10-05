/**
 * ⭐⭐⭐ 「采人」这条链**接通了没有** —— 面板点得到吗
 *
 * ⚠️⚠️ `feedback-guard-must-pin-live-code` 的教训:
 * 守卫钉在「进不去的分支」上 **631 条全绿却点不到**
 * (CaptureMonitorView 顶栏入口早被撤了)。
 * ⭐ 所以这里**逐环钉**:页名 → 按钮 → IPC op → repo 导出,
 * 每一环都要能在**真实的那份代码**里找到,且**名字逐字一致**。
 *
 * ⚠️ 本文件证明的是「**链上每一环都存在且对得上**」,
 * **不是**「点了真的会采到人」—— 那要真机。别把它当成真机验收。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { X_USER_LIST_PAGES, PAGE_PARAMS } from '@modules/x/x-pages';

const read = (p: string): string => readFileSync(p, 'utf8');
const CONSOLE = read('src/modules/x/XConsole.tsx');
const IPC = read('src/modules/x/x-data-ipc.ts');
const TYPES = read('src/modules/x/x-data-types.ts');
const RUN = read('src/modules/x/x-user-run.ts');

/** ⭐ 切出「采人」按钮的 onClick —— 不整文件 toMatch */
function userButton(): string {
  const i = CONSOLE.indexOf('采人（名单）');
  expect(i, '面板里找不到「采人」按钮 —— 入口没了,后面全是空谈')
    .toBeGreaterThan(-1);
  /** ⚠️ 按钮文字在 JSX 末尾,onClick 在它**前面** —— 往回切 */
  const from = CONSOLE.lastIndexOf('<button', i);
  expect(from).toBeGreaterThan(-1);
  const body = CONSOLE.slice(from, i);
  expect(body.length).toBeGreaterThan(200);
  return body;
}

describe('采人链路接通', () => {
  it('⭐⭐⭐ 名单映射里的每个页名,真的是登记过的页', () => {
    /**
     * ⚠️⚠️ 清单**从真表推**,不在守卫里写死 ——
     * `feedback-guard-hardcoded-list-never-grows`:
     * 写死的清单不会自己长,新增第四个名单天然在视野外。
     * ⭐ 这一条第一次跑就逮到我自己:我拿 `X_PAGE_NAME` 当页面注册表,
     * 它其实只有 article/search 两项 —— **而我在面板里写死了三个页名**,
     * 正好撞上「面板里不许出现写死的语义页名」那道老守卫。
     * 修法是把名字加进页面表、面板只认映射。
     */
    expect(Object.keys(X_USER_LIST_PAGES).length).toBeGreaterThanOrEqual(3);
    for (const page of Object.keys(X_USER_LIST_PAGES)) {
      expect(Object.keys(PAGE_PARAMS), `映射里有 ${page},但它不是登记过的页`)
        .toContain(page);
    }
    /** ⭐ `list_source` 的词不许为空 —— 它会进每个人的档案 */
    for (const [page, src] of Object.entries(X_USER_LIST_PAGES)) {
      expect(src.trim(), `${page} 的 list_source 是空的`).not.toBe('');
    }
  });

  it('⭐⭐⭐ 面板不许写死语义页名 —— 只许查映射', () => {
    /**
     * ⚠️ 老守卫的原话:「面板抄一份清单就会漂」,
     * 而漂的表现是「面板上有这个名字、点下去说没登记」。
     */
    const btn = userButton();
    expect(btn).toMatch(/X_USER_LIST_PAGES\[page\]/);
    expect(btn, '按钮里不许出现写死的 x.xxx 页名').not.toMatch(/'x\.[a-zA-Z]+'/);
  });

  it('⭐⭐⭐ 认不出页面就不跑 —— 绝不默认成 followers', () => {
    /**
     * ⚠️⚠️ 兜底在这里的代价是**写坏人的档案**:
     * `listSource` 进 `list_memberships`(累加不覆盖),猜错了会在
     * 每个人身上永久留一条错记录,而「他在不在我的关注者里」从此答错
     * 且**看不出来**。
     * ⭐ `project-x-collect-panel-scraped-homepage` 同族:
     * 静默改页爬了 30 分钟首页、1281 条污染入库。
     */
    const btn = userButton();
    expect(btn, '必须有「认不出就 return」这道闸')
      .toMatch(/if \(listSource === ''\)/);
    /** ⭐ 而且闸里要 return,不是只报个信就往下走 */
    const gate = btn.slice(btn.indexOf("if (listSource === '')"));
    const branch = gate.slice(0, gate.indexOf('\n                      }'));
    expect(branch.length).toBeGreaterThan(20);
    expect(branch).toMatch(/\breturn\b/);
    /** ⚠️ 不许出现「认不出就当 followers」那种兜底 */
    expect(btn).not.toMatch(/listSource\s*(=|\|\|)[^;]*\?\?\s*'followers'/);
  });

  it('⭐⭐⭐ 按钮真的调 runUserCollect,且 listSource 传下去', () => {
    const btn = userButton();
    expect(btn).toMatch(/await runUserCollect\(/);
    /** ⭐ 传的是认出来的那个词,不是写死的字面量 */
    expect(btn).toMatch(/\{ listSource, wantPages/);
    expect(CONSOLE).toContain("import { runUserCollect } from './x-user-run'");
  });

  it('⭐⭐⭐ 落库走 saveUsers,IPC 和契约两边都有', () => {
    const btn = userButton();
    expect(btn).toMatch(/op: 'saveUsers'/);
    /** ⚠️ 契约有、handler 没有 = 点了静默回「不认识的 op」 */
    expect(TYPES).toMatch(/op: 'saveUsers'/);
    expect(IPC).toMatch(/case 'saveUsers':/);
    expect(IPC).toContain("import { saveUsers } from './x-user-repo'");
  });

  it('⭐⭐⭐ IPC 拒收空 listSource —— 它会永久留在人的档案里', () => {
    const i = IPC.indexOf("case 'saveUsers':");
    const body = IPC.slice(i, IPC.indexOf("case 'delete':", i));
    expect(body.length).toBeGreaterThan(200);
    expect(body, '空 listSource 要拒收,与 source 的「记 unknown」故意不同')
      .toMatch(/listSource !== 'string' \|\| p\.ctx\.listSource\.trim\(\) === ''/);
    expect(body).toMatch(/return failed\(/);
  });

  it('⭐⭐ 落库结果落盘 —— 不然「报了 N 条库里 0 行」只能去猜', () => {
    const i = IPC.indexOf("case 'saveUsers':");
    const body = IPC.slice(i, IPC.indexOf("case 'delete':", i));
    /**
     * ⚠️⚠️ 三跑「面板报入库 N 条、库里 0 行」而留痕里一个字都没有,
     * 于是每跑都只能去真库里猜 —— **猜错了三次**。
     */
    expect(body).toMatch(/traceRecorder\.lifecycle\(/);
    expect(body).toMatch(/x-save-users-ok/);
    expect(body).toMatch(/x-save-users-incomplete/);
    /** ⭐ 成功/不完整要**由数据算**,不是写死一个 ok */
    expect(body).toMatch(/r\.inserted \+ r\.updated === 0/);
  });

  it('⭐⭐⭐ 面板要显示「采到多少」和「存了多少」两个数', () => {
    /**
     * ⚠️⚠️ 合成一个数就是「面板报 44、库里 0」那家族的起点:
     * 「采到了」和「存进去了」是两件事。
     */
    expect(CONSOLE).toMatch(/采到 <strong>\{userRun\.users\}<\/strong>/);
    expect(CONSOLE).toMatch(/新 <strong>\{userRun\.saved\.inserted\}<\/strong>/);
    /** ⭐ 还要印「哪道闸停的」—— 上一跑 47 轮我读不出原因就是缺这个 */
    expect(CONSOLE).toMatch(/停因：\{userRun\.stopReason\}/);
  });

  it('⭐⭐ 停止按钮管得到采人(共用 cancelRef)', () => {
    const btn = userButton();
    expect(btn, '不接 cancelled 的话「点停止没反应」会第四次重演')
      .toMatch(/cancelled: \(\) => cancelRef\.current/);
  });

  it('⭐⭐⭐ 面板侧不许自己加「几轮没新人就停」的刹车', () => {
    /**
     * ⚠️⚠️ `project-x-cursor-paging` 实测:3 页刹车把 2604 账号
     * **卡死在 2244**、三跑同数,而 X 一直说 hasMore=true。
     * ⭐ 推文那边的面板有 `emptyRounds >= 15`(推文页情形不同);
     * 人流这边**一条都不许有** —— 滚动已采过的人让头几页天然零新增。
     */
    const btn = userButton();
    const stop = btn.slice(btn.indexOf('stopPaging:'));
    const sp = stop.slice(0, stop.indexOf('cancelled:'));
    expect(sp.length).toBeGreaterThan(50);
    expect(sp, '人流不许用空轮数当停止理由').not.toMatch(/emptyRounds/);
    /** ⭐ 唯一的业务闸是人填的页数 */
    expect(sp).toMatch(/st\.round >= want/);
  });

  it('⭐⭐ 编排层自己也不设空轮上限', () => {
    /** ⚠️ 面板不设、编排偷偷设了,等于白说 */
    const loop = RUN.slice(RUN.indexOf('while (round <'));
    expect(loop.length).toBeGreaterThan(500);
    /** ⭐ emptyRounds 只许**算出来报给业务**,不许自己拿它 break */
    const breaks = [...loop.matchAll(/if \([^)]*emptyRounds[^)]*\)[^\n]*\n?[^\n]*break/g)];
    expect(breaks, '编排层拿 emptyRounds 刹车了 —— 那是业务的事').toHaveLength(0);
  });
});
