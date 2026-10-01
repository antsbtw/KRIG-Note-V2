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
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ipcDom = strip(readFileSync(IPC_DOM, 'utf-8'));

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
    const body = ipcDom.slice(i, ipcDom.indexOf('} catch', i));
    expect(body.length, 'slice 空了 —— 断言会恒真').toBeGreaterThan(50);
    expect(body, 'default 分支没有如实失败').toMatch(/default:[\s\S]*?failed\(/);
  });

  it('⭐⭐ pageRef 解析不出来要失败,绝不兜底到别的页面', () => {
    const i = ipcDom.indexOf('function resolve(');
    expect(i, '没有 resolve').toBeGreaterThan(-1);
    const body = ipcDom.slice(i, ipcDom.indexOf('\n}', i));
    expect(body.length, 'slice 空了').toBeGreaterThan(50);
    // 必须校验 wcId 合法性与 wc 存活
    expect(body, '没校验 wcId').toMatch(/Number\.isInteger/);
    expect(body, '没校验 wc 是否已销毁').toMatch(/isDestroyed/);
    // ⚠️ 绝不出现「挑一个」的兜底
    expect(body, '出现了 activeWs 之类的猜测 —— 底座没资格替业务选页面')
      .not.toMatch(/activeWs|getActive|\[0\]/);
  });

  it('⭐ register 与 bindPageHost 必须成对(漏一个就「调不动且不报错」)', () => {
    expect(ipcDom, '没登记页面').toMatch(/pageRegistry\.register\s*\(/);
    expect(ipcDom, '登记了页面但没绑 wc —— 引擎会说「页面已关闭」而其实是没接线')
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
});
