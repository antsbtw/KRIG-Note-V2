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
import { capBlock, capOfOp, ipcHandles, readCapBlock, saveFnBody } from './_x-ipc-wiring';
import { readFileSync } from 'node:fs';
import { X_USER_LIST_PAGES, PAGE_PARAMS } from '@modules/x/x-pages';

const read = (p: string): string => readFileSync(p, 'utf8');
const IPC = read('src/modules/x/x-data-ipc.ts');
const TYPES = read('src/modules/x/x-data-types.ts');
const RUN = read('src/modules/x/x-collect-run.ts');


describe('一个入口:采到人就存', () => {


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



  it('⭐⭐⭐ IPC 拒收空 listSource —— 它会永久留在人的档案里', () => {
    /** 2026-10-24 迁到能力 x.user.save:空 listSource 在参数校验里拒(invalid) */
    const body = capBlock('x.user.save');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/listSource !== 'string' \|\| ctx\.listSource\.trim\(\) === ''/);
    expect(body).toMatch(/throw new Bad\(/);
  });

  it('⭐⭐⭐ 契约与 handler 两边都有 saveUsers', () => {
    /** ⚠️ 契约有、handler 没有 = 点了静默回「不认识的 op」 */
    expect(TYPES).toMatch(/op: 'saveUsers'/);
    expect(ipcHandles(IPC, 'saveUsers')).toBe(true);
    /** ⚠️ 同一行还会 import 别的(saveTweetAuthors)—— 钉「saveUsers 从 repo 来」,不钉整行字面 */
    expect(require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/modules/x/x-save-batch.ts'), 'utf8')).toMatch(/import \{[^}]*\bsaveUsers\b[^}]*\} from '\.\/x-user-repo'/);
  });

  it('⭐⭐ 落库结果落盘 —— 不然「报了 N 条库里 0 行」只能去猜', () => {
    const body = saveFnBody('saveUserBatch');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/traceRecorder\.lifecycle\(/);
    expect(body).toMatch(/x-save-users-ok/);
    expect(body).toMatch(/x-save-users-incomplete/);
    /** ⭐ 成功/不完整要**由数据算**,不是写死一个 ok */
    expect(body).toMatch(/r\.inserted \+ r\.updated === 0/);
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




  it('⭐⭐⭐ 每轮的游标要落账 —— 否则「X 回同一批」没法定位', () => {
    /**
     * ⚠️⚠️ 真机翻 16 轮只多 20 人,而我**读不出每轮发的游标是什么**:
     * 「游标没变」(我的 bug)和「游标变了 X 还回同一批」(请求形状的问题)
     * 是完全不同的两个毛病,光看总数分不出来,只能猜。
     * ⭐ `feedback-maintainability-over-feature-completion`:
     * 下次验证要能不靠人、只靠留下的东西说清楚。
     */
    expect(RUN).toMatch(/roundsDetail\.push\(/);
    const push = RUN.slice(RUN.indexOf('roundsDetail.push('));
    const line = push.slice(0, push.indexOf(');'));
    for (const k of ['round', 'cursor', 'fresh', 'responses']) {
      expect(line, `每轮的账里缺 ${k}`).toContain(k);
    }
  });




  it('⭐⭐⭐ IPC 三个游标 op 都要有 handler —— 契约有、handler 没有 = 静默失败', () => {
    for (const op of ['readCursor', 'saveCursor', 'clearCursor']) {
      expect(TYPES, `契约里缺 ${op}`).toMatch(new RegExp(`op: '${op}'`));
      expect(ipcHandles(IPC, op), `handler 里缺 ${op} —— 点了会回「不认识的 op」`).toBe(true);
    }
    /** 2026-10-24 三个都迁到能力 x.cursor.read / save / clear */
    void capOfOp;
    expect(readCapBlock('x.cursor.read')).toMatch(/readCursor\(i\.scope\)/);
    expect(capBlock('x.cursor.save')).toMatch(/await saveCursor\(i\.cursor\)/);
    expect(capBlock('x.cursor.clear')).toMatch(/await clearCursor\(i\.scope\)/);
  });




  it('⭐⭐⭐ 状态码必须一路带到采集层 —— 429 看不见就会报成「滚到底」', () => {
    /**
     * ⚠️⚠️⚠️ **折腾七八轮的真因**(2026-10-06):
     * `RunHarvest.items` 原先只声明 `{url, text}`,
     * **状态码在类型边界上被丢掉了** —— 底座的 `AcquiredItem` 有 `status`、
     * 面板甚至红字显示着 `429 Rate limit exceeded`,偏偏采集层拿不到。
     * 于是被限流时照样报「滚到底了」,我对着滚动/翻页/游标改了七八轮,全不是真因。
     *
     * ⭐ 这条钉三件事:类型带着它、有人真的读它、读出来要喊。
     */
    expect(RUN, 'RunHarvest.items 必须带 status').toMatch(/readonly status\?: number;/);
    expect(RUN, '要有人真的判 429').toMatch(/it\.status === 429/);
    expect(RUN, '判出来要给调用方一个字段').toMatch(/readonly rateLimit\?: string;/);
    /** ⭐ 底座那一侧本来就有 —— 钉住它别被「精简」掉 */
    const ACQ = read('src/platform/main/web-capability/acquire/types.ts');
    expect(ACQ, 'AcquiredItem 的 status 是源头,丢了全链路都瞎').toMatch(/readonly status: number;/);
  });


  it('⭐⭐ 翻页种子认推文也认用户请求', () => {
    /**
     * ⚠️ 原先只认推文请求当种子,于是 followers 页「有游标、X 说还有」
     * 却一页都翻不动 —— 又是「采集只认推文」那个旧假设。
     */
    expect(RUN).toMatch(/carriesTweets\(it\.url\) \|\| carriesUsers\(it\.url\)/);
  });
});
