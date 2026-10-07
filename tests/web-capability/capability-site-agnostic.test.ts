/**
 * ⭐⭐⭐ **能力层不许认识任何站点** —— 跨全层的一条铁律
 *
 * ── 用户 2026-10-02 ──
 * 「一定要注意能力分层,如果是**底层的活**,一定要把函数放在底层,
 * 　以后**大家共用**,**x 的活才放在 x 中**。」
 *
 * ⭐ 判据不是「X 能不能用」,而是:
 * **换一个社区/论坛/开放媒体,这层能不能原样拿去用?**
 *
 * ── ⚠️ 为什么要守卫而不是靠自觉 ──
 *
 * 本仓已经栽过:`session-capture.ts:31` **硬编码**了
 * `s-cdn.anthropic.com/images/` —— Claude 的站点适配漏进了底层
 * (`body-provider.ts` 的注释专门记着这条:「本层不重蹈」)。
 * ⚠️ 这种东西**不会报错**:它只是让底层对别的站点悄悄少干一点活,
 * 下一个接论坛的人根本不知道为什么漏了几条。
 *
 * ── ⭐ 目录清单从**真实结构**推导,不写死 ──
 *
 * ⚠️ `feedback-guard-hardcoded-list-never-grows` 已栽过五次:
 * 写死目录名的话,我今天加的 `acquire/` `hook/` 两个新目录
 * **天然在守卫视野之外**。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/source-scan';

const CAP = join(process.cwd(), 'src/platform/main/web-capability');

/**
 * ⭐ 能力层的子目录 —— **从磁盘读**,不写死。
 * ⚠️ `wiring/` 除外:它是**唯一允许碰 Electron 的接缝**,
 * 但它同样不许认识站点(下面单独扫)。
 */
