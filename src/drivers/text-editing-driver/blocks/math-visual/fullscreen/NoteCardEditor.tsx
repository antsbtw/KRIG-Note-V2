/**
 * NoteCardEditor — 说明卡片原地编辑浮层(2026-11-06,用户选 A:画布上双击卡片原地编辑)
 *
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §四·附二
 *
 * - 编辑器 = text-editing.Host(与 note / 画板文字节点同一个),不复用 canvas-text-node 的
 *   EditOverlay:那是全局单例浮层,画板视图也挂着,同窗口开着画板会弹出两个编辑框。
 * - 菜单用自己的 viewId 注册完整一套(照 diglot 语义面 mind-semantic-menus.ts):斜杠 / ⋮⋮ 手柄 /
 *   浮动工具条。菜单内容按 viewId 注册,不注册 → 敲 / 弹空菜单、点手柄弹空菜单。
 *   斜杠项与手柄「转换为…」都过「编辑能插 ⊆ 渲染能渲」闸(与画板共用 lib/atom-serializers/svg/
 *   slash-render-gate):卡片是 atomsToSvg 画出来的,插了画不出的块会变灰字 / 丢内容。
 * - 全屏期间斜杠菜单等浮层由 FullscreenOverlayBinding 挂(shell 层,2026-11-06 修:原先挂在
 *   workspace 里,全屏时整层 display:none,菜单根本出不来)。
 * - doc 只在打开时给一次(useState 初值):Host 内 useEffect[doc] 引用一变就重建,
 *   每次渲染现造 doc = 光标跳回开头(记忆:嵌 note 编辑器三坑)。
 *
 * 退出:点浮层外 / ⌘↩ 提交;Esc 也提交(防丢内容),但块选中态下 Esc 归编辑器(选块→删块)。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import type { TextEditingApi, DriverSerialized } from '@capabilities/text-editing/types';
import {
  filterSlashItemsToRenderable,
  filterHandleItemsToRenderable,
} from '../../../../../lib/atom-serializers/svg/slash-render-gate';
import type { TextEditingPluginToggles } from '../../../types';
import type { NoteDoc } from '../types';

export const MV_CARD_VIEW_ID = 'math-visual-card';

/**
 * 卡片编辑 = note 编辑(用户 2026-11-06:「没有 block、没有 slash 的格式化能力不行」)。
 * 只关掉在卡片里落不了地的:词汇高亮(学习专属)、[[ 双链(知识图谱专属)、粘贴图片(渲染器画不了图片)、
 * 标题折叠(卡片是静态图,点不了三角)。
 */
const CARD_PLUGIN_PRESET: TextEditingPluginToggles = {
  blockHandle: true,
  vocabHighlight: false,
  noteLinkCommand: false,
  pasteMedia: false,
  dropCursor: true,
  slash: true,
  headingCollapse: false,
  bottomPad: true,
};

let menusRegistered = false;
/** 注册本 viewId 的浮动工具条 + 斜杠菜单;幂等(菜单按 viewId 不按文档) */
function ensureCardMenus(api: TextEditingApi): void {
  if (menusRegistered) return;
  menusRegistered = true;
  const ui = api.ui;
  floatingToolbarRegistry.register([
    ...ui.floatingToolbar.createMarkButtons(MV_CARD_VIEW_ID),
    ui.floatingToolbar.createMathButton(MV_CARD_VIEW_ID),
    ui.floatingToolbar.createLinkButton(MV_CARD_VIEW_ID),
    ui.floatingToolbar.createColorButton(MV_CARD_VIEW_ID),
  ]);
  slashRegistry.register(
    filterSlashItemsToRenderable([
      ...ui.slashMenu.createTurnIntoItems(MV_CARD_VIEW_ID),
      ui.slashMenu.createMathBlockItem(MV_CARD_VIEW_ID),
    ]),
  );
  // ⋮⋮ 手柄:转换 / 颜色 / 格式 / 复制·删除块(不注册标题折叠:卡片是静态图)
  handleRegistry.register(
    filterHandleItemsToRenderable([
      ui.handleMenu.createTurnIntoContainer(MV_CARD_VIEW_ID),
      ui.handleMenu.createColorContainer(MV_CARD_VIEW_ID),
      ui.handleMenu.createFormatContainer(MV_CARD_VIEW_ID),
      ...ui.handleMenu.createTurnIntoSubmenu(MV_CARD_VIEW_ID),
      ...ui.handleMenu.createBlockActions(MV_CARD_VIEW_ID),
    ]),
  );
}

export interface NoteCardEditorProps {
  /** 被编辑的图形 id */
  shapeId: string;
  initialDoc: NoteDoc;
  /** 屏幕坐标(fixed) */
  left: number;
  top: number;
  width: number;
  minHeight: number;
  /** 提交(doc)或放弃(null) */
  onExit: (doc: NoteDoc | null) => void;
}

export const NoteCardEditor: React.FC<NoteCardEditorProps> = ({
  shapeId, initialDoc, left, top, width, minHeight, onExit,
}) => {
  const api = requireCapabilityApi<TextEditingApi>('text-editing');
  ensureCardMenus(api);

  // doc 只给一次;编辑中的最新内容放 ref
  const [doc] = useState<DriverSerialized>(() => initialDoc as unknown as DriverSerialized);
  const latestRef = useRef<NoteDoc>(initialDoc);
  const [sessionId] = useState(() => `${shapeId}::${Date.now()}`);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const exitedRef = useRef(false);

  const exit = useCallback((commit: boolean) => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExit(commit ? latestRef.current : null);
  }, [onExit]);

  // Esc / ⌘↩(capture 阶段,先于 PM keymap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
        if (pm?.classList.contains('is-block-selecting')) return; // 块选中:Esc 归编辑器
        e.preventDefault();
        e.stopPropagation();
        exit(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        exit(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit]);

  // 挂载后聚焦(EditorView 异步建好,RAF 重试)
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const tryFocus = () => {
      const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
      if (pm) { pm.focus(); return; }
      if (tries++ < 20) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, []);

  const Host = api.Host;
  return (
    <div
      data-mv-card-editor
      style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) exit(true);
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        ref={popupRef}
        className="mv-card-editor-popup"
        style={{
          position: 'fixed', left: left - 24, top, width: Math.max(width, 160) + 24, minHeight,
          boxSizing: 'border-box', padding: '6px 10px 6px 0',
          background: 'rgba(36, 36, 36, 0.98)', color: '#e0e0e0',
          border: '1px solid #4a90e2', borderRadius: 8,
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
          fontSize: 14, lineHeight: 1.5, overflow: 'auto', maxHeight: '70vh',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Host
          config={{
            instanceId: `mv-card::${sessionId}`,
            undoScope: `math-visual-card.${sessionId}`,
            viewId: MV_CARD_VIEW_ID,
            plugins: CARD_PLUGIN_PRESET,
          }}
          doc={doc}
          onChange={(d: DriverSerialized) => { latestRef.current = d as unknown as NoteDoc; }}
        />
      </div>
      <div
        style={{
          position: 'fixed', left, top: top - 22, fontSize: 11, color: '#a0a0a0',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}
      >
        / 插入列表·公式…　⌘↩ 或点外面完成
      </div>
    </div>
  );
};
