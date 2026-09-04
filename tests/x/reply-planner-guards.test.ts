/**
 * 守卫:自动回复的三条硬约束。
 *
 * ① **红线**:全链路只填不发,代码里不得出现「点发布/点回复按钮」的动作。
 * ② **正文只来自模板库**:模型不生成一个字(它不知道「7天10G」是否仍有效,
 *    且 X 判垃圾看重复度,模型改写只会制造一堆 90% 相似的变体)。
 * ③ **前置过滤不问模型**:刷屏/冷却/已回过是跨条现象,模型一次只看一条判不出。
 *    2026-09-04 评测里唯一残留的假阳正是此类 ——
 *    「我有小火箭加速器,求推荐一个好用的VPN」在库里一字不差出现 3 次。
 *
 * ⚠️ 纯逻辑部分(指纹/轮换)测真实行为;涉及 Electron/DB 的部分测源码约束。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { textFingerprint, pickTemplate, DUPLICATE_FINGERPRINT_THRESHOLD } from
  '../../src/platform/main/x/x-reply-planner';
import {
  REPLY_TEMPLATES, getTemplate, hasStaleShortLink, needsRef, REPLY_CONFIDENCE_FLOOR,
  buildRef, renderTemplate, REF_PLACEHOLDER, LANDING_BASE,
  langOf, templatesFor, LINK_PARAMS,
} from '../../src/shared/types/x-reply-types';

const PLANNER = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-reply-planner.ts'), 'utf-8');
const HANDLERS = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');
const UI_RAW = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/ReplyDraftsView.tsx'), 'utf-8');
/**
 * 去掉注释后的代码 —— 「禁止出现 X」这类守卫必须只看**代码**。
 * 否则「本视图不存在任何一键全发」这句**说明它没做**的注释,
 * 反而会把守卫弄红(踩过:首次写完就是这样),
 * 之后为了让测试变绿去删注释,等于把最该留的说明删掉。
 */
const UI = UI_RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('红线:只填不发', () => {
  it('⭐ planner 不得有任何点击发布/回复按钮的动作', () => {
    // 写方向最高红线(x-write.ts §9):发布那一下永远留给用户
    const clicks = [...PLANNER.matchAll(/\.click\(\)|clickSendButton|clickPublish|pressEnter/g)];
    expect(
      clicks.map((m) => m[0]),
      'planner 里出现了点击动作 —— 违反「绝不程序自动点发布」红线',
    ).toEqual([]);
  });

  it('⭐ planner 不得直接驱动 webview(它只产数据)', () => {
    // 填充走既有的 pasteReply(它自己也只填不点),planner 不该碰 webContents
    expect(
      /executeJavaScript|webContents|sendInputEvent/.test(PLANNER),
      'planner 碰了 webview —— 规划与填充必须分开,否则「产草稿」会顺手把内容送出去',
    ).toBe(false);
  });

  it('⭐ X_PLAN_REPLIES handler 不得调用 pasteReply(规划 ≠ 填充)', () => {
    const start = HANDLERS.indexOf('X_PLAN_REPLIES');
    const body = HANDLERS.slice(start, HANDLERS.indexOf('X_INBOX_QUERY', start));
    expect(
      /pasteReply|pasteTweet/.test(body),
      '规划顺手就填进去了 —— 用户失去逐条过目的机会',
    ).toBe(false);
  });
});