function capabilityDirs(): string[] {
  return readdirSync(CAP, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(full));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * ⭐⭐ 站点特征 —— 命中就说明**业务知识漏进了底层**。
 *
 * ⚠️ 只列**具体站点**的标志,不列通用词:
 * 「graphql」「timeline」是通用概念(任何站点都可能有),
 * 而 `x.com` / `HomeTimeline` / `s-cdn.anthropic.com` 是**某一家的**。
 */
const SITE_MARKERS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /\bx\.com\b/i, what: 'X 的域名' },
  { re: /\btwitter\.com\b/i, what: 'Twitter 的域名' },
  { re: /\btwimg\.com\b/i, what: 'X 的 CDN 域名' },
  { re: /\bHomeTimeline\b/, what: 'X 的 GraphQL 操作名' },
  { re: /\bUserTweets\b|\bSearchTimeline\b|\bUserByScreenName\b/, what: 'X 的 GraphQL 操作名' },
  { re: /\banthropic\.com\b/i, what: 'Claude 的域名（本仓栽过的那次）' },
  { re: /\bchatgpt\.com\b|\bopenai\.com\b/i, what: 'ChatGPT 的域名' },
  { re: /\bgemini\.google\.com\b/i, what: 'Gemini 的域名' },
  { re: /\bdata-testid\s*=\s*["'][a-z]/i, what: '某站点的 DOM 选择器' },
];

describe('⭐⭐⭐ 能力层不许认识任何站点', () => {
  it('⭐ 先确认扫到了东西 —— 否则下面全是空转', () => {
    const dirs = capabilityDirs();
    expect(dirs.length, '一个子目录都没扫到 —— 路径错了?').toBeGreaterThan(4);
    // ⭐ 新目录必须自动在列 —— 这条同时验证「清单不是写死的」
    expect(dirs, 'acquire 层不在扫描范围 —— 清单写死了?').toContain('acquire');
    expect(dirs, 'hook 层不在扫描范围').toContain('hook');
  });

  it('⭐⭐⭐ 每个子目录的**代码**里都不许出现站点标志', () => {
    /**
     * ⚠️ **剥注释后再扫** —— 注释里举例说明「X 要的是 /i/api/graphql/」
     * 是有价值的文档,不该被当成违规;而代码里出现才是真问题。
     * ⭐ 用共享的字符状态机版剥:手写 `//.*$` 会把
     * `'https://…'` 里的双斜杠当注释,**把后面的真代码一起吃掉**
     * (`feedback-guard-stripper-eats-urls` 实测 57 条全绿)。
     */
    const violations: string[] = [];
    for (const dir of capabilityDirs()) {
      for (const file of listSources(join(CAP, dir))) {
        const code = stripComments(readFileSync(file, 'utf-8'));
        for (const m of SITE_MARKERS) {
          if (m.re.test(code)) {
            violations.push(`${file.slice(process.cwd().length + 1)} —— ${m.what}`);
          }
        }
      }
    }
    expect(
      violations,
      '⭐ 站点知识漏进了能力层 —— 它该放在 `src/modules/<站点>/`:\n  '
      + violations.join('\n  ')
      + '\n⚠️ 判据:换一个论坛,这层能不能原样拿去用?',
    ).toEqual([]);
  });

  it('⭐⭐ 能力层不许 import 任何业务模块', () => {
    /**
     * ⚠️ 比字符串更硬的一条:哪怕没写死域名,
     * `import { X_ANCHORS } from '@modules/x/...'` 一样是把底层绑死在 X 上。
     */
    const violations: string[] = [];
    for (const dir of capabilityDirs()) {
      for (const file of listSources(join(CAP, dir))) {
        const code = stripComments(readFileSync(file, 'utf-8'));
        const bad = Array.from(code.matchAll(/from\s+['"]([^'"]*(?:@modules\/|@views\/)[^'"]*)['"]/g));
        for (const b of bad) {
          violations.push(`${file.slice(process.cwd().length + 1)} → ${b[1]}`);
        }
      }
    }
    expect(
      violations,
      '能力层 import 了业务模块 —— 方向反了,底层该用**注册表**让业务 push 进来:\n  '
      + violations.join('\n  '),
    ).toEqual([]);
  });

  it('⚠️ 剥注释真的在工作 —— 否则上面两条会假绿/假红', () => {
    /**
     * ⭐ 自检:给 strip 喂一段「注释里有站点名、代码里有 URL」的样本。
     * 剥错了的两种表现都要排除:
     * · 不剥 → 注释里的举例被当违规(**假红**,逼人删有用的文档)
     * · 剥过头 → `'https://…'` 后面的真代码被吃掉(**假绿**)
     */
    const sample = [
      '// X 要的是 x.com 这个域名',
      'const u = "https://example.com/a"; const marker = "HomeTimeline";',
    ].join('\n');
    const out = stripComments(sample);
    expect(out, '注释没被剥掉 —— 文档里的举例会被误判成违规').not.toContain('X 要的是');
    expect(out, 'URL 后面的真代码被吃掉了 —— 违规藏在那一行就查不到')
      .toContain('HomeTimeline');
  });
});

describe('⭐⭐ 反过来:X 的活必须在 X 里', () => {
  /**
   * 用户:「如果是**底层的活**,一定要把函数放在底层,以后**大家共用**,
   * 　**x 的活才放在 x 中**」。
   *
   * ── ⚠️ 判据要分清两种「含站点名的代码」(第一版没分,抓到两个误报)──
   *
   * ① ⭐ **通用能力层**里出现站点名 = 真违规
   *    (`web-capability` / `web-service-base` / `web-rendering` …)
   *    它们声称「换个站点照样用」,出现 x.com 就是谎言。
   *
   * ② ⚠️ **站点专有的 capability** 里出现 = **不是**违规
   *    `tweet-fetcher` / `tweet-block` 名字里就写着 tweet,
   *    它们服务于 note 的推文嵌入块,与 X 采集模块是两回事。
   *    ⭐ 而且其中一处是**安全白名单**(只许 https://x.com,防 file:// 越权)——
   *    那里的域名是**安全边界**,搬走反而危险。
   *
   * ⭐ 所以守卫钉的是①,不是「全仓除了 modules 都不许有」。
   */

  /** 声称通用、因此不许认识任何站点的那些层 */
  const GENERIC_LAYERS = [
    'src/platform/main/web-capability',
    'src/platform/main/web-service-base',
    'src/capabilities/web-rendering',
    'src/capabilities/content-extraction',
    'src/capabilities/content-ingest',
  ];

  it('⭐⭐⭐ **声称通用的层**里不许出现站点名', () => {
    const violations: string[] = [];
    for (const root of GENERIC_LAYERS) {
      for (const file of listSources(join(process.cwd(), root))) {
        const code = stripComments(readFileSync(file, 'utf-8'));
        for (const m of SITE_MARKERS) {
          if (m.re.test(code)) {
            violations.push(`${file.slice(process.cwd().length + 1)} —— ${m.what}`);
          }
        }
      }
    }
    expect(
      violations,
      '⭐ 通用层里混进了站点知识 —— 它该搬进 `src/modules/<站点>/`:\n  '
      + violations.join('\n  ')
      + '\n⚠️ 判据:换一个论坛,这层能不能原样拿去用?',
    ).toEqual([]);
  });

  it('⭐ 先确认这几层真的扫到了文件 —— 否则上面是空转', () => {
    const counts = GENERIC_LAYERS.map((r) => listSources(join(process.cwd(), r)).length);
    expect(counts.filter((n) => n > 0).length, '一半以上的通用层扫不到文件 —— 路径写错了?')
      .toBeGreaterThanOrEqual(3);
  });

  it('⚠️ 已知的站点专有 capability 单独记账 —— 不可见的债等于不存在', () => {
    /**
     * ⭐ 它们**不算违规**,但记在这里让其一直可见:
     * 数量只许减不许增 —— 增长说明又有人把站点知识散出去了。
     */
    const siteSpecific = new Set<string>();
    for (const root of ['src/platform', 'src/capabilities', 'src/drivers', 'src/views', 'src/slot']) {
      for (const file of listSources(join(process.cwd(), root))) {
        const rel = file.slice(process.cwd().length + 1);
        if (GENERIC_LAYERS.some((g) => rel.startsWith(g))) continue;   // ①已在上面管
        const code = stripComments(readFileSync(file, 'utf-8'));
        if (/\bx\.com\b|\bHomeTimeline\b|\bUserTweets\b/.test(code)) {
          // 记到**目录**粒度 —— 文件数会随重构浮动,目录数才是真信号
          siteSpecific.add(rel.split('/').slice(0, -1).join('/'));
        }
      }
    }
    const dirs = [...siteSpecific].sort();
    expect(
      dirs.length,
      '含 X 站点知识的目录增多了 —— 站点知识在往外散:\n  ' + dirs.join('\n  '),
    ).toBeLessThanOrEqual(4);
  });
});
