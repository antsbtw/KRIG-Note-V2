/**
 * EditOverlay — 文字节点编辑浮层(V1 EditOverlay.ts 197 行 + GraphEditor.ts 167 行)
 *
 * V2 改造(路径 A,G4-2=B):
 * - V1 命令式 DOM API + 手动 createRoot → V2 React 组件,挂在 view 顶层
 * - V1 自管 GraphEditor(build schema/plugins/EditorView)→ V2 直接挂 text-editing.Host
 *   (它内部已封装完整 PM 实例,与 NoteView 同源)
 * - V1 InlineToolbar 371 行砍掉 — text-editing.Host 内部 setupFloatingToolbarTrigger
 *   自动注册 floating-toolbar,与 NoteView 共享
 * - V1 SlashMenu 砍掉 — text-editing.Host 内部 controller 已经接 SlashMenu(同 NoteView)
 *
 * 形态(对齐 V1 视觉):
 *   backdrop (fixed inset:0, z:1000, 半透明)
 *     └── popup (fixed,屏幕坐标定位,圆角胶囊,深灰背景)
 *           └── text-editing.Host(PM EditorView 挂载)
 *
 * 事件:
 * - 点 backdrop 空白 → exit(commit=true)
 * - Esc → exit(commit=false)
 * - Cmd/Ctrl+Enter → exit(commit=true)
 * - popup 内 keydown 阻止冒泡(防 InteractionController 全局 Delete/Backspace/Cmd+Z)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  DriverSerialized,
  TextEditingApi,
  TextEditingPluginToggles,
} from '@capabilities/text-editing/types';
import { sessionStore, type ActiveSession } from './session-store';
import { docToDriverSerialized } from './atom-bridge';
import './edit-overlay.css';

/**
 * canvas-text-node plugin 预设(L5-G4.5 问题 3).
 *
 * 画板文字节点 = 单一文字块,**关掉 NoteView 段落级别能力**:
 * - blockHandle:     ⋮⋮ 拖动手柄(NoteView 段落 drag/turn-into 入口)
 * - vocabHighlight:  词汇高亮(NoteView 词汇学习专属)
 * - noteLinkCommand: [[ 双链搜索(NoteView 知识图谱专属)
 * - pasteMedia:      粘贴图片变 image block(画板不需要)
 * - dropCursor:      拖拽插入位置蓝线(popup 内无拖入语义)
 *
 * 保留(画板编辑必需):
 * - slash:        / 触发 turn-into(H1-H3 / list / blockquote 等),很有用
 * - floating-toolbar: 选区 B/I/link 等,driver Host 内部默认挂(不在 toggles 配置内)
 * - history:      Cmd+Z 撤销 PM 编辑(popup 内 stopPropagation 拦冒泡)
 * - inputRules:   #/## 转 heading 等 markdown 输入
 * - 各 keymap:    Mod-B/I/U 等快捷键
 * - linkClick:    点击链接走路由
 *
 * 单一常量集中,避免 5 个布尔散落各处.
 */
export const CANVAS_TEXT_NODE_PLUGIN_PRESET: TextEditingPluginToggles = {
  blockHandle: false,
  vocabHighlight: false,
  noteLinkCommand: false,
  pasteMedia: false,
  dropCursor: false,
  // slash 默认 true,显式标出以表"刻意保留"
  slash: true,
  // headingCollapse:canvas 文字节点 doc 短,无 TOC 面板,关
  headingCollapse: false,
  // bottomPad:遵循 note —— 末尾 atom 块(code/公式/divider)下方双击空白可补新普通段落
  // (否则末块是 atom/leaf 时光标无处可落)。bottomPad 默认按 viewId==='note-view' 守门,
  // 画板非 note-view 故显式开。L5 一致性 2026-06-24:graph 编辑态向 note 对齐此交互。
  bottomPad: true,
};