describe('UI:只填不发', () => {
  it('⭐ 不得有「全部填入/一键全发」这类批量动作', () => {
    // 逐条过目是这个功能的核心 —— 有了批量按钮,红线形同虚设
    expect(
      /全部填入|一键|批量发|fillAll|sendAll|replyAll/i.test(UI),
      'UI 出现了批量发送入口 —— 逐条过目被绕过',
    ).toBe(false);
  });

  it('⭐ UI 必须明示「不会替你点发布」', () => {
    expect(UI_RAW).toMatch(/不会替你点发布/);
  });

  it('⭐ 填入后不得自动写 markReplied(填入 ≠ 已发布)', () => {
    // 填进去你没点发布的话,这条得还能再出现;自动标已回复会让它永远消失
    expect(
      /markReplied/.test(UI),
      '填入即标已回复 —— 没点发布的会被永久漏掉',
    ).toBe(false);
  });

  it('⭐ 手改正文不得回写模板库', () => {
    // 手滑污染模板会影响之后所有回复
    expect(
      /REPLY_TEMPLATES\s*[.[]\s*\w*\s*=|\.text\s*=\s*/.test(UI),
      'UI 在写模板库 —— 手改应只作用于当前这一条',
    ).toBe(false);
  });

  it('⭐ 英文文案的待审核提示必须真的渲染出来', () => {
    expect(UI).toMatch(/needsHumanReview/);
    expect(UI_RAW).toMatch(/没有语料依据/);
  });

  it('⭐ 跳过的条目要能展开看原因(不静默丢)', () => {
    expect(UI).toMatch(/SKIP_LABEL/);
    for (const k of ['duplicate_text', 'author_recent', 'blocked_author', 'low_confidence']) {
      expect(UI, `跳过原因 ${k} 没有对应人话`).toContain(k);
    }
  });

  it('⭐ 规划失败必须报错,不能留空列表装作「没什么可回的」', () => {
    expect(UI_RAW).toMatch(/规划失败/);
  });
});

describe('正文只来自模板库', () => {
  it('⭐ prompt 必须明确要求模型不生成正文', () => {
    expect(PLANNER).toMatch(/不生成任何回复正文/);
  });

  it('⭐ prompt 不得要求模型输出正文或模板选择字段', () => {
    const promptStart = PLANNER.indexOf('REPLY_SYSTEM_PROMPT');
    const prompt = PLANNER.slice(promptStart, PLANNER.indexOf('`;', promptStart));
    // 输出契约里只该有 tweetId/reply/confidence/reason
    expect(prompt).not.toMatch(/"text"\s*:/);
    expect(prompt).not.toMatch(/"template"\s*:/);
    expect(prompt).not.toMatch(/"suggestReply"\s*:/);
  });

  it('⭐ 草稿正文只经 renderTemplate(唯一允许的替换是 {ref})', () => {
    // 任何按推文内容拼接正文的写法都是「模型生成正文」的后门
    expect(PLANNER).toMatch(/text:\s*renderTemplate\(template,\s*ref\)/);
  });

  it('⭐ 正文不得混入推文内容/模型输出', () => {
    const push = PLANNER.slice(PLANNER.indexOf('drafts.push('));
    const body = push.slice(0, push.indexOf('});'));
    const textLine = body.split('\n').find((l) => /^\s*text:/.test(l)) ?? '';
    expect(
      /t\.text|d\.reason|decision|\+/.test(textLine),
      `正文行混入了模板以外的东西:${textLine.trim()}`,
    ).toBe(false);
  });

  it('模板库非空,且每个模板都有正文', () => {
    expect(REPLY_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of REPLY_TEMPLATES) {
      expect(t.text.trim().length, `模板 ${t.id} 正文为空`).toBeGreaterThan(0);
    }
  });

  it('⭐ 模板正文不得自带 @提及(X 回复框会自动带,重复会变 @@xxx)', () => {
    for (const t of REPLY_TEMPLATES) {
      expect(/^@\w+/.test(t.text.trim()), `模板 ${t.id} 自带了 @提及`).toBe(false);
    }
  });

  it('getTemplate 对未知 id 必须 throw(不静默回退第一个模板)', () => {
    // 静默回退 = 发错内容出去才发现
    expect(() => getTemplate('nope' as never)).toThrow();
  });

  it('⭐ 模板里不得残留 X 的 t.co 短链', () => {
    // t.co 是 X 发布时生成的包装,硬编码它 = 丢掉 ref 统计参数,
    // 且指向一条我们控制不了也更新不了的跳转
    for (const t of REPLY_TEMPLATES) {
      expect(hasStaleShortLink(t), `模板 ${t.id} 还带着 t.co 短链`).toBe(false);
    }
  });
});

describe('追踪标识 ref', () => {
  it('⭐ 模板用原始落地页 + {ref} 占位', () => {
    for (const t of REPLY_TEMPLATES) {
      expect(t.text, `模板 ${t.id} 没用落地页`).toContain(LANDING_BASE);
      expect(needsRef(t), `模板 ${t.id} 少了 {ref} 占位`).toBe(true);
    }
  });

  it('⭐ renderTemplate 必须把占位全换掉', () => {
    for (const t of REPLY_TEMPLATES) {
      const out = renderTemplate(t, 'tw_x_20260904');
      expect(out, `模板 ${t.id} 渲染后仍有占位`).not.toContain(REF_PLACEHOLDER);
      expect(out).toContain('ref=tw_x_20260904');
    }
  });

  it('⭐ 有占位却不给 ref 必须 throw(不能把 {ref} 字面量发出去)', () => {
    // 静默留着占位 = 推给用户一条明显坏掉的链接
    expect(() => renderTemplate(REPLY_TEMPLATES[0], '')).toThrow();
    expect(() => renderTemplate(REPLY_TEMPLATES[0], '   ')).toThrow();
  });

  it('ref 形态:tw_<账号>_<日期>[_<配方>],只含 URL 安全字符', () => {
    const at = new Date('2026-09-04T10:00:00Z');
    expect(buildRef('netlab2gfw', at)).toBe('tw_netlab2gfw_20260904');
    expect(buildRef('netlab2gfw', at, 'vpn-help')).toBe('tw_netlab2gfw_20260904_vpnhelp');
    // 非法字符必须被剔除,不能带进 URL
    expect(buildRef('a@b#c', at)).toMatch(/^tw_abc_\d{8}$/);
  });

  it('⭐ ref 按批次不按条 —— 同一批各条正文必须完全相同', () => {
    // 每条唯一 = 正文条条不同 = 水军最直接的特征之一
    const ref = buildRef('netlab2gfw', new Date());
    const a = renderTemplate(REPLY_TEMPLATES[0], ref);
    const b = renderTemplate(REPLY_TEMPLATES[0], ref);
    expect(a).toBe(b);
  });
});

describe('前置过滤不问模型', () => {
  it('⭐ 文本指纹能识别「同一句话」的刷屏', () => {
    // 这两条在库里一字不差出现过 3 次,是评测里唯一残留假阳的来源
    const a = textFingerprint('我有小火箭加速器，求推荐一个好用的VPN');
    const b = textFingerprint('@someone 我有小火箭加速器，求推荐一个好用的VPN https://t.co/abc');
    expect(a, '@提及与链接不同就认不出是同一句 —— 刷屏必然漏网').toBe(b);
  });

  it('⭐ 不同内容必须有不同指纹(否则会误杀真求助)', () => {
    const a = textFingerprint('大家有什么好用的机场推荐吗');
    const b = textFingerprint('我有小火箭加速器，求推荐一个好用的VPN');
    expect(a).not.toBe(b);
  });

  it('阈值为 2 —— 真人不会一字不差发两遍', () => {
    expect(DUPLICATE_FINGERPRINT_THRESHOLD).toBe(2);
  });

  it('⭐ 前置过滤必须在调用模型之前(省算力,更要省误回)', () => {
    const filterAt = PLANNER.indexOf("push('duplicate_text'");
    const modelAt = PLANNER.indexOf('await callOllama');
    expect(filterAt, '找不到刷屏过滤').toBeGreaterThan(-1);
    expect(
      filterAt < modelAt,
      '过滤跑在模型之后 —— 刷屏推文会先被模型判成「该回」',
    ).toBe(true);
  });

  it('⭐ 冷却/已回过/屏蔽三道闸都要在', () => {
    for (const k of ['already_replied', 'blocked_author', 'author_recent', 'duplicate_text']) {
      expect(PLANNER, `少了 ${k} 这道闸`).toContain(k);
    }
  });

  it('⭐ 被挡掉的必须留原因,不静默丢', () => {
    // 否则「为什么没回这条」无从查起
    expect(PLANNER).toMatch(/skips\.push/);
    expect(PLANNER).toMatch(/skipReason/);
  });
});

describe('模板轮换(不问模型)', () => {
  it('⭐ 连续选取不重复 —— 避免连发同一句被判水军', () => {
    for (const lang of ['zh', 'en'] as const) {
      const pool = templatesFor(lang);
      const picked: string[] = [];
      let recent: ReturnType<typeof pickTemplate>[] = [];
      for (let i = 0; i < pool.length; i++) {
        const id = pickTemplate(recent, lang);
        picked.push(id);
        recent = [id, ...recent];
      }
      expect(new Set(picked).size, `${lang} 轮换失效,${pool.length} 次里出现重复`)
        .toBe(pool.length);
    }
  });

  it('⭐ 模板选择不得依赖模型返回', () => {
    // 离线一致率仅 37%,且语料本身无信号(同质父推人工也用了不同模板)
    const pick = PLANNER.slice(PLANNER.indexOf('export function pickTemplate'));
    const body = pick.slice(0, pick.indexOf('\n}'));
    expect(
      /decision|verdict|ollama|d\.template/i.test(body),
      'pickTemplate 又去看模型输出了 —— 那是在学噪声',
    ).toBe(false);
  });
});

describe('中英文分流', () => {
  it('⭐ 中文推用中文模板,其余一律英文', () => {
    // 给英文推回中文文案,对方看不懂 = 白发一条还留垃圾记录
    expect(langOf('zh')).toBe('zh');
    expect(langOf('zh-Hans')).toBe('zh');
    expect(langOf('en')).toBe('en');
    expect(langOf('ja')).toBe('en');       // 非中文回退英文(国际通用)
    expect(langOf(undefined)).toBe('en');
  });

  it('⭐ 两种语言都必须有可用模板(否则 pickTemplate 会 throw)', () => {
    expect(templatesFor('zh').length).toBeGreaterThan(0);
    expect(templatesFor('en').length).toBeGreaterThan(0);
  });

  it('⭐ 选出的模板语言必须与请求一致', () => {
    for (const lang of ['zh', 'en'] as const) {
      const id = pickTemplate([], lang);
      expect(getTemplate(id).lang, `lang=${lang} 选出了别的语言的模板`).toBe(lang);
    }
  });

  it('⭐ 链接参数按语言:中文 lang=zh&v=6,英文 lang=en&v=7', () => {
    // 用户 2026-09-04 给定,两者均已实测 307 → 200
    expect(LINK_PARAMS.zh).toBe('lang=zh&v=6');
    expect(LINK_PARAMS.en).toBe('lang=en&v=7');
    for (const t of REPLY_TEMPLATES) {
      expect(t.text, `模板 ${t.id} 链接参数与其语言不符`).toContain(LINK_PARAMS[t.lang]);
    }
  });

  it('⭐ 英文文案必须标 needsHumanReview(全库 0 条英文语料,是新写的)', () => {
    // 语料里像英文句子的回复是 0 条 —— 那 115 条「无中文」全是数字和 emoji。
    // 发出去的是产品承诺,不能让用户不知情地发未经检验的文案。
    for (const t of templatesFor('en')) {
      expect(t.needsHumanReview, `英文模板 ${t.id} 没标待审核`).toBe(true);
    }
  });

  it('中文文案有语料依据,不该标待审核', () => {
    for (const t of templatesFor('zh')) {
      expect(t.needsHumanReview ?? false, `中文模板 ${t.id} 被误标待审核`).toBe(false);
      expect(t.observedCount).toBeGreaterThan(0);
    }
  });
});

describe('失败要响,不静默产出空草稿', () => {
  it('⭐ 模型返回结构异常必须 throw(同 x-ai-judge 的教训)', () => {
    // 回复层丢一批 = 该回的没回,而面板显示一切正常,比判断层后果更重
    expect(PLANNER).toContain('contains no decision array');
    const ex = PLANNER.slice(PLANNER.indexOf('function extractDecisions'));
    expect(
      /\?\?\s*\[\]/.test(ex.slice(0, ex.indexOf('\n}'))),
      '又出现了 `?? []` 兜底 —— 整批会被静默当成空批',
    ).toBe(false);
  });

  it('⭐ 置信度下限存在且不为 0(宁可漏不可扰)', () => {
    expect(REPLY_CONFIDENCE_FLOOR).toBeGreaterThan(0);
    expect(PLANNER).toContain('low_confidence');
  });

  it('模型漏判某条时不得当成「不该回」而无痕跳过', () => {
    expect(PLANNER).toMatch(/模型未返回该条判断/);
  });
});
