/**
 * `web.net` 边界守卫 —— 扫源码,守「业务方永不 attach/detach」这条(prompt §7)
 *
 * 这条一旦破了**不会报错**,只会让「A 结束时 detach 把共用的 B 掐掉」那个 bug
 * 原样复活。所以必须机器强制,不能靠约定 —— X 现在那 8 处正是靠注释约定,而它失效了。
 *
 * ⚠️ 本仓踩过两次的坑(`07` §0.2 第 3 条):**守卫比对源码前先剥注释**。
 * 本文件的被测源码注释里大量出现 `detach`(在解释那个 bug),不剥就永远红。
 * 所以下面第一组是**守卫自检**:先证明剥注释真的在工作。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NET_DIR = join(process.cwd(), 'src/platform/main/web-capability/net');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const sources = listSources(NET_DIR).map((path) => ({
  path: path.replace(process.cwd() + '/', ''),
  code: stripComments(readFileSync(path, 'utf-8')),
}));

describe('守卫自检 —— 先证明剥注释真的在工作', () => {
  it('源码注释里确实大量出现 detach(否则这守卫是空转的)', () => {
    const raw = listSources(NET_DIR).map((p) => readFileSync(p, 'utf-8')).join('\n');
    expect(raw).toMatch(/detach/);
  });

  it('stripComments 能剥行注释与块注释,但不动真代码', () => {
    expect(stripComments('const a = 1; // detach')).not.toContain('detach');
    expect(stripComments('/* detach */ const a = 1;')).not.toContain('detach');
    expect(stripComments('dbg.detach();')).toContain('detach');
  });

  it('剥完注释后源码非空', () => {
    for (const { path, code } of sources) {
      expect(code.trim().length, `${path} 剥注释后成空文件`).toBeGreaterThan(0);
    }
  });
});

describe('⭐⭐ 本层源码零处调用 detach', () => {
  it('⭐ 不出现 .detach( 调用 —— provider 装上就不撤(单一持有者)', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      if (/\.detach\s*\(/.test(code)) offenders.push(path);
    }
    expect(
      offenders,
      '单一持有者模型:装上就不 detach。有 detach 就有「关错灯」的可能(`04` §2)',
    ).toEqual([]);
  });

  it('⭐ DebuggerLike 接口不暴露 detach —— 上层拿不到关灯的能力', () => {
    const bodyProvider = sources.find((s) => s.path.endsWith('body-provider.ts'))!;
    const ifaceStart = bodyProvider.code.indexOf('export interface DebuggerLike');
    const ifaceEnd = bodyProvider.code.indexOf('}', ifaceStart);
    const iface = bodyProvider.code.slice(ifaceStart, ifaceEnd);
    expect(iface.length).toBeGreaterThan(0);
    expect(iface).not.toMatch(/detach\s*\(/);
  });

  it('⭐ 不出现引用计数的痕迹(`04` §2 已否决)', () => {
    // ⚠️ 只打真正的引用计数变量,不能误伤只读的诊断计数器:
    // 本层有个 `subscriberCount(pageId)` 是给测试/诊断读数用的,它**不驱动任何 detach 决策**。
    // 引用计数的特征是「有人走就减一,减到 0 就关灯」—— 所以打的是**自减**与 refCount 这类命名。
    for (const { path, code } of sources) {
      expect(code, `${path} 出现引用计数变量`).not.toMatch(/\brefCount\b|\breferenceCount\b|\battachCount\b/i);
      expect(code, `${path} 出现「减到 0 就关灯」的自减`).not.toMatch(/(?:Count|count)\s*(?:--|-=)/);
    }
  });

  it('本层零 electron 依赖(纯逻辑 + 注入接口,可完全单测)', () => {
    const offenders = sources
      .filter(({ code }) => /from\s+['"]electron['"]/.test(code))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe('⭐ 噪音名单不得硬编码在底座(`04` §3.1)', () => {
  it('源码里不出现具体站点域名', () => {
    // V1 的 session-capture.ts:31 硬编码了 s-cdn.anthropic.com/images/
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      for (const site of ['anthropic.com', 'openai.com', 'x.com', 'twitter.com', 'google.com', 'claude.ai']) {
        if (code.includes(site)) offenders.push(`${path} 硬编码了 ${site}`);
      }
    }
    expect(offenders, '站点适配不进底层 —— 噪音名单由调用方以参数给').toEqual([]);
  });
});

describe('⭐ 通道故障不许被过滤掉', () => {
  it('ALWAYS_DELIVERED 里含 channel-failed 与 channel-lost', () => {
    // 若让失聪告警被 kinds 过滤掉,等于把告警本身也静默了,这层就白做了
    const bus = sources.find((s) => s.path.endsWith('bus.ts'))!;
    const start = bus.code.indexOf('ALWAYS_DELIVERED');
    const chunk = bus.code.slice(start, start + 200);
    expect(chunk).toContain('channel-failed');
    expect(chunk).toContain('channel-lost');
  });
});
