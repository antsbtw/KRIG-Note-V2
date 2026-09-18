/**
 * ⭐⭐ 游标翻页 —— 真调 withCursor,不扫源码
 *
 * ── 用户 2026-09-18 拍板 ──
 *
 * > 「① 用游标直接翻页 —— 不滚动,直接重放 GraphQL 请求带 cursor。
 * >   快几十倍。可以使用这个方法」
 *
 * ⚠️ 本实现**最危险的失败形态**不是报错,是**静默原地打转**:
 * `variables` 换错了,X 返回第 1 页,解析照常、人也照样入库,
 * 循环跑满 40 轮然后报「采完了」—— 数字好看,数据只有第一页。
 *
 * ⭐ 所以这里钉两件事:①换错了要**返回 null**(而不是给个改坏的 URL);
 * ②换对了 queryId/features **一个字都不能变**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withCursor, buildRefetchScript } from '@platform/main/x/x-people-harvester';

/** 真实形状:X 的 Followers 请求(queryId 与 features 都在 URL 里) */
const REAL = 'https://x.com/i/api/graphql/rRXFSG5vR6drKr5M37YOTw/Followers'
  + '?variables=' + encodeURIComponent(JSON.stringify({
    userId: '1234567890', count: 20, includePromotedContent: false,
  }))
  + '&features=' + encodeURIComponent(JSON.stringify({
    rweb_tipjar_consumption_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true,
  }));

describe('⭐⭐ 换游标:只动 cursor,别的一个字不动', () => {
  it('⭐⭐ cursor 真的被写进 variables', () => {
    const out = withCursor(REAL, 'CURSOR_PAGE_2')!;
    expect(out, 'withCursor 返回了 null —— 正常 URL 都换不了').not.toBeNull();
    const vars = JSON.parse(new URL(out).searchParams.get('variables')!);
    expect(vars.cursor, 'cursor 没写进去 —— 会一直请求第 1 页').toBe('CURSOR_PAGE_2');
  });

  it('⭐⭐ queryId 原样保留 —— 这正是不自己拼请求的理由', () => {
    /**
     * `x-article-replies.ts:285` 记着教训:重发要复刻 queryId/features,
     * 而它们**会随 X 版本变**。本实现靠「抄 X 刚发的那条」绕开 ——
     * 所以路径里的 queryId 一旦被动过,整个理由就不成立了。
     */
    const out = withCursor(REAL, 'C')!;
    expect(new URL(out).pathname, 'queryId 被改了').toBe(
      '/i/api/graphql/rRXFSG5vR6drKr5M37YOTw/Followers',
    );
  });

  it('⭐⭐ features 一个字都不能变', () => {
    const out = withCursor(REAL, 'C')!;
    expect(
      new URL(out).searchParams.get('features'),
      'features 被动过 —— X 会拒绝或返回不同结构',
    ).toBe(new URL(REAL).searchParams.get('features'));
  });

  it('⭐ 原有的 variables 字段全部保留', () => {
    const vars = JSON.parse(new URL(withCursor(REAL, 'C')!).searchParams.get('variables')!);
    expect(vars.userId, 'userId 丢了 —— 会翻到别人的列表去').toBe('1234567890');
    expect(vars.count).toBe(20);
    expect(vars.includePromotedContent).toBe(false);
  });

  it('⭐⭐ 已有 cursor 的请求是**替换**不是叠加', () => {
    const withOld = withCursor(REAL, 'PAGE_1')!;
    const vars = JSON.parse(new URL(withCursor(withOld, 'PAGE_2')!).searchParams.get('variables')!);
    expect(vars.cursor, '旧游标没被换掉 —— 会一直停在同一页').toBe('PAGE_2');
  });
});

describe('⭐⭐ 换不了就返回 null —— 绝不猜着改', () => {
  /**
   * ⚠️ 这里每一条,如果改成「猜着拼一个 URL」,后果都是**静默拿错数据**:
   * 请求成功、JSON 能解、人能入库,只是那批人不是我们要的。
   */
  it('⭐⭐ 没有 variables 参数 → null', () => {
    expect(withCursor('https://x.com/i/api/graphql/abc/Followers', 'C')).toBeNull();
  });

  it('⭐⭐ variables 不是合法 JSON → null', () => {
    expect(withCursor('https://x.com/i/api/graphql/abc/Followers?variables=%7Bbroken', 'C'))
      .toBeNull();
  });

  it('⭐ 坏 URL → null,不抛异常', () => {
    expect(withCursor('not-a-url', 'C')).toBeNull();
    expect(withCursor('', 'C')).toBeNull();
  });
});

