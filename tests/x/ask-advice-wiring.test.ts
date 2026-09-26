/**
 * ⭐⭐ **④ 送 Claude 取建议** —— 接线守卫(用户 2026-09-26)。
 *
 * ⚠️ 这一步最危险的两件事:
 *  ① **静默失败** —— Claude 改了回答格式,解析出 0 条却报「跑完了」
 *  ② **只取建议变成了发推** —— 红线,必须钉死
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ADV = strip(read('src/platform/main/x/x-ask-advice.ts'));
const CAPS = read('src/platform/main/x/x-flow-capabilities.ts');

describe('⭐⭐ 红线:只取建议，绝不发推', () => {
  it('⭐⭐ 这条链路里不许出现任何发推动作', () => {
    /**
     * ⚠️ `askAI` 内部的 clickSendButton 是**发给 Claude**,与发推无关。
     * 但这一层自己**绝不能**碰发布原语。
     */
    for (const forbidden of ['replyTweet', 'postReply', 'markReplied', 'publishTweet']) {
      expect(
        new RegExp(`\\b${forbidden}\\s*\\(`).test(ADV),
        `④ 这一步出现了发布动作 ${forbidden} —— 红线:只取建议，发不发是人点的`,
      ).toBe(false);
    }
  });
});

describe('⭐⭐ 静默失败必须挡住', () => {
  it('⭐⭐ 送了却一条没解析出来 = 报失败，不报成功', () => {
    const i = CAPS.indexOf('async askAdvice(');
    expect(i, '找不到 askAdvice 能力').toBeGreaterThan(0);
    const body = strip(CAPS.slice(i, CAPS.indexOf('async planReply(')));
    expect(body.length, 'slice 空转').toBeGreaterThan(200);
    expect(
      body,
      '送了 N 条一条没解析出来却报成功 —— Claude 改了格式没人会发现',
    ).toMatch(/const stuck = r\.sent > 0 && r\.parsed === 0/);
    expect(body, 'stuck 算出来了却没用来决定 ok').toMatch(/ok: !stuck/);
  });

  it('⭐⭐ 解析不出来的段落要带回去，不许丢', () => {
    expect(ADV, 'unparsed 没带回调用方 —— 格式变了查不到证据').toMatch(/unparsed/);
    const i = CAPS.indexOf('async askAdvice(');
    const body = strip(CAPS.slice(i, CAPS.indexOf('async planReply(')));
    expect(body, '没解析的段数没进 note —— 面板上看不出来').toMatch(/unparsed\.length/);
  });

  it('⭐ 失败时要提示「先怀疑 askAI」（它长期无人调用）', () => {
    /**
     * ⚠️ 用户说它「当然活着」,但**未经本机实测**。
     * 第一次真跑失败时要把排查方向写在错误里,别让人去别处查。
     */
    const i = CAPS.indexOf('async askAdvice(');
    const body = CAPS.slice(i, CAPS.indexOf('async planReply('));
    expect(body, '失败时没给排查方向').toMatch(/askAI/);
  });
});

