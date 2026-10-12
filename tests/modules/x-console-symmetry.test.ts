/**
 * 「对称性」守卫 —— 左栏导航 → 右栏识别并**建议**参数
 *
 * 用户 2026-10-02:「在左边操作,右边自动识别行为并填写上参数?」
 * 用户 2026-09-18(底座注释里留着):「点击左边时,右边自动填充变量,点击采集,即可采集。」
 *
 * ── ⚠️ 本文件钉的三条,都是**踩过的坑**,不是假想 ──
 *
 * ① 面板不许自己 parse x.com 的 URL —— 第二份规则会漂,
 *    漂的表现是「自动填的和实际采的不是同一页」。
 * ② 识别结果**不许自动覆盖**人选好的页面 ——
 *    `project-x-collect-panel-scraped-homepage`:「跟着左边走」把
 *    `x.profile` 静默改成 `x.home` → 爬首页 1281 条污染入库。
 * ③ URL 与 wcId 走**同一条通路** —— 分两条会出现
 *    「wcId 是这页的、URL 是上一页的」。
 *
 * ⚠️⚠️ 写法上**刻意避开**本仓栽过五次的假绿形态
 * (`feedback-guard-scope-to-the-branch` / `feedback-guard-hardcoded-list-never-grows`):
 * 不整文件 `toMatch`,先 slice 出目标函数体/分支再断言,且**断言 slice 非空**。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { xPageResolver, PAGE_PARAMS, OPTIONAL_PAGE_PARAMS } from '@modules/x/x-pages';

const ROOT = resolvePath(__dirname, '../..');
const read = (p: string): string => readFileSync(resolvePath(ROOT, p), 'utf8');

/**
 * 剥注释 —— ⚠️ 行注释正则**必须**排除 `://`,
 * 否则 `https://` 里的 `//` 会让整段 URL 连同后面代码被删,
 * 扫 URL 的断言就永远假绿(`feedback-guard-stripper-eats-urls` 实测 57 条全绿)。
 */
function strip(src: string): string {
  const out = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // ⭐ 给 strip 本身自检:剥完还留着 http 协议头才算没吃掉 URL
  return out;
}

it('⭐ strip 自检:不吃掉 URL 里的双斜杠', () => {
  const s = strip('const u = "https://x.com/a"; // 注释\nconst v = 1;');
  expect(s).toContain('https://x.com/a');
  expect(s).toContain('const v = 1');
  expect(s).not.toContain('注释');
});

/** 切出一个函数/块的体 —— ⚠️ 切不到要**显式失败**,不许静默返回空串恒真 */
function sliceFrom(src: string, needle: string, lines = 60): string {
  const i = src.indexOf(needle);
  expect(i, `守卫切片锚点找不到:「${needle}」—— 代码改名了?守卫必须跟上`)
    .toBeGreaterThan(-1);
  return src.split('\n').slice(
    src.slice(0, i).split('\n').length - 1,
  ).slice(0, lines).join('\n');
}

describe('对称性:底座侧（identify 这条反向通路）', () => {
  it('⭐ identify 有真实现,且认得出带 query 的推文链接', () => {
    /**
     * ⚠️ 这一条防的是「建好了没接线」——
     * `identifySemanticPage` 曾经**全仓零消费者**。
     */
    const got = xPageResolver.identify?.(
      'https://x.com/cxknh5z/status/2105861183614169438?s=20&t=abc',
    );
    expect(got).toEqual({ name: 'x.status', params: { tweetId: '2105861183614169438' } });
  });

  /**
   * ⭐⭐ **每个登记的页面都要有一条样本** —— 清单从**真表推导**。
   *
   * ⚠️⚠️ 上一版这里是一份**写死的 5 条样本**,而我这轮加了 8 页 ——
   * 55 条测试照样全绿,因为新页面天然不在样本里。
   * 正是 `feedback-guard-hardcoded-list-never-grows` 同族第六刀:
   * **信息来源错了**,补清单治不了,要换成从 `names()` 推。
   *
   * ⭐ 现在加页面而不加样本 → 下面那条「每页都有样本」直接红。
   */
  const SAMPLE_URL: Readonly<Record<string, string>> = {
    'x.home': 'https://x.com/home',
    'x.profile': 'https://x.com/elonmusk',
    'x.withReplies': 'https://x.com/elonmusk/with_replies',
    /** ⭐ 转发标签页(2026-10-10)—— 地址取自用户截图 */
    'x.reposts': 'https://x.com/whyyoutouzhele/reposts',
    'x.articles': 'https://x.com/elonmusk/articles',
    'x.status': 'https://x.com/i/status/2105861183614169438',
    'x.search': 'https://x.com/search?q=%22VPN%22&f=live',
    'x.followers': 'https://x.com/elonmusk/followers',
    'x.verifiedFollowers': 'https://x.com/elonmusk/verified_followers',
    'x.following': 'https://x.com/elonmusk/following',
    'x.notifications': 'https://x.com/notifications',
    'x.compose': 'https://x.com/compose/post',
    'x.composeArticles': 'https://x.com/compose/articles',
    /** ⭐ 单篇长文(2026-10-03)—— 地址取自真机载荷的 expanded_url */
    'x.article': 'https://x.com/i/article/2105111183481266176',
  };

  it('⭐⭐ 每个登记的页面都必须有一条反向样本(清单从真表推)', () => {
    const names = xPageResolver.names?.() ?? [];
    expect(names.length, '页面表是空的?').toBeGreaterThan(4);
    const noSample = names.filter((n) => !SAMPLE_URL[n]);
    expect(
      noSample,
      '这些页面登记了但没有反向样本 —— 加页面时请一起加:\n  ' + noSample.join('\n  '),
    ).toEqual([]);
    // ⭐ 反向也钉:样本里不许有已删除的页面
    const stale = Object.keys(SAMPLE_URL).filter((n) => !names.includes(n));
    expect(stale, '样本里有已删除的页面:\n  ' + stale.join('\n  ')).toEqual([]);
  });

  it('⭐⭐ 反向认出的页面名与参数,必须在正向表里真能用', () => {
    /**
     * ⭐ 「正反必须同一张表」的**真**判据:
     * 不只比字符串,而是把 identify 的产出**喂回 resolve**,看能不能拼出 URL。
     * ⚠️ 只断言 `name === 'x.status'` 那种写法,表删了这页也照样绿。
     */
    const names = xPageResolver.names?.() ?? [];
    const cases = names.map((n) => ({ name: n, u: SAMPLE_URL[n] })).filter((c) => c.u);
    expect(cases.length, '一条样本都没有 —— 下面的循环会空转').toBeGreaterThan(8);

    for (const { name, u } of cases) {
      const hit = xPageResolver.identify?.(u) ?? null;
      expect(hit, `identify('${u}') 认不出来 —— 这一页登记了却反向不认`).not.toBeNull();
      expect(hit!.name, `identify('${u}') 认成了别的页`).toBe(name);

      /**
       * ⚠️⚠️ **可选参数允许不回** —— 不是放宽,是必须如此:
       * `x.search` 的 `PAGE_PARAMS` 含 `days`,而 `identify` **故意不回它** ——
       * URL 里的 `since:` 已经在 `q` 里面了,再单独回一个 `days`,
       * 「用它」之后重新 resolve 会**叠加第二个时间条件**,而且不报错。
       * ⭐ 所以判据是:回的键 ⊆ 本页参数,且**必填的一个不少**。
       */
      const need = PAGE_PARAMS[name] ?? [];
      const optional = new Set(OPTIONAL_PAGE_PARAMS);
      const required = need.filter((k) => !optional.has(k));
      const got = Object.keys(hit!.params);

      expect(
        got.filter((k) => !need.includes(k)),
        `${name} 反向回了本页不认的参数 —— 喂回 resolve 会被忽略或拼错`,
      ).toEqual([]);
      expect(
        required.filter((k) => !got.includes(k)),
        `${name} 反向漏了必填参数 —— 「用它」之后点 goto 会直接 failed`,
      ).toEqual([]);

      // ⭐ 真喂回正向:拼得出 URL 才算同一张表的两面
      const back = xPageResolver.resolve(name, hit!.params);
      expect(back, `identify('${u}') 的产出喂回 resolve 拼不出 URL`).not.toBeNull();
    }
  });

  it('⚠️ 认不出来回 null,不抛、不猜', () => {
    for (const u of ['https://x.com/settings/account', 'not-a-url', 'https://google.com/home', '']) {
      expect(xPageResolver.identify?.(u) ?? null, `「${u}」不该被硬认成某一页`).toBeNull();
    }
  });
});

