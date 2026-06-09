/**
 * NoteView — view 主组件
 *
 * 见 DESIGN.md v0.2.3 § 4。
 *
 * 订阅两层:
 * - workspaceManager:取当前 ws.activeNoteId(per-workspace)
 * - noteCapability:取笔记数据(全局共享,通过 useAllNotes hook + IPC 广播)
 */

import { useMemo, useState, useSyncExternalStore, useCallback, useEffect } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';
import type { NoteCapabilityApi, NoteDocEnvelope } from '@capabilities/note/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllNotes } from './use-notes-folders';
import { getNoteWsState, updateNote } from './data-model';
import { takePendingAnchor } from './link-click-integration';
import { setCurrentNoteId } from './note-navigation-history';
import { useExtractionImport } from './use-extraction-import';
import { useMarkdownImport } from './use-markdown-import';
import { useActiveNoteDocSync } from './use-active-note-doc-sync';
import { runRendererProgress } from '@shell/global-progress-overlay/run-renderer-progress';
import { TocIndicator } from './toc/TocIndicator';
import './note.css';

interface NoteViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function NoteView({ workspaceId }: NoteViewProps) {
  // W5 C4:间接路由拿 text-editing capability(useMemo 缓存,React identity 稳定)
  const textEditing = useMemo(
    () => requireCapabilityApi<TextEditingApi>('text-editing'),
    [],
  );

