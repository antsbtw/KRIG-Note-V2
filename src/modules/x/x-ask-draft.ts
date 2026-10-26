/**
 * ⭐⭐ 求关留言 —— Gemma 草拟,人改(2026-10-21)
 *
 * 用户 10-21:「建议这里跳出一个Gemma草拟的答复吧。如果不满意我再修改,如何?」· 模型用户选 Gemma 4 12B(本机 Ollama)。
 * 用户 10-17:「留言--需要AI学习我的求关习惯,给出建议,我来修正。准确率提升后开启自动化。」
 *
 * · 范例只取**你亲手写、发出去**的求关留言(x_ask.reply_source = human 且 replied = ok)+ 当时他那条帖子
 *   ⚠️ 账号上已有的回复是 Muse 自动回复,不算你的习惯(记忆 project-x-ask-reply-corpus);AI 原样发出去的也不进范例(免得学自己)
 * · 输出纯文本,不用 JSON 契约(记忆 project-x-reply-latency:语法约束采样空转慢;num_predict 会变静默截断 —— 都不用)
 * · 关掉思考(think: false):Gemma 4 默认先写 ~1000 字思考,一条 30~80 秒;关掉 1~2 秒
 * · 校验不过就不填、说清为什么,不拿模板凑(fail loud)
 * · 默认写中文;你要求别的语言(点评 / 长期要求)就用那种语言 —— 用户 10-22:「让它用英文回复,怎么都是中文?」
 *   原来写死「只写中文」+ 校验拒收非中文,你的点评压不过。⚠️ 外语草稿必须回译成中文给你看(记忆 project-x-multilang-reply-risk:
 *   外语会编清单外承诺,人审不出来)—— 回译失败也要说出来
 * · ⭐ 点评(2026-10-22,用户:「在回复框增加一个我对AI回复提出要求的窗口(点评),要求AI如何调整回复的内容、语气等」):
 *   这一次按点评改上一版(revise);勾「以后都这样」的点评成长期要求,每次草拟都带上(rules,优先于范例口吻)。
 *   每次点评都记进 x_draft_note(改前 / 点评 / 改后),留着以后让 AI 从中找你想要的回复方法。
 */
import { getXDB } from '@storage/surreal/client';
import { callOllamaChat } from '@platform/main/local-llm/ollama-client';
import { googleTranslate } from '@platform/main/learning/providers/google-translate';
import { buildVpnReplyPrompt, cleanVpnDraft } from './x-vpn-help';
import type { ReplyLang } from '@shared/types/x-reply-types';

export const ASK_DRAFT_MODEL = 'gemma4:12b';
const MAX_EXAMPLES = 12;
/** 中文按字、外文按词算长短(英文一句 62 个字母不算长 —— 10-22 真机「太长了(62 字)」) */
const MAX_CJK_CHARS = 60;
const MAX_WORDS = 45;
const CJK = /[一-鿿]/;

export type AskExample = { readonly tweet: string; readonly reply: string };

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return [...t].length > n ? `${[...t].slice(0, n).join('')}…` : t;
};

