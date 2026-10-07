/**
 * `web.dom` 边界守卫 —— AI 侧零裸 `executeJavaScript`(`07` §2.3 #3)
 *
 * 守的是**注入点收口**:脚本文本只能来自预注册表,不能在业务代码里现拼。
 * 这条一旦破了不会报错 —— 只会让转义事故的攻击面重新打开
 * (`project-x-inject-template-escape`:tsc 通过、单测通过、看源码也没问题,
 *  错的是**求值之后**的样子,采集恒 0 一整天)。
 *
 * ⚠️ 本仓踩过两次:**守卫比对源码前先剥注释**(`07` §0.2 陷阱 3)。
 * 本文件的被测源码注释里就写着 `executeJavaScript`,不剥会永远红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/source-scan';
// ⚠️ 剥注释一律用共享的字符状态机版(tests/helpers/source-scan.ts)。
// 本文件原先手写 `.replace(/\/\/.*$/gm, '')`:遇到 `'https://…'` 会把 URL 连同
// 同一行后面的真代码一起吃掉 → 违规藏在那一行就查不到(2026-09-30 注入实测全绿)。

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const AI_DIR = join(process.cwd(), 'src/platform/main/ai');
const aiSources = listTs(AI_DIR).map((p) => ({
  path: p.replace(process.cwd() + '/', ''),
  code: stripComments(readFileSync(p, 'utf-8')),
}));

describe('守卫自检 —— 先证明剥注释真的在工作', () => {
  it('AI 侧注释里确实提到 executeJavaScript(否则守卫空转)', () => {
    const raw = listTs(AI_DIR).map((p) => readFileSync(p, 'utf-8')).join('\n');
    expect(raw).toMatch(/executeJavaScript/);
  });

  it('stripComments 剥行注释与块注释,但不动真代码', () => {
    expect(stripComments('a(); // executeJavaScript')).not.toContain('executeJavaScript');
    expect(stripComments('/* executeJavaScript */ a();')).not.toContain('executeJavaScript');
    expect(stripComments('wc.executeJavaScript(x);')).toContain('executeJavaScript');
    // 字符串里的 // (URL)后面的真代码必须留下 —— 正则版在这里会把它吃掉
    expect(stripComments("const u = 'https://x.com'; executeJavaScript();")).toContain('executeJavaScript();');
  });
});

