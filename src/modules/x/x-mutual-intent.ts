/**
 * ⭐⭐ 互关倾向 —— 算法层(2026-10-16,蓝V互关 M2)—— 纯函数,离线可测
 *
 * 用户 10-16:「对有蓝V有互关倾向的(比如写了蓝V互关/浇朋友等类似属于的Bio或者帖子),进行互动求关。」
 * 用户 10-08 定的覆盖规则:**人确认为最优先级,AI次之,算法最后。** → 算法只写 source 为空或 rule 的人。
 *
 * ── 词从哪来 ──
 * 真库互关蓝V 的 Bio 实际写法(10-16 查:互关必回 / 关注必回 / 有关必回 / 诚信互关 / 互关交友 / 互粉 …)。
 * M1 配方的搜索词**取自这里**,判断与搜索用同一份,不漂。
 * ⚠️ 不认单字「回关」:真库「直接回关小黑屋」(关小黑屋)。
 * ⚠️ 单独的「互关」:Bio 里照认;推文里也认,但**排除限制评论的说法**(真库「仅允许互关好友评论」)。
 *    10-16 真机第一次搜:推文里「互关互关😊」「互关的来喔」「帮你互关涨粉」「已互关」全是真求互关,
 *    第一版推文不认单独「互关」→ 10 个作者漏判 5 个。
 * ⚠️ 英文要按词边界:IFB 不能命中 IFBB(健美)。
 */

/** 判断用的中文词组 */
export const MUTUAL_PHRASES_ZH: readonly string[] = [
  '互关必回', '关注必回', '有关必回', '蓝V互关', '诚信互关', '互关交友', '互粉', '#互关', '#真诚交友',
];
/** 判断用的英文词 */
export const MUTUAL_PHRASES_EN: readonly string[] = ['follow back', 'followback', 'F4F', 'IFB'];

/**
 * ⭐⭐ M1 配方的**搜索词**(2026-10-16 第二版)—— 以**话题标签**为主。
 * 用户 10-16:「一般蓝V互关的特征是带了"#蓝V互关 #真诚交友"这样的特征,它给出一个搜索的标签。」
 * 第一版 8 个词组全加引号 + 蓝V + 中文 + 7 天 → X 只给 20 条(滚到底)。
 * ⚠️ 每个搜索词都必须是判断认得出的(测试钉着)—— 搜进来的人,判断要能说出依据。
 */
export const SEARCH_TERMS_ZH: readonly string[] = [
  '#蓝V互关', '#互关', '#真诚交友', '#浇朋友', '互关必回', '关注必回', '有关必回', '互关',
];
export const SEARCH_TERMS_EN: readonly string[] = ['#followback', 'follow back', 'F4F'];
/** 只用于判断的补充词组(搜起来太泛,判断时有用) */
/** ⭐ 「浇朋友」是用户 10-16 原话里的说法,真库也有(「浇个朋友,有关必回」)—— 10-16 预演后补上 */
const EXTRA_ZH: readonly string[] = ['必回关', '秒回关', '互关互赞', '求互关', '浇朋友', '浇个朋友', '蓝V回关', '永不取关'];
/** 单独的「互关」—— Bio 直接认;推文要先排除限制评论的说法 */
const PLAIN = '互关';
/** 「仅允许互关好友评论」「互关好友才能评论」—— 是在限制评论,不是求互关 */
const RESTRICT_RE = /允许互关|互关(好友|的人)?(才能|可以)?评论/;
/**
 * ⚠️ 「互关」是从别的词里拆出来的:相互关联 / 相互关系 / 互关联 —— 10-16 真库预演抓到
 * (新闻「该公司隶属于一个相互关联的中国黑客网络」被判成求互关)。**只看后一字**是「联/系」就不算。
 * ⚠️ 不能看前一字「相」:「相互关注」正是求互关(真库 1 人),「FB/相互关爱」也是(第二版这么写,预演抓到漏判)。
 */
function isPartOfOtherWord(text: string, at: number): boolean {
  return /[联系]/.test(text[at + PLAIN.length] ?? '');
}

export type IntentTweet = { readonly tweetId: string; readonly text: string };

export type IntentHit =
  | { readonly hit: true; readonly where: 'bio' | 'name' | 'tweet'; readonly phrase: string; readonly evidence: string; readonly tweetId?: string }
  | { readonly hit: false };

const EVIDENCE_MAX = 120;

/** 命中那一句(按换行 / 句末标点切)—— 给人看的依据,不是整段 Bio */
function sentenceAround(text: string, at: number, len: number): string {
  const stops = /[\n。！!？?]/;
  let s = at; while (s > 0 && !stops.test(text[s - 1])) s -= 1;
  let e = at + len; while (e < text.length && !stops.test(text[e])) e += 1;
  const line = text.slice(s, e).trim();
  return line.length > EVIDENCE_MAX ? `${line.slice(0, EVIDENCE_MAX)}…` : line;
}

