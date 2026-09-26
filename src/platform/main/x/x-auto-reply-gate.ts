/**
 * ⭐⭐ **自动回复闸门** —— 决定哪些草稿可以自动填进回复框。
 *
 * ── 用户 2026-09-26 拍板 ──
 * > 「设置Gemma开关，当用户对目前这批配方及答复满意后，打开开关，
 * >   Gemma自动选定回复数据。」
 * > 「这个是针对某一个配方来自动回复，而不是任意所有的配方吧？」
 *
 * ## ⭐⭐ 按配方,不是全局
 *
 * 用户订正的,理由很硬:实测(记忆 `project-x-keyword-precision`)
 * 不同配方的精确率**差一个数量级** ——
 * 英文 `blocked` **4%**、`censorship` **0%**,泛词改词组后能到 **62%**。
 * 全局开关会把「中文配方已调准」和「英文配方还在 4%」绑死:
 * 要么不敢开,要么开了就出事。
 *
 * ## ⚠️⚠️ 红线:自动只到「填进回复框」
 *
 * **发布仍然是人点**。用户省掉的是「挑哪条 + 写正文」,**不是「要不要发」**。
 * 这个开关**不松动**任何既有红线 —— 本模块只回答
 * 「这条能不能自动填」,**绝不调用任何发布原语**。
 *
 * ## ⚠️ 外语的额外约束
 *
 * 实测(记忆 `project-x-multilang-reply-risk`):Gemma 写中文 0 编造,
 * 但**俄语/波斯语会加清单外承诺**(「稳定运行」「最佳选择」)。
 * 而**人读不懂外语 = 人工确认这道闸本来就失效**。
 * ⭐ 所以自动路径**只放行中英**(落地页也只有中英两版)。
 */

import { getRecipeById } from '../db/search-recipe-repo';
import { verifyGeneratedReply } from '@shared/types/x-reply-facts';
import type { ReplyLang } from '@shared/types/x-reply-types';

/** 不放行的原因 —— 每条都对应一个实测过的真实风险 */
export type AutoBlockReason =
  /** 这条推不知道是哪个配方采来的 —— 无从判断该不该自动 */
  | 'no_recipe'
  /** 那个配方的开关没开 */
  | 'recipe_off'
  /** 配方查不到(被删了?) */
  | 'recipe_missing'
  /** 非中英 —— 人读不懂就确认不了,自动等于无人把关 */
  | 'lang_not_allowed'
  /** 模型自己就说不该回 */
  | 'not_worth'
  /** 正文没过程序校验(链接被改/带@/超长/最高级) */
  | 'verify_failed';

export interface AutoGateInput {
  /** 这条推是哪个配方采来的(`x_tweet.search_recipe`) */
  recipeId?: string;
  lang: ReplyLang | string;
  text: string;
  /** 落地页链接 —— 校验要用 */
  link: string;
  /** 模型觉得该不该回 */
  worth?: boolean;
}

export interface AutoGateResult {
  allowed: boolean;
  /** ⚠️ 不放行必须有原因 —— 否则「为什么没自动」又要靠猜 */
  reason?: AutoBlockReason;
  /** 给人看的一句话 */
  detail?: string;
}

/** ⭐ 自动路径只放行这两种语言(落地页也只有中英两版) */
const AUTO_LANGS = new Set(['zh', 'en']);

/**
 * 这条草稿能不能**自动填进回复框**。
 *
 * ⚠️ **默认拒绝**:任何一条判据不成立就不放行。
 * 自动回复出错的代价是不对称的 —— 少自动一条只是多点一次,
 * 自动发错一条是发到公开时间线上收不回来。
 *
 * ⚠️ 本函数**只读不写、不碰页面** —— 它只回答「能不能」。
 */
export async function canAutoReply(input: AutoGateInput): Promise<AutoGateResult> {
  /** ① 模型自己说不该回 —— 最先挡,省掉后面的查库 */
  if (input.worth === false) {
    return { allowed: false, reason: 'not_worth', detail: '模型判定这条不值得回' };
  }

  /** ② 语言 —— 人读不懂就等于没有人工确认这道闸 */
  if (!AUTO_LANGS.has(String(input.lang))) {
    return {
      allowed: false, reason: 'lang_not_allowed',
      detail: `${input.lang} 不在自动范围内（人读不懂就确认不了，且落地页只有中英两版）`,
    };
  }

  /** ③ 哪个配方 —— 没有来源就无从判断该不该自动 */
  const rid = input.recipeId?.trim();
  if (!rid) {
    return {
      allowed: false, reason: 'no_recipe',
      detail: '这条推没记来源配方，无法判断是否在自动范围内',
    };
  }

  const recipe = await getRecipeById(rid).catch(() => null);
  if (!recipe) {
    return { allowed: false, reason: 'recipe_missing', detail: `配方 ${rid} 查不到` };
  }
  /**
   * ④ ⭐⭐ **按配方的开关** —— 这是本模块存在的理由。
   * ⚠️ 判据是 `=== true` 不是 truthy:老配方没有这个字段,
   * 必须**默认关**,不能因为字段缺失而放行。
   */
  if (recipe.autoReply !== true) {
    return {
      allowed: false, reason: 'recipe_off',
      detail: `配方「${recipe.name}」没有打开自动回复`,
    };
  }

  /**
   * ⑤ ⭐ **正文照样过程序校验** —— 自动路径**更**要校验,不是更宽松:
   * 人工路径还有人过一眼,自动路径没有。
   * ⚠️ 链接被改写最隐蔽:发出去看不出来,但那次点击永远归不了因。
   */
  const bad = verifyGeneratedReply(input.text, input.link);
  if (bad) {
    return { allowed: false, reason: 'verify_failed', detail: `正文没过校验：${bad}` };
  }

  return { allowed: true };
}
