/**
 * DictionaryPanel — 字典查词 / 翻译 / 生词本面板(L5-B3.20b)
 *
 * V1 → V2 改写:src/plugins/note/learning/dictionary-panel.ts(V1 纯 DOM 436 行)→
 * V2 React 组件,L4.1 后从 popup-registry 迁到 help-panel-registry(右栏长侧栏)。
 *
 * 双模式 + 双 Tab:
 * - mode = 'lookup' / 'translate'(由 setPanelInitial 设置,help-panel 渲染时读)
 * - tab = 'lookup' / 'vocab'(用户切换)
 *
 * lookup 模式:并行查词 + 翻译,UI 显释义 + 中文 + TTS + 加生词本
 * translate 模式:仅翻译,UI 显原文 + 翻译 + TTS + 收藏
 *
 * vocab Tab:全量列表 + 搜索过滤 + 删除 + 点击回查词
 *
 * W5-A View 边界:走 requireCapabilityApi<LearningApi>('learning') 间接路由,
 * 不直 import @capabilities/learning 运行时函数(types 是类型 only,纯擦除可 import)。
 *
 * TTS 实现:Audio + Blob URL(B3.20a CSP fix 已含 blob:);组件级 cleanup
 * (上一个未结束的 audio 在新点击时 pause + revoke)。
 *
 * Header / × 关闭按钮:由 help-panel shell 提供,本组件只填 body。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HelpPanelCloseProps } from '@slot/interaction-registries/help-panel-registry/help-panel-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  LearningApi,
  DictionaryLookupResult,
  VocabEntry,
} from '@capabilities/learning/types';
import './dictionary-panel.css';

// 模块级"待显示"状态(setPanelInitial 写入,help-panel 组件 mount 时读取)
let pendingMode: 'lookup' | 'translate' = 'lookup';
let pendingText = '';
let pendingContext: string | undefined;

export function setPanelInitial(
  mode: 'lookup' | 'translate',
  text: string,
  context?: string,
): void {
  pendingMode = mode;
  pendingText = text;
  pendingContext = context;
}

interface AudioRef {
  audio: HTMLAudioElement | null;
  url: string | null;
}

export function DictionaryPanel(_props: HelpPanelCloseProps) {
  const learning = useMemo(() => requireCapabilityApi<LearningApi>('learning'), []);

  // 初始模式 + 文本(组件级常量,popup 内部不切换 — 切换走"重新打开 popup")
  const [mode] = useState(pendingMode);
  const [text] = useState(pendingText);
  const [context] = useState(pendingContext);

  // Tab 状态
  const [tab, setTab] = useState<'lookup' | 'vocab'>('lookup');

  // lookup / translate 数据
  const [lookup, setLookup] = useState<DictionaryLookupResult | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // vocab 数据
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [vocabLoaded, setVocabLoaded] = useState(false);

  // 添加生词本状态(防重复加 + 显 ✓ 已添加)
  const [addedToVocab, setAddedToVocab] = useState(false);

  // TTS audio 引用(组件级 cleanup)
  const audioRef = useRef<AudioRef>({ audio: null, url: null });

  // 初次加载查词 / 翻译
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (mode === 'lookup') {
      Promise.all([learning.dictionaryLookup(text), learning.translate(text)]).then(
        ([d, t]) => {
          if (cancelled) return;
          setLookup(d);
          setTranslation(t?.text ?? null);
          setLoading(false);
        },
      );
    } else {
      learning.translate(text).then((t) => {
        if (cancelled) return;
        setTranslation(t?.text ?? null);
        setLoading(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [mode, text, learning]);

  // 切到 vocab Tab 时取列表(同时检测当前 text 是否已在 vocab)
  useEffect(() => {
    if (tab !== 'vocab' && !vocabLoaded) {
      // lookup Tab 也需要 vocab 列表来判断 addedToVocab 状态
      learning.vocabList().then((entries) => {
        setVocab(entries);
        setVocabLoaded(true);
        const normalized = text.toLowerCase().trim();
        setAddedToVocab(entries.some((e) => e.word === normalized));
      });
    } else if (tab === 'vocab') {
      learning.vocabList().then((entries) => {
        setVocab(entries);
        setVocabLoaded(true);
      });
    }
  }, [tab, learning, text, vocabLoaded]);

  // 组件 unmount 清理 TTS audio
  useEffect(() => {
    return () => {
      const ref = audioRef.current;
      if (ref.audio) ref.audio.pause();
      if (ref.url) URL.revokeObjectURL(ref.url);
    };
  }, []);

  function playTTS(t: string, lang = 'en'): void {
    // 上一个未结束的先 pause + revoke
    const ref = audioRef.current;
    if (ref.audio) {
      ref.audio.pause();
      ref.audio = null;
    }
    if (ref.url) {
      URL.revokeObjectURL(ref.url);
      ref.url = null;
    }
    void learning.tts(t, lang).then((buf) => {
      if (!buf) return;
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      ref.url = URL.createObjectURL(blob);
      ref.audio = new Audio(ref.url);
      ref.audio.play().catch(() => {
        /* ignore play errors */
      });
    });
  }

  async function handleAddToVocab(): Promise<void> {
    const definition = lookup?.definition || translation || '';
    if (!definition) return;
    const phonetic = lookup?.phonetic;
    const entry = await learning.vocabAdd(text, definition, context, phonetic);
    if (entry) {
      setAddedToVocab(true);
      // 重新拉 vocab list(addedToVocab 变化由用户重开面板时下次 useEffect 触发同步)
      const list = await learning.vocabList();
      setVocab(list);
    }
  }

  async function handleRemoveVocab(id: string): Promise<void> {
    await learning.vocabRemove(id);
    const list = await learning.vocabList();
    setVocab(list);
    // 如果删的是当前 text,addedToVocab 状态切回 false
    const normalized = text.toLowerCase().trim();
    setAddedToVocab(list.some((e) => e.word === normalized));
  }

  // 过滤 vocab
  const filtered = useMemo(() => {
    if (!filter) return vocab;
    const f = filter.toLowerCase();
    return vocab.filter(
      (e) => e.word.includes(f) || e.definition.toLowerCase().includes(f),
    );
  }, [vocab, filter]);

  // 渲染(header / × 关闭按钮由 help-panel shell 提供;本组件只填 body)
  return (
    <div className="krig-dictionary-panel">
      {/* Tabs */}
      <div className="krig-dictionary-panel__tabs">
        <button
          type="button"
          className={
            'krig-dictionary-panel__tab' +
            (tab === 'lookup' ? ' krig-dictionary-panel__tab--active' : '')
          }
          onClick={() => setTab('lookup')}
        >
          {mode === 'translate' ? '翻译' : '查词'}
        </button>
        <button
          type="button"
          className={
            'krig-dictionary-panel__tab' +
            (tab === 'vocab' ? ' krig-dictionary-panel__tab--active' : '')
          }
          onClick={() => setTab('vocab')}
        >
          生词本
        </button>
      </div>

      {/* Body */}
      <div className="krig-dictionary-panel__body">
        {tab === 'lookup' ? (
          <LookupView
            mode={mode}
            text={text}
            lookup={lookup}
            translation={translation}
            loading={loading}
            addedToVocab={addedToVocab}
            onAddVocab={handleAddToVocab}
            onTTS={playTTS}
          />
        ) : (
          <VocabView
            entries={filtered}
            filter={filter}
            onFilterChange={setFilter}
            onRemove={handleRemoveVocab}
            onTTS={playTTS}
          />
        )}
      </div>
    </div>
  );
}