describe('对称性:IPC 侧', () => {
  it('⭐ identify 在 resolve(pageRef) 之前分流 —— 它不收 pageRef', () => {
    /**
     * ⚠️ 顺序错了会怎样:`resolve()` 看到 `pageRef === undefined` 报
     * 「wcId 非法: undefined」——**诚实但完全误导**,
     * 人会去查 wcId 怎么没传,而真因是这个 op 本不需要它。
     * ⭐ 且 `resolve()` 有副作用(register + bindPageHost):
     * 让纯查询走它 = 问一句话就注册一个页面。
     */
    const src = strip(read('src/platform/main/web-capability/wiring/ipc-dom.ts'));
    const iIdentify = src.indexOf("p.op === 'identify'");
    const iResolve = src.indexOf('resolve(p.pageRef)');
    expect(iIdentify, 'identify 分流不见了').toBeGreaterThan(-1);
    expect(iResolve, 'resolve(p.pageRef) 不见了').toBeGreaterThan(-1);
    expect(iIdentify, 'identify 必须在 resolve(p.pageRef) **之前**').toBeLessThan(iResolve);
  });

  it('⚠️ 认不出来回 ok+null,不报 failed', () => {
    /**
     * 「这页我不认识」是正常答案(人可能停在设置页)。
     * 报 failed 会让留痕堆满红条,真故障被淹掉。
     */
    const src = strip(read('src/platform/main/web-capability/wiring/ipc-dom.ts'));
    /**
     * ⚠️⚠️ 切片**必须窄到 `identifySemanticPage` 那一句** ——
     * 注入验证时这条曾假绿:切 14 行把上面「缺 url」那条 `failed(...)` 也包进来,
     * 于是我把 ok 改成 failed 后,`toContain("status: 'ok'")` 靠**另一条语句**
     * 照样成立。正是 `feedback-guard-guard-scope-to-the-branch` 第三刀的形态。
     * ⭐ 判据改成:`identifySemanticPage(` 所在的那一条语句里必须是 `ok`,
     *   且这一句**不许**走 `failed(`。
     */
    const i = src.indexOf('identifySemanticPage(p.url)');
    expect(i, 'identify 分支里不调 identifySemanticPage 了 —— 它在自己 parse?')
      .toBeGreaterThan(-1);
    // 往回找到这条语句的起点(上一个 `;` 或 `{`)
    const head = Math.max(src.lastIndexOf(';', i), src.lastIndexOf('{', i)) + 1;
    const stmt = src.slice(head, src.indexOf(';', i) + 1);
    expect(stmt.length, '切出来的语句是空的 —— 断言会恒真').toBeGreaterThan(20);
    expect(stmt, '识别结果没按 ok 返回 —— 「不认识这一页」是正常答案,报 failed 会淹掉真故障')
      .toContain("status: 'ok'");
    expect(stmt, '识别这一句走了 failed —— 认不出来不是故障').not.toContain('failed(');
  });
});

