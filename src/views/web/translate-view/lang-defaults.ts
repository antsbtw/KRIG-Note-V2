/**
 * 翻译目标语言:默认值检测 + 选项列表(L5-B4.2.2)
 *
 * 第一次启动(per-ws state 没 targetLang 字段)时,根据 navigator.language 自动选默认语言;
 * 中文系统 → zh-CN,日 → ja,韩 → ko,其他 → en。覆盖大多数用户的"母语"假设。
 *
 * 用户后续在 WebToolbar 下拉里手动改 → 写 per-ws state 持久化,后续从持久化读。
 */

export interface LangOption {
  /** Google Translate 支持的语言代码(传给 widget 用)*/
  value: string;
  /** UI 显示的语言名(用各自语言写,易于识别)*/
  label: string;
}

export const LANG_OPTIONS: ReadonlyArray<LangOption> = Object.freeze([
  { value: 'zh-CN', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
]);

/**
 * 第一次启动用 navigator.language 选默认翻译目标语言
 *
 * 简单匹配:zh* → zh-CN, ja* → ja, ko* → ko, 其他 → en
 * (跟 LANG_OPTIONS 一一对应,不引入 zh-TW 等其他变体,等用户反馈再扩)
 */
export function getDefaultTargetLang(): string {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

/** 给一个 lang code 找对应 label(下拉菜单/banner 里显示用)*/
export function getLangLabel(value: string): string {
  return LANG_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