/** 拼提示词 —— 纯函数(测试钉住:范例全在、他的帖子在、规矩在) */
export function buildAskDraftPrompt(input: {
  readonly examples: readonly AskExample[];
  readonly tweet: string;
  readonly person: { readonly name?: string; readonly bio?: string };
  /**
   * ⭐ engage = 对已经互关的朋友日常互动(2026-10-22):接住他说的话回应,**不求关、不提互关**;
   * 回他找我的那一条时,就是回应他对我说的话
   */
  readonly mode?: 'ask' | 'engage' | 'vpn';
  /** ⭐ 对话上文(原帖 → 来回 → 要回的这条;2026-10-22)—— 有就附上,回复才接得上 */
  readonly context?: string;
  /** ⭐ 你的长期要求(勾了「以后都这样」的点评)—— 优先于范例的口吻 */
  readonly rules?: readonly string[];
  /** ⭐ 按点评改上一版 */
  readonly revise?: { readonly previous: string; readonly note: string };
}): Array<{ role: 'system' | 'user'; content: string }> {
  const engage = input.mode === 'engage';
  const sys = [
    engage
      ? '你替一个中文 X(推特)蓝V用户回复他已经互相关注的朋友的帖子,目的是保持往来、让对方愿意聊下去。接住对方帖子里说的事回应,不要求关注、不要提「互关」。'
      : '你替一个中文 X(推特)蓝V用户写「求互关」的回复。他在别人和互关相关的帖子下面留言,目的是让对方回关他。',
    engage ? '口语、短、真诚,一两句话;可以附和、追问一句、或说说自己的看法。' : '照他自己写过的留言的口气和长短来写:口语、短、真诚,一两句话。',
    '规矩:默认写中文,他的要求(下面的长期要求或点评)指定了别的语言就用那种语言;中文不超过 40 个字,外文不超过 30 个词;不要 @ 任何人;不要链接;不要话题标签;不要编造你不知道的事(不提具体数字、产品、承诺);',
    '可以接住对方帖子里的一句话再求关;可以带一个表情,也可以不带。',
    '只输出这一条留言本身,不要引号,不要解释,不要前缀。',
    ...(input.rules && input.rules.length > 0 ? [`他的长期要求(一定照做,和上面的口吻冲突时以这里为准):\n${input.rules.map((r, i) => `${i + 1}. ${r.trim()}`).join('\n')}`] : []),
  ].join('\n');
  const shots = input.examples.map((e, i) => `例 ${i + 1}\n他的帖子:${clip(e.tweet, 120)}\n我的留言:${e.reply.trim()}`).join('\n\n');
  const who = [input.person.name ? `对方名字:${clip(input.person.name, 40)}` : '', input.person.bio ? `对方简介:${clip(input.person.bio, 120)}` : ''].filter(Boolean).join('\n');
  const ctx = input.context && input.context.trim() !== '' ? `这条帖子所在的对话(从原帖开始):\n${input.context.slice(0, 1500)}\n\n` : '';
  const revise = input.revise ? `\n\n上一版留言:${input.revise.previous.trim()}\n他对上一版的点评(照着改):${input.revise.note.trim()}\n\n改好的留言:` : '\n\n我的留言:';
  const user = `${shots ? `下面是我以前亲手写的${engage ? '回复' : '求关留言'}:\n\n${shots}\n\n` : ''}${ctx}现在要回复的帖子:\n${clip(input.tweet, 280)}\n${who}${revise}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

/** 模型回来的文字收拾一下 + 校验;不合格回原因 —— 纯函数 */
export function cleanAskDraft(raw: string): { readonly text: string } | { readonly problem: string } {
  let t = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  t = t.replace(/^(改好的留言|我的留言|留言|回复)\s*[:：]\s*/, '').replace(/^["“「『'`]+|["”」』'`]+$/g, '').trim();
  if (t === '') return { problem: '模型回了空的' };
  if (CJK.test(t) ? [...t].length > MAX_CJK_CHARS : t.split(/\s+/).length > MAX_WORDS) {
    return { problem: CJK.test(t) ? `太长了(${[...t].length} 字)` : `太长了(${t.split(/\s+/).length} 个词)` };
  }
  if (/@\w/.test(t)) return { problem: '带了 @(求关留言不 @ 人)' };
  if (/https?:\/\/|t\.co\/|www\./i.test(t)) return { problem: '带了链接' };
  if (/#\S/.test(t)) return { problem: '带了话题标签' };
  return { text: t };
}

/** 范例:你亲手写、发出去的(最新的在前)—— 求关取 x_ask,互动取 x_engage(两种口吻各学各的) */
export async function readAskExamples(account: string, mode: 'ask' | 'engage' | 'vpn' = 'ask'): Promise<AskExample[]> {
  /** 三种口吻各学各的:求关 x_ask / 互动 x_engage / 回复求助 x_vpn_reply */
  const table = mode === 'engage' ? 'x_engage' : mode === 'vpn' ? 'x_vpn_reply' : 'x_ask';
  const [rows] = await getXDB().query<[Array<{ tweet_text: string; reply_text: string; at: string }>]>(
    `SELECT tweet_text, reply_text, <string> at AS at FROM ${table}
       WHERE account = $a AND reply_source = 'human' AND replied = 'ok' AND reply_text != '' ORDER BY at DESC LIMIT $n`,
    { a: account, n: MAX_EXAMPLES },
  );
  return (rows ?? []).map((r) => ({ tweet: r.tweet_text, reply: r.reply_text }));
}

/** ⭐ 长期要求(勾了「以后都这样」且还生效的),先到的在前 */
export async function readDraftRules(account: string, mode: 'ask' | 'engage' | 'vpn'): Promise<Array<{ id: string; note: string; at: string }>> {
  const [rows] = await getXDB().query<[Array<{ id: string; note: string; at: string }>]>(
    `SELECT <string> record::id(id) AS id, note, <string> at AS at FROM x_draft_note WHERE account = $a AND mode = $m AND keep = true AND active = true ORDER BY at ASC`,
    { a: account, m: mode },
  );
  return rows ?? [];
}

/** 记一次点评(只追加);写不上就抛,不假装记住了 */
export async function recordDraftNote(n: {
  readonly account: string; readonly mode: 'ask' | 'engage' | 'vpn'; readonly note: string; readonly keep: boolean;
  readonly tweet: string; readonly before?: string; readonly after?: string;
}): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `CREATE x_draft_note SET account = $a, mode = $m, note = $note, keep = $keep, active = $keep, tweet_text = $t,
       draft_before = $b, draft_after = $af, at = time::now()`,
    { a: n.account, m: n.mode, note: n.note, keep: n.keep, t: n.tweet, b: n.before, af: n.after },
  );
  if (!rows || rows.length !== 1) throw new Error('[x.ask-draft] 点评没记上');
}

