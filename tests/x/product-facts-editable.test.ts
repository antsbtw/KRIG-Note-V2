/**
 * ⭐⭐ **产品事实清单可编辑** —— 用户 2026-09-26:
 * > 「这个需要增加，而且产品描述给好格式，我要及时更新的。」
 *
 * ⚠️ 清单原来写死在 `x-reply-facts.ts`,改一次要重新编译打包。
 *
 * ⚠️⚠️ 本文件钉的核心是**「改了能不能真的生效」** ——
 * 本仓最贵的一类 bug 就是「类型有、UI 有、消费层零消费」的死配置:
 * 面板上改得好好的,模型还在用旧口径,而且**不报错**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGenerationPrompt, buildSingleReplyPrompt, PRODUCT_FACTS,
  type ProductFacts,
} from '@shared/types/x-reply-facts';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 一份和默认值**处处不同**的口径 —— 用它才能看出到底有没有生效 */
const CUSTOM: ProductFacts = {
  productName: 'ZZTestProduct',
  direction: 'ZZ方向：只出不进',
  trial: 'ZZ试用：14 天 99GB',
  platforms: 'ZZ平台：只有安卓',
  accountSharing: 'ZZ共享：一个账号只能一台',
  paymentNote: 'ZZ支付：只收比特币',
  forbidden: ['ZZ禁止甲', 'ZZ禁止乙'],
};

describe('⭐⭐ 改了口径要真的进 prompt（不是死配置）', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`⭐⭐ 批量生成 prompt 用传进去的口径（${lang}）`, () => {
      const p = buildGenerationPrompt(lang, 'https://x.test/a', [], CUSTOM);
      /** ⚠️ 逐项都钉:只钉产品名的话,漏传某一项也发现不了 */
      for (const [k, v] of Object.entries(CUSTOM)) {
        if (Array.isArray(v)) {
          for (const one of v) {
            expect(p, `forbidden「${one}」没进 prompt —— 模型不知道这条不能说`).toContain(one);
          }
        } else {
          expect(p, `${k} 没进 prompt —— 面板改了也没用`).toContain(v);
        }
      }
    });

    it(`⭐⭐ 单条 prompt 用传进去的口径（${lang}）`, () => {
      const p = buildSingleReplyPrompt(lang, 'https://x.test/a', [], undefined,
        undefined, false, CUSTOM);
      expect(p, '产品名没进单条 prompt').toContain(CUSTOM.productName);
      expect(p, '支付口径没进单条 prompt').toContain(CUSTOM.paymentNote);
      expect(p, '试用口径没进单条 prompt').toContain(CUSTOM.trial);
    });

    it(`⚠️ 传了自定义口径就**不许**再出现默认值（${lang}）`, () => {
      /**
       * ⚠️ 这条钉的是「写死的残留」:英文块原来把事实**硬编码在模板字符串里**
       * (7-day 10GB / no WeChat / Alipay …),只改中文块的话,
       * 英文回复会继续用旧口径 —— 而用户改的时候完全看不出来。
       */
      const p = buildGenerationPrompt(lang, 'https://x.test/a', [], CUSTOM);
      expect(p, '默认产品名还留在 prompt 里 —— 有写死的残留').not.toContain(PRODUCT_FACTS.productName);
      expect(
        /7-day 10GB|no WeChat \/ Alipay/.test(p),
        '英文块里还有写死的试用/支付文案 —— 改口径对英文回复无效',
      ).toBe(false);
    });
  }

  it('⭐ 不传口径时回落默认值（空清单比写死更危险）', () => {
    /**
     * ⚠️ 回落必须留着:没有清单时模型会**无约束自由发挥**,
     * 而本清单存在的全部意义就是「只能用这里的内容」。
     */
    const p = buildGenerationPrompt('zh', 'https://x.test/a');
    expect(p, '不传口径时没回落默认值 —— 会变成空清单').toContain(PRODUCT_FACTS.productName);
  });
});