describe('对称性:面板侧（这里是两条真红线）', () => {
  const panel = () => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐ 面板不许自己 parse x.com 的 URL —— 必须问底座', () => {
    /**
     * ⚠️ 自己 parse 就有了第二份规则,漂的表现是
     * 「自动填的和实际采的不是同一页」(`control-types.ts` 原话)。
     * ⭐ 判据不钉「有没有调 identify」(那种写法改成 `void 0 && identify()`
     * 照样绿,见 `feedback-source-scan-cant-see-execution`),
     * 而是钉**面板里不许出现 X 的 URL 规则**。
     */
    const src = panel();
    /**
     * ⚠️⚠️ **必须同时认「裸写」和「正则转义写法」** —— 注入验证时发现的缺口:
     * 我写的守卫只找字面 `x.com`,而注入的违规是
     * `u.match(/x\.com\/(.+)\/status\/(\d+)/)` —— **带 `\.` 转义**,守卫没命中。
     * ⭐ 而业务代码里写 URL 规则**几乎一定用正则**,所以转义形态才是真形态。
     * 判据统一成:先把源码里的 `\.` 归一成 `.`,再找裸形态。
     */
    const norm = src.replace(/\\\./g, '.');
    const smells = [
      { re: /\/status\//, why: '自己认 /status/ 路径 —— 那是页面表的职责' },
      { re: /\bx\.com\b/, why: '面板里写了 x.com —— URL 规则必须在页面表里' },
      { re: /\btwitter\.com\b/, why: '面板里写了 twitter.com' },
      { re: /with_replies/, why: '自己认 with_replies 路径' },
      { re: /new URL\s*\([^)]*hostUrl/, why: '面板在自己拆左栏 URL —— 该问底座 identify' },
    ];
    const hit = smells.filter((x) => x.re.test(norm)).map((x) => x.why);
    expect(hit, '面板在自己 parse X 的 URL:\n  ' + hit.join('\n  ')).toEqual([]);
  });

  it('⭐⭐ 识别结果不许自动写进下拉 —— 只能人点才填', () => {
    /**
     * ⚠️⚠️ 这条最贵:`project-x-collect-panel-scraped-homepage` ——
     * 「跟着左边走」把人选好的 `x.profile` **静默改成** `x.home`,
     * 爬自己 For You 首页 1281 条 / 703 轮 / 30 分钟,污染入库
     * (572 个不相干作者、1252 条进 AI 队列)。
     * 真因正是**自动跟随覆盖了人的选择且不出声**。
     *
     * ⭐ 判据:识别那个 effect 的体内**不许出现** setPageName / setParamVals。
     * ⚠️ 必须切到 effect 体再断言 —— 整文件扫必然假绿
     * (「用它」按钮里本来就要调这两个 setter)。
     */
    const src = panel();
    const eff = sliceFrom(src, "}, [hostUrl]);", 1);
    expect(eff, '识别 effect 的依赖数组找不到 —— 它还在吗?').toContain('hostUrl');

    // 从 effect 起点切到它的依赖数组收尾
    const start = src.indexOf('if (!hostUrl)');
    const end = src.indexOf('}, [hostUrl]);');
    expect(start, '识别 effect 的起点找不到').toBeGreaterThan(-1);
    expect(end, '识别 effect 的终点找不到').toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body.length, '切出来的 effect 体是空的 —— 断言会恒真').toBeGreaterThan(80);

    expect(body, '识别 effect 自动改了下拉选中项 —— 会静默覆盖人的选择')
      .not.toMatch(/setPageName\s*\(/);
    expect(body, '识别 effect 自动改了参数框 —— 会冲掉人正在填的内容')
      .not.toMatch(/setParamVals\s*\(/);
  });

  it('⭐ 但「用它」这条路必须真的存在 —— 否则识别了也用不上', () => {
    /**
     * ⚠️ 上一条是「不许自动填」,光有它会被一个
     * 「干脆不提供填的办法」的实现满足 —— 那是另一种坏。
     * ⭐ 所以反向也要钉:得有一处**同时**写两个 setter(即那个按钮)。
     */
    const src = panel();
    const i = src.indexOf('setPageName(identified.name)');
    expect(i, '「用它」按钮没了 —— 识别出来的页面没有办法应用').toBeGreaterThan(-1);
    const btn = src.slice(i, i + 300);
    expect(btn, '「用它」只改了页面名、没填参数 —— 参数会留着上一页的残值')
      .toMatch(/setParamVals\s*\(\s*identified\.params/);
  });
});

describe('对称性:URL 与 wcId 必须同一条通路', () => {
  it('⭐ registry 的 set 一次收齐 wcId + url', () => {
    /**
     * ⚠️ 分两条通路会漂,表现是「wcId 是这页的、URL 是上一页的」,
     * 于是右栏按旧 URL 填参数、按新 wcId 发操作。
     */
    const src = strip(read('src/modules/x/x-host-registry.ts'));
    const sig = sliceFrom(src, 'export function setXHostState', 3);
    expect(sig).toMatch(/wcId:\s*number/);
    expect(sig).toMatch(/url:\s*string/);
  });

  it('⭐⭐ 登记函数不许读 state 里的 url —— 那是上一页的值', () => {
    /**
     * ⚠️⚠️ 真坑(守卫第一次跑就抓到的那个):登记与 `setUrl(u)` 在**同一个回调里
     * 并列调用**,那时 `url` state 还是上一页的值(setState 不同步生效)。
     * 读 state 登记 → 右栏识别结果**永远慢一拍**。
     *
     * ⭐ 判据切到**登记函数体内**(不是整文件):
     * 它只许读 `lastUrlRef.current`,不许出现裸的 `url`。
     * ⚠️ 整文件扫必然假绿 —— `url` state 本来就要传给 Host 的 currentUrl。
     */
    const src = strip(read('src/modules/x/XWebView.tsx'));
    const start = src.indexOf('const registerHost');
    expect(start, 'registerHost 不见了 —— 改名了?守卫必须跟上').toBeGreaterThan(-1);
    const end = src.indexOf('}, [workspaceId]);', start);
    expect(end, 'registerHost 的函数体收尾找不到').toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body.length, '切出来的函数体是空的 —— 断言会恒真').toBeGreaterThan(60);

    expect(body, '登记函数在读 state 的 url —— 那是上一页的值').not.toMatch(/\burl\b/);
    expect(body, '登记函数该从 ref 读 URL').toContain('lastUrlRef.current');
    expect(body, '登记函数该一次收齐 wcId + url').toMatch(/setXHostState\s*\(/);
  });

  it('⭐ ref 与 state 必须同时赋值 —— 否则 ref 会停在初值', () => {
    /**
     * ⚠️ 上一条逼着登记走 ref,那就多出一个新的坏法:
     * **ref 忘了更新** —— 登记永远是 X_HOME,而守卫与 tsc 都不会红。
     * ⭐ 所以钉 `onDisplayUrlChanged` 里两个赋值都在。
     */
    const src = strip(read('src/modules/x/XWebView.tsx'));
    const i = src.indexOf('onDisplayUrlChanged');
    expect(i, 'onDisplayUrlChanged 不见了').toBeGreaterThan(-1);
    const cb = src.slice(i, src.indexOf('}}', i) + 2);
    expect(cb.length, '切出来的回调是空的').toBeGreaterThan(30);
    expect(cb, 'ref 没跟着更新 —— 登记的 URL 会永远停在初值')
      .toMatch(/lastUrlRef\.current\s*=\s*u/);
    expect(cb, 'state 没更新 —— Host 的受控 currentUrl 会不动')
      .toMatch(/setUrl\s*\(\s*u\s*\)/);
    expect(cb, '没登记 host 状态').toMatch(/registerHost\s*\(/);
  });
});

/**
 * ⭐⭐ Console 布局:三种能力**并排平级**(用户 2026-10-02 定)
 *
 * 用户原话:
 * 「X console 中的各种能力是**并排**的，上部分是操作参数，下部分是操作结果…
 * 　如果你把能力垂直布局，就变成一个不断向下滚动的 view，
 * 　**没有体现能力的层级是一致的**了。」
 *
 * ⭐ 最后那句是判据的来源:控制/输入/输出是**平级**的,
 * 竖排会隐含「从上到下」的次序,而它们之间本来没有次序。
 */
describe('Console 布局:能力并排,不竖排', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐ tab 从真表渲染,不在 JSX 里写三个按钮', () => {
    /**
     * ⚠️ 写死三个按钮的话,加第四个能力时必然漏 ——
     * 本仓「写死的清单不会自己长」已栽过五次
     * (`feedback-guard-hardcoded-list-never-grows`)。
     *
     * ⭐ 判据切到 tabBar 那个块,不整文件扫。
     */
    const s = panel();
    const i = s.indexOf('style={S.tabBar}');
    expect(i, 'tabBar 不见了 —— 布局被改回竖排了?').toBeGreaterThan(-1);
    const block = s.slice(i, s.indexOf('style={S.pane}', i));
    expect(block.length, '切出来的 tabBar 块是空的 —— 断言会恒真').toBeGreaterThan(60);

    expect(block, 'tab 不是从 CAP_TABS 渲染的 —— 加能力时会漏')
      .toMatch(/CAP_TABS\.map\s*\(/);
    // ⚠️ 反向:块里不许出现写死的能力名(那就是手写按钮的指纹)
    for (const lit of ['控制', '输入', '输出']) {
      expect(block, `tabBar 里写死了「${lit}」—— 标签该来自 CAP_TABS`).not.toContain(lit);
    }
  });

  it('⭐⭐ 三种能力**互斥**显示,不是三段都渲染', () => {
    /**
     * ⚠️ 判据不是「有 tab 栏」—— 光有栏而三段照样全渲染,
     * 还是那个一直往下滚的 view(**用户点破的正是这一点**)。
     * ⭐ 所以钉:每个能力都在 `tab === 'x' &&` 的条件里。
     */
    const s = panel();
    for (const id of ['control', 'input', 'output']) {
      expect(s, `${id} 不是条件渲染 —— 三段会同时显示,又变回竖排`)
        .toMatch(new RegExp(`tab === '${id}'\\s*&&`));
    }
  });

  it('⭐⭐ 每个 tab 内:上半操作、下半结果', () => {
    /**
     * 用户:「上部分是操作参数，下部分是操作结果」。
     * ⭐ 判据钉**两个区都存在且顺序对** —— 只钉存在的话,
     * 把结果区写在操作区上面也会绿。
     */
    const s = panel();
    const op = s.indexOf('S.opArea');
    const res = s.indexOf('S.resultArea');
    expect(op, '没有操作区').toBeGreaterThan(-1);
    expect(res, '没有结果区').toBeGreaterThan(-1);
    expect(op, '结果区排在操作区前面 —— 与用户定的上下形态相反').toBeLessThan(res);
  });

  it('⭐ 结果区必须能自己滚 —— 否则还是整页往下长', () => {
    /**
     * ⚠️⚠️ `minHeight: 0` 少了会怎样:flex 子项按内容撑开,
     * 结果区的滚动条**出不来**,面板又变回「一直往下滚」——
     * 而这正是用户要改掉的那个毛病。它是个**纯 CSS 细节,
     * 但决定了整个布局成不成立**。
     */
    const s = panel();
    const i = s.indexOf('resultArea: {');
    expect(i, 'resultArea 样式不见了').toBeGreaterThan(-1);
    const block = s.slice(i, s.indexOf('},', i));
    expect(block.length, '切出来的样式块是空的').toBeGreaterThan(20);
    expect(block, 'resultArea 没有 minHeight:0 —— 滚动条出不来,又变回整页滚')
      .toMatch(/minHeight:\s*0/);
    expect(block, 'resultArea 不吃剩余高度').toMatch(/flex:\s*1/);
  });

  it('⭐ 捕获中在**输出 tab 的标签上**也看得见', () => {
    /**
     * ⚠️ 人可能正停在控制 tab,而捕获在后台跑着 ——
     * 指示只画在输出 tab 内部的话,切走就看不见了,
     * 人会以为没在捕(与 `feedback-maintainability-over-feature-completion`
     * 「依据不能一关就没」同源)。
     */
    const s = panel();
    const i = s.indexOf('style={S.tabBar}');
    const block = s.slice(i, s.indexOf('style={S.pane}', i));
    /**
     * ⚠️ 钉的是「**有没有指示**」这个行为,不是某个变量名 ——
     * 2026-10-02 底座把多条腿的状态合并进 `acquire` 后,
     * 面板的 `stats?.running` 变成了 `running`,而行为完全没变。
     * ⭐ 守卫钉实现细节就会在重构时**假红**,逼人去改没坏的东西。
     */
    expect(block, 'tab 标签上没有采集中指示 —— 切到别的 tab 就看不见了')
      .toMatch(/running/);
    expect(block, '指示没挂在输出 tab 上').toMatch(/t\.id === 'output'/);
  });

  it('⚠️ 样式表里不留零引用的死样式', () => {
    /**
     * ⚠️ 改布局最容易留下的垃圾:旧的 `section` / `live` 样式没人用了还在。
     * ⭐ 死样式本身无害,但它会让下一个人以为「还有个 section 布局」,
     * 照着它写出第二套。
     */
    const s = panel();
    /**
     * ⚠️⚠️ **必须切到 `S` 常量块内** —— 2026-10-02 抓到:
     * 整文件扫 `^ {2}(\w+):\s*\{` 会把**类型里的字段**也当成样式
     * (`AcquireReport` 的 `legs: { … }` 就被误判了)。
     * ⭐ 又是「信息来源错了」:补清单治不了,要换成只看样式表那一段。
     */
    const at = s.indexOf('const S: Record<string, React.CSSProperties> = {');
    expect(at, '样式表不见了 —— 改名了?').toBeGreaterThan(-1);
    const styleBlock = s.slice(at);
    const defined = Array.from(styleBlock.matchAll(/^ {2}(\w+):\s*\{/gm)).map((m) => m[1]);
    expect(defined.length, '一条样式都没解析出来 —— 正则该跟上').toBeGreaterThan(8);
    const unused = defined.filter((k) => !new RegExp(`S\\.${k}\\b`).test(s));
    expect(unused, '这些样式零引用 —— 改布局后的残留:\n  ' + unused.join('\n  ')).toEqual([]);
  });
});

/**
 * ⭐⭐ 多步流程:**正在进行的那一步必须有指引**
 *
 * ── 2026-10-02 实测踩到 ──
 * 步骤提示的条件是 `!running && !report` —— **一点「开始收」它就消失了**。
 * 于是人进入第 ② 步(去控制那栏翻页)后,面板上只剩一个「● 收集中」,
 * **不告诉他接下来该做什么** —— 那一轮因此没走到「停止并核对」,
 * 留痕里只有 `acquire-start` 没有 `acquire-stop`。
 *
 * ⚠️ 与 `feedback-maintainability-over-feature-completion` 同族:
 * **依据一关就没**。⭐ 正在进行的那一步该**更醒目**,不是消失。
 */
describe('⭐⭐⭐ 采集是**一步到底**,不是多步流程', () => {
  /**
   * ── 用户 2026-10-03 ──
   * 「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
   * 　采集完毕后再验证采集的内容才对。」
   *
   * ⚠️ 此前输出栏有五个要人点的动作(开始收/重载/滚动/展开/停止),
   * 而且**顺序错了就采不到** —— 那是把编排推给了人。
   * ⭐ 现在底座 `harvest` 一次做完,面板只剩「采这一页」+「停止」。
   */
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 输出栏**只有一个**发起动作', () => {
    /**
     * ⚠️ 判据钉「旧的那些 op 不在输出栏出现」——
     * `goto`/`reload`/`scrollUntil` 仍可在**控制**栏存在(它们是控制的活),
     * 但输出栏不该再要人点它们。
     */
    const s = panel();
    const i2 = s.indexOf("{tab === 'output' &&");
    expect(i2, '输出 tab 不见了').toBeGreaterThan(-1);
    const area = s.slice(i2, s.indexOf('S.resultArea', i2));
    expect(area.length, '切片是空的 —— 断言会恒真').toBeGreaterThan(100);

    expect(area, '输出栏发起的不是 harvest').toMatch(/op:\s*'harvest'/);
    /**
     * ⚠️⚠️ 判据钉的是「**没有按钮去点这些 op**」,不是「这些字不许出现」
     * (2026-10-04 改)。
     *
     * 起因:编排补完长文后要**回到原来那一页**(用户原话「点击返回上一下」),
     * 那一步在 `goBack` 回调里调 `goto` —— **没有按钮,人点不到**,
     * 可它让原来的整段 `toContain` 判据变红了。
     * ⭐ 原判据的本意写在它自己的注释里:「输出栏不该再**要人点**它们」。
     * 按本意钉:只看 `onClick` 里有没有这些 op。
     * ⚠️ 松判据(直接删掉这条)会把真正的回潮也放过去,所以不是删,是**改准**。
     */
    const clickHandlers = [...area.matchAll(/onClick=\{([\s\S]*?)\n\s{18}\}\}/g)]
      .map((m) => m[1]);
    expect(clickHandlers.length, '输出栏一个 onClick 都没切出来 —— 断言会恒真')
      .toBeGreaterThan(0);
    for (const bad of ['acquireStart', 'acquireStop', "op: 'reload'", "op: 'goto'"]) {
      for (const h of clickHandlers) {
        /** ⚠️ 排除 harvest 那个(它内部的回调里允许有,因为那是编排不是人点) */
        if (h.includes('runCollect(')) continue;
        expect(h, `输出栏还有按钮直接点「${bad}」—— 编排该在底座做`).not.toContain(bad);
      }
    }
    /** ⭐ 并且:`goto` 只许出现在 goBack 那个回调里,不许另起炉灶 */
    const gotoCount = (area.match(/op:\s*'goto'/g) ?? []).length;
    expect(gotoCount, '输出栏有不止一处 goto —— 编排又散开了').toBeLessThanOrEqual(1);
    if (gotoCount === 1) {
      const i = area.indexOf("op: 'goto'");
      const before = area.slice(Math.max(0, i - 400), i);
      expect(before, 'goto 不在 goBack 回调里 —— 那就是人点得到的动作了')
        .toContain('goBack:');
    }
  });

  it('⭐⭐ 采集中可以**停**', () => {
    /** ⚠️ 长操作必须能取消,否则人只能干等 */
    const s = panel();
    const i2 = s.indexOf("{tab === 'output' &&");
    const area = s.slice(i2, s.indexOf('S.resultArea', i2));
    expect(area, '采集中停不下来').toMatch(/op:\s*'scrollStop'/);
    // ⭐ 「停」不许被 busy/running 之外的条件挡住
    expect(area, '「停」在采集中是灰的 —— 那它就没用').toMatch(/disabled=\{wcId == null \|\| !running\}/);
  });

  it('⭐⭐ 「采几页」可填 —— 不写死', () => {
    /**
     * 用户 2026-10-03:「每次采集 10 页」。
     * ⚠️ 写死的话下次要采 50 页就得改代码,
     * 而 `project-x-followers-2500-ceiling` 的教训是:
     * **写死的闸门会被当成平台的限制**。
     */
    const s = panel();
    expect(s, '页数写死了').toMatch(/wantPages:\s*Number\(pagesWanted\)/);
    expect(s, '没有页数输入框').toMatch(/setPagesWanted/);
  });

  it('⭐⭐ 采集中要有「正在做什么」的提示', () => {
    /**
     * ⚠️ `feedback-maintainability-over-feature-completion`:
     * 只给一个「采集中…」而不说在做什么,人不知道该等多久、也不知道卡在哪。
     */
    const s = panel();
    const i2 = s.indexOf('{running && (');
    expect(i2, '采集中没有任何提示').toBeGreaterThan(-1);
    const block = s.slice(i2, s.indexOf(')}', i2));
    expect(block.length, '切片是空的').toBeGreaterThan(40);
    expect(block, '没说清在做哪几步').toMatch(/重载|滚动|展开/);
  });

  it('⭐ 没采过时给出三步说明 —— 人要知道先做什么', () => {
    const s = panel();
    const i2 = s.indexOf('{!running && !report && (');
    expect(i2, '没有引导文案').toBeGreaterThan(-1);
    const block = s.slice(i2, s.indexOf(')}', i2));
    expect(block, '没说要先选页面').toMatch(/选好页面|控制/);
  });
});

