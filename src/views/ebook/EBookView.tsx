/**
 * EBookView — view 主组件(L5-C4 扩展)
 *
 * **本段(C4)** 在 C3 基础上加:
 * - useBookmarks hook 接入 + 书签按钮(toolbar 高亮态)+ Cmd+D 切换书签
 * - useEpubAnnotation hook 接入 + EpubAnnotationPicker(EPUB 选区颜色 picker)
 * - EPUB CFI 持久化补回(C3 已知短板修复)— host.getCurrentCFI() + onEpubProgressChange
 * - 主区点击外部关 picker(对齐 V1 全屏 mousedown 监听)
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3 § 5 C4。
 *
 * LOC 红线(v0.3 § 3.1):≤150~200 行。本组件 ~245 行(超 45 行,沿用 C3
 * 的"机会主义瘦身"取舍 — 持久化已拆 use-ebook-progress;keymap+toolbar
 * handlers 跟 view state 关联紧密,继续拆引入 hook 间通信反而更乱)。
 */

import {
  useSyncExternalStore,
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { EBookLoadedInfo } from '@shared/ipc/ebook-types';
import type {
  EBookRenderingApi,
  EBookHostHandle,
  PdfTextSelectionEvent,
} from '@capabilities/ebook-rendering/types';
import type { LearningApi } from '@capabilities/learning/types';
import type { ThoughtType } from '@shared/ipc/thought-types';
import { getEBookWsState, getActiveBookId, type EBookSlot } from './data-model';
import { useEBookProgress } from './use-ebook-progress';
import { usePdfAnnotations } from './use-pdf-annotations';
import { EBookToolbar, type EBookToolbarRenderMode } from './EBookToolbar';
import {
  init as initVocabHighlight,
  setVocab as setVocabHighlight,
  ensureLayer as ensureVocabLayer,
  scanPage as scanVocabPage,
  rescanAll as rescanVocabHighlight,
  clearAll as clearVocabHighlight,
} from './pdf-vocab-highlight';
import {
  setVocab as setEpubVocab,
  attachSection as attachEpubVocabSection,
  clearAll as clearEpubVocab,
} from './epub-vocab-highlight';
import { setLastPdfSelection } from './pdf-selection-ref';
import './pdf-vocab-highlight/styles.css';
import './ebook.css';

interface EBookViewProps {
  workspaceId: string;
  payload?: unknown;
  /**
   * 本实例所在的槽(SlotArea 透传)。
   *
   * feat/ebook-per-slot:此前这个 prop **SlotArea 传了而本 view 丢掉了**
   * (SlotArea.tsx 的 `<Comp workspaceId payload slot />`),于是 eBook 侧没有
   * 任何东西知道自己在哪一栏 —— per-slot 的一切都无从谈起。这是前置修复。
   *
   * 默认 'left':兼容非 SlotArea 的调用方(与 NoteView 同款约定)。
   */
  slot?: EBookSlot;
}

export function EBookView({ workspaceId, slot = 'left' }: EBookViewProps) {
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );
  const rendering = useMemo(
    () => requireCapabilityApi<EBookRenderingApi>('ebook-rendering'),
    [],
  );
  const {
    Host,
    OutlinePanel,
    SearchBar,
    PdfTextAnnotationPicker,
    useSearch,
    useBookmarks,
    useEpubAnnotation,
  } = rendering;

  const hostRef = useRef<EBookHostHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次 onBookOpened 推流 — 全屏触发时复用,补最新位置喂给 panel */
  const lastBookInfoRef = useRef<EBookLoadedInfo | null>(null);
  // 阅读进度按槽持久化:PDF 每翻页都写,不带槽的话左栏翻页会持续覆盖右栏位置
  const { activeBookIdRef, persistPdfProgress, persistEpubProgress } =
    useEBookProgress(workspaceId, slot);

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getEBookWsState(ws) : null;
    },
  );
  // 本槽的当前书(feat/ebook-per-slot)—— 原先两栏都读同一个 activeBookId,
  // 是「两栏恒显同一本」的字段层病根。
  const activeBookId = wsState ? getActiveBookId(wsState, slot) : null;

  /**
   * 全屏(PDF 沉浸阅读)— view 内部独立 state(2026-05-24 用户拍板:与 navSideCollapsed 解耦)。
   *
   * 进入全屏(⛶ 按钮):
   *   1. 快照 prevNavSideCollapsed + prevRightSlot
   *   2. setNavSideCollapsed(true) + closeRight()
   *   3. PDF 切 paged 双页 spread + toolbar auto-hide
   *
   * 退出全屏(再点 ⛶ / ESC):
   *   1. setNavSideCollapsed(快照值) + openRight(快照 viewId)
   *   2. PDF 回 scroll + toolbar 常显
   *
   * **不再** = navSideCollapsed:用户从 WorkspaceBar 点 NavSide toggle 时,
   * 仅 navSideCollapsed 变,view 内 PDF 模式字面无感知。
   */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSnapshotRef = useRef<{
    navSideCollapsed: boolean;
    rightSlot: string | null;
  } | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  // 退出全屏时复位 visible,避免下次进全屏首帧仍是"显示态"
  useEffect(() => {
    if (!isFullscreen) setToolbarVisible(false);
  }, [isFullscreen]);

  // toolbar 显示状态
  const [fileName, setFileName] = useState('');
  const [renderMode, setRenderMode] = useState<EBookToolbarRenderMode>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [epubChapter, setEpubChapter] = useState('');
  const [epubPercentage, setEpubPercentage] = useState(0);
  const [epubPage, setEpubPage] = useState(0);
  const [epubPages, setEpubPages] = useState(0);
  // fontSize 现仅作命令式推到 host(不参与 view 自身 render),由 Aa popup 持 state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // PDF 全屏翻页式布局 — 按容器宽高比自动选(宽屏 double / 竖屏 single)
  const [pagedLayout, setPagedLayout] = useState<'single' | 'double'>('single');

  // hooks
  const search = useSearch(hostRef);
  const bookmarks = useBookmarks(hostRef, activeBookIdRef, epubChapter);
  const ann = useEpubAnnotation(hostRef, activeBookIdRef);
  const pdfAnn = usePdfAnnotations(activeBookIdRef, hostRef);

  // C6:PDF 提取 — 上传当前书到 Platform → 切右栏 web-view 装 Platform UI
  // (atom batch JSON 落 noteCapability 由 NoteView 内的 useExtractionImport 处理)
  const [extractUploading, setExtractUploading] = useState(false);
  const handleExtract = useCallback(async () => {
    if (extractUploading) return;
    setExtractUploading(true);
    try {
      const result = (await window.electronAPI.extractionUpload()) as {
        uploaded: boolean;
        platformUrl?: string;
        reason?: string;
      };
      if (!result.uploaded || !result.platformUrl) {
        console.warn('[ebook-view] extraction upload failed:', result.reason);
        return;
      }
      // 通过命令把 Platform URL 装到右栏 web-view(view 间不直 import @views/web)
      commandRegistry.execute('web-view.open-url', result.platformUrl);
    } catch (err) {
      console.error('[ebook-view] extraction error:', err);
    } finally {
      setExtractUploading(false);
    }
  }, [extractUploading]);

  // 订阅 onBookOpened → 命令式驱动 Host + 加载书签 / 标注
  //
  // feat/ebook-per-slot:**按 requester 认领**。EBOOK_LOADED 是发给
  // BrowserWindow.getAllWindows() 的广播,原先本回调无条件加载 —— 一次点击,
  // 2槽 × N workspace × N 窗口 的所有 EBookView 一起换书(截图现象的直接原因)。
  //
  // 为什么不用「info.bookId === 我的 activeBookId」来判断:左右开**同一本书**时
  // 两栏 activeBookId 相同,会双双认领 —— 而对照阅读同一本书的不同页是真实用法。
  // 身份必须由请求方携带,不能由接收方猜(PROTOCOL.md §1.5 原则 1 推论)。
  useEffect(() => {
    return library.onBookOpened((info) => {
      const req = info.requester;
      if (!req) {
        // 没带身份 = 非 view 发起的加载。不认领(否则退回"谁都加载"的老行为),
        // 但要留痕:说明有调用点漏传 requester。
        console.error(
          `[ebook-view] EBOOK_LOADED 缺 requester,已忽略(book=${info.bookId})——` +
            ' 请检查该 open/add 调用点是否漏传 { wsId, slot }。',
        );
        return;
      }
      if (req.wsId !== workspaceId || req.slot !== slot) return;   // 不是给我的
      setFileName(info.fileName);
      activeBookIdRef.current = info.bookId;
      lastBookInfoRef.current = info;
      void hostRef.current?.loadFromInfo(info);
      bookmarks.loadOnBookOpen(info.bookId);
      // EPUB:加载已有 annotation 并重绘高亮(loadOnBookOpen 内 await getTOC 等就绪)
      void ann.loadOnBookOpen(info.bookId);
      // C5:PDF 空间标注加载(EPUB 路径会过滤掉,无副作用)
      void pdfAnn.loadOnBookOpen(info.bookId);
    });
  }, [library, activeBookIdRef, bookmarks, ann, pdfAnn, workspaceId, slot]);

  // EPUB / PDF 全屏 单/双页布局自适应:容器宽高比 ≥ 1(宽 ≥ 高)→ 双页 spread;< 1 → 单页。
  // - EPUB(reflowable):始终自适应 — NavSide 收起后容器横向变宽,自动进双页 spread
  // - PDF(fixed-page):仅全屏 paged 模式消费 pagedLayout state — 非全屏 scroll
  //   模式不需要(单/双页只在翻页式渲染下有意义)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const compute = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const count: 1 | 2 = w >= h ? 2 : 1;
      if (renderMode === 'reflowable') {
        hostRef.current?.setEpubMaxColumnCount(count);
      } else if (renderMode === 'fixed-page') {
        setPagedLayout(count === 2 ? 'double' : 'single');
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderMode]);

  // EPUB 字号 / 主题:popup wrapper 改 localStorage 后 notify → 这里推给 host
  // (popup-registry 的 Component 不能接 view 端 props,只能模块级 event bus 通信)
  useEffect(() => {
    return rendering.subscribeEpubReadingSettings((s) => {
      hostRef.current?.setFontSize(s.fontSize);
      hostRef.current?.setEpubTheme(s.theme);
      hostRef.current?.setEpubAppearance(s.appearance);
    });
  }, [rendering]);

  // 启动 + 切书:本槽有 activeBookId → 主动 open(带上自己的身份,回来的广播才认得出)
  useEffect(() => {
    if (!activeBookId || activeBookIdRef.current === activeBookId) return;
    void library.open(activeBookId, { wsId: workspaceId, slot }).catch((err) => {
      console.warn('[ebook-view] open failed:', err);
    });
  }, [library, activeBookId, activeBookIdRef, workspaceId, slot]);

  // Host onLoadComplete:同步 totalPages + renderMode + 字号(EPUB)
  const handleLoadComplete = useCallback(
    (info: {
      totalPages: number;
      fileType: string;
      renderMode: 'fixed-page' | 'reflowable';
    }) => {
      setRenderMode(info.renderMode);
      setTotalPages(info.totalPages);
      setCurrentPage(1);
      if (info.renderMode === 'reflowable') {
        // EPUB 加载完成 — 把 localStorage 偏好推给 host(字号 + 主题),
        // 确保非全屏 view 内也呈现用户偏好的字号/主题
        const s = rendering.loadEpubReadingSettings();
        hostRef.current?.setFontSize(s.fontSize);
        hostRef.current?.setEpubTheme(s.theme);
        hostRef.current?.setEpubAppearance(s.appearance);
      }
    },
    [rendering],
  );

  const handlePageChangeFromHost = useCallback(
    (page: number) => {
      setCurrentPage(page);
      persistPdfProgress(page, scale, fitWidth);
      // 翻页时强制收 toolbar 浮层(全屏期 hover 露出后用户翻页 → toolbar 让位)
      if (isFullscreen) setToolbarVisible(false);
      // PR-α-3b:翻页关 PDF 文字流 picker(选区已失效)
      setPdfTextSelection(null);
    },
    [persistPdfProgress, scale, fitWidth, isFullscreen],
  );

  const handleScaleChangeFromHost = useCallback(
    (s: number) => {
      setScale(s);
      setFitWidth(false);
      persistPdfProgress(currentPage, s, false);
    },
    [persistPdfProgress, currentPage],
  );

  // C4:EPUB CFI 持久化(C3 已知短板修复)— relocate 时拿 host.getCurrentCFI
  const handleEpubProgressChange = useCallback(
    (progress: { chapter: string; percentage: number; page: number; pages: number }) => {
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      setEpubPage(progress.page);
      setEpubPages(progress.pages);
      const cfi = hostRef.current?.getCurrentCFI();
      if (cfi) persistEpubProgress(cfi);
      // 翻页时强制收 toolbar 浮层(全屏期 hover 露出后用户翻页 → toolbar 让位)
      if (isFullscreen) setToolbarVisible(false);
    },
    [persistEpubProgress, isFullscreen],
  );

  // PDF 标注创建后**仅落库**(PR-α-2 行为回退,handoff §α-2 第 1 项):
  // 用户在标注上右键 "💭 加思考" 才召唤右槽 ThoughtView,不再自动开。
  //
  // 历史:0eaafe73 前 create 后会自动 commandRegistry.execute(
  //   'thought-view.add-from-pdf-annotation', created.thoughtId
  // ),与"右键 = 显式选择动作"的右键体系不一致;本 PR 回退此自动行为。
  const handlePdfAnnotationCreate = useCallback(
    async (pageNum: number, draft: Parameters<typeof pdfAnn.create>[1]) => {
      await pdfAnn.create(pageNum, draft);
    },
    [pdfAnn],
  );

  // PR-α-3b:PDF 文字流标注模式 — toolbar ✎ 按钮 toggle
  // ✎ on 时 textLayer 拖选 → 弹 picker;off 时 hook 的 onPdfTextSelected = undefined
  // (无 mouseup listener,零开销 — Cmd+C 复制不被打扰)
  const [pdfTextMode, setPdfTextMode] = useState(false);

  // PR-α-3b followup:扫描件检测 toast — 点 ✎ 时若当前页无 textLayer,
  // 自动 off ✎ + toast 提示用户改用 ▢ 框选(handoff §扫描件友好提示)
  // toast 锚定 ✎ 按钮正下方(用户视线焦点处)
  const [toast, setToast] = useState<{ msg: string; x: number; y: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string): void => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    // 从 DOM 反查 ✎ 按钮位置(toolbar 内 data-pdf-text-mode-btn 标记)
    const btn = document.querySelector<HTMLElement>('[data-pdf-text-mode-btn]');
    const bcr = btn?.getBoundingClientRect();
    const x = bcr ? bcr.left + bcr.width / 2 : window.innerWidth - 100;
    const y = bcr ? bcr.bottom + 6 : 48;
    setToast({ msg, x, y });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  const togglePdfTextMode = useCallback(
    (active: boolean) => {
      if (!active) {
        setPdfTextMode(false);
        return;
      }
      // 用户开 ✎:先检测当前页是否含 textLayer,无则提示 + 不进入文字模式
      void (async () => {
        const has = await hostRef.current?.hasTextContent(currentPage);
        if (!has) {
          showToast('无文字层');
          return;
        }
        setPdfTextMode(true);
        pdfAnn.setMode('off'); // 互斥:开文字模式 → 关框选
      })();
    },
    [pdfAnn, currentPage, showToast],
  );
  // 框选模式开 → 关文字模式(反向互斥)
  useEffect(() => {
    if (pdfAnn.mode === 'rect') setPdfTextMode(false);
  }, [pdfAnn.mode]);
  // 切书 → 重置(新 PDF 默认 off 更安全)+ 清 PDF 选区 ref(跨书 stale 防护)
  useEffect(() => {
    setPdfTextMode(false);
    setLastPdfSelection(null);
  }, [activeBookId]);

  // PDF textLayer 选区 → picker 弹出 + 始终缓存到模块 ref(右键 ask-ai 用)
  const [pdfTextSelection, setPdfTextSelection] =
    useState<PdfTextSelectionEvent | null>(null);
  const handlePdfTextSelected = useCallback(
    (ev: PdfTextSelectionEvent) => {
      // ref 始终写(右键 ask-ai 不依赖 pdfTextMode):mouseup → write ref → 右键时可读
      setLastPdfSelection(ev);
      // picker 弹出只在 ✎ 文字模式开时(原行为不变)
      if (pdfTextMode) setPdfTextSelection(ev);
    },
    [pdfTextMode],
  );
  const dismissPdfTextPicker = useCallback(() => {
    setPdfTextSelection(null);
    // 清掉浏览器原生选区灰底(否则残留)
    window.getSelection()?.removeAllRanges();
  }, []);
  // picker confirm → 调 pdfAnn.createFromTextSelection(走 legacy,不召右槽)
  const handlePdfTextPickerConfirm = useCallback(
    (type: ThoughtType, markStyle: 'highlight' | 'strikethrough') => {
      const ev = pdfTextSelection;
      if (!ev) return;
      void pdfAnn.createFromTextSelection(ev, type, markStyle);
      dismissPdfTextPicker();
    },
    [pdfAnn, pdfTextSelection, dismissPdfTextPicker],
  );

  // ── PDF + EPUB vocab highlight(PDF 2026-05-25 / EPUB 2026-05-26)──
  // mount 时:PDF 挂全局 hover 委托 + 两个模块共享同份 learning vocab 推送源 + 启动拉一次。
  // 回调内 PDF 每页 textLayer render 完后扫该页;EPUB section load 后挂 iframe doc。
  // vocab 列表变 重扫已渲染 PDF 页 + 重扫所有已 attach EPUB doc。
  useEffect(() => {
    const learning = requireCapabilityApi<LearningApi>('learning');
    initVocabHighlight();
    let cancelled = false;
    void learning.vocabList().then((entries) => {
      if (cancelled) return;
      setVocabHighlight(entries);
      setEpubVocab(entries);
      rescanVocabHighlight();
    });
    const unsubscribe = learning.onVocabChanged((entries) => {
      setVocabHighlight(entries);
      setEpubVocab(entries);
      rescanVocabHighlight();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      clearVocabHighlight();
      clearEpubVocab();
    };
  }, []);
  /**
   * Host onPdfTextLayerRendered 回调:每页 textLayer render 完触发。
   * 找 textLayer 所在 page-wrapper(主区 / 全屏 sibling 路径不同,统一用 parentElement),
   * ensureLayer + scanPage 单页扫描。
   */
  const handlePdfTextLayerRendered = useCallback(
    (_pageNum: number, textLayer: HTMLElement): void => {
      const wrapper = textLayer.parentElement;
      if (!wrapper) return;
      const hl = ensureVocabLayer(wrapper);
      scanVocabPage(textLayer, hl);
    },
    [],
  );
  /**
   * Host onEpubSectionLoad 回调:renderer 完成 attachListeners 后触发,
   * iframe doc 可直接 querySelectorAll;attachSection 注入 span + 挂 mousemove(幂等)。
   * 切书 / 重 mount 由 useEffect cleanup 内 clearEpubVocab 清理。
   */
  const handleEpubSectionLoad = useCallback((doc: Document): void => {
    attachEpubVocabSection(doc);
  }, []);

  // 切书时清掉旧书的 EPUB span — 避免上一本书翻章节遗留的 doc 残留高亮影响新书
  // (PDF 路径的 textLayer 在切书时由 pdfjs 自然清,这里只补 EPUB 这条线)
  useEffect(() => {
    return () => {
      clearEpubVocab();
    };
  }, [activeBookId]);

  // picker 关闭 lifecycle:外部 mousedown / ESC 关
  useEffect(() => {
    if (!pdfTextSelection) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('.krig-pdf-text-picker')) return;
      dismissPdfTextPicker();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissPdfTextPicker();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pdfTextSelection, dismissPdfTextPicker]);

  // PR-α-3b follow-up:双击 PDF 标注 → activate 关联 thought(召唤右槽 + 滚卡)
  // 走 closest('[data-pdf-annotation-id]') 检测(同 L4 contextMenu trigger 模式),
  // 不污染 AnnotationLayer 组件(它是 capability 层,不应知道 thought 概念)。
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onDblClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const annEl = target?.closest('[data-pdf-annotation-id]') as HTMLElement | null;
      if (!annEl) return;
      const id = annEl.getAttribute('data-pdf-annotation-id');
      if (!id) return;
      e.preventDefault();
      // 显式传 bookId + wsId — 双击不走右键菜单,命令侧的 contextMenuController.custom
      // 为空,不能从中读(2026-08-03 根因)。bookId 走 ref(effect 空 deps 闭包)。
      commandRegistry.execute('ebook-view.activate-thought-from-annotation', {
        annotationId: id,
        bookId: activeBookIdRef.current,
        wsId: workspaceId,
      });
    };
    el.addEventListener('dblclick', onDblClick);
    return () => el.removeEventListener('dblclick', onDblClick);
  }, [activeBookIdRef, workspaceId]);

  // ── Toolbar callbacks ──

  const onPageChange = useCallback((page: number) => {
    hostRef.current?.goToPage(page);
    setCurrentPage(page);
  }, []);

  const onScaleChange = useCallback(
    (s: number) => {
      hostRef.current?.setScale(s);
      setScale(s);
      setFitWidth(false);
      persistPdfProgress(currentPage, s, false);
    },
    [persistPdfProgress, currentPage],
  );

  const onFitWidthToggle = useCallback(() => {
    const next = !fitWidth;
    hostRef.current?.setFitWidth(next);
    setFitWidth(next);
    if (next) persistPdfProgress(currentPage, scale, true);
  }, [fitWidth, scale, currentPage, persistPdfProgress]);

  const onPrevChapter = useCallback(() => hostRef.current?.prevChapter(), []);
  const onNextChapter = useCallback(() => hostRef.current?.nextChapter(), []);
  // 字号 +/- 不在 toolbar,迁到 Aa popup;变更通过 subscribeEpubReadingSettings 同步推 host

  const onSidebarToggle = useCallback(() => setSidebarOpen((p) => !p), []);

  /**
   * 全屏 toggle(2026-05-24 用户拍板:与 navSideCollapsed 解耦的独立 view state):
   *
   * 进入:快照 navSide / rightSlot 状态 → setNavSideCollapsed(true) + closeRight + setIsFullscreen(true)
   * 退出:setIsFullscreen(false) + restore navSide + restore rightSlot
   *
   * 分层原则:view 通过 workspaceManager.setNavSideCollapsed + bus.slot.openRight/closeRight
   * 这些"高层提供的明确 API"触发副作用,不直接 mutate workspace state。
   */
  const onFullscreen = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    const bus = workspaceManager.getBus(workspaceId);
    if (!ws || !bus) return;
    if (!isFullscreen) {
      // 进入全屏 — 快照 + 强制收 NavSide + 关右槽
      fullscreenSnapshotRef.current = {
        navSideCollapsed: ws.navSideCollapsed,
        rightSlot: ws.slotBinding.right,
      };
      workspaceManager.setNavSideCollapsed(workspaceId, true);
      // 腾空另一栏。
      //
      // ⚠️ 只处理「自己在 left」的情形。右栏自己进全屏时**不腾左栏** ——
      // 腾它只能调 closeLeft(),而 closeLeft 会触发 right→left 升级(铁律 7):
      // 本实例的 React key 从 `ebook-view:right` 变成 `ebook-view:left` → 实例
      // 重建 → 刚设的 isFullscreen 随之丢失,进全屏当场失效。
      // 正确修法需要一个「不升级的腾空」原语(或全屏改成覆盖层而非借 slot),
      // 属独立工作量,本次不做。现状:右栏进全屏 = 只占右半边 + 收 NavSide。
      if (slot === 'left' && ws.slotBinding.right) bus.slot.closeRight();
      setIsFullscreen(true);
    } else {
      // 退出全屏 — 恢复快照(开右槽前 setIsFullscreen 让 view paged→scroll 先生效)
      const snap = fullscreenSnapshotRef.current;
      setIsFullscreen(false);
      if (snap) {
        workspaceManager.setNavSideCollapsed(workspaceId, snap.navSideCollapsed);
        // 只有当初真关了右栏(即自己在 left)才恢复它;右栏进全屏时没关过任何东西,
        // 这里若照旧 openRight 会把自己重装一遍。
        if (slot === 'left' && snap.rightSlot) bus.slot.openRight(snap.rightSlot);
      }
      fullscreenSnapshotRef.current = null;
    }
    // 释放按钮焦点 — 避免 toolbar 全屏按钮点击后保持 :focus 视觉残留 +
    // ESC 退出后 hover 露出的 toolbar 上仍有焦点环
    (document.activeElement as HTMLElement | null)?.blur();
  }, [workspaceId, isFullscreen, slot]);

  // × 关闭当前 ebook view:根据所在槽位调 closeLeft / closeRight
  // (最后一个 view 时 closeLeft 自身拒绝,见 slot-control.ts 铁律 8)
  const onClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    // 关**自己这一栏**。原实现按 `right === 'ebook-view'` 猜:左右双开 eBook 时
    // 该条件对两个实例都成立,点左栏的 ✕ 会把右栏关掉(note 侧 c7720f37 修过同款)。
    // 现在 view 知道自己的槽,直接用。
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);

  const onBookmarkToggle = useCallback(
    () => void bookmarks.toggle(currentPage),
    [bookmarks, currentPage],
  );

  // keymap:Cmd+F 开搜索;Cmd+D 切书签;EPUB ←/→ 翻章节;ESC 退出全屏
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.openSearch();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        onBookmarkToggle();
      } else if (e.key === 'Escape' && isFullscreen) {
        // 焦点在输入框/contenteditable 时让位(SearchBar 输入框 ESC 关搜索)
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        // 多 view 共存 workspace 防重入:同 ESC 被两个 EBookView handler 收到会
        // toggle 两次互相抵消。用 event 上的 marker(自定义属性)第一处理者占位。
        const ev = e as KeyboardEvent & { __krigEbookEscHandled?: boolean };
        if (ev.__krigEbookEscHandled) return;
        ev.__krigEbookEscHandled = true;
        e.preventDefault();
        onFullscreen();
      } else if (renderMode === 'reflowable') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onPrevChapter();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNextChapter();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search, onBookmarkToggle, renderMode, onPrevChapter, onNextChapter, isFullscreen, onFullscreen]);

  // PR-α-3b followup:EPUB 自动 picker 已废除(右键菜单接管),原 mousedown 关 picker 逻辑删除

  // PR-α-3b followup:EPUB iframe 内右键 → 手动调 L4 contextMenuController.show
  // (iframe contextmenu 不冒泡,L4 trigger 接不到;同 web view showWebContextMenu 模式)
  const handleEpubContextMenu = useCallback(
    (info: { x: number; y: number; text: string; cfi: string | null; annotationCfi: string | null }) => {
      contextMenuController.show(info.x, info.y, 'ebook-view', {
        hasSelection: info.text.length > 0,
        isEditable: false,
        x: info.x,
        y: info.y,
        custom: {
          // EPUB 专用 — epub-context-menu-content.ts provider 注入,enabledWhen 判 has-epub-text-selection / has-epub-annotation
          epubSelectionText: info.text,
          epubSelectionCfi: info.cfi,
          epubAnnotationCfi: info.annotationCfi,
          // 注入 wsId + activeBookId,让命令内不再直接调 workspaceManager.getActiveId()
          wsId: workspaceId,
          activeBookId,
        },
      });
    },
    [],
  );
  // PR-α-3b followup:EPUB 标注双击 → activate 关联 thought(对齐 PDF 双击 activate)
  const handleEpubAnnotationDoubleClick = useCallback((annotationCfi: string) => {
    commandRegistry.execute('ebook-view.activate-thought-from-epub-annotation', annotationCfi);
  }, []);
  // PR-α-3b followup fix:iframe 内 mousedown(选区取消通道)同时关 L4 右键菜单
  // 根因:contextMenuController 自挂的 window mousedown 在 iframe 内 click 时收不到事件
  // (iframe mousedown 不冒泡到外层 window),菜单失焦不关。改走 capability 的 dismiss 通道。
  const handleEpubSelectionDismiss = useCallback(() => {
    contextMenuController.hide();
  }, []);

  // PR-α-3b followup fix:把 EPUB 已知标注 cfi 列表推给 host renderer,
  // contextmenu/dblclick 内 hit-test 用(foliate svg pointer-events:none → closest 失效)。
  useEffect(() => {
    const host = hostRef.current;
    if (!host?.setKnownEpubAnnotationCfis) return;
    host.setKnownEpubAnnotationCfis(ann.annotations.map((a) => a.cfi));
  }, [ann.annotations]);

  // thought-view Phase 4:订阅 'thought.scroll-to-book-source' channel
  // → ThoughtView 点 anchor 跳转到 ebook 当前 active book 的页/CFI(host.goToPage/goToCFI)
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const unsub = bus.channels.subscribe('thought.scroll-to-book-source', (payload: unknown) => {
      const { bookId, pageNum, cfi, thoughtId } = (payload ?? {}) as {
        bookId?: string;
        pageNum?: number;
        cfi?: string;
        thoughtId?: string;
      };
      if (!bookId) return;
      /**
       * 跳源重试策略(2026-05-24 修跳源 bug):
       *   scroll-to-source 流程内会调 ebookCap.open → EBookView 收到 onBookOpened
       *   → host.loadFromInfo → FixedPageContent 重 mount。这一过程从 channel emit
       *   到 containerRef 真正绑好可能跨多个 frame(取决于 PDF 大小)。
       *
       *   单次 goToPage 调用经常落到 containerRef = null 的窗口期。最稳的策略:
       *   定时点多次调 goToPage(幂等),让任意一次落到 ready 后的窗口就成功。
       *
       *   8 次 * 250ms = 2s 内总会有 1 次落到 ready 之后(若 2s 内仍未 ready
       *   说明 PDF 加载本身有问题,放弃)。每次调都是幂等 scrollTo(targetTop)。
       */
      const tryScroll = (attempt: number): void => {
        const host = hostRef.current;
        if (host) {
          if (cfi) {
            void host.goToCFI(cfi);
          } else if (pageNum && pageNum > 0) {
            host.goToPage(pageNum);
          }
        }
        if (attempt < 8) {
          window.setTimeout(() => tryScroll(attempt + 1), 250);
        }
      };
      tryScroll(0);
      if (thoughtId) {
        // 闪烁延后到第一波 retry 都试过(8*250=2000ms);annotations 此时大概率已就位
        window.setTimeout(() => pdfAnn.flash(thoughtId), 2200);
      }
    });
    return unsub;
  }, [workspaceId, pdfAnn]);

  if (!wsState) {
    return <div className="krig-ebook-empty">Workspace 未就绪</div>;
  }

  if (!activeBookId) {
    return (
      <div className="krig-ebook-empty">
        <div className="krig-ebook-empty-icon">📕</div>
        <div className="krig-ebook-empty-text">在左侧书架中选择电子书</div>
        <div className="krig-ebook-empty-hint">或点击 NavSide 顶部 + 导入</div>
      </div>
    );
  }

  // 全屏期 toolbar 浮层显隐:鼠标进入顶部 36px 触发区 → 显示;离开 toolbar → 隐
  // 触发区高度 = toolbar 高度(36px),避免"触发区比 toolbar 高"造成显隐抖动
  // 非全屏期 toolbarVisible 不消费(toolbar 走常态 flex 流)
  const toolbarClass = isFullscreen
    ? `krig-ebook-toolbar--floating${toolbarVisible ? ' krig-ebook-toolbar--floating-visible' : ''}`
    : '';

  return (
    <div className="krig-ebook-view" data-view-id="ebook-view">
      {isFullscreen && (
        <div
          className="krig-ebook-toolbar-trigger"
          onMouseEnter={() => setToolbarVisible(true)}
        />
      )}
      <EBookToolbar
        className={toolbarClass}
        onMouseLeave={isFullscreen ? () => setToolbarVisible(false) : undefined}
        fileName={fileName}
        renderMode={renderMode}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        isBookmarked={bookmarks.isBookmarked(currentPage)}
        onBookmarkToggle={onBookmarkToggle}
        currentPage={currentPage}
        pageCount={totalPages}
        scale={scale}
        fitWidth={fitWidth}
        onPageChange={onPageChange}
        onScaleChange={onScaleChange}
        onFitWidthToggle={onFitWidthToggle}
        pdfAnnotationMode={pdfAnn.mode}
        onPdfAnnotationModeChange={pdfAnn.setMode}
        pdfTextMode={pdfTextMode}
        onPdfTextModeChange={togglePdfTextMode}
        onExtract={handleExtract}
        extractDisabled={extractUploading}
        epubPercentage={epubPercentage}
        epubPage={epubPage}
        epubPages={epubPages}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        onFullscreen={onFullscreen}
        onClose={onClose}
      />
      <SearchBar
        visible={search.visible}
        results={search.results}
        currentIndex={search.currentIndex}
        onSearch={search.handleSearch}
        onNext={search.handleNext}
        onPrev={search.handlePrev}
        onClose={search.handleClose}
      />
      <div className="krig-ebook-view__body" ref={bodyRef}>
        {sidebarOpen && (
          <OutlinePanel
            host={{
              getTOC: () => hostRef.current?.getTOC() ?? Promise.resolve([]),
              goToPage: (p) => hostRef.current?.goToPage(p),
              goToCFI: (c) => hostRef.current?.goToCFI(c),
            }}
            currentChapter={epubChapter}
            currentPage={currentPage}
            reloadToken={activeBookId}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div className="krig-ebook-view__main">
          <Host
            ref={hostRef}
            workspaceId={workspaceId}
            onPageChange={handlePageChangeFromHost}
            onLoadComplete={handleLoadComplete}
            onScaleChange={handleScaleChangeFromHost}
            onEpubProgressChange={handleEpubProgressChange}
            onEpubAnnotationClick={ann.handleAnnotationClick}
            onEpubContextMenu={handleEpubContextMenu}
            onEpubAnnotationDoubleClick={handleEpubAnnotationDoubleClick}
            onEpubSelectionDismiss={handleEpubSelectionDismiss}
            onEpubSectionLoad={handleEpubSectionLoad}
            pdfAnnotationMode={pdfAnn.mode}
            pdfAnnotations={pdfAnn.annotations}
            pdfFlashAnnotationId={pdfAnn.flashId}
            onPdfAnnotationCreate={handlePdfAnnotationCreate}
            onPdfTextSelected={handlePdfTextSelected}
            onPdfTextLayerRendered={handlePdfTextLayerRendered}
            pdfLayout={isFullscreen ? 'paged' : 'scroll'}
            pagedLayout={pagedLayout}
          />
          {pdfTextSelection && (
            <PdfTextAnnotationPicker
              anchor={pdfTextSelection.screenAnchor}
              onConfirm={handlePdfTextPickerConfirm}
              onCancel={dismissPdfTextPicker}
            />
          )}
        </div>
      </div>
      {toast && (
        <div
          className="krig-ebook-toast"
          style={{ left: toast.x, top: toast.y, transform: 'translateX(-50%)' }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
