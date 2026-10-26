/**
 * ⭐⭐ `renderer → web.dom` IPC 面的边界守卫(L2 收口最后一块)
 *
 * ── 这层为什么存在(设计 §〇)──
 *
 * renderer 侧 18 处裸注入的四个实测缺陷:
 *  ① `sync-driver` **26 处静默吞异常、零日志** —— 违反可靠性纲领 §44
 *  ② `replace(/__KRIG_SIDE__/g, …)` 把运行时值**文本替换进脚本源码**,
 *     与 `project-x-inject-template-escape` 同机制,**且已经咬过一次**
 *     (代码注释自己记着:「只替换第一个会让 sync 行为异常」)
 *  ③ 9 处把运行时值拼进脚本(含数字 —— `JSON.stringify(NaN)` → `null` → 当 0)
 *  ④ 零留痕:绕过 `trace`/`raw`,出事查不到「往页面里塞了什么」
 *
 * ⭐ 而「社区论坛自动化」会让这四条**随每个新站点线性增长**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const IPC_DOM = join(ROOT, 'src/platform/main/web-capability/wiring/ipc-dom.ts');

/** ⚠️ 剥注释 —— 本文件与被扫文件的注释里都大量提到 `runDynamic` 等词 */
/** 仓根下的绝对路径 —— ⚠️ 与本文件已有的 ROOT 同源,不另算一份 */
function resolveFromRoot(rel: string): string {
  return join(ROOT, rel);
}

const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ipcDom = strip(readFileSync(IPC_DOM, 'utf-8'));
/**
 * ⭐ 采集引擎(会话表 / 两条腿 / resolve)2026-10-13 从 ipc-dom 原样搬到这里(后台策略 3a)。
 * ⚠️ 钉在这些零件上的守卫跟着改读这个文件 —— 不改的话它们在 ipc-dom 里找不到、当场红;
 * 而**更糟的是**有人为了变绿把断言删了。判据本身一条没放松。
 */
const ENGINE = join(ROOT, 'src/platform/main/web-capability/wiring/web-collect-engine.ts');
const engine = strip(readFileSync(ENGINE, 'utf-8'));

