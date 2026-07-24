/**
 * Google 翻译免费端点封装（无需 API key）
 * 用于推文非中文内容的实时翻译，替代 Gemma 本地翻译（速度慢、占资源）
 */

const GT_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * 翻译单条文本到中文。
 * 失败时返回 null（非致命，调用方决定是否重试）。
 */
export async function googleTranslate(text: string, targetLang = 'zh-CN'): Promise<string | null> {
  const url = `${GT_ENDPOINT}?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json() as unknown[][];
    // 返回结构: [[["译文","原文",null,null,1],...],null,"检测语言",...]
    const segments = json[0];
    if (!Array.isArray(segments)) return null;
    const translation = (segments as Array<string[]>)
      .map((s) => s[0])
      .filter(Boolean)
      .join('');
    return translation.trim() || null;
  } catch (err) {
    console.warn('[googleTranslate] failed:', (err as Error).message);
    return null;
  }
}

/**
 * 批量翻译，返回 tweetId → translation 的 Map。
 * 逐条请求（Google 翻译接口不支持批量），失败条目静默跳过。
 */
export async function googleTranslateBatch(
  items: Array<{ tweetId: string; text: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const item of items) {
    const translation = await googleTranslate(item.text);
    if (translation) result.set(item.tweetId, translation);
  }
  return result;
}