describe('⭐⭐ Claude 写的同样要过程序校验', () => {
  it('⭐⭐ 建议正文必须过 verifyGeneratedReply', () => {
    /**
     * ⚠️ 链接被改写最隐蔽:发出去看不出来,但那次点击永远归不了因。
     * Claude 写得流畅**不代表**不会改链接。
     */
    expect(ADV, 'Claude 的建议没过校验 —— 改了 ref 也发得出去')
      .toMatch(/verifyGeneratedReply\(/);
    const i = ADV.indexOf('const advices = parsed.advices.filter');
    expect(i, '找不到过滤建议的地方').toBeGreaterThan(0);
    const blk = ADV.slice(i, i + 400);
    expect(blk, '没把没过校验的记进 rejected —— 拦了但没人知道')
      .toMatch(/rejected\.push/);
  });

  it('⚠️ 建议「不回」的不做正文校验（本来就没正文）', () => {
    const i = ADV.indexOf('const advices = parsed.advices.filter');
    const blk = ADV.slice(i, i + 400);
    expect(blk, '对「不回」的也校验正文 —— 会把它们全判成 empty 拦掉')
      .toMatch(/if \(!a\.shouldReply\) return true/);
  });

  it('⭐ 校验拦了什么要留痕（观察点）', () => {
    const i = CAPS.indexOf('async askAdvice(');
    const body = strip(CAPS.slice(i, CAPS.indexOf('async planReply(')));
    expect(body, 'rejected 没进 evidence —— 「Claude 改了链接」这种事只能靠留痕发现')
      .toMatch(/evidence:[\s\S]{0,300}rejected/);
  });
});

describe('⭐ 接线与登记', () => {
  it('⭐⭐ 四处都登记了（漏一处就静默不生效）', () => {
    expect(
      strip(read('src/shared/types/flow-recipe-types.ts')),
      "FlowStepKind 里没登记 'askAdvice'",
    ).toMatch(/\| 'askAdvice'/);
    const runner = strip(read('src/platform/main/flow/flow-runner.ts'));
    expect(runner, 'FlowCapabilities 里没有 askAdvice').toMatch(/askAdvice\(params/);
    expect(
      runner,
      "STEP_TYPE_BY_KIND 里没登记 —— step_type 会变成 unknown",
    ).toMatch(/askAdvice: 'judge'/);
    expect(
      strip(read('src/platform/main/x/x-flow-recipes.ts')),
      '默认配方里没有这一步',
    ).toMatch(/kind: 'askAdvice'/);
  });

  it('⚠️ 默认**关掉**（要前台 AI 视图开着，且尚未真机验证）', () => {
    const rec = read('src/platform/main/x/x-flow-recipes.ts');
    const i = rec.indexOf("kind: 'askAdvice'");
    expect(i, '找不到 askAdvice 步骤').toBeGreaterThan(0);
    const blk = rec.slice(i, rec.indexOf("kind: 'planReply'"));
    expect(blk.length, 'slice 空转').toBeGreaterThan(50);
    expect(
      blk,
      '默认开着 —— AI 视图没开时每跑必失败，会把整条编排拖成红的',
    ).toMatch(/enabled: false/);
  });

  it('⭐ 没建议就别往下走（与判断步同一个道理）', () => {
    const i = CAPS.indexOf('async askAdvice(');
    const body = strip(CAPS.slice(i, CAPS.indexOf('async planReply(')));
    expect(body, '没表态 hasCandidates —— 一条建议都没有时还会往下跑')
      .toMatch(/hasCandidates: r\.recommended > 0/);
  });

  it('⚠️ 需要 wsId（否则跨 ws 混批）', () => {
    const i = CAPS.indexOf('async askAdvice(');
    const body = strip(CAPS.slice(i, i + 400));
    expect(body, '没挡 wsId 缺失').toMatch(/askAdvice 需要 wsId/);
  });
});

describe('⭐ 组装语境:只读库，不现采', () => {
  it('⭐⭐ 这一步不许自己去 X 采 bio 或上文', () => {
    /**
     * ⚠️ 备料是第 ③ 步的事。两处都能采 = 两份实现必漂,
     * 而且会让「备料」这一步失去意义。
     */
    for (const f of ['harvestAuthorProfile', 'fetchParentTweet', 'autoCollect']) {
      expect(
        new RegExp(`\\b${f}\\s*\\(`).test(ADV),
        `④ 自己去采 ${f} 了 —— 那是第③步备料的事，两份实现必漂`,
      ).toBe(false);
    }
  });

  it('⚠️ handle 要归一化（不然永远查不到 bio）', () => {
    expect(ADV, 'x_tweet 存 @Xxx、x_author 存小写 —— 不归一化永远命中不上且不报错')
      .toMatch(/normalizeHandle\(/);
  });

  it('⚠️ 上文三态要如实标（有/本来没有/没抓到）', () => {
    expect(ADV, '没区分「是回复但没抓到」—— 模型会把它当成独立推')
      .toMatch(/contextMissing: isReply && !parentText/);
  });
});