// ─── 子组件:lookup / translate 视图 ──────────────────────────

interface LookupViewProps {
  mode: 'lookup' | 'translate';
  text: string;
  lookup: DictionaryLookupResult | null;
  translation: string | null;
  loading: boolean;
  addedToVocab: boolean;
  onAddVocab: () => void;
  onTTS: (text: string, lang?: string) => void;
}

function LookupView(props: LookupViewProps) {
  const { mode, text, lookup, translation, loading, addedToVocab, onAddVocab, onTTS } = props;

  if (loading) {
    return (
      <div className="krig-dictionary-panel__loading">
        <div className="krig-dictionary-panel__word">
          {text.length > 60 ? text.slice(0, 60) + '...' : text}
        </div>
        <div className="krig-dictionary-panel__hint">
          {mode === 'translate' ? '翻译中...' : '查询中...'}
        </div>
      </div>
    );
  }

  if (!lookup && !translation) {
    return (
      <div className="krig-dictionary-panel__loading">
        <div className="krig-dictionary-panel__word">{text}</div>
        <div className="krig-dictionary-panel__hint">
          {mode === 'translate' ? '翻译失败' : '未找到释义'}
        </div>
      </div>
    );
  }

  // translate 模式
  if (mode === 'translate') {
    return (
      <div>
        <div className="krig-dictionary-panel__section-label">
          原文{' '}
          <button
            type="button"
            className="krig-dictionary-panel__tts-btn"
            onClick={() => onTTS(text, 'en')}
            title="发音"
          >
            🔊
          </button>
        </div>
        <div className="krig-dictionary-panel__original">{text}</div>
        {translation && (
          <>
            <div
              className="krig-dictionary-panel__section-label"
              style={{ marginTop: 12 }}
            >
              翻译{' '}
              <button
                type="button"
                className="krig-dictionary-panel__tts-btn"
                onClick={() => onTTS(translation, 'zh-CN')}
                title="发音"
              >
                🔊
              </button>
            </div>
            <div className="krig-dictionary-panel__translate-text">{translation}</div>
            <div className="krig-dictionary-panel__source">来源:Google Translate</div>
          </>
        )}
        <div className="krig-dictionary-panel__actions">
          <button
            type="button"
            className={
              'krig-dictionary-panel__add-btn' +
              (addedToVocab ? ' krig-dictionary-panel__add-btn--added' : '')
            }
            onClick={onAddVocab}
            disabled={addedToVocab}
          >
            {addedToVocab ? '✓ 已收藏' : '+ 收藏到生词本'}
          </button>
        </div>
      </div>
    );
  }

  // lookup 模式
  const word = lookup?.word || text;
  return (
    <div>
      <div className="krig-dictionary-panel__word">
        {word}{' '}
        <button
          type="button"
          className="krig-dictionary-panel__tts-btn"
          onClick={() => onTTS(word, 'en')}
          title="发音"
        >
          🔊
        </button>
      </div>
      {lookup?.phonetic && (
        <div className="krig-dictionary-panel__phonetic">{lookup.phonetic}</div>
      )}
      {lookup && (
        <>
          <div className="krig-dictionary-panel__definition">{lookup.definition}</div>
          <div className="krig-dictionary-panel__source">来源:{lookup.source}</div>
        </>
      )}
      {translation && (
        <div className="krig-dictionary-panel__translate-section">
          <div className="krig-dictionary-panel__section-label">
            中文翻译{' '}
            <button
              type="button"
              className="krig-dictionary-panel__tts-btn"
              onClick={() => onTTS(translation, 'zh-CN')}
              title="发音"
            >
              🔊
            </button>
          </div>
          <div className="krig-dictionary-panel__translate-text">{translation}</div>
        </div>
      )}
      <div className="krig-dictionary-panel__actions">
        <button
          type="button"
          className={
            'krig-dictionary-panel__add-btn' +
            (addedToVocab ? ' krig-dictionary-panel__add-btn--added' : '')
          }
          onClick={onAddVocab}
          disabled={addedToVocab}
        >
          {addedToVocab ? '✓ 已在生词本' : '+ 添加到生词本'}
        </button>
      </div>
    </div>
  );
}