export function EditOverlay(): ReactElement | null {
  const textEditing = useMemo(
    () => requireCapabilityApi<TextEditingApi>('text-editing'),
    [],
  );

  // 订阅 session-store(view 端调 enterEdit 触发 store 更新 → 本组件重渲渲染 popup)
  const [session, setSession] = useState<ActiveSession | null>(() => sessionStore.get());
  useEffect(() => {
    const off = sessionStore.subscribe(() => setSession(sessionStore.get()));
    return off;
  }, []);

  // 初始 doc 是 DriverSerialized — V1 atoms[] 形态 lazy 转换
  const [initialDoc, setInitialDoc] = useState<DriverSerialized | null>(null);
  // 编辑期间最新的 doc(commit 时写回 instance.doc)
  const latestDocRef = useRef<DriverSerialized | null>(null);
  // popup 容器 ref(挂载后聚焦内部 PM contenteditable,否则双击进编辑却打不了字)
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) {
      setInitialDoc(null);
      latestDocRef.current = null;
      return;
    }
    let cancelled = false;
    void docToDriverSerialized(session.opts.initialDoc).then((d) => {
      if (cancelled) return;
      const ds = d as DriverSerialized;
      setInitialDoc(ds);
      latestDocRef.current = ds;
    });
    return () => { cancelled = true; };
  }, [session]);

  const handleChange = useCallback((newDoc: DriverSerialized): void => {
    latestDocRef.current = newDoc;
  }, []);

  const exit = useCallback((commit: boolean): void => {
    if (!session) return;
    const doc = commit ? latestDocRef.current : null;
    session.opts.onExit(session.opts.instanceId, doc);
    sessionStore.clear();
  }, [session]);

  // ESC / Cmd+Enter(window 级,capture 阶段拦在 PM keymap 之前)
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Esc 上下文化(对齐 note 删块流程):光标在块内(未选块)时,Esc 让给 PM →
        // blockSelection 选中整块(蓝框),用户可接 Backspace 删块;**不退出编辑**。
        // 仅当已是"块选中态"(.ProseMirror 有 is-block-selecting)或拿不到编辑器时,
        // Esc 才退出编辑。避免 Esc 一律退出,夺走 note 的「Esc 选块」入口。
        const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
        const blockSelected = pm?.classList.contains('is-block-selecting') ?? false;
        if (pm && !blockSelected) {
          // 放行给 PM(它选中整块);本 handler 不拦、不退出
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        exit(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        exit(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session, exit]);

  // 挂载后聚焦 PM 编辑器(否则双击进编辑但焦点仍在 canvas → 打不了字)。
  // Host 内部 EditorView 异步建好后,.ProseMirror contenteditable 才在 DOM 里;
  // 用 RAF + 重试覆盖 mount 时序(initialDoc 就绪 → Host render → EditorView mount)。
  useEffect(() => {
    if (!session || !initialDoc) return;
    let raf = 0;
    let tries = 0;
    const tryFocus = (): void => {
      const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
      if (pm) { pm.focus(); return; }
      if (tries++ < 20) raf = requestAnimationFrame(tryFocus); // ~20 帧内重试
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [session, initialDoc]);

  if (!session || !initialDoc) return null;

  const Host = textEditing.Host;
  const t = session.opts;
  // V1 体验:popup 完全贴合 mesh 屏幕投影,编辑态与展示态视觉无缝过渡(M2.1 §4.2)。
  // L5-G6c:transparent(编辑覆盖几何 shape)→ 无底色/边框/阴影,几何透出、只编辑文字层。
  const popupStyle: CSSProperties = t.transparent
    ? {
        ...styles.popup,
        left: t.screenX,
        top: t.screenY,
        width: t.width,
        [t.heightFixed ? 'height' : 'minHeight']: t.height,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        color: 'var(--krig-text-primary)',
      }
    : {
        ...styles.popup,
        left: t.screenX,
        top: t.screenY,
        width: t.width,
        [t.heightFixed ? 'height' : 'minHeight']: t.height,
        background: t.backgroundColor ?? 'rgba(40, 40, 40, 0.98)',
        color: t.backgroundColor ? '#222' : 'var(--krig-text-primary)',
      };

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) exit(true);
      }}
    >
      <div
        ref={popupRef}
        className="krig-canvas-edit-popup"
        style={popupStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation() /* 防 InteractionController Delete/Cmd+Z */}
      >
        <Host
          config={{
            instanceId: `${t.workspaceId}::${t.instanceId}`,
            undoScope: `canvas-text-node.${t.workspaceId}.${t.instanceId}`,
            viewId: t.viewId,
            plugins: CANVAS_TEXT_NODE_PLUGIN_PRESET,
          }}
          doc={initialDoc}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    // V1 edit-overlay.css `.krig-canvas-edit-backdrop` 对齐:全屏 transparent,
    // 只作为"点空白处提交"的事件捕获层,不遮挡画板视觉.
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'transparent',
  },
  popup: {
    // V1 edit-overlay.css `.krig-canvas-edit-popup` 对齐:popup 与 mesh 投影完全重合,
    // border 蓝色延续节点选中视觉,padding 内吃(box-sizing: border-box).
    position: 'fixed',
    boxSizing: 'border-box',
    border: '1px solid #4a90e2',
    borderRadius: 8,
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
    overflow: 'auto',
    padding: '8px 10px',
    fontSize: 14,
    lineHeight: 1.5,
  },
};