function listSources(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('⭐⭐ IPC 面:不许把 runDynamic 开给 renderer', () => {
  it('前提自检:确实读到了 ipc-dom.ts', () => {
    expect(ipcDom.length, '文件空了 —— 守卫在空转').toBeGreaterThan(500);
    expect(ipcDom, '不是那个文件').toContain('registerWebDomIpc');
    expect(engine.length, 'web-collect-engine.ts 空了 —— 钉在引擎上的守卫在空转').toBeGreaterThan(500);
    expect(engine, '不是那个文件').toContain('sessionsByPageId');
  });

  it('⭐⭐ handler 里零处 runDynamic', () => {
    /**
     * ⚠️ `runDynamic` 是 web.dom 的 dev-only 逃生口。开给 renderer
     * 等于把 web.dom 费力关掉的注入口重新打开 ——
     * `channel-names.ts` 里控制台时代那条注释写得很清楚。
     */
    expect(
      ipcDom,
      'IPC handler 里出现了 runDynamic —— 那等于把「求值任意脚本」开给 renderer',
    ).not.toMatch(/runDynamic/);
  });

  it('⭐⭐ 契约类型里零处 runDynamic(类型层面也堵住)', () => {
    const types = strip(readFileSync(join(ROOT, 'src/shared/ipc/web-dom-types.ts'), 'utf-8'));
    expect(types, "WebDomInvoke 里出现了 runDynamic 这个 op").not.toMatch(/runDynamic/);
  });

  it('⭐ preload 暴露的是 scriptId 不是脚本文本', () => {
    /**
     * ⭐ 这是类型层面的根治:调用方给不了原始字符串,就拼不出坏脚本。
     * ⚠️ 若哪天签名变成收 `script: string`,这条要红。
     */
    const pre = strip(readFileSync(join(ROOT, 'src/platform/main/preload/main-window-preload.ts'), 'utf-8'));
    const i = pre.indexOf('webDomRun(');
    expect(i, 'preload 没有 webDomRun').toBeGreaterThan(-1);
    const body = pre.slice(i, i + 400);
    expect(body, 'webDomRun 收的不是 scriptId').toMatch(/scriptId\s*:\s*string/);
    expect(body, '⚠️ webDomRun 开始收脚本文本了 —— 根治失效').not.toMatch(/\bscript\s*:\s*string/);
  });
});

describe('⭐ 分层方向:renderer 不许直接 import 能力层', () => {
  /**
   * ⭐ 趁**零违规**立这条(2026-09-30):renderer 侧要用 web.dom
   * 只能走 IPC。直接 import 会把 Electron main 的东西拖进渲染进程,
   * 且绕过 `ipc-dom.ts` 这唯一接线点(以及它的 runDynamic 红线)。
   */
  const RENDERER_DIRS = ['src/drivers', 'src/views', 'src/capabilities', 'src/workspace', 'src/shell', 'src/slot'];

  it('前提自检:扫到了 renderer 侧源码', () => {
    const n = RENDERER_DIRS.reduce((acc, d) => acc + listSources(join(ROOT, d)).length, 0);
    expect(n, 'renderer 侧一个文件都没扫到 —— 守卫在空转').toBeGreaterThan(100);
  });

  it('⭐⭐ renderer 侧零处 import web-capability', () => {
    const offenders: string[] = [];
    for (const d of RENDERER_DIRS) {
      for (const f of listSources(join(ROOT, d))) {
        const code = strip(readFileSync(f, 'utf-8'));
        if (/from\s+['"][^'"]*web-capability/.test(code) || /^\s*import\s+['"][^'"]*web-capability/m.test(code)) {
          offenders.push(f.replace(ROOT + '/', ''));
        }
      }
    }
    expect(
      offenders,
      'renderer 直接 import 了能力层 —— 要用 web.dom 只能走 IPC(window.electronAPI.webDomRun),\n'
      + '直接 import 会把 main 的东西拖进渲染进程,且绕过 ipc-dom.ts 的 runDynamic 红线:\n  '
      + offenders.join('\n  '),
    ).toEqual([]);
  });
});

describe('⭐ IPC 面的失败语义:不许静默', () => {
  it('⭐⭐ 零处静默 catch —— 这正是本层要替换掉的病', () => {
    /**
     * ⚠️ renderer 侧那 18 处就是 `.catch(() => {})`(实测 sync-driver 26 处)。
     * 新建的这一层**绝不许**长出同样的东西。
     */
    /**
     * ⚠️ 本条第一版的正则是**错的**:写成 `catch\s*\(\s*\)\s*=>`,
     * 要求 `catch` 后紧跟空括号 —— 而真实写法是 `.catch(() => {})`
     * (`catch` 后是 `(`,里面才是 `()`)。实测它**什么都匹配不到**,
     * 注入 `.catch(() => {})` 照样全绿。
     * ⭐ 又一次「断言写了但永远不会红」—— 注入验证当场抓出来的。
     */
    const silent = [
      /\.catch\s*\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/,   // .catch(() => {}) / .catch(e => {})
      /\.catch\s*\(\s*\w+\s*=>\s*\{\s*\}\s*\)/,                  // .catch(e => {})(无括号形参)
      /\.catch\s*\(\s*\(\s*\)\s*=>\s*undefined\s*\)/,             // .catch(() => undefined)
      /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/,                         // catch {} / catch (e) {}
    ];
    for (const re of silent) {
      expect(
        ipcDom,
        `出现了静默吞异常的写法(${String(re)}) —— 本层要替换的正是这个病`,
      ).not.toMatch(re);
    }
  });

  it('⭐ 未知 op 要如实报,不许落到某个默认操作', () => {
    const i = ipcDom.indexOf('switch (p.op)');
    expect(i, '没有 op 分派').toBeGreaterThan(-1);
    /**
     * ⚠️⚠️ 切到 **`default:` 为止**,不切到 `} catch` ——
     * 2026-10-02 实测:我给 `writeAudit` 分支加了 `try/catch`(写文件要兜异常),
     * 切片在那个 catch 就被截断了,`default` **根本没进切片** → 守卫**假红**,
     * 而 default 分支一直是对的。
     * ⭐ 守卫切片的边界必须选**不会被正常代码插入**的锚点。
     */
    const d = ipcDom.indexOf('default:', i);
    expect(d, 'switch 里没有 default 分支 —— 未知 op 会被静默吞掉').toBeGreaterThan(i);
    /**
     * ⚠️⚠️ 切到 **`default:` 之后的第一个 `return`** ——
     * 注入验证抓到:切 600 字符的固定窗口时,后面 `catch` 块里的
     * `failed(` 把断言兜住了 → 把 default 改成静默返回 ok **照样全绿**。
     * ⭐ `feedback-guard-scope-to-the-branch`:同一 token 在切片里出现多次。
     */
    const ret = ipcDom.indexOf('return', d);
    expect(ret, 'default 分支没有 return').toBeGreaterThan(d);
    const stmt = ipcDom.slice(ret, ipcDom.indexOf(';', ret) + 1);
    expect(stmt.length, 'slice 空了 —— 断言会恒真').toBeGreaterThan(10);
    expect(stmt, 'default 分支没有如实失败 —— 未知 op 会被静默吞掉')
      .toMatch(/failed\(/);
  });

  it('⭐⭐ pageRef 解析不出来要失败,绝不兜底到别的页面', () => {
    /** ⭐ `resolve` 2026-10-13 搬进采集引擎(3a)—— 读那个文件 */
    const i = engine.indexOf('function resolve(');
    expect(i, '没有 resolve').toBeGreaterThan(-1);
    const body = engine.slice(i, engine.indexOf('\n}', i));
    expect(body.length, 'slice 空了').toBeGreaterThan(50);
    // 必须校验 wcId 合法性与 wc 存活
    expect(body, '没校验 wcId').toMatch(/Number\.isInteger/);
    expect(body, '没校验 wc 是否已销毁').toMatch(/isDestroyed/);
    // ⚠️ 绝不出现「挑一个」的兜底
    expect(body, '出现了 activeWs 之类的猜测 —— 底座没资格替业务选页面')
      .not.toMatch(/activeWs|getActive|\[0\]/);
  });

  it('⭐ register 与 bindPageHost 必须成对(漏一个就「调不动且不报错」)', () => {
    /** ⭐ 登记/绑定在 `resolve` 里,随它搬进采集引擎(3a) */
    expect(engine, '没登记页面').toMatch(/pageRegistry\.register\s*\(/);
    expect(engine, '登记了页面但没绑 wc —— 引擎会说「页面已关闭」而其实是没接线')
      .toMatch(/bindPageHost\s*\(/);
  });
});

describe('⭐⭐ scriptId 字面量两边必须一致(不 import 的代价)', () => {
  /**
   * ⭐ renderer 不许 import 能力层,所以 scriptId 在两边各写一份字面量。
   * ⚠️ 那就必然有**漂移风险** —— 漂了的表现是「注入静默没生效」
   * (main 侧查不到这个 id → Failed「未注册」,而 renderer 只看到一行 warn)。
   * 本条用**两张清单对照**钉住它们一致,不钉单个字面量
   * (`project-x-field-four-place-registration` 的做法)。
   */
  const mainScripts = strip(
    readFileSync(join(ROOT, 'src/platform/main/web-capability/dom/renderer-scripts.ts'), 'utf-8'),
  );

  it('前提自检:两边都读到了', () => {
    expect(mainScripts, 'main 侧脚本表读不到').toContain('RENDERER_SCRIPTS');
  });

  it('⭐⭐ main 侧登记的每个 id,renderer 侧都有对应字面量', () => {
    // 从 main 侧真表取 id(⭐ 不自己抄一份清单 —— 抄的会漂)
    const ids = Array.from(mainScripts.matchAll(/'(renderer\.[a-z0-9-]+)'\s+as\s+ScriptId/g))
      .map((m) => m[1]);
    expect(ids.length, '一个 renderer.* 脚本都没登记 —— 判据会空转').toBeGreaterThan(0);

    const rendererSources = ['src/drivers', 'src/views', 'src/capabilities']
      .flatMap((d) => listSources(join(ROOT, d)))
      .map((f) => strip(readFileSync(f, 'utf-8')))
      .join('\n');

    const missing = ids.filter((id) => !rendererSources.includes(`'${id}'`));
    expect(
      missing,
      'main 侧登记了这些脚本,但 renderer 侧找不到对应字面量 —— 要么是死脚本,\n'
      + '要么是 renderer 写错了名字(表现为「注入静默没生效」):\n  ' + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ renderer 侧用的每个 renderer.* id,main 侧都登记了', () => {
    /** ⚠️ 反方向同样要钉:renderer 写了个 main 没登记的名字 = 注入永远失败 */
    const used = new Set<string>();
    for (const d of ['src/drivers', 'src/views', 'src/capabilities']) {
      for (const f of listSources(join(ROOT, d))) {
        const code = strip(readFileSync(f, 'utf-8'));
        for (const m of code.matchAll(/'(renderer\.[a-z0-9-]+)'/g)) used.add(m[1]);
      }
    }
    const unregistered = Array.from(used).filter((id) => !mainScripts.includes(`'${id}'`));
    expect(
      unregistered,
      'renderer 用了 main 侧没登记的 scriptId —— 注入会永远失败(「未注册」):\n  '
      + unregistered.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 脚本本体里不许再留占位符(文本替换的遗迹)', () => {
    /**
     * ⚠️ 旧做法是对占位符做 regex 文本替换,**已经咬过一次**
     * (占位符在 sync-inject.js 出现 2 处:一处注释一处真实变量,
     * `replace(string,string)` 只换了注释 → sync 行为异常)。
     * ⭐ 改成绑定值之后,脚本本体里不该再有任何 `__XXX__` 式占位符。
     */
    /**
     * ⚠️ 两个 `?raw` 脚本都要扫 —— 2026-09-30 步 2b 发现
     * `google-translate-inject.js` 有**完全同形**的占位符
     * (同样 2 处:一处注释一处真实变量)。只扫一个文件就是漏。
     */
    const RAW_SCRIPTS = [
      'src/drivers/web-sync-driver/sync-inject.js',
      'src/drivers/web-translate-driver/google-translate-inject.js',
    ];
    const found: string[] = [];
    for (const f of RAW_SCRIPTS) {
      const code = readFileSync(join(ROOT, f), 'utf-8');
      for (const m of code.matchAll(/__[A-Z][A-Z0-9_]{2,}__/g)) {
        found.push(`${f}: ${m[0]}`);
      }
    }
    expect(
      found,
      '脚本里还有占位符 —— 说明又在做文本替换而不是参数绑定:\n  ' + found.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ driver 侧不许再 `?raw` + replace —— 那是旧机制的指纹', () => {
    /**
     * ⭐ 脚本本体现在归 main 侧的 `renderer-scripts.ts`。
     * driver 若又 `import x from './y.js?raw'` 并 `.replace(...)`,
     * 说明旧机制复活了(把运行时值文本替换进脚本源码)。
     */
    const offenders: string[] = [];
    for (const f of listSources(join(ROOT, 'src/drivers'))) {
      const code = strip(readFileSync(f, 'utf-8'));
      if (/\?raw/.test(code)) offenders.push(`${f.replace(ROOT + '/', '')} (?raw)`);
    }
    expect(
      offenders,
      'driver 又在 import ?raw 脚本 —— 脚本本体应登记在 main 侧的 renderer-scripts.ts,\n'
      + 'driver 只给 scriptId + 参数:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ 失败必须在**主进程**也出声(不能只打在 renderer)', () => {
    /**
     * ⚠️ 2026-10-01 步 2b 调试时发现的真实障碍:
     * 调用方的 `console.warn` 打在 **renderer 进程**,只存在于那个 webview 的
     * DevTools 里;而人看的是启动终端。于是「我加了日志」与
     * 「人能看到日志」是两回事 —— 查了四轮静态证据仍定不了因,
     * 就卡在拿不到那一行上。
     *
     * ⭐ 这是 feedback-maintainability-over-feature-completion 的同一种形态:
     * 记了,但记在人看不到的地方。
     */
    const i = ipcDom.indexOf('function failed(');
    expect(i, 'failed 不再是函数 —— 本条要重写').toBeGreaterThan(-1);
    const body = ipcDom.slice(i, ipcDom.indexOf('\n}', i));
    expect(body.length, 'slice 空了 —— 断言会恒真').toBeGreaterThan(30);
    expect(body, 'failed() 不出声 —— 真因只会留在 renderer 的 DevTools 里')
      .toMatch(/console\.(warn|error)/);
  });

  it('⭐ 启动时报一次脚本表 —— 「没登记上」要在启动就看得见', () => {
    /**
     * ⭐ 「成功路径也要留痕」:不是等出事才查,而是平时就把判断依据摆出来。
     * 脚本数量/名字不对,终端里直接能看见,不必等用户点翻译才暴露。
     */
    const i = ipcDom.indexOf('export function registerWebDomIpc');
    const body = ipcDom.slice(i, i + 900);
    expect(body, '启动时不报脚本表').toMatch(/scriptRegistry\.list\(\)/);
    expect(body, '没把 renderer.* 单独列出来 —— 那才是 renderer 侧调用的依据')
      .toMatch(/renderer\./);
  });

  it('⭐⭐ goto 只收**语义页面名**,不许开一个收 URL 的口子', () => {
    /**
     * ⚠️⚠️ 这是一道**闸**,不只是接口风格:
     * renderer 给不了任意 URL,就导航不到计划外的地方。
     *
     * ⭐ 旧实现 2026-09-07 的「把首页时间线当搜索结果」**整批入库**
     * 正是没有这道闸(`x-pages.ts` 的注释记着:
     * 「解释不出来返回 null,绝不兜底 —— 兜底会导航到别的页面」)。
     *
     * 判据:契约里 `goto` 这一支**不许出现 url 字段**。
     */
    const types = strip(readFileSync(join(ROOT, 'src/shared/ipc/web-dom-types.ts'), 'utf-8'));
    const i = types.indexOf("readonly op: 'goto'");
    expect(i, '契约里没有 goto —— 本条要重写').toBeGreaterThan(-1);
    const branch = types.slice(i, types.indexOf('}', i));
    expect(branch.length, 'slice 空了 —— 断言会恒真').toBeGreaterThan(20);
    expect(
      branch,
      'goto 开了收 URL 的口子 —— 那等于绕开页面表,\n'
      + 'renderer 可以导航到任意地址(旧实现「把首页当搜索结果」整批入库的成因)',
    ).not.toMatch(/readonly\s+url\s*:/);
    expect(branch, 'goto 没收语义页面名').toMatch(/readonly\s+name\s*:\s*string/);
  });


});


/**
 * ⭐⭐ 载荷捕获那几个 op 的接线约束(2026-10-02 第 3 步)
 *
 * ⚠️ 本节钉的全是「漏了就静默失效」的东西 —— 不是风格。
 */
describe('⭐⭐ web.net 捕获 op:三条接线约束', () => {
  /**
   * ⚠️ 用本文件顶部已有的 `ipcDom`(模块加载时读一次)——
   * 不另写一份读文件逻辑:两份路径会漂,而漂的表现是
   * 「守卫读的不是我改的那个文件」,全绿也证明不了什么。
   */
  const src = (): string => ipcDom;

  it('⭐⭐⭐ captureStart 必须先接 webRequest 侧 —— 否则关联恒失败', () => {
    /**
     * ⚠️⚠️ 不接的整条链(守卫 net-webrequest-side-wired 记着):
     *   candidatesFor 恒空 → findClosestMatch 恒 null
     *   → attachProviderBody 恒「关联失败」→ **不发 response-complete**
     *   → 订阅者一条载荷都收不到,**而且是静默的**
     * 现象是「捕获 0 条」,人会去查选择器/页面 —— 方向完全相反。
     *
     * ⭐ 判据切到 captureStart 分支内,不整文件扫。
     */
    const s = src();
    const i = s.indexOf("case 'captureStart'");
    expect(i, 'captureStart 分支不见了').toBeGreaterThan(-1);
    const end = s.indexOf("case 'captureStop'", i);
    expect(end, 'captureStop 分支不见了 —— 切片没边界').toBeGreaterThan(i);
    const body = s.slice(i, end);
    expect(body.length, '切出来的分支是空的 —— 断言会恒真').toBeGreaterThan(80);

    expect(body, 'captureStart 没接 webRequest 侧 —— 载荷关联会恒失败且静默')
      .toMatch(/wireWebRequestSide(On)?\s*\(/);
    expect(body, 'captureStart 没 attach CDP 通道 —— 压根不会有 body')
      .toMatch(/bodyProvider\.attach\s*\(/);
  });

  it('⭐⭐ 接线必须传**真 session 对象**,不许传反推的 partition 名', () => {
    /**
     * ⚠️⚠️ 反推办法是 `wc.session.storagePath` 取尾段,而那**不保证**
     * 等于 partition 名(X 真实值 `persist:webview-ws-1`)。
     * 猜错时 `session.fromPartition()` 会**凭空建一个新 session**,
     * 监听挂到没人用的地方,去重表还把这名字记下 → 真 session 永远挂不上,
     * **而日志照样打「已接线」**。
     */
    const s = src();
    const i = s.indexOf("case 'captureStart'");
    const body = s.slice(i, s.indexOf("case 'captureStop'", i));
    expect(body, '接线传的不是真 session —— 猜错 partition 名会完全静默')
      .toMatch(/wireWebRequestSideOn\s*\(\s*\w+\s*,\s*wc\.session/);
    expect(body, '接线用了反推出来的 partition 名').not.toMatch(/wireWebRequestSideOn\s*\([^)]*readPartition/);
  });

  it('⭐⭐ attach 失败要**如实回报**,不许只靠广播', () => {
    /**
     * ⭐ provider 会广播 channel-failed(订阅者收得到),但人点了「开始捕」
     * 要**立刻**知道成没成 —— 不能等他滚了半天才发现一条都没有。
     */
    const s = src();
    const i = s.indexOf("case 'captureStart'");
    const body = s.slice(i, s.indexOf("case 'captureStop'", i));
    expect(body, 'attach 失败没回 failed —— 人点了开始捕却不知道没成').toMatch(/failed\s*\(/);
  });

  it('⭐⭐ wc 销毁时必须清会话 —— 否则内存只涨不降', () => {
    /**
     * ⚠️ 不清的话会话一直订阅一个死页面,
     * 而症状是**内存只涨不降**,没有任何报错指向这里。
     * ⭐ 判据切到 destroyed 回调里。
     */
    /** ⭐ destroyed 回调在 `resolve` 里,随它搬进采集引擎(3a) */
    const s = engine;
    const i = s.indexOf("wc.once('destroyed'");
    expect(i, 'destroyed 回调不见了').toBeGreaterThan(-1);
    const body = s.slice(i, i + 400);
    expect(body, 'destroyed 时没停会话 —— 会一直订阅死页面').toMatch(/\.stop\s*\(\s*\)/);
    expect(body, 'destroyed 时没删会话记录').toMatch(/sessionsByPageId\.delete/);
  });

  it('⭐ 会话按 pageId 分,不按 wcId —— 页面刷新后会话该延续', () => {
    /**
     * ⚠️ 按 wcId 分的话,人点了「开始捕」、页面刷新一下就悄悄停了 ——
     * 而数字不动很难察觉是「停了」还是「没载荷」。
     */
    expect(engine, '会话表的键不是 pageId').toMatch(/sessionsByPageId\s*=\s*new Map<\s*PageId/);
  });
});

/**
 * ⭐⭐ 捕获结果必须**落盘**,不能只活在 renderer 的 state 里
 *
 * ── 用户 2026-10-02 ──
 * 「你在底层有读取数据的能力，而不是靠我截图，否则效率会差很多。」
 *
 * ⚠️ 这正是 `feedback-maintainability-over-feature-completion`:
 * X 采集面板的判断依据「只渲染一次关掉就没」,核对只能反过来要用户截图,
 * 被点破「**你不记录如何做验证**」。
 * ⭐ 而那条还有后半句:**成功路径也要留痕**,不只失败。
 *
 * ⚠️ 本节钉的是「验证能力」本身 —— 断了的症状不是报错,
 * 而是**下次又只能靠截图**,很难察觉。
 */
describe('⭐⭐ 捕获留痕:让验证不靠人截图', () => {
  const src = (): string => ipcDom;

  it('⭐ 接线这一步要留痕 —— 它是最靠前的线索', () => {
    /**
     * ⚠️ 没接上的话后面三个数全是 0,而那时人分不清
     * 「没接上」与「页面没动」。两件事记下来才分得开。
     */
    const s = src();
    const i = s.indexOf("case 'captureStart'");
    const body = s.slice(i, s.indexOf("case 'captureStop'", i));
    expect(body.length, '切片是空的').toBeGreaterThan(80);
    expect(body, '接线没留痕 —— 后面全 0 时分不清是没接上还是页面没动')
      .toMatch(/webrequest-side-wired/);
  });

  it('⭐⭐ attach 成功与失败**都要**留痕', () => {
    /**
     * ⚠️ 只记失败的话,「成功了但一条没捕到」这种最难查的情况
     * 反而没有起点 —— 用户定的是**成功路径也要留痕**。
     */
    const s = src();
    const i = s.indexOf("case 'captureStart'");
    const body = s.slice(i, s.indexOf("case 'captureStop'", i));
    expect(body, 'attach 结果没留痕').toMatch(/traceRecorder\.lifecycle\s*\(/);
    expect(body, '只记了失败 —— 成功路径也要留痕')
      .toMatch(/capture-start.*capture-attach-failed|attached \?/s);
  });

  it('⭐⭐ 停捕时把**三个数**写进留痕', () => {
    /**
     * ⚠️ 这是「这一轮到底捕到了什么」唯一能离开 renderer 的地方。
     * ⭐ 三个数必须都在 —— 只写 captured 的话,
     * 「通道哑了」(noBody)这个最该留的信号恰好丢了。
     */
    const s = src();
    const i = s.indexOf("case 'captureStop'");
    expect(i, 'captureStop 分支不见了').toBeGreaterThan(-1);
    const branch = s.slice(i, s.indexOf("case 'captureStats'", i));
    expect(branch.length, '切片是空的').toBeGreaterThan(80);

    /**
     * ⚠️⚠️ **必须切到 `traceRecorder.lifecycle(...)` 的参数里** ——
     * 注入验证抓到:切整个 branch 时,同一段里的
     * `console.log(\`…captured=\${st.captured}…\`)` 把断言全兜住了,
     * 于是**把整段 traceRecorder 删掉照样全绿**。
     * 正是 `feedback-guard-scope-to-the-branch`:同一 token 在切片里出现多次。
     * ⭐ console.log 只打在终端,进程一关就没 —— 它顶不了落盘的活。
     */
    const call = branch.indexOf('traceRecorder.lifecycle');
    expect(call, '停捕时压根没调 traceRecorder —— 这一轮的数就只能靠截图了')
      .toBeGreaterThan(-1);
    const argsEnd = branch.indexOf('});', call);
    expect(argsEnd, 'traceRecorder 调用没收尾').toBeGreaterThan(call);
    const args = branch.slice(call, argsEnd);
    expect(args.length, '切出来的参数是空的 —— 断言会恒真').toBeGreaterThan(60);

    for (const field of ['captured', 'noBody', 'bodyLost', 'channelFailures']) {
      expect(args, `停捕留痕里少了 ${field} —— 这个信号就只能靠截图了`)
        .toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('⭐⭐ 首次捕到就留痕 —— 人可能忘了点停', () => {
    /**
     * ⚠️ 只在停捕时写的话,人忘了点停(或直接关面板)
     * 这一轮**一个字都不会留下** —— 又回到只能靠截图。
     */
    /** ⭐ `sessionFor` 搬进了采集引擎(3a)—— 读那个文件 */
    const s = engine;
    expect(s, '没有首次捕获留痕 —— 人忘了点停这一轮就全没了')
      .toMatch(/capture-first-payload/);
    // ⭐ 且它必须接在会话上,不是写了个常量就算
    expect(s, '首次捕获回调没传给 CaptureSession')
      .toMatch(/new CaptureSession\s*\(\s*netBus\s*,\s*pageId\s*,/);
  });

  it('⚠️ 读留痕的工具必须在 —— 否则记了也读不到', () => {
    /**
     * ⭐ 「记录」与「读得到」是两件事。
     * 本仓栽过的 `feedback-log-where-the-human-looks` 是打错地方,
     * 这条防的是**没有读的办法**:落盘了但没人知道怎么看,等于没记。
     */
    const tool = resolveFromRoot('scripts/web-trace.mjs');
    expect(existsSync(tool), '读留痕的脚本没了 —— 落盘的数据就没人读得到').toBe(true);
    const code = readFileSync(tool, 'utf-8');
    // ⚠️ 路径必须与 runtime.ts 的 traceRoot() 一致,否则读的是空目录
    expect(code, '脚本没去 userData 下找 —— 会读到空目录').toContain('krig-data/web-trace');
  });
});

/**
 * ⭐⭐⭐ 「开始收」必须从**干净的池子**开始 —— 2026-10-04 真机
 *
 * `start()` 只订阅、不清上一轮攒的内容(那是它的契约)。
 * 所以**清空这件事必须由 `startAll` 做** —— 它才知道「新一轮开始了」。
 * ⚠️ 漏了这一步的后果是**静默串轮**:逐篇补长文时每一篇都把前面
 * 那些页的载荷当成自己的,报「解出 42 条推文但都没正文」,
 * 而且挤爆池子让总数从 97 掉到 40。
 *
 * ⭐ 判据钉在 `startAll` 这个函数体里,不是整文件找 `clearPayloads`
 * (`feedback-guard-scope-to-the-branch`:整文件 toMatch 必然假绿 ——
 * 手动的 `captureClear` 分支里也有这个词)。
 */
describe('⭐⭐⭐ 开始收之前先清空', () => {
  it('⭐⭐⭐ `startAll` 里**真的**调了 clearPayloads', () => {
    /** ⭐ `makeAcquireDeps`(含 startAll)2026-10-13 搬进采集引擎(3a)—— 读那个文件 */
    const src = engine;
    const i = src.indexOf('async startAll(');
    expect(i, 'startAll 不见了 —— 本条要重写').toBeGreaterThan(-1);
    /** ⚠️ 切到函数体结束(下一个顶层成员)为止,别把整文件圈进来 */
    const end = src.indexOf('\n    },', i);
    expect(end, '切不出 startAll 的函数体').toBeGreaterThan(i);
    const body = src.slice(i, end);
    expect(body.length, '切片空了 —— 断言会恒真').toBeGreaterThan(100);

    expect(
      body,
      'startAll 没清上一轮的载荷 —— 下一轮会把上一轮的当成自己的（静默串轮）',
    ).toContain('clearPayloads');
    /** ⭐ 顺序也要钉:清要在 start 之前,否则清掉的可能是刚收到的 */
    expect(
      body.indexOf('clearPayloads'),
      '清空排在 start() 之后 —— 可能把这一轮刚收到的清掉',
    ).toBeLessThan(body.indexOf('cap.start()'));
  });
});

/**
 * ⭐⭐⭐ 采完要能读出**收到的是什么** —— 2026-10-04
 *
 * 配方搜索滚了 60 轮 39983px,却只有 1 条时间线载荷。
 * ⚠️ 而我**读不出那 40 条响应里都是些什么** —— 只能回头猜。
 * ⭐ 这正是 2026-10-02 补过的那条(「我知道捕到 37 条,却不知道捕到的是什么」),
 * `harvest` 取代手动流程时**漏带了** —— 同一个教训第二次。
 */
describe('⭐⭐⭐ harvest 留痕要带「收到的是什么」', () => {
  it('⭐⭐⭐ 留痕里有端点清单,不只有条数', () => {
    /**
     * ⭐ 2026-10-13(3a):留痕从 case 里原样抽进 `collect-trace.ts` 的 `traceHarvest`,
     * 让 renderer(经 IPC)与主进程直接调用(X 人卡 / 后台 runner)打**同一份**。
     * ⚠️ 所以判据拆两段,缺一段都会让「端点清单」静默消失:
     *   ① harvest 分支**真的调了** traceHarvest
     *   ② traceHarvest 函数体里**真的有**端点清单
     */
    const src = strip(readFileSync(join(ROOT, 'src/platform/main/web-capability/wiring/ipc-dom.ts'), 'utf-8'));
    const i = src.indexOf("case 'harvest':");
    expect(i, "harvest 分支不见了 —— 本条要重写").toBeGreaterThan(-1);
    const end = src.indexOf('case ', i + 10);
    const branch = src.slice(i, end > i ? end : undefined);
    expect(branch.length, '切片空了 —— 断言会恒真').toBeGreaterThan(40);
    expect(branch, 'harvest 分支没打留痕 —— 采完不知道收到了什么').toMatch(/traceHarvest\s*\(/);

    const trace = strip(readFileSync(join(ROOT, 'src/platform/main/web-capability/wiring/collect-trace.ts'), 'utf-8'));
    const t = trace.indexOf('export function traceHarvest(');
    expect(t, 'traceHarvest 不见了 —— 本条要重写').toBeGreaterThan(-1);
    const body = trace.slice(t, trace.indexOf('\n}', t));
    expect(body.length, '切片空了 —— 断言会恒真').toBeGreaterThan(200);

    expect(
      body,
      'harvest 留痕只记条数不记端点 —— 「采到 40 条」却不知道是些什么,查不动',
    ).toContain('endpoints');
    /** ⚠️ 不许记完整 URL(带长 queryId)——只记路径尾段 */
    expect(
      body,
      '把完整 URL 写进留痕了 —— queryId 很长且可能含敏感参数',
    ).not.toMatch(/endpoints[\s\S]{0,200}it\.url[,)]/);
  });
});

/**
 * ⭐⭐⭐ 噪音名单**两条腿都要给** —— 2026-10-04 真机
 *
 * 配方搜索滚 60 轮只采到 1 页。端点清单一看:47 条响应里
 * **19 条是 `.m3u8`**,把 64 条的池子挤爆,真正的 SearchTimeline 只剩 1 条。
 * ⚠️⚠️ 而 `video.twimg.com` **本来就在噪音名单里** ——
 * 名单只接到了 CDP 腿,**M4 页面钩子这条腿压根没接**。
 *
 * ⚠️ 这一处 **tsc 查不出来**(HookSession 第四参可选),
 * 行为测试也盖不住(那测的是 HookSession 本身,不是这里有没有传)——
 * 所以必须有这条守卫。
 */
describe('⭐⭐⭐ 噪音名单两条腿都要接', () => {
  it('⭐⭐⭐ `startAll` 把名单**同时给** CDP 腿和钩子腿', () => {
    /** ⭐ `makeAcquireDeps`(含 startAll)2026-10-13 搬进采集引擎(3a)—— 读那个文件 */
    const src = engine;
    const i = src.indexOf('async startAll(');
    expect(i, 'startAll 不见了 —— 本条要重写').toBeGreaterThan(-1);
    const end = src.indexOf('\n    },', i);
    const body = src.slice(i, end > i ? end : undefined);
    expect(body.length, '切片空了 —— 断言会恒真').toBeGreaterThan(200);

    /** ① CDP 腿 */
    expect(body, 'CDP 腿没收到噪音名单').toMatch(/noisyUrlSubstrings:\s*noisy/);
    /** ② 钩子腿 —— ⚠️ 正是这条漏了才有 19 条 m3u8 */
    /**
     * ⚠️ 别用 `[^)]*` —— 它会停在 `toHookHost(wc)` 的那个右括号上,
     * 于是**代码是对的也判红**(写这条时当场栽了一次)。
     * ⭐ 改成「同一行里有 HookSession 且有 noisy」。
     */
    const hookLine = body.split('\n').find((l) => l.includes('new HookSession('));
    expect(hookLine, 'startAll 里没有 new HookSession —— 本条要重写').toBeTruthy();
    expect(
      hookLine,
      '钩子腿没收到噪音名单 —— 视频分片会把池子挤爆（真机 47 条里 19 条 m3u8）',
    ).toContain('noisy');
  });

  /**
   * ⚠️ 名单变了要**重建**钩子 —— 否则改了配置不生效,
   * 而且**一点症状都没有**(看起来仍在采,只是噪音照样进来)。
   */
  it('⚠️ 名单变了要重建钩子,不复用旧的', () => {
    /** ⭐ `makeAcquireDeps`(含 startAll)2026-10-13 搬进采集引擎(3a)—— 读那个文件 */
    const src = engine;
    const i = src.indexOf('async startAll(');
    const body = src.slice(i, src.indexOf('\n    },', i));
    expect(
      body,
      '钩子只按「有没有」复用 —— 名单换了也不重建,改了配置不生效',
    ).toMatch(/sameList\(/);
  });
});
