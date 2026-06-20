/**
 * NodeToolbar — 浮条容器(L5-G5)
 *
 * 职责(且只做这些):
 * - 锚定:贴选中框正下方居中(anchor 是容器内 CSS 像素矩形,view 持续推流重定位)
 * - 排布:读 registry.resolveSections(node) → 渲染若干 trigger button(**零硬编码 section 清单**)
 * - 面板互斥:同时只展开一个 section 面板;再点别的切换,点空白 / ESC 收
 * - 键盘:ESC 收面板
 *
 * 具体有哪几个 button、各是什么 —— 全由 nodeBindingRegistry 声明,容器不认得 fill/line/text。
 *
 * **W5 边界**:0 import three / prosemirror / @drivers;改属性走 props 注入的回调。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSections } from './registry';
import type {
  NodeSnapshot,
  NodeStyleOverrides,
  NodeToolbarProps,
  SectionContext,
  SectionDef,
  TextNodeStyleCommand,
} from './types';
import './styles.css';

/** 浮条与选中框底边的垂直间距(px) */
const TOOLBAR_GAP = 12;

export function NodeToolbar({
  anchor,
  node,
  onPatchStyle,
  onPatchInstance,
  onTextCommand,
  onListSystemFonts,
  onEmbedSystemFont,
}: NodeToolbarProps): React.ReactElement | null {
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 选中节点变化(id 变)时收起任何展开的面板,避免面板停留在旧节点
  const nodeId = node?.id ?? null;
  useEffect(() => {
    setOpenSectionId(null);
  }, [nodeId]);

  // ESC 收面板(capture 阶段 + stopPropagation,先于画布 InteractionController 的 ESC)
  useEffect(() => {
    if (openSectionId == null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenSectionId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openSectionId]);

  // 点浮条外收面板(点画布 / 别处)。浮条内部点击在根 div onPointerDown stopPropagation,
  // 不会冒泡到这;故只需判 target 不在 rootRef 内即收。
  useEffect(() => {
    if (openSectionId == null) return;
    const onDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setOpenSectionId(null);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [openSectionId]);

  const close = useCallback(() => setOpenSectionId(null), []);

  // section 上下文:回调透传到 view 注入的落地函数
  const makeContext = useCallback(
    (snapshot: NodeSnapshot): SectionContext => ({
      node: snapshot,
      patchStyle: (patch: NodeStyleOverrides) => onPatchStyle(patch),
      patchInstance: (patch: Partial<NodeSnapshot>) => onPatchInstance(patch),
      runTextCommand: (cmd: TextNodeStyleCommand) => onTextCommand(cmd),
      close,
      listSystemFonts: onListSystemFonts,
      embedSystemFont: onEmbedSystemFont,
    }),
    [onPatchStyle, onPatchInstance, onTextCommand, close, onListSystemFonts, onEmbedSystemFont],
  );

  // registry 解析:有哪几个 section 完全由节点类型声明
  const sections: SectionDef[] = useMemo(() => {
    if (!node) return [];
    const ctx = makeContext(node);
    return resolveSections(node).filter((s) => !s.visibleWhen || s.visibleWhen(ctx));
  }, [node, makeContext]);

  if (!anchor || !node || sections.length === 0) return null;

  const ctx = makeContext(node);
  const openSection = openSectionId ? sections.find((s) => s.id === openSectionId) ?? null : null;

  // 锚定:贴选中框底边中点,浮条水平居中
  const centerX = anchor.x + anchor.w / 2;
  const topY = anchor.y + anchor.h + TOOLBAR_GAP;

  return (
    <div
      ref={rootRef}
      className="krig-node-toolbar"
      style={{ left: centerX, top: topY }}
      // 阻止画布捕获(点浮条不取消选区)
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 主条:trigger button 排布 */}
      <div className="krig-node-toolbar__pill" role="toolbar" aria-label="节点属性">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={
              'krig-node-toolbar__trigger' +
              (openSectionId === section.id ? ' is-active' : '')
            }
            title={section.title}
            aria-label={section.title}
            aria-pressed={openSectionId === section.id}
            onClick={() =>
              setOpenSectionId((cur) => (cur === section.id ? null : section.id))
            }
          >
            {section.icon(ctx)}
          </button>
        ))}
      </div>

      {/* 展开面板(互斥,只一个) */}
      {openSection && (
        <div className="krig-node-toolbar__panel" role="dialog" aria-label={openSection.title}>
          <div className="krig-node-toolbar__panel-arrow" aria-hidden />
          <openSection.Panel {...ctx} />
        </div>
      )}
    </div>
  );
}
