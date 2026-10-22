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
 * · 只写中文:外语回复人审不出来(记忆 project-x-multilang-reply-risk)
 */
import { getXDB } from '@storage/surreal/client';
import { callOllamaChat } from '@platform/main/local-llm/ollama-client';

export const ASK_DRAFT_MODEL = 'gemma4:12b';
const MAX_EXAMPLES = 12;
const MAX_CHARS = 60;

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
  readonly mode?: 'ask' | 'engage';
  /** ⭐ 对话上文(原帖 → 来回 → 要回的这条;2026-10-22)—— 有就附上,回复才接得上 */
  readonly context?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const engage = input.mode === 'engage';
  const sys = [
    engage
      ? '你替一个中文 X(推特)蓝V用户回复他已经互相关注的朋友的帖子,目的是保持往来、让对方愿意聊下去。接住对方帖子里说的事回应,不要求关注、不要提「互关」。'
      : '你替一个中文 X(推特)蓝V用户写「求互关」的回复。他在别人和互关相关的帖子下面留言,目的是让对方回关他。',
    engage ? '口语、短、真诚,一两句话;可以附和、追问一句、或说说自己的看法。' : '照他自己写过的留言的口气和长短来写:口语、短、真诚,一两句话。',
    '规矩:只写中文;不超过 40 个字;不要 @ 任何人;不要链接;不要话题标签;不要编造你不知道的事(不提具体数字、产品、承诺);',
    '可以接住对方帖子里的一句话再求关;可以带一个表情,也可以不带。',
    '只输出这一条留言本身,不要引号,不要解释,不要前缀。',
  ].join('\n');
  const shots = input.examples.map((e, i) => `例 ${i + 1}\n他的帖子:${clip(e.tweet, 120)}\n我的留言:${e.reply.trim()}`).join('\n\n');
  const who = [input.person.name ? `对方名字:${clip(input.person.name, 40)}` : '', input.person.bio ? `对方简介:${clip(input.person.bio, 120)}` : ''].filter(Boolean).join('\n');
  const ctx = input.context && input.context.trim() !== '' ? `这条帖子所在的对话(从原帖开始):\n${input.context.slice(0, 1500)}\n\n` : '';
  const user = `${shots ? `下面是我以前亲手写的${engage ? '回复' : '求关留言'}:\n\n${shots}\n\n` : ''}${ctx}现在要回复的帖子:\n${clip(input.tweet, 280)}\n${who}\n\n我的留言:`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

/** 模型回来的文字收拾一下 + 校验;不合格回原因 —— 纯函数 */
export function cleanAskDraft(raw: string): { readonly text: string } | { readonly problem: string } {
  let t = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  t = t.replace(/^(我的留言|留言|回复)\s*[:：]\s*/, '').replace(/^["“「『'`]+|["”」』'`]+$/g, '').trim();
  if (t === '') return { problem: '模型回了空的' };
  if ([...t].length > MAX_CHARS) return { problem: `太长了(${[...t].length} 字)` };
  if (/@\w/.test(t)) return { problem: '带了 @(求关留言不 @ 人)' };
  if (/https?:\/\/|t\.co\/|www\./i.test(t)) return { problem: '带了链接' };
  if (/#\S/.test(t)) return { problem: '带了话题标签' };
  if (!/[一-鿿]/.test(t)) return { problem: '不是中文(外语留言你审不出来,不填)' };
  return { text: t };
}

/** 范例:你亲手写、发出去的(最新的在前)—— 求关取 x_ask,互动取 x_engage(两种口吻各学各的) */
export async function readAskExamples(account: string, mode: 'ask' | 'engage' = 'ask'): Promise<AskExample[]> {
  const table = mode === 'engage' ? 'x_engage' : 'x_ask';
  const [rows] = await getXDB().query<[Array<{ tweet_text: string; reply_text: string; at: string }>]>(
    `SELECT tweet_text, reply_text, <string> at AS at FROM ${table}
       WHERE account = $a AND reply_source = 'human' AND replied = 'ok' AND reply_text != '' ORDER BY at DESC LIMIT $n`,
    { a: account, n: MAX_EXAMPLES },
  );
  return (rows ?? []).map((r) => ({ tweet: r.tweet_text, reply: r.reply_text }));
}

export type AskDraft =
  | { readonly ok: true; readonly text: string; readonly examples: number; readonly ms: number; readonly model: string }
  | { readonly ok: false; readonly why: string };

export async function draftAskReply(input: {
  readonly account: string;
  readonly tweet: string;
  readonly person: { readonly name?: string; readonly bio?: string };
  readonly mode?: 'ask' | 'engage';
  readonly context?: string;
}): Promise<AskDraft> {
  const examples = await readAskExamples(input.account, input.mode ?? 'ask');
  const t0 = Date.now();
  let raw: string;
  try {
    /**
     * ⚠️ think: false —— Gemma 4 默认先思考:真机一条 30~80 秒(5 条里 3 条 90 秒超时);关掉 1~2 秒,质量差不多(2026-10-21 实测)
     */
    raw = (await callOllamaChat({
      model: ASK_DRAFT_MODEL, messages: buildAskDraftPrompt({ examples, tweet: input.tweet, person: input.person, mode: input.mode, context: input.context }),
      think: false, temperature: 0.8, timeoutMs: 60_000,
    })).content;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, why: /model.*not found|404/i.test(why) ? `本机还没装 ${ASK_DRAFT_MODEL}(ollama pull ${ASK_DRAFT_MODEL})` : `Gemma 没回:${why}` };
  }
  const c = cleanAskDraft(raw);
  const ms = Date.now() - t0;
  if ('problem' in c) {
    console.warn(`[x.ask-draft] 草稿不合格:${c.problem} —— 原文「${clip(raw, 80)}」`);
    return { ok: false, why: `草稿不合格:${c.problem}` };
  }
  console.log(`[x.ask-draft] ${ms}ms · 范例 ${examples.length} 条 · 「${c.text}」`);
  return { ok: true, text: c.text, examples: examples.length, ms, model: ASK_DRAFT_MODEL };
}
