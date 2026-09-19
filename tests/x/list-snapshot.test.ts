import { describe, it, expect } from 'vitest';
import { findPagingCursor } from '../../src/platform/main/x/x-people-harvester';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 去注释,避免注释里的字样把守卫兜住(本仓「整文件 toMatch 假绿」栽过三次) */
function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

describe('⭐⭐ followers 增量采集', () => {
  const repo = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/db/x-author-repo.ts'), 'utf-8'));
  const collectRaw = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));
  /**
   * ⚠️ **切掉 import 区**再找调用点 —— 否则 indexOf 会命中 import 里的
   * 同名符号,而不是真正的调用处(本轮实测:守卫因此假红,
   * 代码顺序其实是对的)。同族坑见 feedback-guard-scope-to-the-branch。
   */
  const bodyStart = collectRaw.lastIndexOf("from '");
  const collect = collectRaw.slice(collectRaw.indexOf('\n', bodyStart));

  it('⭐⭐ 全量仍然用差集 —— 「谁取关了」只有它答得出', () => {
    /**
     * ⚠️ 这条**原来是「禁止一切早停」**,理由是「X 按什么排序没有证据」。
     * 2026-09-19 证据有了(见下一条),禁令因此**改成了限定**:
     * 快速增量可以早停,但**全量必须照旧走差集** ——
     * 取关者是从名单中间消失的,只有采全了比差集才发现得了。
     */
    expect(repo, '没有差集函数').toMatch(/export async function diffSnapshots/);
    expect(collect, '采集流程没调差集').toMatch(/diffSnapshots\(/);
  });

  it('⭐⭐⭐ 快速增量**绝不写快照** —— 写了会把基线毁掉', () => {
    /**
     * ── 不加这条会怎样(本次改动最危险的失败形态)──
     *
     * 快速增量只翻前一两页(几十人)。若把这几十人存成快照,
     * **下一次差集**会拿它当基线,报出「新增 0 人、**取关 2700 人**」——
     * 一次快速采集就毁掉 2781 人的基线,而且**在数据里看不出来**
     * (表里确实有一条完整记录,只是它只有 60 行)。
     *
     * ⚠️ 钉**写快照那个 if 的条件**,不是「文件里出现过 mayWriteSnapshot」——
     * 声明处和注释都有这个名字,整文件 toMatch 会被兜住
     * (本仓「假绿」已栽过五次,见 feedback-guard-scope-to-the-branch)。
     */
    const i = collect.indexOf('saveListSnapshot(scope, runId');
    expect(i, '找不到快照写入调用').toBeGreaterThan(0);

    /** 往前找**包住它**的那个 if —— 快照写入必须在守卫之内 */
    const guardIdx = collect.lastIndexOf('if (r.people.length > 0', i);
    expect(guardIdx, '快照写入不在任何 if 之内').toBeGreaterThan(0);
    const cond = collect.slice(guardIdx, collect.indexOf('{', guardIdx));
    expect(
      cond,
      '写快照的条件里没有「非快速模式」这一项 —— 快速增量会把几十人存成基线,'
      + '下次差集报「2700 人取关」',
    ).toMatch(/mayWriteSnapshot/);

    /**
     * ⚠️ 判据必须是**真跑了快速模式**(ranFast),不是**人想快**
     * (opts.fastIncremental)—— 退回全量那跑是完整列表,必须写快照,
     * 否则第一次采新账号永远建不起基线。两者差一个字,行为相反。
     */
    const assign = collect.match(/const mayWriteSnapshot\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 mayWriteSnapshot 的赋值').toBeTruthy();
    expect(
      assign,
      'mayWriteSnapshot 不是从 ranFast 算的 —— 用 opts.fastIncremental 会让'
      + '「退回全量」那跑也不写快照,基线永远建不起来',
    ).toMatch(/ranFast/);

    const rf = collect.match(/const ranFast\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(rf, '找不到 ranFast 的赋值').toBeTruthy();
    expect(
      rf,
      'ranFast 不是从「真拿到了已知名单」算的 —— 名单取不到时该退回全量',
    ).toMatch(/knownHandles/);
  });

  it('⭐⭐ 0 人那跑不能存快照 —— 否则下次会误判成「全员取关」', () => {
    const i = collect.indexOf('saveListSnapshot');
    expect(i, '没有存快照').toBeGreaterThan(0);
    // 往前找它所在的 if 条件
    const before = collect.slice(Math.max(0, i - 600), i);
    expect(
      before,
      '存快照前没有「采到人才存」的判断 —— 0 人那跑会把所有人当成取关',
    ).toMatch(/r\.people\.length > 0/);
  });

  it('⭐⭐ 上一批次必须在写入本批之前取,否则取到自己', () => {
    const i = collect.indexOf('recentSnapshotRuns');
    const j = collect.indexOf('saveListSnapshot');
    expect(i, '没有取上一批次').toBeGreaterThan(0);
    expect(j, '没有存快照').toBeGreaterThan(0);
    expect(
      i < j,
      '取上一批次在存快照**之后** —— 会把刚写的这批当成「上一次」,差集恒为空',
    ).toBe(true);
  });

  it('⭐ 排序证据必须算出来并交给调用方', () => {
    expect(repo, '没有排序稳定性函数').toMatch(/export async function orderingStability/);
    expect(collect, '采集没算排序证据').toMatch(/orderingStability\(/);
    expect(collect, '排序证据没进报告').toMatch(/ordering:/);
  });

  it('⭐⭐ verifiedFollowers 无总数:必须给采完判据 + 交叉基准', () => {
    /**
     * 用户 2026-09-19:「要监控好是否取完整了,因为这里 x 没有给出总数的」
     * ⭐ X 不报蓝V关注者总数 → 采完只能看游标;
     *   另用 followers 列表里标蓝V的人数做**独立来源**交叉验证。
     */
    const i = collect.indexOf('if (isVerified) {');
    expect(i, '找不到 verified 的对账分支').toBeGreaterThan(0);
    const blk = collect.slice(i, i + 2500);

    /**
     * ⚠️ 钉**赋值本身**,不是「整块里出现过 paging.hasMore」——
     * 后者会被同块其他地方的同名调用兜住(实测:把 doneByCursor 改成
     * 写死 true,守卫仍全绿 = 假绿)。同族坑见 feedback-guard-scope-to-the-branch。
     */
    const assign = blk.match(/doneByCursor\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 doneByCursor 的赋值').toBeTruthy();
    expect(
      assign,
      'doneByCursor 不是从游标算的 —— X 不报总数时游标是唯一的采完判据',
    ).toMatch(/paging\.hasMore/);
    expect(
      blk,
      '没有交叉基准 —— 无总数的页面必须有第二个来源互验',
    ).toMatch(/countBlueVerifiedInFollowers/);
    // 差太多时必须说「不能用」,不能只报个数字了事
    expect(
      blk,
      '两来源相差很多时没有警示 —— 用户会拿没采全的数据下结论',
    ).toMatch(/没采全/);
  });

  it('⭐⭐ 空 handle 必须先滤掉 —— 一条就能让整批写入 0 条', () => {
    /**
     * 实测 2026-09-19(真 DB):schema 上 handle 带 ASSERT $value != '',
     * 而 `FOR` 里**一条 ASSERT 失败会让整批写进 0 条**
     * (3 条里夹 1 条空 handle → 写入 0)。
     *
     * 现象:采到 2753 人、快照**三跑都只写进 2493**,断点分毫不差;
     * 把批大小 500→50 **断点纹丝不动** —— 证明与批量大小无关,是坏数据。
     */
    const i = collect.indexOf('saveListSnapshot(scope, runId');
    expect(i, '找不到快照写入调用').toBeGreaterThan(0);
    const blk = collect.slice(Math.max(0, i - 900), i + 200);
    expect(
      blk,
      '写快照前没滤掉空 handle —— 一条空的会让整批(乃至整跑)写不进去',
    ).toMatch(/filter\(/);
    expect(blk, '滤的不是空 handle').toMatch(/handle !== ''/);
    // 滤掉了多少必须说出来(铁律四:成功要对账)
    /** ⚠️ 钉**赋值**,不是「块里出现过 dropped」(会被后面的使用处兜住) */
    const assign = blk.match(/const dropped\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 dropped 的赋值').toBeTruthy();
    expect(
      assign,
      'dropped 不是真算出来的 —— 少写了多少用户不知道(铁律四)',
    ).toMatch(/r\.people\.length\s*-\s*snapRows\.length/);
  });

  it('⭐⭐ 快照一条失败不能拖垮整批,且必须报进 problems', () => {
    /**
     * 实测 2026-09-19:采到 2772 人、快照只写进 2493(seq 0..2492 连续后齐断),
     * 因为 500 条塞一条 FOR 语句 → 第 6 批整批失败;
     * 而失败只 console.warn → **面板毫无异常**,用户靠「感觉数字有点问题」才发现。
     */
    const i = repo.indexOf('export async function saveListSnapshot');
    const body = repo.slice(i, i + 2200);
    expect(body, '整批失败没有逐条重试 —— 一条坏数据会让整批陪葬').toMatch(/for \(const r of chunk\)/);
    expect(body, '失败没有抛给调用方 —— 静默吞掉').toMatch(/throw new Error/);
    // 批大小要小,降低连带损失
    const chunk = Number(body.match(/CHUNK = (\d+)/)?.[1] ?? 0);
    expect(chunk, '找不到 CHUNK').toBeGreaterThan(0);
    expect(chunk, `批大小 ${chunk} 太大 —— 一批失败损失太多`).toBeLessThanOrEqual(100);

    // 失败必须进 problems
    /**
     * ⚠️ 钉 **catch 块里的赋值**,不是「整文件出现过 snapshotProblem」——
     * 声明和 problems 拼接处都有这个名字,会把守卫兜住(实测假绿)。
     */
    const ci = collect.indexOf('列表快照/差集失败');
    expect(ci, '找不到快照失败的 catch').toBeGreaterThan(0);
    const cblk = collect.slice(ci, ci + 600);
    expect(
      cblk,
      '快照失败没赋给 snapshotProblem —— 只有 console.warn,用户看不见(铁律一)',
    ).toMatch(/snapshotProblem\s*=/);
    expect(
      collect,
      'snapshotProblem 没并进 problems —— 赋了值也传不出去',
    ).toMatch(/\.\.\.r\.problems,\s*snapshotProblem/);
  });

  it('⭐ 快照分批写 —— 2500 人一条语句会把 SQL 撑爆', () => {
    const i = repo.indexOf('export async function saveListSnapshot');
    const body = repo.slice(i, i + 900);
    expect(body, '没有分批').toMatch(/CHUNK/);
  });
  it('⭐⭐ X 说 TimelineTerminateTimeline 就是到底了(真实载荷)', () => {
    /**
     * 2026-09-19 从**真实 634 字节响应体**里拿到的到底载荷。
     * ⚠️ 它**仍然附带 Bottom 游标**(值还在倒退),只看「有没有游标」
     * 会永远以为还有下一页 —— 实测因此空翻 50 页。
     */
    const REAL_TERMINAL = {
      data: { user: { result: { timeline: { timeline: { instructions: [
        { direction: 'Bottom', type: 'TimelineTerminateTimeline' },
        { type: 'TimelineAddEntries', entries: [
          { entryId: 'cursor-bottom-2101249894198015160', content: {
            __typename: 'TimelineTimelineCursor', cursorType: 'Bottom',
            value: '0|2101249894198015158' } },
        ] },
      ] } } } } },
    };
    const r = findPagingCursor(REAL_TERMINAL);
    expect(r.terminated, 'X 说了到此为止,没认出来').toBe(true);
    expect(r.hasMore, 'X 明说到底却仍报「还有下一页」—— 会空翻几十页').toBe(false);
    const NORMAL = { instructions: [{ entries: [{ content: {
      __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'REAL' } }] }] };
    expect(findPagingCursor(NORMAL).hasMore, '正常载荷被误判成到底').toBe(true);
  });
});