/**
 * ⭐⭐⭐ **深度由人选,不由代码定** —— 用户 2026-10-03
 *
 * 「最后**根据业务的要求**来执行是否要获取全部内容。」
 * 「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
 *
 * ⚠️ 之前是「缺就补」写死在代码里 —— 有的采集只要互动数,
 * 为此进 38 篇详情页纯属浪费。
 */
describe('⭐⭐⭐ 补到哪一层:采集要求说了算', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 深度是**可选的**(state),不是写死的常量', () => {
    const s = panel();
    expect(s, '没有深度选择 —— 又变回「代码替人决定补不补」')
      .toMatch(/useState<FetchDepth>/);
    /** ⭐ 三档都要能选到,少一档就等于那档用不上 */
    for (const d of ['as-is', 'expand-only', 'full']) {
      expect(s, `深度 ${d} 选不到`).toContain(`"${d}"`);
    }
  });

  it('⭐⭐ 传给编排的是**选中的那个**,不是写死的字面量', () => {
    const s = panel();
    const i = s.indexOf('runCollect(');
    expect(i, '面板没调 runCollect —— 编排又回到 onClick 里了').toBeGreaterThan(-1);
    /**
     * ⚠️ 切到 `wantPages` 那个参数对象为止。
     * 第一版切到第一个 `});` —— 那落在 `harvest` 回调里面,
     * **根本够不着 depth 那一行**(切片写错了,不是代码错了)。
     */
    const from = s.indexOf('wantPages', i);
    expect(from, 'runCollect 调用里没有 wantPages —— 本条要重写').toBeGreaterThan(i);
    const call = s.slice(from, s.indexOf('});', from));
    expect(call.length, '切片空了 —— 断言会恒真').toBeGreaterThan(20);
    expect(call, '传的是写死的深度 —— 人选了也没用').not.toMatch(/depth:\s*'/);
    expect(call, '没把选中的深度传进去').toMatch(/depth,/);
  });

  /**
   * ⚠️⚠️ 三类账必须都显示 —— 只显示「做了几条」
   * 会让报告显得「全齐了」(`不量的字段永远 100%`)。
   */
  it('⚠️⚠️ 三类账都要露面:执行 / 本次不补 / 补不了', () => {
    const s = panel();
    for (const [field, label] of [
      ['todo', '本次执行的'],
      ['skipped', '缺但本次不补的'],
      ['impossible', '根本补不了的'],
    ] as const) {
      expect(s, `${label}(plan.${field})没显示 —— 账是不全的`)
        .toContain(`plan.${field}`);
    }
  });

  it('⭐ 长流程要报进度 —— 不让人对着「采集中」干等', () => {
    const s = panel();
    expect(s, '没有进度显示').toMatch(/onProgress/);
  });
});