describe('⭐⭐ 重发脚本:带 X 自己的头,不自己加', () => {
  it('⭐⭐ 鉴权头原样带走', () => {
    const js = buildRefetchScript(REAL, {
      authorization: 'Bearer AAAA', 'x-csrf-token': 'deadbeef',
    });
    expect(js, 'authorization 没带 —— X 会返回 401').toContain('Bearer AAAA');
    expect(js, 'csrf 没带').toContain('deadbeef');
  });

  it('⭐⭐ credentials: include —— cookie 得带上', () => {
    expect(
      buildRefetchScript(REAL, {}),
      '没带 cookie —— 登录态丢失,拿不到关注者',
    ).toContain("credentials: 'include'");
  });

  it('⭐⭐ 浏览器自算的头必须剔掉', () => {
    /** content-length/host 手动带会和浏览器自己算的冲突 → 请求被拒 */
    const js = buildRefetchScript(REAL, { 'content-length': '999', host: 'x.com', accept: '*/*' });
    expect(js, 'content-length 没剔掉 —— 会和浏览器自算的冲突').not.toContain('999');
    expect(js, 'host 没剔掉').not.toMatch(/"host"/);
    expect(js, '正常的头被误剔了').toContain('accept');
  });

  it('⭐⭐ 错误要报回来,不能吞掉变成「空响应」', () => {
    const js = buildRefetchScript(REAL, {});
    expect(js, '没有错误分支 —— 401/429 会被当成「采完了」').toContain('__err');
    expect(js, 'HTTP 状态没检查').toContain('r.ok');
  });
});

describe('⭐⭐ 翻页循环:原地打转必须停下来', () => {
  /**
   * ⚠️ 循环逻辑要真 webContents,单测跑不了,这里扫**形态**
   * (分工见 feedback-source-scan-cant-see-execution)。
   * 钉的是三道刹车 —— 少任何一道都会「跑满 40 轮然后报采完了」。
   */
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const src = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8',
  ));
  /**
   * ⚠️ 切片起点从 `let pagedRounds` 往前挪到入口闸门 ——
   * 钉住的 `baseReq` 现在声明在闸门处(为了让「没翻页」也能报原因),
   * 切晚了就把它切在外面,守卫会误报。
   * ⭐ 这条是守卫**真的抓到过**我自己的改动(2026-09-18),不是摆设。
   */
  const i = src.indexOf('let pagedRounds = 0;');
  const loop = src.slice(i, src.indexOf("wc.debugger.off('message'", i));

  it('前提自检:切到了翻页循环', () => {
    expect(i, '找不到翻页循环 —— 下面的断言会空转').toBeGreaterThan(0);
    expect(loop.length, '切出来的循环体是空的').toBeGreaterThan(400);
  });

  it('⭐⭐ 刹车一:游标重复就停', () => {
    expect(loop, '没有游标去重 —— 换错了会原地打转跑满预算')
      .toMatch(/seenCursors\.has\(cursor\)/);
  });

  it('⭐⭐ 刹车二:拿不到新游标当到底,不复用旧的', () => {
    expect(loop, '拿不到新游标时复用了旧的 —— 必然原地打转')
      .toMatch(/cur\.bottom \|\| cur\.top\) \? cur : \{ hasMore: false \}/);
  });

  it('⭐⭐ 刹车三:连续几页没新人就停', () => {
    expect(loop, '没有「没新人」的退出 —— 会白翻到预算耗尽')
      .toMatch(/emptyPages/);
  });

  it('⭐⭐ withCursor 返回 null 要中止,不能拿原 URL 硬发', () => {
    expect(loop, 'URL 换不了时没中止 —— 会拿第 1 页的 URL 反复请求')
      .toMatch(/if \(!nextUrl\)[\s\S]{0,140}break;/);
  });

  it('⭐⭐ 请求用的是**钉住的**那条,不是会被改写的闭包变量', () => {
    expect(loop, '循环里直接读 lastPeopleReq —— 中途被覆盖会翻到别的列表上去')
      .not.toMatch(/lastPeopleReq\.(url|headers)/);
    expect(loop, '没有钉住请求').toMatch(/const baseReq\b/);
  });

  it('⭐ 停止原因要如实说明是哪一种,不能含糊成「采完了」', () => {
    for (const reason of ['游标重复', 'variables 解不开', 'X 说没有更多了']) {
      expect(loop, `停止原因里没有「${reason}」—— 人看不出是哪种停法`).toContain(reason);
    }
  });
});