// ─── 子组件:vocab 列表 ──────────────────────────────────────

interface VocabViewProps {
  entries: VocabEntry[];
  filter: string;
  onFilterChange: (v: string) => void;
  onRemove: (id: string) => void;
  onTTS: (text: string, lang?: string) => void;
}

function VocabView(props: VocabViewProps) {
  const { entries, filter, onFilterChange, onRemove, onTTS } = props;

  return (
    <div>
      <input
        type="text"
        className="krig-dictionary-panel__search"
        placeholder="搜索生词..."
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
      />
      {entries.length === 0 ? (
        <div className="krig-dictionary-panel__empty">
          {filter ? '未找到匹配的生词' : '生词本为空'}
        </div>
      ) : (
        <div className="krig-dictionary-panel__entries">
          {entries.map((entry) => {
            const isPhrase = entry.word.includes(' ');
            const displayWord =
              entry.word.length > 50 ? entry.word.slice(0, 50) + '...' : entry.word;
            const defLimit = isPhrase ? 60 : 100;
            const displayDef =
              entry.definition.length > defLimit
                ? entry.definition.slice(0, defLimit) + '...'
                : entry.definition;
            return (
              <div
                key={entry.id}
                className={
                  'krig-dictionary-panel__entry' +
                  (isPhrase ? ' krig-dictionary-panel__entry--phrase' : '')
                }
              >
                <div className="krig-dictionary-panel__entry-info">
                  <div className="krig-dictionary-panel__entry-word">
                    {displayWord}{' '}
                    <button
                      type="button"
                      className="krig-dictionary-panel__tts-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTTS(entry.word, isPhrase ? 'en' : 'en');
                      }}
                      title="发音"
                    >
                      🔊
                    </button>
                  </div>
                  <div className="krig-dictionary-panel__entry-def">{displayDef}</div>
                </div>
                <button
                  type="button"
                  className="krig-dictionary-panel__entry-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(entry.id);
                  }}
                  title="删除"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
