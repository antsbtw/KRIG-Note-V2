/**
 * ⭐⭐ pageId → 宿主的反查**必须在每个登记点都接上**(2026-09-15)
 *
 * ── 本仓第三次遇到同一种病 ──
 *
 * | # | 能力 | 症状 |
 * |---|---|---|
 * | 1 | `ready` / `scrollUntil` | 写完了、有测试,但没从 `page/index.ts` 导出 → X 调不到 |
 * | 2 | `recordRequestStart` | 只有测试在调 → webRequest 侧恒空 → 抓画像静默超时 |
 * | 3 | **`ControlEngine` / `InputEngine`** | 四个类都写完了,但**零处 `new`** —— 两个 Host 要的 `WebContentsLookup` 没人提供 |
 *
 * 共同形态:**建好了、测过了、没接线**。单测全绿,因为测试自己造宿主。
 *
 * ⭐ 所以本文件钉的不是「函数存在」,而是:
 *  ① 每个 `pageRegistry.register()` 调用点后面**都**跟了一次 `bindPageHost`
 *     —— 漏掉哪家,哪家就「登记了页面但控制/输入调不动」且不报错
 *  ② 两个引擎在生产代码里**真的被 new 了**
 *  ③ 反查会**验活**(没有人调 `pageRegistry.destroy`,所以只能查询时验)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(full));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const FILES = listSources(SRC).map((p) => ({
  path: p.replace(process.cwd() + '/', ''),
  code: strip(readFileSync(p, 'utf-8')),
}));

describe('⭐⭐ 每个登记点都要绑宿主 —— 漏一家,那家静默失能', () => {
  it('⭐⭐ 调了 pageRegistry.register 的文件,都要调 bindPageHost', () => {
    const registrars = FILES.filter((f) => /pageRegistry\.register\s*\(/.test(f.code));
    // 前提自检:真有人登记页面,否则本守卫空转
    expect(registrars.length, '没有任何文件登记页面 —— 守卫前提不成立').toBeGreaterThan(0);

    const missing = registrars
      .filter((f) => !/bindPageHost\s*\(/.test(f.code))
      .map((f) => f.path);

    expect(
      missing,
      '这些文件登记了页面却没绑宿主 —— 它们的页面「控制/输入」调不动,'
      + '且表现为「没有对应的渲染目标」(看起来像页面关了,实际是没接线):\n  '
      + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 登记点数量与绑定次数对得上(少绑一处也算漏)', () => {
    for (const f of FILES) {
      const regs = (f.code.match(/pageRegistry\.register\s*\(/g) ?? []).length;
      if (regs === 0) continue;
      const binds = (f.code.match(/bindPageHost\s*\(/g) ?? []).length;
      expect(
        binds,
        `${f.path}:登记 ${regs} 次但只绑了 ${binds} 次 —— 有登记点漏绑`,
      ).toBeGreaterThanOrEqual(regs);
    }
  });
});

describe('⭐⭐ 引擎必须真的被 new(不是只写了类)', () => {
  const runtime = FILES.find((f) => f.path.endsWith('web-capability/wiring/runtime.ts'));

  it('⭐⭐ ControlEngine 在生产代码里被构造', () => {
    expect(runtime, 'runtime.ts 不见了').toBeDefined();
    expect(
      runtime!.code,
      'ControlEngine 零处 new —— 能力写完了没人用,与 §15.1 那笔债同形态',
    ).toMatch(/new ControlEngine\s*\(/);
  });

  it('⭐⭐ InputEngine 在生产代码里被构造', () => {
    expect(runtime!.code).toMatch(/new InputEngine\s*\(/);
  });

  it('⭐⭐ 两个引擎拿到的是**同一个** lookup(否则各查各的表)', () => {
    expect(runtime!.code).toMatch(/new ElectronControlHost\(lookupWebContents\)/);
    expect(runtime!.code).toMatch(/new ElectronInputHost\(lookupWebContents\)/);
  });
});

describe('⭐⭐ 反查必须验活 —— 没有人清理页面', () => {
  const seam = FILES.find((f) => f.path.endsWith('wiring/page-hosts.ts'));

  it('⭐⭐ lookup 里检查 isDestroyed 并就地丢弃', () => {
    expect(seam, 'page-hosts.ts 不见了').toBeDefined();
    /**
     * ⚠️⚠️ **只扫 `lookupWebContents` 的函数体**,不扫整个文件。
     *
     * 初版写成扫全文件 `toMatch(/isDestroyed\(\)/)` —— 结果是**假绿**:
     * `unbindPageHost` / `listBoundPages` 里也有 `isDestroyed()`,
     * 于是把 lookup 里的验活整个掏空(改成 `if (false)`),守卫**照样全绿**。
     * 注入验证当场抓到(2026-09-15)。教训与本会话另外五次同源:
     * **守卫的扫描范围必须精确到被守的那段代码**。
     */
    const body = seam!.code.slice(
      seam!.code.indexOf('export function lookupWebContents'),
      seam!.code.indexOf('export function unbindPageHost'),
    );
    expect(body.length, '锚点过时:找不到 lookupWebContents 的函数体').toBeGreaterThan(50);
    expect(
      body,
      '没验活 —— 会把已销毁的 wc 交出去,错误信息指向完全错误的方向',
    ).toMatch(/isDestroyed\(\)/);
    expect(body, '验活了却不丢弃 —— 死对象会越积越多').toMatch(/hosts\.delete\(/);
  });

  it('⭐ 前提仍然成立:没有人调 pageRegistry.destroy(成立才需要验活)', () => {
    // ⚠️ 若将来有人接上了生命周期,这条会红 —— 那是**好事**,
    //    提醒回来把清理改成事件驱动,而不是继续靠查询时兜底。
    const callers = FILES.filter((f) => /pageRegistry\.destroy\s*\(/.test(f.code));
    expect(
      callers.map((f) => f.path),
      '有人开始清理页面了 —— 请回 page-hosts.ts 把清理改成订阅 page-destroyed',
    ).toEqual([]);
  });
});