/** 停掉 / 恢复一条长期要求(行不删,留痕) */
export async function setDraftRuleActive(account: string, id: string, active: boolean): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `UPDATE type::record('x_draft_note', $id) SET active = $v WHERE account = $a AND keep = true`,
    { id, v: active, a: account },
  );
  if (!rows || rows.length !== 1) throw new Error('[x.ask-draft] 没找到这条长期要求');
}

export type AskDraft =
  | { readonly ok: true; readonly text: string; readonly examples: number; readonly ms: number; readonly model: string;
      /** 长期要求几条;这次的点评没记上的原因(草稿照给,但要说出来) */
      readonly rules?: number; readonly noteProblem?: string;
      /** 外语草稿的中文意思(回译);回译失败给原因 */
      readonly meaning?: string; readonly meaningProblem?: string }
  | { readonly ok: false; readonly why: string };

export async function draftAskReply(input: {
  readonly account: string;
  readonly tweet: string;
  readonly person: { readonly name?: string; readonly bio?: string };
  readonly mode?: 'ask' | 'engage' | 'vpn';
  readonly context?: string;
  /** ⭐ 按点评改上一版;keep = 以后都这样(成长期要求) */
  readonly revise?: { readonly previous: string; readonly note: string; readonly keep: boolean };
  /** ⭐ 回复求助(mode = vpn,2026-10-23):试用链接(逐字、带来源标识)/ 语言 / 他要出去还是回国 */
  readonly vpn?: { readonly link: string; readonly lang: ReplyLang; readonly direction?: 'out' | 'in' | 'none' };
}): Promise<AskDraft> {
  const mode = input.mode ?? 'ask';
  if (mode === 'vpn' && !input.vpn) return { ok: false, why: '回复求助缺试用链接' };
  const examples = await readAskExamples(input.account, mode);
  /**
   * 这次勾了「以后都这样」:这一次就当长期要求用;**草稿成了才记成长期要求**
   * (10-22 真机:先记后拟,草稿被拒时要求已经存下,人以为没生效又点了两次 → 三条长期要求)
   */
  const rules = [...(await readDraftRules(input.account, mode)).map((r) => r.note), ...(input.revise?.keep ? [input.revise.note] : [])];
  const t0 = Date.now();
  let raw: string;
  try {
    /**
     * ⚠️ think: false —— Gemma 4 默认先思考:真机一条 30~80 秒(5 条里 3 条 90 秒超时);关掉 1~2 秒,质量差不多(2026-10-21 实测)
     */
    raw = (await callOllamaChat({
      model: ASK_DRAFT_MODEL,
      messages: mode === 'vpn' && input.vpn
        ? buildVpnReplyPrompt({ tweet: input.tweet, lang: input.vpn.lang, link: input.vpn.link, direction: input.vpn.direction, context: input.context, examples, rules,
          revise: input.revise ? { previous: input.revise.previous, note: input.revise.note } : undefined })
        : buildAskDraftPrompt({ examples, tweet: input.tweet, person: input.person, mode: input.mode, context: input.context, rules,
          revise: input.revise ? { previous: input.revise.previous, note: input.revise.note } : undefined }),
      think: false, temperature: 0.8, timeoutMs: 60_000,
    })).content;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, why: /model.*not found|404/i.test(why) ? `本机还没装 ${ASK_DRAFT_MODEL}(ollama pull ${ASK_DRAFT_MODEL})` : `Gemma 没回:${why}` };
  }
  const c = mode === 'vpn' && input.vpn ? cleanVpnDraft(raw, input.vpn.link) : cleanAskDraft(raw);
  const ms = Date.now() - t0;
  if ('problem' in c) {
    console.warn(`[x.ask-draft] 草稿不合格:${c.problem} —— 原文「${clip(raw, 80)}」`);
    return { ok: false, why: `草稿不合格:${c.problem}` };
  }
  console.log(`[x.ask-draft] ${ms}ms · 范例 ${examples.length} 条 · 长期要求 ${rules.length} 条${input.revise ? ` · 按点评「${clip(input.revise.note, 30)}」改` : ''} · 「${c.text}」`);
  /** 记下这次点评:改前 / 点评 / 改后;勾了「以后都这样」的从此成长期要求 */
  let noteProblem: string | undefined;
  if (input.revise) {
    await recordDraftNote({ account: input.account, mode, note: input.revise.note, keep: input.revise.keep, tweet: input.tweet, before: input.revise.previous, after: c.text })
      .catch((e) => { noteProblem = e instanceof Error ? e.message : String(e); console.warn(`[x.ask-draft] 点评没记上:${noteProblem}`); });
  }
  /** ⭐ 外语草稿:回译成中文给你看(人工确认在外语上成立的前提) */
  let meaning: string | undefined;
  let meaningProblem: string | undefined;
  if (!CJK.test(c.text)) {
    const tr = await googleTranslate(c.text, 'zh-CN');
    if (tr?.text) meaning = tr.text; else meaningProblem = '没回译成中文(Google 翻译没回)—— 发之前自己看懂它';
  }
  return { ok: true, text: c.text, examples: examples.length, ms, model: ASK_DRAFT_MODEL, rules: rules.length, noteProblem, meaning, meaningProblem };
}
