/**
 * ⭐⭐⭐ 「人」这条链**接通了没有** —— 一个入口,采到就存
 *
 * 用户 2026-10-05 的订正(原话):
 * 「不管采什么,都是采集页面的内容,而不应该增加一个采人的名单。
 * 　跳转到那个页面,就采集那个页面,这就是输出的意义。
 * 　**输出要自行判断**,把输出的内容结构化而已。」
 *
 * ⚠️⚠️ 本文件的**上一版钉的是「采人（名单）」那个第二按钮** ——
 * 按钮删掉后 7 条全红。那是对的:守卫红是因为它钉的东西真的没了。
 * ⭐ `feedback-guard-must-pin-live-code` 反过来说的也是这件事:
 * 钉在死代码上的守卫会**一直绿**,而那才是危险的。
 *
 * ⭐ 现在逐环钉**单入口**:采 → dispatch 分流 → saveUsers → x_author。
 * ⚠️ 本文件证明「每一环都在且对得上」,**不是**「点了真会采到人」——那要真机。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { X_USER_LIST_PAGES, PAGE_PARAMS } from '@modules/x/x-pages';

const read = (p: string): string => readFileSync(p, 'utf8');
const CONSOLE = read('src/modules/x/XConsole.tsx');
const IPC = read('src/modules/x/x-data-ipc.ts');
const TYPES = read('src/modules/x/x-data-types.ts');
const RUN = read('src/modules/x/x-collect-run.ts');

/** ⭐ 切出面板里「存人」那一段 —— 不整文件 toMatch */
function saveUsersBlock(): string {
  const i = CONSOLE.indexOf("op: 'saveUsers'");
  expect(i, '面板里找不到存人的调用 —— 采到的人又蒸发了').toBeGreaterThan(-1);
  const from = CONSOLE.lastIndexOf('const users =', 0 + i);
  expect(from, '找不到「从 run 里取人」那一步').toBeGreaterThan(-1);
  const body = CONSOLE.slice(from, i + 400);
  expect(body.length).toBeGreaterThan(200);
  return body;
}

