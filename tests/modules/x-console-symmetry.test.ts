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
import { xPageResolver, PAGE_PARAMS } from '@modules/x/x-pages';

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

  it('⭐⭐ 反向认出的页面名与参数,必须在正向表里真能用', () => {
    /**
     * ⭐ 这是「正反必须同一张表」的**真**判据:
     * 不只比字符串,而是把 identify 的产出**喂回 resolve**,看能不能拼出 URL。
     * ⚠️ 只断言 `name === 'x.status'` 那种写法,表删了这页也照样绿。
     */
    const samples = [
      'https://x.com/home',
      'https://x.com/elonmusk',
      'https://x.com/elonmusk/with_replies',
      'https://x.com/i/status/2105861183614169438',
      'https://twitter.com/elonmusk/status/123',
    ];
    const recognized = samples
      .map((u) => ({ u, hit: xPageResolver.identify?.(u) ?? null }))
      .filter((x) => x.hit !== null);

    // ⚠️ 样本里必须真有认得出来的 —— 否则下面的循环空转,等于没测
    // (`feedback-check-sample-contains-phenomenon`:别拿不含该现象的样本论证)
    expect(recognized.length, '一个样本都认不出来 —— 循环会空转').toBeGreaterThan(2);

    for (const { u, hit } of recognized) {
      const names = xPageResolver.names?.() ?? [];
      expect(names, `identify('${u}') 认出了 ${hit!.name},但正向表里没这个名字`)
        .toContain(hit!.name);

      // 认出的参数键必须正是这页要的参数
      const need = PAGE_PARAMS[hit!.name] ?? [];
      expect(Object.keys(hit!.params).sort(), `${hit!.name} 的参数键对不上正向表`)
        .toEqual([...need].sort());

      // ⭐ 真喂回正向:拼得出 URL 才算同一张表的两面
      const back = xPageResolver.resolve(hit!.name, hit!.params);
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
