/**
 * 回复反馈 —— 学习期的记录与判据
 *
 * 用户 2026-09-05 定的节奏:
 *   「先定一个学习期间,它所有的回复都经过我点击后方能发出,
 *     等到一定数量积累后,就可以让它自动回复了。」
 *
 * 本模块负责两件事:
 *  ① 记下「AI 写了什么 / 用户最终发了什么」—— 现在的 accept/reject
 *     **记不了「该回,但不该这么回」**,那个信息此前直接丢掉。
 *  ② 把「能不能放手」变成**可量化判据**(分语言算),而不是靠感觉。
 */

import { getXDB } from '@storage/surreal/client';
import type { ReplyLang, ReplySource, PosterKind } from '@shared/types/x-reply-types';

export interface ReplyFeedback {
  tweet_id: string;
  tweet_text: string;
  lang: ReplyLang;
  /** AI 写的原文(回落模板时是模板正文) */
  ai_text: string;
  source: ReplySource;
  /** 用户最终填进 X 的正文 */
  final_text: string;
  /** final_text !== ai_text */
  edited: boolean;
  action: 'filled' | 'dismissed';
  confidence?: number;
  ref?: string;
  ws_id?: string;
  /** ① 发推者判断 —— ⚠️模型据正文推断,非查证事实(库里无账号资料) */
  poster_kind?: PosterKind;
  /** ① 凭什么这么判 */
  poster_read?: string;
  /** ② 因由:对方为什么发这条推 */
  trigger?: string;
  /** ③ 之前的判断理由(worth 的 reason) */
  ai_reason?: string;
  /** 这条推是否在回复串里(AI 没看到上文) */
  in_thread?: boolean;
  created_at: string;
}

export async function insertReplyFeedback(fb: ReplyFeedback): Promise<void> {
  const db = getXDB();
  await db.query(
    `INSERT INTO x_reply_feedback {
      tweet_id: $tweet_id, tweet_text: $tweet_text, lang: $lang,
      ai_text: $ai_text, source: $source, final_text: $final_text,
      edited: $edited, action: $action, confidence: $confidence,
      ref: $ref, ws_id: $ws_id, created_at: $created_at,
      poster_kind: $poster_kind, poster_read: $poster_read,
      trigger: $trigger, ai_reason: $ai_reason, in_thread: $in_thread
    }`,
    {
      ...fb,
      confidence: fb.confidence ?? undefined,
      ref: fb.ref ?? undefined,
      ws_id: fb.ws_id ?? undefined,
      poster_kind: fb.poster_kind ?? undefined,
      poster_read: fb.poster_read ?? undefined,
      trigger: fb.trigger ?? undefined,
      ai_reason: fb.ai_reason ?? undefined,
      in_thread: fb.in_thread ?? false,
      created_at: new Date(fb.created_at),
    },
  );
}

/** 放手自动的门槛 —— 可调常量,不是硬编码在逻辑里的魔数 */
export const AUTO_REPLY_MIN_SAMPLES = 50;
export const AUTO_REPLY_MIN_PASS_RATE = 0.8;

export interface LangReadiness {
  lang: ReplyLang;
  /** 填入过的总条数(dismissed 不计:那是「不该回」,不是「回得不好」) */
  filled: number;
  /** 其中原样通过(没改一个字)的条数 */
  unedited: number;
  passRate: number;
  /** 是否达到放手门槛 */
  ready: boolean;
}

/**
 * 分语言统计「原样通过率」——**放手自动的唯一判据**。
 *
 * ⚠️ 必须分语言:中文可能早就够了,英文还差得远。
 * 合起来算会让样本多的那一边淹掉另一边,得出「整体达标」的假结论。
 *
 * ⚠️ 只统计 action='filled':dismissed 表示「这条根本不该回」,
 * 那是判断层的问题,不该算进「写得好不好」。
 */
export async function getReadiness(): Promise<LangReadiness[]> {
  const db = getXDB();
  const out: LangReadiness[] = [];
  for (const lang of ['zh', 'en'] as const) {
    const res = await db.query<[Array<{ c: number }>, Array<{ c: number }>]>(
      `SELECT count() AS c FROM x_reply_feedback
         WHERE lang = $lang AND action = 'filled' GROUP ALL;
       SELECT count() AS c FROM x_reply_feedback
         WHERE lang = $lang AND action = 'filled' AND edited = false GROUP ALL;`,
      { lang },
    );
    const filled = res?.[0]?.[0]?.c ?? 0;
    const unedited = res?.[1]?.[0]?.c ?? 0;
    const passRate = filled > 0 ? unedited / filled : 0;
    out.push({
      lang, filled, unedited, passRate,
      ready: filled >= AUTO_REPLY_MIN_SAMPLES && passRate >= AUTO_REPLY_MIN_PASS_RATE,
    });
  }
  return out;
}

/**
 * 取近期「用户原样认可」的例子,回流进生成 prompt 当少样本。
 *
 * ⚠️ 只取 edited=false 的:用户改过的说明 AI 那版**不够好**,
 * 拿它当范例是在教模型重复被否决的写法。
 * (用户改后的 final_text 更值得当范例,但那需要区分「改得多」还是
 *  「只改了个错别字」—— 先从最保守的做起。)
 */
export async function getApprovedExamples(
  lang: ReplyLang, limit = 5,
): Promise<Array<{ tweet: string; reply: string }>> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_text: string; final_text: string }>]>(
    `SELECT tweet_text, final_text FROM x_reply_feedback
       WHERE lang = $lang AND action = 'filled' AND edited = false
       ORDER BY created_at DESC LIMIT $limit`,
    { lang, limit },
  );
  return (res?.[0] ?? []).map((r) => ({ tweet: r.tweet_text, reply: r.final_text }));
}