/**
 * ⭐⭐⭐ 配方配置 —— 用户 2026-10-04:「配方的配置功能也要增加上来哦。」
 */
describe('⭐⭐⭐ 配方栏:能配、能看见实际搜什么', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐ 配方是**第四个并排 tab**,不是堆在输出下面', () => {
    const s = panel();
    const i = s.indexOf('const CAP_TABS');
    expect(i, 'CAP_TABS 不见了 —— 本条要重写').toBeGreaterThan(-1);
    const block = s.slice(i, s.indexOf('];', i));
    expect(block, '配方没进 CAP_TABS —— tab 根本不显示').toContain("id: 'recipe'");
    /** ⚠️ 四个都要在 —— 少一个就是那个能力点不到 */
    for (const id of ['control', 'input', 'output', 'recipe']) {
      expect(block, `tab ${id} 不在真表里`).toContain(`id: '${id}'`);
    }
  });

  it('⭐⭐ 增删改三样**都要有** —— 只能看不能改不算「配置功能」', () => {
    const s = panel();
    const i = s.indexOf("{tab === 'recipe' &&");
    expect(i, '配方栏的 JSX 不见了').toBeGreaterThan(-1);
    const area = s.slice(i);
    expect(area.length, '切片空了 —— 断言会恒真').toBeGreaterThan(200);
    for (const [fn, what] of [
      ["op: 'list'", '读'], ["op: 'upsert'", '存'], ["op: 'delete'", '删'],
    ] as const) {
      expect(s, `配方栏少了「${what}」—— 配不全`).toContain(fn);
    }
  });

  /**
   * ⭐⭐⭐ 配方填的词与**真正发出去的串**不是一回事
   * (会加 OR、引号、from:、min_faves、since:)。
   * 不显示的话人只能靠猜 —— 而猜错了要等采回一堆噪音才发现。
   */
  it('⭐⭐⭐ 每条配方都显示**实际会搜什么**', () => {
    const s = panel();
    expect(s, '面板没调 recipeToQuery —— 显示的是配方不是真查询')
      .toContain('recipeToQuery');
    const i = s.indexOf("{tab === 'recipe' &&");
    const area = s.slice(i);
    expect(area, '没把查询串显示出来').toContain('q.q');
    expect(area, '没把「为什么这么搜」显示出来').toContain('q.explain');
  });

  it('⚠️⚠️ 翻译不出来的配方**点不了** —— 不许点了才失败', () => {
    const s = panel();
    const i = s.indexOf("{tab === 'recipe' &&");
    const area = s.slice(i);
    expect(
      area,
      '「按它搜索」没按 problems 禁用 —— 残缺配方也能点,搜回一堆不相干的',
    ).toMatch(/disabled=\{[^}]*q\.problems\.length > 0/);
  });

  /**
   * ⚠️ 配方栏**只导航不采集** —— 用户 2026-10-03:
   * 「我自己选定一个页面,点击开始采集,就采集」。
   * 配方替人把页面选好,**不替人决定采不采**。
   */
  it('⚠️ 配方栏只 goto,**不自己发起采集**', () => {
    const s = panel();
    const i = s.indexOf("{tab === 'recipe' &&");
    const area = s.slice(i);
    expect(area, '配方栏自己采起来了 —— 采集该是输出栏那一个按钮的事')
      .not.toContain("op: 'harvest'");
  });
});