function findPhrase(text: string, zh: readonly string[]): { phrase: string; at: number } | null {
  const lower = text.toLowerCase();
  for (const p of zh) {
    const i = lower.indexOf(p.toLowerCase());
    if (i >= 0) return { phrase: p, at: i };
  }
  for (const p of MUTUAL_PHRASES_EN) {
    const m = new RegExp(`(^|[^a-z0-9])${p.toLowerCase().replace(' ', '\\s+')}(?![a-z0-9])`).exec(lower);
    if (m) return { phrase: p, at: m.index + m[1].length };
  }
  return null;
}

/**
 * ⭐ 判断一个人有没有互关倾向:先看 Bio,再看他自己的推文(最新的在前)。
 * ⚠️ 推文只给**他自己发的**(转发的是别人的话,调用方要排除)。
 */
export function detectMutualIntent(
  bio: string | undefined, tweets: readonly IntentTweet[],
  /**
   * ⭐ 显示名(10-16 真机明细:「米丽（蓝V互关）」「wh（互关版）」「Liberte（互关）」—— 写在名字上的信号最强)。
   * 规则同 Bio(单独「互关」也认)。
   */
  name?: string,
): IntentHit {
  const all = [...MUTUAL_PHRASES_ZH, ...EXTRA_ZH];
  if (bio) {
    const f = findPhrase(bio, all) ?? findPlain(bio, false);
    if (f) return { hit: true, where: 'bio', phrase: f.phrase, evidence: sentenceAround(bio, f.at, f.phrase.length) };
  }
  if (name) {
    const f = findPhrase(name, all) ?? findPlain(name, false);
    if (f) return { hit: true, where: 'name', phrase: f.phrase, evidence: name.trim() };
  }
  for (const t of tweets) {
    const f = findPhrase(t.text, all) ?? findPlain(t.text, true);
    if (f) return { hit: true, where: 'tweet', phrase: f.phrase, evidence: sentenceAround(t.text, f.at, f.phrase.length), tweetId: t.tweetId };
  }
  return { hit: false };
}

/** 单独的「互关」:拆自别的词的不算;推文里所在那一句是在限制评论的,也不算 */
function findPlain(text: string, isTweet: boolean): { phrase: string; at: number } | null {
  let i = text.indexOf(PLAIN);
  while (i >= 0) {
    const ok = !isPartOfOtherWord(text, i) && !(isTweet && RESTRICT_RE.test(sentenceAround(text, i, PLAIN.length)));
    if (ok) return { phrase: PLAIN, at: i };
    i = text.indexOf(PLAIN, i + PLAIN.length);
  }
  return null;
}

/** 人表里这个人现在的倾向状态 */
export type IntentNow = {
  readonly mutual_intent?: boolean;
  readonly mutual_intent_source?: string;
  readonly mutual_intent_evidence?: string;
};

/** 依据存成一行文字:「Bio:…」/「推文 123:…」 */
export function evidenceText(h: Extract<IntentHit, { hit: true }>): string {
  if (h.where === 'bio') return `Bio:${h.evidence}`;
  if (h.where === 'name') return `名字:${h.evidence}`;
  return `推文 ${h.tweetId ?? '?'}:${h.evidence}`;
}

/**
 * ⭐⭐ 算法这次该对这个人做什么:
 * · 人或 AI 定过 → 不动(人 > AI > 算法)
 * · 命中且与库里一致 → 不动;命中但不同 → 写
 * · 没命中、而库里是算法以前写的 → 清掉(规则可重算,派生不留残)
 */
export function planIntentRuleWrite(now: IntentNow, h: IntentHit): 'skip-higher' | 'same' | 'set' | 'clear' | 'none' {
  const src = now.mutual_intent_source;
  if (src !== undefined && src !== 'rule') return 'skip-higher';
  if (h.hit) {
    return src === 'rule' && now.mutual_intent === true && now.mutual_intent_evidence === evidenceText(h) ? 'same' : 'set';
  }
  return src === 'rule' ? 'clear' : 'none';
}

/** ⚠️ UPDATE 不存在的人返回空不报错 —— repo 必须检查返回行数 */
export const SET_INTENT_RULE_SQL = `UPDATE type::record('x_author', $rest_id) SET
  mutual_intent = true, mutual_intent_source = 'rule', mutual_intent_evidence = $evidence, mutual_intent_at = time::now()
  RETURN rest_id;`;
export const CLEAR_INTENT_RULE_SQL = `UPDATE type::record('x_author', $rest_id) SET
  mutual_intent = NONE, mutual_intent_source = NONE, mutual_intent_evidence = NONE, mutual_intent_at = NONE
  RETURN rest_id;`;
/** 人的决定 —— 有/无都存成 human(存「无」而不是清空:清空的话算法下次又会标上) */
export const SET_INTENT_HUMAN_SQL = `UPDATE type::record('x_author', $rest_id) SET
  mutual_intent = $value, mutual_intent_source = 'human', mutual_intent_at = time::now()
  RETURN rest_id, mutual_intent;`;
