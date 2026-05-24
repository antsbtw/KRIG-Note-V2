/**
 * ThoughtCard — V1 形态对齐(inline 展开/收起 + 蓝色 anchor 引文 + Editor + bottom actions)
 *
 * 见 V1 src/plugins/thought/components/ThoughtCard.tsx:
 *   - header click → toggle expanded(active 时自动展开 + scrollIntoView)
 *   - 收起时:仅显 icon + title + time + chevron(性能优化销毁 Editor)
 *   - 展开时:anchor 引文条(点 ↗ 跳源)+ Editor + bottom action bar
 *     (type 切换菜单 / 完成/重开 / 删除;ai-response 加复制)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { useCollisionPosition } from '@slot/frame-bindings/use-collision-position';
import type { ThoughtInfo } from '@capabilities/thought/types';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import { ThoughtCardEditor } from './ThoughtCardEditor';

interface ThoughtCardProps {
  thought: ThoughtInfo;
  isActive: boolean;
  onActivate: (id: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 深度优先遍历 PM 节点取所有 text node 的 text — 兼容 callout/toggleList 等容器节点
// (旧版只看一层 child,提取 AI 对话改用 ❓Callout/🔀Toggle 包装后,顶层 child 不是
//  text node 而是 paragraph,会取不到任何文字,导致"AI 思考中"骨架永不消失)
function collectText(node: Record<string, unknown>, out: string[]): void {
  if (node.type === 'text' && typeof node.text === 'string') {
    out.push(node.text);
    return;
  }
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(children)) {
    for (const c of children) collectText(c, out);
  }
}

function extractTitle(t: ThoughtInfo): string {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return '';
  for (const block of root.content) {
    const parts: string[] = [];
    collectText(block, parts);
    const joined = parts.join('').trim();
    if (joined) return joined.slice(0, 60);
  }
  return '';
}

// ── 标题 segments(text + mathInline 混排,给 KaTeX 渲染用) ──
// title 来自 thought.doc 第一段;为支持行内公式,深度遍历时把 mathInline 节点
// 抽出为独立 math segment(用 attrs.latex),其余文字按 text segment 平铺。

type TitleSegment = { kind: 'text'; text: string } | { kind: 'math'; latex: string };

function collectSegments(node: Record<string, unknown>, out: TitleSegment[]): void {
  if (node.type === 'text' && typeof node.text === 'string') {
    out.push({ kind: 'text', text: node.text });
    return;
  }
  if (node.type === 'mathInline') {
    const attrs = node.attrs as { latex?: string } | undefined;
    const latex = (attrs?.latex ?? '').trim();
    if (latex) out.push({ kind: 'math', latex });
    return;
  }
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(children)) {
    for (const c of children) collectSegments(c, out);
  }
}

function extractTitleSegments(t: ThoughtInfo): TitleSegment[] {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return [];
  for (const block of root.content) {
    const segs: TitleSegment[] = [];
    collectSegments(block, segs);
    const hasContent = segs.some(
      (s) => s.kind === 'math' || (s.kind === 'text' && s.text.trim().length > 0),
    );
    if (hasContent) return segs;
  }
  return [];
}

// ── anchor 引文条 $...$ markdown 解析 ──
// anchor.locator.preview(L7 升级前字段名 text)字面是从 Note 抓的源字符串,
// 带 markdown 风格 $f$ $X$ 等占位符。最小解析:扫 $...$ 配对(non-greedy,不跨段落),
// 命中转 math segment,其余按 text segment 平铺。不解析 *bold* / `code` 等其他 markdown。

function parseInlineMathInText(text: string): TitleSegment[] {
  if (!text) return [];
  const segments: TitleSegment[] = [];
  // non-greedy 匹配 $...$;避开转义 \$(用否定回溯不友好,简化:不支持转义,
  //   实际 anchor 文字罕见反斜杠 + $ 组合)
  const re = /\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ kind: 'text', text: text.slice(last, m.index) });
    }
    segments.push({ kind: 'math', latex: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments;
}

function extractFullText(t: ThoughtInfo): string {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return '';
  return root.content
    .map((block) => {
      const parts: string[] = [];
      collectText(block, parts);
      return parts.join('');
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

function anchorPreviewText(t: ThoughtInfo): string {
  if (!t.anchor) return '';
  // L7 升级(decision 026 §10.1 + 2026-05-21 用户拍板):
  // - note locator 字面 preview 字段(取代 V1 text)— 创建瞬间快照,UI 显示用
  // - book locator 字面 textContent 字段(EPUB 高亮选区文字;PDF 留 OCR 后续 PR)
  const loc = t.anchor.locator as { preview?: string; textContent?: string };
  return loc.preview ?? loc.textContent ?? '';
}

/**
 * 取 book anchor 的页码(简洁文字,2026-05-24 拍板:anchor 区不再大图,改页码)。
 * 截图字面进 thought.doc 第一行 image 节点(用户可保留/删除),anchor 区只显轻量定位提示。
 */