/**
 * ⭐⭐⭐ 面板报的数字要是**人问的那个** —— 2026-10-04
 *
 * 用户看着面板问:「怎么才采到 7 条呢?」
 * ⚠️⚠️ 那个 7 是**第一趟 harvest 的响应条数**,而同一跑的报告里写着
 * 「56 条响应 / **43 条推文**」—— 三个数字说同一件事,
 * 面板挑了最没用的那个,标签还写着「合并去重后的总条数」
 * (**既没合并也没去重**,更不含翻页那几趟)。
 */
describe('⭐⭐⭐ 面板首要指标 = 推文数', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 头一个数字是**推文**,不是响应条数', () => {
    const s = panel();
    const i = s.indexOf('S.statRow');
    expect(i, 'statRow 不见了 —— 本条要重写').toBeGreaterThan(-1);
    const area = s.slice(i, s.indexOf('</div>', i) + 200);
    expect(area.length, '切片空了 —— 断言会恒真').toBeGreaterThan(80);
    expect(area, '面板没报推文数 —— 人问「采到几条」看不到答案')
      .toMatch(/label="推文"/);
    expect(
      area,
      '首要指标还是 report.items.length —— 那只是第一趟的响应数',
    ).not.toMatch(/label="采到"\s*v=\{report\.items\.length\}/);
  });

  it('⭐⭐ 响应数要算**整轮**,不是第一趟', () => {
    const s = panel();
    expect(s, '响应数仍取第一趟 —— 翻页和补长文那些趟全没算')
      .toContain('setTotalResponses(run.totalResponses)');
  });

  it('⚠️ 重新开跑要清零 —— 否则上一跑的数字赖着不走', () => {
    const s = panel();
    expect(s, '没清零 —— 新一跑会显示上一跑的数').toContain('setTotalResponses(0)');
  });
});