describe('一个入口:采到人就存', () => {
  it('⭐⭐⭐ 只有一个采集按钮 —— 不许再出现第二个「采人」入口', () => {
    /**
     * ⚠️⚠️ 这是本轮订正的**核心判据**:让人去选「这页上是什么」
     * 就是造第二个真源,而端点名里本来就写着。
     * ⭐ 判据钉在「面板不许再有采人专用按钮」上。
     */
    expect(CONSOLE, '又加回了采人专用按钮 —— 页面装什么该由响应说')
      .not.toContain('采人（名单）');
    expect(CONSOLE, '面板不该再直接调人流专用编排')
      .not.toContain('runUserCollect');
  });

  it('⭐⭐⭐ 人是从同一次采集的结果里取的,不是另跑一趟', () => {
    const b = saveUsersBlock();
    expect(b, '必须从 run.users 取 —— 那是同一次 harvest 解出来的')
      .toMatch(/run\.users\.flatMap/);
  });

  it('⭐⭐⭐ runCollect 真的把用户产出来(不只是声明了字段)', () => {
    /**
     * ⚠️ `feedback-source-scan-cant-see-execution`:字段在类型里
     * 不等于有人往里放东西。这里钉**赋值点**。
     */
    expect(RUN).toMatch(/users: userAudits/);
    expect(RUN, '第一轮要收').toMatch(/^\s*takeUsers\(rep\);/m);
    expect(RUN, '翻页回来的也要收').toMatch(/takeUsers\(one\);/);
  });

  it('⭐⭐⭐ 一条推文都没有也不许提前 return —— followers 页就是这样', () => {
    /**
     * ⚠️⚠️ 原先 `audits.length === 0` 直接 return,
     * 等于**跳过整个翻页段**:X 一直说还有下一页而我们只采第一页。
     */
    expect(RUN, '「没推文」必须只是个标记,不是 return')
      .toMatch(/const noTweets = audits\.length === 0;/);
    /** ⭐ 而且那个 return 要落在**翻页之后** */
    const iPaging = RUN.indexOf('pageUntilDone(deps,');
    const iReturn = RUN.indexOf('if (noTweets && audits.length === 0)');
    expect(iPaging).toBeGreaterThan(-1);
    expect(iReturn, '没推文的 return 必须在翻页之后,否则翻不了页')
      .toBeGreaterThan(iPaging);
  });

  it('⭐⭐⭐ 名单映射里的每个页名,真的是登记过的页', () => {
    /**
     * ⚠️ 清单**从真表推**,不在守卫里写死
     * (`feedback-guard-hardcoded-list-never-grows`)。
     */
    expect(Object.keys(X_USER_LIST_PAGES).length).toBeGreaterThanOrEqual(3);
    for (const page of Object.keys(X_USER_LIST_PAGES)) {
      expect(Object.keys(PAGE_PARAMS), `映射里有 ${page},但它不是登记过的页`)
        .toContain(page);
    }
    for (const [page, src] of Object.entries(X_USER_LIST_PAGES)) {
      expect(src.trim(), `${page} 的 list_source 是空的`).not.toBe('');
    }
  });

  it('⭐⭐⭐ 面板不许写死语义页名 —— 只许查映射', () => {
    const b = saveUsersBlock();
    expect(b).toMatch(/X_USER_LIST_PAGES\[/);
    expect(b, '不许出现写死的 x.xxx 页名').not.toMatch(/'x\.[a-zA-Z]+'/);
  });

  it('⭐⭐⭐ 认不出页面时 listSource 留空 —— 绝不默认成 followers', () => {
    /**
     * ⚠️⚠️ 兜底在这里的代价是**写坏人的档案**:
     * `listSource` 进 `list_memberships`(累加不覆盖),猜错了会在
     * 每个人身上永久留一条错记录,而「他在不在我的关注者里」从此答错
     * 且**看不出来**。⭐ 这是少数「宁可不存也不兜底」的地方。
     */
    const b = saveUsersBlock();
    expect(b, '认不出就该留空串,由 IPC 侧拒收').toMatch(/\?\? ''/);
    expect(b, '不许兜底成某个具体名单').not.toMatch(/\?\?\s*'(followers|following)'/);
  });

  it('⭐⭐⭐ IPC 拒收空 listSource —— 它会永久留在人的档案里', () => {
    const i = IPC.indexOf("case 'saveUsers':");
    expect(i).toBeGreaterThan(-1);
    const body = IPC.slice(i, IPC.indexOf("case 'delete':", i));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/listSource !== 'string' \|\| p\.ctx\.listSource\.trim\(\) === ''/);
    expect(body).toMatch(/return failed\(/);
  });

  it('⭐⭐⭐ 契约与 handler 两边都有 saveUsers', () => {
    /** ⚠️ 契约有、handler 没有 = 点了静默回「不认识的 op」 */
    expect(TYPES).toMatch(/op: 'saveUsers'/);
    expect(IPC).toMatch(/case 'saveUsers':/);
    expect(IPC).toContain("import { saveUsers } from './x-user-repo'");
  });

  it('⭐⭐ 落库结果落盘 —— 不然「报了 N 条库里 0 行」只能去猜', () => {
    const i = IPC.indexOf("case 'saveUsers':");
    const body = IPC.slice(i, IPC.indexOf("case 'delete':", i));
    expect(body).toMatch(/traceRecorder\.lifecycle\(/);
    expect(body).toMatch(/x-save-users-ok/);
    expect(body).toMatch(/x-save-users-incomplete/);
    /** ⭐ 成功/不完整要**由数据算**,不是写死一个 ok */
    expect(body).toMatch(/r\.inserted \+ r\.updated === 0/);
  });

  it('⭐⭐⭐ 面板要显示「解出多少」和「存了多少」两个数', () => {
    /** ⚠️ 合成一个数就是「面板报 44、库里 0」那家族的起点 */
    expect(CONSOLE).toMatch(/解出 <strong>\{userRun\.users\}<\/strong>/);
    expect(CONSOLE).toMatch(/新 <strong>\{userRun\.saved\.inserted\}<\/strong>/);
    /** ⭐ 没存进去要说为什么(最常见=认不出页面被拒收) */
    expect(CONSOLE).toMatch(/没入库：\{userRun\.reason\}/);
  });

  it('⭐⭐⭐ 编排层不许自己拿空轮刹车 —— 那是业务的事', () => {
    /**
     * ⚠️⚠️ `project-x-cursor-paging` 实测:3 页刹车把 2604 账号
     * **卡死在 2244**、三跑同数,而 X 一直说 hasMore=true。
     */
    const loop = RUN.slice(RUN.indexOf('while (round <'));
    expect(loop.length).toBeGreaterThan(500);
    const breaks = [...loop.matchAll(/if \([^)]*emptyRounds[^)]*\)[^\n]*\n?[^\n]*break/g)];
    expect(breaks, '编排层拿 emptyRounds 刹车了').toHaveLength(0);
  });

  it('⭐⭐ 翻页种子认推文也认用户请求', () => {
    /**
     * ⚠️ 原先只认推文请求当种子,于是 followers 页「有游标、X 说还有」
     * 却一页都翻不动 —— 又是「采集只认推文」那个旧假设。
     */
    expect(RUN).toMatch(/carriesTweets\(it\.url\) \|\| carriesUsers\(it\.url\)/);
  });
});