function anchorBookPageLabel(t: ThoughtInfo): string | null {
  if (t.anchor?.source !== 'book') return null;
  const loc = t.anchor.locator as { pageNum?: number };
  if (typeof loc.pageNum !== 'number' || loc.pageNum <= 0) return null;
  return `第 ${loc.pageNum} 页`;
}

export function ThoughtCard({ thought, isActive, onActivate }: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // V1 同模式:active 时自动展开 + scrollIntoView。
  // **deps 字面只 isActive** — 含 expanded 会让用户手动收起后立刻被 effect
  // 反弹回展开(active && !expanded → setExpanded(true)),用户无法 toggle 收起。
  // V1 src/plugins/thought/components/ThoughtCard.tsx:45 字面 deps:[isActive]。
  useEffect(() => {
    if (isActive && !expanded) setExpanded(true);
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  const meta = THOUGHT_TYPE_META[thought.type];
  const isAI = thought.type === 'ai-response';
  // KaTeX inline: title 来自 doc 第一段 segments,anchor 来自源字符串里 $...$ 配对
  const titleSegments = useMemo(() => extractTitleSegments(thought), [thought]);
  const hasTitleContent = titleSegments.length > 0;
  const isAiPending = isAI && !hasTitleContent;
  const anchorText = anchorPreviewText(thought);
  const anchorPageLabel = anchorBookPageLabel(thought);
  const anchorSegments = useMemo(() => parseInlineMathInText(anchorText), [anchorText]);
  // book → 页码;note/EPUB → 文字 preview;graph/canvas → 暂无
  const hasAnchorVisual = Boolean(anchorPageLabel) || Boolean(anchorText);
  const titleFallback = isAI
    ? (isAiPending ? 'AI 思考中...' : 'AI 回复')
    : '空思考';

  const cardClass = [
    'thought-card',
    isActive ? 'thought-card--active' : '',
    thought.resolved ? 'thought-card--resolved' : '',
  ].filter(Boolean).join(' ');

  const cardStyle = isActive
    ? { borderColor: meta.color, borderWidth: 2 }
    : undefined;

  const handleToggle = (): void => {
    setExpanded((p) => !p);
    onActivate(thought.id);
  };

  const handleScrollToSource = (e: React.MouseEvent): void => {
    e.stopPropagation();
    commandRegistry.execute('thought-view.scroll-to-source', thought.id);
  };

  const handleTypeChange = (newType: ThoughtType): void => {
    commandRegistry.execute('thought-view.change-type', {
      id: thought.id,
      type: newType,
    });
    setShowTypeMenu(false);
  };

  const handleResolve = (): void => {
    commandRegistry.execute('thought-view.toggle-resolve', thought.id);
  };

  const handleDelete = (): void => {
    commandRegistry.execute('thought-view.delete-thought', thought.id);
  };

  const handleCopyAi = (): void => {
    const text = extractFullText(thought);
    if (text) void navigator.clipboard?.writeText(text);
  };

  return (
    <div ref={cardRef} className={cardClass} style={cardStyle}>
      {/* Header */}
      <div className="thought-card__header" onClick={handleToggle}>
        <span className="thought-card__icon">{meta.icon}</span>
        <InlineSegments
          segments={titleSegments}
          fallback={titleFallback}
          className="thought-card__title"
          fallbackClassName="thought-card__title--fallback"
        />
        {isAI && thought.serviceId && (
          <span
            className="thought-card__service"
            style={{ color: meta.color }}
          >
            {thought.serviceId}
          </span>
        )}
        <span className="thought-card__time">{formatTime(thought.createdAt)}</span>
        <span className="thought-card__chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <>
          {/* Anchor 锚定凭证 — book 显示页码("第 X 页");note/EPUB 显示文字 preview。
              截图字面进 doc 第一行 image 节点(用户可保留/删除),不在 anchor 区重复展示。*/}
          {hasAnchorVisual && (
            <div
              className="thought-card__anchor"
              onClick={handleScrollToSource}
              title="点击跳转到原文位置"
              style={{ borderLeftColor: meta.color }}
            >
              {anchorPageLabel ? (
                <span className="thought-card__anchor-text">📖 {anchorPageLabel}</span>
              ) : (
                <InlineSegments
                  segments={anchorSegments}
                  fallback=""
                  className="thought-card__anchor-text"
                />
              )}
              <span className="thought-card__anchor-jump">↗</span>
            </div>
          )}

          {/* Editor 区(ai-response pending 时显 spinner 替代) */}
          {isAiPending ? (
            <div className="thought-card__ai-pending">
              <span className="thought-card__ai-spinner" aria-hidden>🤖</span>
              <span>AI 正在思考...</span>
            </div>
          ) : (
            <div className="thought-card__editor">
              <ThoughtCardEditor
                key={thought.id}
                thought={thought}
                readOnly={isAI}
              />
            </div>
          )}

          {/* Bottom action bar — ai-response 锁死 type(AI 回复不可伪装成手写思考)*/}
          <div className="thought-card__actions">
            {!isAI && (
              <TypeSwitcher
                currentType={thought.type}
                open={showTypeMenu}
                onToggle={() => setShowTypeMenu((p) => !p)}
                onSelect={(t) => {
                  handleTypeChange(t);
                  setShowTypeMenu(false);
                }}
              />
            )}

            {isAI && !isAiPending && (
              <button
                className="thought-card__action-btn"
                onClick={handleCopyAi}
                title="复制 Markdown"
              >
                📋 复制
              </button>
            )}

            <button
              className={`thought-card__action-btn ${thought.resolved ? 'thought-card__action-btn--resolved' : ''}`}
              onClick={handleResolve}
            >
              {thought.resolved ? '↩ 重开' : '√ 完成'}
            </button>

            <button
              className="thought-card__action-btn thought-card__action-btn--danger"
              onClick={handleDelete}
            >
              🗑
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── InlineSegments + InlineKaTeX ──
// 通用 inline 段渲染:text 直显,math 走 KaTeX。
// 用于 title(来自 PM doc 第一段 segments)和 anchor 引文条(来自 $...$ 解析)。
// 空 segments 走 fallback 占位文字(灰色 — 由 fallbackClassName 控制)。

interface InlineSegmentsProps {
  segments: TitleSegment[];
  fallback: string;
  className?: string;
  fallbackClassName?: string;
}

function InlineSegments({
  segments,
  fallback,
  className,
  fallbackClassName,
}: InlineSegmentsProps) {
  if (segments.length === 0) {
    const cls = [className, fallbackClassName].filter(Boolean).join(' ');
    return <span className={cls}>{fallback}</span>;
  }
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <InlineKaTeX key={i} latex={seg.latex} />
        ),
      )}
    </span>
  );
}