/**
 * ⭐⭐⭐ 「停止」要**停得住整跑** —— 用户 2026-10-04:
 * 「停止按钮不起作用的,怎么点击停止也不停止?」
 *
 * ⚠️⚠️ 原先只发底座的 `scrollStop`,那**只能停滚动**。
 * 一跑有三段,后两段是编排自己的循环(主动翻页 / 逐篇补长文)——
 * 人点停止时多半正在那两段,所以「点了没反应」。
 */
describe('⭐⭐⭐ 停止按钮要停得住整跑', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 停止**既**停滚动**也**置取消标记', () => {
    const s = panel();
    const i = s.lastIndexOf("op: 'scrollStop'");
    expect(i, '停止按钮不见了 —— 本条要重写').toBeGreaterThan(-1);
    /** ⭐ 往前切到 onClick 开头,看这个 handler 里两件事都做了没 */
    const from = s.lastIndexOf('onClick=', i);
    const handler = s.slice(from, i + 60);
    expect(handler.length, '切片空了 —— 断言会恒真').toBeGreaterThan(40);
    expect(
      handler,
      '停止只发 scrollStop —— 翻页和补长文那两段听不见，人点了没反应',
    ).toContain('cancelRef.current = true');
  });

  it('⭐⭐ 取消标记传给编排 —— 否则置了也没人看', () => {
    const s = panel();
    expect(s, '没把 cancelled 传进 runCollect —— 标记置了白置')
      .toContain('cancelled: () => cancelRef.current');
  });

  /**
   * ⚠️ 必须用 `useRef` 不能用 `useState` ——
   * 编排在 async 函数里跑,闭包捕获的 state 永远是开跑那一刻的值。
   */
  it('⚠️⚠️ 取消标记用 useRef —— useState 在闭包里看不见改动', () => {
    const s = panel();
    expect(
      s,
      '取消标记不是 useRef —— async 编排闭包捕获的是旧值，改了也看不见',
    ).toMatch(/const cancelRef = useRef\(/);
  });

  it('⚠️ 开跑要清零 —— 否则上一次的「停」会把新一跑立刻掐掉', () => {
    const s = panel();
    expect(s, '没清零 —— 点过一次停止之后再也采不了')
      .toContain('cancelRef.current = false');
  });
});

