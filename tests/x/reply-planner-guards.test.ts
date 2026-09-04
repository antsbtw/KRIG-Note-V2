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
} from '../../src/shared/types/x-reply-types';

const PLANNER = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-reply-planner.ts'), 'utf-8');
const HANDLERS = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');

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
    const picked: string[] = [];
    let recent: ReturnType<typeof pickTemplate>[] = [];
    for (let i = 0; i < REPLY_TEMPLATES.length; i++) {
      const id = pickTemplate(recent);
      picked.push(id);
      recent = [id, ...recent];
    }
    expect(new Set(picked).size, `轮换失效,${REPLY_TEMPLATES.length} 次里出现重复`)
      .toBe(REPLY_TEMPLATES.length);
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