function InlineKaTeX({ latex }: { latex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(latex, ref.current, {
        throwOnError: false,
        displayMode: false,
        strict: false,
      });
    } catch {
      // throwOnError:false 已兜底,这里仅挡 katex 自身异常
      if (ref.current) ref.current.textContent = latex;
    }
  }, [latex]);
  return <span className="thought-card__inline-math" ref={ref} />;
}

// ── TypeSwitcher ──
// 触发按钮 inline,菜单走 fixed 浮层 + useCollisionPosition 自动 flip
// (V1 thought-card__type-menu position:absolute bottom:100% 在 V2 thought-view
//  toolbar 下方时被遮挡 — V2 用碰撞检测自动选向上/向下展开)。

interface TypeSwitcherProps {
  currentType: ThoughtType;
  open: boolean;
  onToggle: () => void;
  onSelect: (t: ThoughtType) => void;
}

function TypeSwitcher({ currentType, open, onToggle, onSelect }: TypeSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // open 状态变化时测 trigger 位置,作为 menu fixed 锚点(default 向上展开 —
  // anchor = trigger bottom-left;useCollisionPosition 检测下溢时自动翻为向下)。
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // 默认期望菜单底贴 trigger 顶上方 4px — collision hook anchorY 是 menu top,
    // 所以这里 anchorY = triggerTop - menuHeight - 4。但 menuHeight 在 hook 内测,
    // 这里 anchorY = triggerTop 直接给(hook 用 anchorY 测+flip):菜单默认向下展开,
    // 不符合 V1 向上语义。
    // V1 同款做法:anchorY = triggerTop - 估算高度。但 hook 是基于 "anchor 是默认
    // 展开位置 + 下溢翻上" 设计,这里反过来:我们想要默认向上 + 上溢翻下。
    // 简化:anchorY = triggerTop(用 hook 默认向下展开 → 命中遮挡时不变;
    //       不够好,因为 trigger 下方就是 viewport 下边距,几乎必下溢 → 翻上 → 命中)。
    // 折中:trigger 顶坐标给 anchorY,让 hook 总尝试向下,通常会触发翻上(因为卡片底
    // 接近 viewport 底)。
    setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }, [open]);

  const { x, y } = useCollisionPosition(menuRef, anchor.x, anchor.y);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      onToggle();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, onToggle]);

  const meta = THOUGHT_TYPE_META[currentType];

  return (
    <div className="thought-card__type-switcher">
      <button
        ref={triggerRef}
        className="thought-card__action-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {meta.icon} {meta.label} ▾
      </button>
      {open && (
        <div
          ref={menuRef}
          className="thought-card__type-menu"
          style={{ position: 'fixed', left: x, top: y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {USER_THOUGHT_TYPES.map((t) => (
            <button
              key={t}
              className={`thought-card__type-option ${t === currentType ? 'thought-card__type-option--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t);
              }}
            >
              {THOUGHT_TYPE_META[t].icon} {THOUGHT_TYPE_META[t].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