describe('⭐⭐ 翻页上限要真的一路传到底', () => {
  /**
   * ⚠️ 本仓常见形态:「类型有、JSON 有、消费端零读取」的死字段。
   * pageBudget 从面板到 harvestTimeline 要过 4 层,断在任何一层都是
   * **面板改了数字没有任何反应** —— 而报告照常、数字照常,看不出来。
   */
  const read = (f: string) =>
    readFileSync(join(process.cwd(), f), 'utf-8');

  it('⭐⭐ 面板 → IPC → autoCollect → harvestTimeline 每一层都有', () => {
    const chain: [string, string][] = [
      ['src/views/web-console/WebConsoleView.tsx', '面板没传'],
      ['src/platform/main/ipc/web-console-handler.ts', 'IPC 没透传'],
      ['src/platform/main/x/x-auto-collect.ts', 'autoCollect 没透传'],
      ['src/platform/main/x/x-timeline-harvester.ts', 'harvester 没接收'],
    ];
    for (const [f, why] of chain) {
      expect(read(f), `${why} —— 面板上改翻页数会毫无反应`).toContain('pageBudget');
    }
  });

  it('⭐⭐ autoCollect 是**透传**不是写死', () => {
    const src = read('src/platform/main/x/x-auto-collect.ts');
    expect(src, 'autoCollect 把 pageBudget 写死了 —— 面板的值到不了')
      .toMatch(/pageBudget: opts\.pageBudget/);
  });
});

describe('⭐⭐ 没翻页必须说清是哪一条不成立', () => {
  /**
   * ── 用户 2026-09-18 实测 ──
   *
   * 翻页上线后实采 314 人 / 2604 = 12%,只比滚动多 113 人 ——
   * 「快几十倍」没发生。而四个入口条件写成一个 `if`,不成立就**静默跳过**,
   * 报告里只剩「采了 314 人然后停了」。
   *
   * ⚠️ 四种断法(抄不到请求 / X 说没下一页 / 没游标 / 没采到人)
   * 在报告里长得**完全一样**,于是查不下去 —— 这正是本仓反复踩的
   * 「看着成功实际没有」。
   */
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const src = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8',
  ));

  it('⭐⭐ 四个入口条件逐条判定,不是一个 if 吞掉', () => {
    const i = src.indexOf('const gate = {');
    expect(i, '入口条件没有逐条判定 —— 不成立时查不出是哪一条').toBeGreaterThan(0);
    const g = src.slice(i, src.indexOf('};', i));
    expect(g.length, '切出来的 gate 是空的').toBeGreaterThan(40);
    // 四条缺任何一条,那种断法就会重新变成哑的
    for (const cond of ['抄到请求', 'paging.hasMore', 'paging.bottom', 'people.size']) {
      expect(g, `入口条件少了「${cond}」—— 这种断法会查不出来`).toContain(cond);
    }
  });

  it('⭐⭐ 不成立要真的写进 pagingSkipped,不能只判定不记录', () => {
    /**
     * ⚠️ 光断言「有这行文本」不够:`void 0 && (pagingSkipped = ...)`
     * 文本在、行为没了,照样全绿(本仓同族第五刀)。
     * 所以要切出赋值所在的那条语句,钉住它**前面没有短路**。
     */
    const i = src.indexOf('pagingSkipped = ');
    expect(i, '根本没有给 pagingSkipped 赋值 —— 判定了却不记录').toBeGreaterThan(0);
    const stmtStart = src.lastIndexOf('\n', i);
    const stmt = src.slice(stmtStart, src.indexOf(';', i));
    expect(stmt, '赋值被短路掉了 —— 文本在、行为没了').not.toMatch(/(void 0|false)\s*&&/);
    expect(stmt, '记的不是「哪几条不成立」').toMatch(/blocked\.join/);
  });

  it('⭐⭐ pagingSkipped 要一路传到报告里', () => {
    expect(src, 'pagingSkipped 没进 return —— 主进程拿不到').toMatch(/\n\s*pagingSkipped,/);
    /**
     * ⚠️ 中间两层用 `r.pagingSkipped` 钉**取值**,不是钉字面量 ——
     * 只写个类型声明、不真的透传,照样能让 toContain 全绿。
     */
    for (const [f, why] of [
      ['src/platform/main/x/x-auto-collect.ts', 'autoCollect 没透传'],
      ['src/platform/main/ipc/web-console-handler.ts', 'IPC 没透传'],
    ] as [string, string][]) {
      expect(
        readFileSync(join(process.cwd(), f), 'utf-8'),
        `${why} —— 人在面板上看不到为什么没翻页`,
      ).toMatch(/pagingSkipped: r\.pagingSkipped/);
    }
    /**
     * ⚠️ 面板这层**必须钉渲染分支**:删掉整个显示分支后,类型声明里
     * 还留着一个 `pagingSkipped`,`toContain` 就被它兜住了 ——
     * 实测 2026-09-18 这条注入全绿,是假守卫(本仓同族第三刀)。
     */
    const view = readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8',
    );
    expect(view, '面板没有渲染分支 —— 原因拿到了却不显示给人看')
      .toMatch(/\{d\.pagingSkipped && \(/);
  });
});
