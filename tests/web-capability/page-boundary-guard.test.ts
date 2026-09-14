/**
 * `web.page` 边界守卫 —— 扫源码,守两条会**静默失效**的约束
 *
 * 1. ⭐ **不变量 3**(`06` §1.5):应用只见页面对象,**永远拿不到 wcId / webContents**。
 *    这条一旦破了不会报错 —— 只会让 `targetWcId` 那套身份透传悄悄复活,
 *    而那正是记忆 `project-ws-instance-isolation-invariant` 记的「一天踩两次」的病根。
 *
 * 2. ⭐ **身份不许拼维度**(`06` §8.1 已否决)。
 *    拼维度的 id 在「同 ws 三个 tab」时会算出同一个 —— 要治的病在方案自身复发。
 *
 * ⚠️ 本仓踩过两次的坑(`07` §0.2 第 3 条):**守卫比对源码前先剥注释**,
 * 否则会被自己写的说明文字骗过 —— 上面那两段注释里就写着 `wcId` 和 `${windowId}:`。
 * 不剥注释的话,这个守卫会**永远红**;剥错了(比如把字符串也当注释)会**永远绿**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src/platform/main/web-capability');

/** 递归收集本层全部 .ts 源码 */
function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * 剥掉行注释与块注释。
 * ⚠️ 简易实现:不处理「字符串里含 // 」的情况。本层源码里没有那种写法,
 * 且下面有一条自检用例专门验证剥注释真的在工作(剥错了它会红)。
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');   // 行尾注释也要剥 —— 只剥整行注释会漏掉 `const a = 1; // wcId`
}

/**
 * ⭐ `wiring/` 是**唯一**允许碰 Electron 的目录(步 3 接线时引入)。
 *
 * 能力层(page / net / trace)必须保持零 electron 依赖 —— 那是它们可完全单测的前提。
 * 但总得有个地方把真 `WebContents` 转成能力层要的形状,那个地方就是 `wiring/`。
 *
 * ⚠️ 这不是给守卫开后门:下面有一条用例专门锁死
 * **「除 wiring/ 外零处 Electron」**,所以这个例外不会悄悄扩大。
 */
const WIRING_DIR = 'web-capability/wiring/';

const allSources = listSources(SRC_DIR).map((path) => ({
  path: path.replace(process.cwd() + '/', ''),
  code: stripComments(readFileSync(path, 'utf-8')),
}));

/** 能力层源码(不含接线层) */
const sources = allSources.filter((s) => !s.path.includes(WIRING_DIR)).map((s) => ({
  path: s.path,
  code: s.code,
}));

describe('守卫自检 —— 先证明剥注释真的在工作', () => {
  it('本层源码里确实存在只出现在注释中的敏感词(否则这个守卫是空转的)', () => {
    // 如果这条红了,说明注释里已经没有 wcId 了 —— 那下面的守卫就不再有区分力,
    // 需要重新设计,而不是删掉。
    const raw = listSources(SRC_DIR).map((p) => readFileSync(p, 'utf-8')).join('\n');
    expect(raw).toMatch(/wcId/);
  });

  it('stripComments 能剥掉行注释与块注释', () => {
    expect(stripComments('const a = 1; // wcId\n')).not.toContain('wcId');
    expect(stripComments('/* wcId */ const a = 1;')).not.toContain('wcId');
    expect(stripComments('const wcId = 1;')).toContain('wcId');
  });

  it('剥完注释后源码非空(没把整个文件剥没)', () => {
    for (const { path, code } of sources) {
      expect(code.trim().length, `${path} 剥注释后成空文件`).toBeGreaterThan(0);
    }
  });
});

describe('⭐ 不变量 3 —— 本层代码零处 wcId / webContents', () => {
  it('源码(剥注释后)不含 wcId / webContents / debugger.attach', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      for (const pattern of [/\bwcId\b/, /\bwebContents\b/, /\bWebContents\b/, /debugger\s*\.\s*attach/]) {
        if (pattern.test(code)) offenders.push(`${path} 命中 ${pattern}`);
      }
    }
    expect(
      offenders,
      '本层不许出现 wcId / webContents —— 应用只见页面对象(`06` §1.5 不变量 3)',
    ).toEqual([]);
  });

  it('⭐ wiring/ 是唯一的 Electron 例外 —— 例外不许扩大', () => {
    // 若将来有人在 net/ 或 page/ 里直接 import electron,上面那条会红;
    // 这条则锁死「例外目录只有 wiring 一个」,防止靠新增豁免目录绕过守卫。
    const electronTouchers = allSources
      .filter(({ code }) => /\bWebContents\b|from\s+['"]electron['"]/.test(code))
      .map(({ path }) => path);
    for (const p of electronTouchers) {
      expect(p, `${p} 碰了 Electron,但它不在 wiring/ 里`).toContain(WIRING_DIR);
    }
    // 且 wiring/ 必须真的存在并确实碰了 Electron —— 否则这条是空转的
    expect(electronTouchers.length).toBeGreaterThan(0);
  });

  it('本层零 electron 依赖(纯逻辑,可完全单测)', () => {
    const offenders = sources
      .filter(({ code }) => /from\s+['"]electron['"]/.test(code))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe('⭐ 身份不许拼维度(`06` §8.1 已否决)', () => {
  it('源码里不出现「用 window/ws/slot/service 拼 id」的模板串', () => {
    const offenders: string[] = [];
    for (const { path, code } of sources) {
      // 形如 `${windowId}:${wsId}:...` —— 拼维度身份的特征
      if (/`\$\{[^}]*(window|ws|slot|service|tab)[^}]*\}:/i.test(code)) {
        offenders.push(path);
      }
    }
    expect(offenders, '身份不许由维度拼出(`06` §8.1)').toEqual([]);
  });

  it('mintPageId 不读取任何页面事实(签名零参数)', () => {
    const registry = sources.find((s) => s.path.endsWith('page-registry.ts'));
    expect(registry).toBeDefined();
    // 零参数 = 它不可能把维度拼进 id
    expect(registry!.code).toMatch(/function mintPageId\(\)\s*:\s*PageId/);
  });
});

describe('⭐ 底座不做判断(`06` §0)', () => {
  it('find 的实现里没有排序 / 取首个 / 择优', () => {
    const registry = sources.find((s) => s.path.endsWith('page-registry.ts'))!;
    const findBody = registry.code.slice(
      registry.code.indexOf('find(query'),
      registry.code.indexOf('list()'),
    );
    expect(findBody.length).toBeGreaterThan(0);
    for (const banned of [/\.sort\(/, /\.slice\(0,\s*1\)/, /\[0\]/, /\.find\(/]) {
      expect(findBody, `find 不许替调用方挑(命中 ${banned})`).not.toMatch(banned);
    }
  });

  it('本层不含「最后 navigate 胜出」那类择优逻辑的痕迹', () => {
    for (const { path, code } of sources) {
      expect(code, `${path} 出现 lastNavigated 之类的择优状态`).not.toMatch(/lastNavigat|mostRecent|preferred/i);
    }
  });
});