describe('⭐ interceptor.ts 零裸 executeJavaScript(步 4 迁移的核心判据)', () => {
  it('⭐⭐ interceptor 里不再直接调 executeJavaScript', () => {
    const f = aiSources.find((s) => s.path.endsWith('ai/interceptor.ts'));
    expect(f).toBeDefined();
    expect(
      f!.code,
      'interceptor 的注入必须走 web.dom 预注册脚本(转义事故的类型层面根治)',
    ).not.toMatch(/executeJavaScript/);
  });

  it('⭐ interceptor 用的是脚本 id 常量,不是脚本字符串', () => {
    const f = aiSources.find((s) => s.path.endsWith('ai/interceptor.ts'))!;
    expect(f.code).toMatch(/AI_SCRIPTS\./);
    expect(f.code).toMatch(/domRunner\.run\(/);
  });

  it('⭐ 未动 Gemini 链路(步 3 的成果)', () => {
    const f = aiSources.find((s) => s.path.endsWith('ai/interceptor.ts'))!;
    // 步 3 迁移的标志物必须还在
    expect(f.code).toMatch(/netBus\.subscribe\(/);
    expect(f.code).toMatch(/bodyProvider\.attach\(/);
    // 且 Gemini 仍不注入页面脚本(它走 CDP 网络层)
    expect(f.code).toMatch(/profile\.id !== 'gemini'/);
  });
});

describe('⭐ 脚本文本只在 inject-scripts/ 里(不许在业务代码现拼)', () => {
  /**
   * ⚠️ **已知债清单**(步 4 范围外,`08` §1.2 的「逐个消费者迁移」)。
   *
   * 这些文件仍在业务代码里现拼注入脚本。步 4 的范围是
   * **ChatGPT / Claude 的注入 hook**(即 `interceptor.ts` 那几处),
   * 已全部迁完;下面这些属于**提取时**的一次性脚本,分属不同消费者:
   *
   *   - gemini-*        → 步 3 已迁网络层,但**提取时的 DOM 脚本没迁**(本步不动 Gemini)
   *   - claude / chatgpt-extract-turn → 单条提取链路,与整页提取是两条路
   *   - ai-sync-orchestrator / writer → 消费者侧
   *
   * ⭐ `chatgpt-full-extraction.ts` **本步已出清单** —— 它的三段内联脚本
   * 已搬进 inject-scripts/ 并注册进 web.dom(步 4 的直接成果)。
   *
   * ⭐ 清单**只减不增**:下面那条「已修好的必须从清单删掉」的用例会强制这一点。
   * 这是本仓已验证有效的范式(见 `tests/views/slot-resource-guard.test.ts` 的 KNOWN_DEBT)。
   */
  const KNOWN_DEBT = [
    'src/platform/main/ai/ai-sync-orchestrator.ts',
    'src/platform/main/ai/extractors/claude-api-extractor.ts',
    'src/platform/main/ai/extractors/gemini-conversation-query.ts',
    'src/platform/main/ai/extractors/gemini-full-extraction.ts',
    'src/platform/main/ai/writer.ts',
  ];
  /**
   * ⭐ 2026-09-30 **还掉三条**(L2 收口第 2 批):
   * `chatgpt-extract-turn` / `claude-extract-turn` / `gemini-extract-turn`
   * 的「按坐标定位第几条」已收进 `web.dom` 预注册表(`dom/locate-scripts.ts`),
   * 三份实现合一(前两份原本**逐字节相同**,只差 selector 常量)。
   *
   * ⭐ 是本守卫**自己发现**它们已修好并要求删的 ——
   * 「只减不增」这条规则在这次真正起了作用,不是摆设。
   */

  /** 现在还在现拼脚本的文件 */
  function currentOffenders(): string[] {
    const out: string[] = [];
    for (const { path, code } of aiSources) {
      if (path.includes('/inject-scripts/')) continue;   // 脚本本体就该在这里
      if (/`\s*\(\s*(?:async\s+)?function\s*\(/.test(code)) out.push(path);
    }
    return out;
  }

  it('⭐⭐ 已知债之外零命中 —— 新代码不许再现拼脚本', () => {
    const unexpected = currentOffenders().filter((p) => !KNOWN_DEBT.includes(p));
    expect(
      unexpected,
      '新增的注入脚本必须走 inject-scripts/ + web.dom 注册(防转义事故复发)',
    ).toEqual([]);
  });

  it('⭐ 已知债清单只减不增 —— 修好一个就要删一条', () => {
    const stale = KNOWN_DEBT.filter((p) => !currentOffenders().includes(p));
    expect(
      stale,
      '这些已不再现拼脚本,请从 KNOWN_DEBT 删掉(清单必须与现实精确对齐,\n' +
      '否则它会在下一处真违规出现时误放行):\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ interceptor.ts 已不在债清单里(步 4 迁完了它)', () => {
    expect(currentOffenders()).not.toContain('src/platform/main/ai/interceptor.ts');
    expect(KNOWN_DEBT).not.toContain('src/platform/main/ai/interceptor.ts');
  });
});

describe('⭐ 解析失败不静默丢(`07` §2.3 #4)', () => {
  it('domRunner 失败时记 degradation', () => {
    const runner = readFileSync(
      join(process.cwd(), 'src/platform/main/web-capability/wiring/electron-dom.ts'), 'utf-8',
    );
    const code = stripComments(runner);
    expect(code).toMatch(/recorder\?\.degradation\(/);
    // 且**两条**失败路径都要留痕:构建期 + 执行期
    expect((code.match(/degradation\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('⭐ 失败信息不写猜测(那次事故的日志把「多半撞上导航」当结论)', () => {
    const runner = stripComments(readFileSync(
      join(process.cwd(), 'src/platform/main/web-capability/wiring/electron-dom.ts'), 'utf-8',
    ));
    // 代码里(剥注释后)不许出现这类推测性措辞
    expect(runner).not.toMatch(/多半|大概|可能是|probably/);
  });
});