describe('⭐⭐ 拟回复真的去库里读口径', () => {
  const planner = strip(read('src/platform/main/x/x-reply-planner.ts'));

  it('⭐⭐ 两个调用点都把库里的口径传下去了', () => {
    expect(planner, '没从库里读口径 —— 面板改了拟回复也用不上')
      .toMatch(/getProductFacts/);
    /** ⚠️ 切到各自调用处再断言,别整文件 toMatch(同名 token 会假绿) */
    const i = planner.indexOf('buildGenerationPrompt(');
    const j = planner.indexOf('buildSingleReplyPrompt(');
    expect(i, '找不到批量生成的调用').toBeGreaterThan(0);
    expect(j, '找不到单条生成的调用').toBeGreaterThan(0);
    expect(
      planner.slice(i, planner.indexOf(')', i) + 1),
      '批量生成没把口径传进去 —— 那条路径还在用默认值',
    ).toMatch(/,\s*pf\s*\)/);
    expect(
      planner.slice(j, j + 260),
      '单条生成没把口径传进去',
    ).toMatch(/\bpf\b/);
  });

  it('⚠️ 取口径在循环外 —— 不许每条推读一次库', () => {
    const i = planner.indexOf('const pf = await getProductFacts()');
    expect(i, '找不到取口径的地方').toBeGreaterThan(0);
    const j = planner.indexOf("for (const lang of ['zh', 'en'] as const)");
    expect(j, '找不到按语言分组的循环').toBeGreaterThan(0);
    expect(i, '取口径写在循环里了 —— 每种语言都读一次库').toBeLessThan(j);
  });
});

describe('⭐ 存取与兜底', () => {
  const repo = strip(read('src/platform/main/db/x-product-facts-repo.ts'));

  it('⭐⭐ 读失败回落默认值且不抛（拟回复是主流程，不能被配置拖垮）', () => {
    const i = repo.indexOf('export async function getProductFacts');
    expect(i, '找不到 getProductFacts').toBeGreaterThan(0);
    const body = repo.slice(i, repo.indexOf('export async function saveProductFacts'));
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(body, '读失败没回落 —— 配置读不到会把拟回复整条拖垮')
      .toMatch(/catch[\s\S]{0,200}PRODUCT_FACTS/);
    expect(body, '读失败静默了 —— 要 warn，别让人查不到').toMatch(/console\.warn/);
  });

  it('⭐⭐ 写失败要抛（与读相反：用户点了保存，存不进去必须知道）', () => {
    const i = repo.indexOf('export async function saveProductFacts');
    const body = repo.slice(i, repo.indexOf('export async function resetProductFacts'));
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    /**
     * ⚠️ 要连 **`catch {`（无参数形式）** 一起挡 —— 只写 `/catch\s*\(/`
     * 时注入 `} catch { }` 守卫**全绿**(2026-09-26 实测栽过)。
     */
    expect(
      /\bcatch\b/.test(body),
      '写失败被吞了 —— 用户会以为改好了，而模型还在用旧口径',
    ).toBe(false);
  });

  it('⚠️ 产品名不许空（空了模型会自己脑补一个名字）', () => {
    expect(repo, '没挡空产品名').toMatch(/产品名不能为空/);
  });

  it('⭐ 保存后回读确认（成功要对账，不是只报一句成功）', () => {
    const h = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
    const i = h.indexOf('X_SAVE_PRODUCT_FACTS, async');
    expect(i, '找不到保存 handler').toBeGreaterThan(0);
    const body = h.slice(i, i + 700);
    expect(body, '存完没回读 —— 「看着成功实际没有」那一类')
      .toMatch(/saveProductFacts[\s\S]{0,120}getProductFacts/);
  });

  it('⚠️ 单行表：只有一份对外口径，不按 ws 分', () => {
    expect(
      repo,
      '按 ws 存了 —— 产品事实与 workspace 无关（同 x_author 不带 ws_id 的道理）',
    ).toMatch(/x_product_facts:current/);
    expect(/ws_id/.test(repo), '口径表不该有 ws_id').toBe(false);
  });
});

describe('⭐ 面板能改到每一项', () => {
  const view = read('src/views/x-workbench/XWorkbenchView.tsx');

  it('⭐⭐ 清单里每个字段面板上都要有得改（漏一项 = 那项永远改不了）', () => {
    const i = view.indexOf('const FACT_FIELDS');
    expect(i, '找不到字段表').toBeGreaterThan(0);
    const block = view.slice(i, view.indexOf('];', i));
    /** ⚠️ 用**两张清单对照**,不钉单个字段 —— 新增字段才不会天然在视野外 */
    for (const k of Object.keys(PRODUCT_FACTS) as Array<keyof ProductFacts>) {
      if (k === 'forbidden') continue;   // forbidden 单独一个多行框
      expect(block, `面板上没有「${k}」这一项 —— 它永远改不了`).toContain(`'${k}'`);
    }
    expect(view, 'forbidden 没有编辑入口').toMatch(/facts\.forbidden/);
  });

  it('⚠️ 已改未存时切走再回来不许覆盖（改的字会全没）', () => {
    const i = view.indexOf("if (pane !== 'facts'");
    expect(i, '找不到载入 facts 的守卫').toBeGreaterThan(0);
    expect(
      view.slice(i, view.indexOf('\n', i)),
      '没判 factsDirty —— 切走再切回来，改的字全丢',
    ).toMatch(/factsDirty/);
  });
});
