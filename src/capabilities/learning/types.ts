/**
 * learning capability — 对外类型(L5-B3.20a)
 *
 * view 通过 requireCapabilityApi<LearningApi>('learning') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界)。
 */

export interface VocabEntry {
  id: string;
  /** normalized lowercase */
  word: string;
  definition: string;
  /** 添加生词时的句子上下文(可选)*/
  context?: string;
  /** 音标(可选)*/
  phonetic?: string;
  createdAt: number;
}

export interface DictionaryLookupResult {
  word: string;
  definition: string;
  phonetic?: string;
  /** 'macOS Dictionary' / 'Google Translate' / 字典名 */
  source: string;
}

export interface TranslateResult {
  text: string;
  sourceLang: string;
  targetLang: string;
}

/** view 业务路径 API(扁平化,对齐 ytdlp / media-storage 风格)*/
export interface LearningApi {
  // ── vocab CRUD + 订阅 ──

  /** 添加生词;失败(参数非法 / 写文件失败)返 null */
  vocabAdd(
    word: string,
    definition: string,
    context?: string,
    phonetic?: string,
  ): Promise<VocabEntry | null>;

  /** 删除生词(by id) */
  vocabRemove(id: string): Promise<void>;

  /** 全量列表,按 createdAt 倒序(最新加在前)*/
  vocabList(): Promise<VocabEntry[]>;

  /** 检查某 word 是否已在生词本(case-insensitive)*/
  vocabHas(word: string): Promise<boolean>;

  /** 订阅 vocab 变化(任何 add/remove 都推全量 list)— 返回 unsubscribe */
  onVocabChanged(callback: (entries: VocabEntry[]) => void): () => void;

  // ── dictionary ──

  /**
   * 词典查询
   * - macOS:swift CLI 调系统词典(质量最高)
   * - 其他平台:Google Translate fallback
   * - 都失败返 null
   */
  dictionaryLookup(word: string): Promise<DictionaryLookupResult | null>;

  // ── translate / tts ──

  /**
   * 文本翻译(Google 免费端点;反爬时返 null)
   * @param targetLang 默认 'zh-CN'
   */
  translate(text: string, targetLang?: string): Promise<TranslateResult | null>;

  /**
   * 文本转语音(Google 免费端点)
   * @returns MP3 二进制 ArrayBuffer;view 用 `new Blob([ab], { type: 'audio/mpeg' })` 创建
   *          object URL 给 audio 播放;失败返 null
   */
  tts(text: string, lang: string): Promise<ArrayBuffer | null>;

  /** UI 命名空间(S2 上提;view 通过 api.ui.* 拿工厂 / 触发函数,W5 合规) */
  readonly ui: LearningUiApi;
}

// ── ui 命名空间(typeof namespace import 模式,同 stage 04 text-editing.ui)──

import type * as DictionaryPanelIntegration from './ui/help-panel-integration';
import type * as ContextMenuFactory from './ui/context-menu/items';

/**
 * learning UI API(view 通过 requireCapabilityApi 取):
 * - dictionaryPanel.showLookup(word, ctx?) / showTranslate(text)  — 触发 help-panel
 * - contextMenu.createDictionaryLookupItem(viewId) / createTranslateItem(viewId)
 *   → 工厂返 ContextMenuItem,view 拼装到自己的 context-menu register 数组
 */
export interface LearningUiApi {
  readonly dictionaryPanel: typeof DictionaryPanelIntegration;
  readonly contextMenu: typeof ContextMenuFactory;
}