/**
 * ⭐⭐⭐ **采完要落库** —— 2026-10-05
 *
 * ⚠️⚠️ 在这之前,采到的数据**跑完就蒸发**:
 * 长文正文 23446 字、主动翻页、研判分层 —— 修了一长串,库里一个字没留下。
 */
describe('⭐⭐⭐ 采完就存,且存的结果看得见', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 采完调 saveTweets', () => {
    expect(panel(), '采完不存 —— 跑完就蒸发').toContain("op: 'saveTweets'");
  });

  /**
   * ⚠️⚠️ 存的必须是 `record`(完整记录),不是面板那份核对结果 ——
   * 后者 `preview` 只 80 字、媒体只有 type,存进去等于存了个摘要。
   */
  it('⭐⭐⭐ 存的是**完整记录**,不是 80 字的核对结果', () => {
    const s = panel();
    const i = s.indexOf("op: 'saveTweets'");
    const from = s.lastIndexOf('const records', i);
    expect(from, '没看到 records 的来源 —— 本条要重写').toBeGreaterThan(-1);
    const block = s.slice(from, i);
    expect(block, '存的不是 record —— preview 只有 80 字,媒体只有 type')
      .toContain('.map((t) => t.record)');
  });

  /**
   * ⚠️⚠️ inserted / updated **必须分开显示**。
   * 合成一个「保存了 N 条」的话,「全是重复的」和「全是新的」长得一模一样 ——
   * 那正是 `INSERT IGNORE` 当年藏了两个月的东西。
   */
  it('⭐⭐⭐ 新入库与已更新**分开报**', () => {
    const s = panel();
    expect(s, '没报「新入库」').toContain('label="新入库"');
    expect(s, '没报「已更新」—— 全是重复的和全是新的会长得一样')
      .toContain('label="已更新"');
  });

  it('⚠️⚠️ 入库失败要**显眼**,不许静默', () => {
    const s = panel();
    expect(s, '入库失败不显示 —— 「存进去了」和「静默失败」长得一样')
      .toContain('label="入库失败"');
  });

  it('⚠️ 重新开跑要清掉上一跑的入库数', () => {
    expect(panel(), '没清零 —— 新一跑会显示上一跑的入库数').toContain('setSaved(null)');
  });
});

/**
 * ⭐⭐⭐ **并排的数字必须同口径,否则标签要说清** —— 用户 2026-10-05:
 * 「从观察的数字看,好像有点问题吧?」
 *
 * 面板当时并排摆着:
 *   页 32          ← 时间线载荷条数(首轮滚动 + 翻页都算)
 *   翻页 28 轮     ← 只数翻页
 * ⚠️ 数字**各自都对**(实测逐个对过),但两个标签都像在说「翻了多少」,
 * 于是 32 vs 28 看起来自相矛盾 —— **错的是名字,不是数**。
 */
describe('⭐⭐⭐ 并排的数字不许看起来自相矛盾', () => {
  const panel = (): string => strip(read('src/modules/x/XConsole.tsx'));

  it('⭐⭐⭐ 载荷数不叫「页」—— 它与「翻页 N 轮」不是一个口径', () => {
    const s = panel();
    const i = s.indexOf('S.statRow');
    const area = s.slice(i, s.indexOf('</div>', i) + 600);
    expect(area.length, '切片空了 —— 断言会恒真').toBeGreaterThan(100);
    expect(
      area,
      '载荷数还叫「页」—— 与旁边的「翻页 N 轮」口径不同却同名，看起来自相矛盾',
    ).not.toMatch(/label="页"/);
    expect(area, '没报载荷数').toMatch(/label="载荷"/);
  });

  it('⭐⭐ 它的 hint 要说清**和翻页轮数不是一回事**', () => {
    const s = panel();
    const i = s.indexOf('label="载荷"');
    expect(i, '载荷那格不见了 —— 本条要重写').toBeGreaterThan(-1);
    const hint = s.slice(i, s.indexOf('/>', i));
    expect(
      hint,
      'hint 没说清口径 —— 人看到两个数不一样还是会以为出错了',
    ).toMatch(/不是一个口径|滚动|翻页/);
  });
});