  // 订阅当前 ws 的 activeNoteId(per-workspace)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getNoteWsState(ws) : null;
    },
  );

  // 订阅 noteCapability — onListChanged 推送(所有 ws 共享视图)
  // NoteView 自此仅读 list 的元数据(title/folderId);doc 走独立 incomingDoc 通道
  // 避免自家 onChange 经 LIST_CHANGED 回灌让 activeNote.doc 引用变 → Host useEffect[doc] 跳光标。
  const allNotes = useAllNotes();

  // 取当前活跃笔记元数据
  const activeNoteId = wsState?.activeNoteId ?? null;
  const activeNoteMeta = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) ?? null : null;

  // doc 独立通道(dual-channel 方案 §5.1):
  // - 切笔记时 getNote() 拉初始 doc(主动)
  // - 外部更新通过 onDocContentChanged 推送(被动);自家编辑不动 incomingDoc
  // - activeNoteId=null 或 note 被外部删除 → setIncomingDoc(null)
  const [incomingDoc, setIncomingDoc] = useState<NoteDocEnvelope | null>(null);

  // 切笔记:拉初始 doc。getNote 返 null(已删除/找不到)时显式清空,UI 回兜底态;
  // 不能保留旧 doc,否则用户错觉"删除/切换没生效"。
  useEffect(() => {
    if (!activeNoteId) {
      setIncomingDoc(null);
      return;
    }
    let cancelled = false;
    const note = requireCapabilityApi<NoteCapabilityApi>('note');
    // 2026-05-29 open-progress:长 note 的 getNote(main 端 assemblePmDoc)慢。
    // 用 delayMs=300 延迟 overlay — 秒开的 note(绝大多数)不显遮罩,只有 assemble
    // 慢的长 note 超 300ms 才显"正在打开…"。title 取自当前 meta(可能 null → 兜底)。
    const title = activeNoteMeta?.title?.trim() || '(无标题)';
    void runRendererProgress(
      `正在打开《${title}》…`,
      () => note.getNote(activeNoteId),
      { delayMs: 300 },
    )
      .then((info) => {
        if (cancelled) return;
        setIncomingDoc(info ? info.doc : null);
      })
      .catch((err) => {
        console.error('[NoteView] getNote failed:', err);
        if (!cancelled) setIncomingDoc(null);
      });
    return () => { cancelled = true; };
  }, [activeNoteId]);

  // 外部更新(ebook addReadingThoughtBlock / removeReadingThoughtBlock 等)
  useActiveNoteDocSync(
    activeNoteId,
    useCallback((doc, origin) => {
      console.debug('[NoteView] external doc update', { activeNoteId, origin });
      setIncomingDoc(doc);
    }, [activeNoteId]),
  );

  // allNotes 变化:若 activeNote 被外部删除(LIST_CHANGED 不再含),清空 incomingDoc。
  // 选用方案 b(§5.1):UI 层兜底,不主动改 workspaceManager.activeNoteId;留 followup。
  //
  // 守护(2026-05-22 修):**allNotes.length === 0 时不动 incomingDoc** — 初始加载竞态下
  // useAllNotes hook 的 listNotes IPC 比 NoteView getNote IPC 慢,allNotes 暂时为空。
  // 此时若 stillExists=false 就清 incomingDoc,会把 getNote 刚拿到的 doc 又设回 null →
  // 永远走 fallback。等 allNotes 真有数据(>0)再判 stillExists 才安全。
  // (真删 note 时 allNotes 至少有其它 note;空仓库无 note 可点,不会走到 NoteView 这里。)
  useEffect(() => {
    if (!activeNoteId || !incomingDoc) return;
    if (allNotes.length === 0) return; // allNotes 尚未拉到,先信任 incomingDoc
    const stillExists = allNotes.some((n) => n.id === activeNoteId);
    if (!stillExists) setIncomingDoc(null);
  }, [allNotes, activeNoteId, incomingDoc]);

  // L5-C6:订阅 main 推送的 atom batch JSON → 落 noteCapability
  // (主进程广播,每个并存 NoteView 都收到 — hook 内按 activeId 认领,只活跃 ws 处理,
  //  否则 N 个 ws 各跑一遍导入并发写库抢锁。去重只防"重跑同章"不防"两批并发")
  useExtractionImport(workspaceId);
  // 同模式:订阅 File → Import Markdown... 推送的 ScannedFile 批(同样 hook 内认领)
  useMarkdownImport(workspaceId);

  const handleDocChange = useCallback(
    (newDoc: DriverSerialized) => {
      if (!wsState?.activeNoteId) return;
      // L7-sub2:title 派生自 doc 首段文本 (capability 内自动算),view 不传 title
      // 注意:这里只发 IPC,**不动 incomingDoc** — Host 内部 PM state 已是最新,
      // 自家编辑不需要回灌;若回灌反而触发 useEffect[doc] 跳光标。
      void updateNote(wsState.activeNoteId, { doc: newDoc });
    },
    [wsState?.activeNoteId],
  );

  // L5-B3.4:同步当前 noteId 到导航历史栈(切笔记时)
  useEffect(() => {
    setCurrentNoteId(activeNoteId);
  }, [activeNoteId]);

  // L5-B3.4:笔记加载后 flush pendingAnchor(link-click 跨文档跳转的滚动)
  useEffect(() => {
    if (!activeNoteId) return;
    const anchor = takePendingAnchor();
    if (!anchor) return;
    // 等编辑器装配 + DOM 渲染完成
    const t = window.setTimeout(() => {
      textEditing.api.scrollToAnchor(workspaceId, anchor);
    }, 100);
    return () => window.clearTimeout(t);
  }, [activeNoteId, workspaceId]);

  // W4.1:全局 keymap(Cmd+K / Cmd+[ / Cmd+])改为 ViewDefinition.keymap 声明式注册,
  // 见 views/note/index.ts + note-commands.ts(note-view.popup-link / go-back / go-forward)

  if (!wsState) {
    return <div className="krig-note-empty">Workspace 未就绪</div>;
  }

  // 三态(§5.1):
  //   未选笔记(activeNoteId=null) → "未选择笔记"
  //   选了笔记但 doc 还没到/note 已被删 → "加载中或已删除"
  //   doc 到了 → 渲染 Host
  if (!activeNoteId) {
    return (
      <div className="krig-note-empty">
        <div className="krig-note-empty-icon">📝</div>
        <div className="krig-note-empty-text">未选择笔记</div>
        <div className="krig-note-empty-hint">从左侧列表点选,或新建笔记</div>
      </div>
    );
  }

  if (!incomingDoc || !activeNoteMeta) {
    return (
      <div className="krig-note-empty">
        <div className="krig-note-empty-icon">📝</div>
        <div className="krig-note-empty-text">笔记加载中或已删除</div>
      </div>
    );
  }

  const Host = textEditing.Host;
  return (
    <div className="krig-note-view-frame">
      <div className="krig-note-view" data-view-id="note-view">
        <div className="krig-note-view-content">
          {/* key=activeNoteId:切 note 时强制重挂编辑器,新实例用新 doc 初始化(走 mount
              路径,fresh lastEmittedJsonRef=null),从机制上绕开 applyExternalDoc 的指纹
              echo 守门 —— 该守门只比内容不比 noteId,空 note 内容雷同会撞指纹被误判 echo
              而跳过切换(2026-05-30 新建/切换 note 主区不更新根因,日志 SKIP fingerprint 坐实)。
              同篇内 echo / 外部更新 key 不变不重挂,光标防跳逻辑完整保留。 */}
          <Host
            key={activeNoteId}
            config={{
              instanceId: workspaceId,
              undoScope: 'text-editing.pm',
              viewId: 'note-view',
              // C8 D-D:NoteView 显式声明 titleGuard(noteTitle 强制守门)。
              // driver 层 fallback `viewId === 'note-view'` 仍兼容兜底,
              // 但显式声明为后续删 fallback 铺路。
              plugins: { titleGuard: true, headingCollapse: true },
            }}
            doc={incomingDoc}
            onChange={handleDocChange}
          />
        </div>
      </div>
      <TocIndicator instanceId={workspaceId} textEditing={textEditing} />
    </div>
  );
}
