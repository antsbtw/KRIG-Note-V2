/**
 * TranslateWebView — 右栏翻译 webview view 主组件(L5-B4.2 / W4.2 C4 重构)
 *
 * View 归属(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview 编排 +
 * SyncDriver / TranslateDriver 生命周期 + 跨 slot 通信全部封装在 web-rendering
 * capability 的 <TranslateHost /> 组件内。
 *
 * View 仍持有的部分:
 * - per-ws targetLang 订阅(显示在顶部条 + 切语言时写 per-ws state)
 * - 翻译信息条 UI(方向显示 / 切语言下拉 / 关闭翻译)
 * - 切语言 + 关闭翻译命令(改 slotBinding)
 *
 * 注:targetLang 运行时切换不可靠是 widget 注入路径的固有限制,所以切语言走
 *     "写 per-ws state + WebView 顶部 banner 提示重启 app"路径。TranslateHost
 *     mount 时锁定 lang,后续 wsTargetLang 变化不重 inject。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';
import { TranslateHost } from '@capabilities/web-rendering';
import { getWebWsState, setWebTargetLang } from '../data-model';
import { getDefaultTargetLang, getLangLabel, LANG_OPTIONS } from './lang-defaults';

interface TranslateWebViewProps {
  workspaceId: string;
}

export function TranslateWebView({ workspaceId }: TranslateWebViewProps) {
  // 从 per-ws state 取 targetLang(显示用 + 切语言时写)
  const wsTargetLang = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getWebWsState(ws).targetLang : getDefaultTargetLang();
    },
  );

  // ── 顶部信息条:语言下拉菜单状态 ──
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!langMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!langMenuRef.current) return;
      if (!langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [langMenuOpen]);

  // 切语言:写 per-ws state(WebView 侧 banner 自动 fire — slotBinding right=translate-view)
  // 实际生效仍需重启(widget 注入路径限制)
  const handleSelectLang = useCallback(
    (lang: string) => {
      setLangMenuOpen(false);
      if (lang === wsTargetLang) return;
      setWebTargetLang(workspaceId, lang);
    },
    [workspaceId, wsTargetLang],
  );

  // 关闭翻译模式(× 按钮)
  const handleCloseTranslate = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;
    workspaceManager.update(workspaceId, {
      slotBinding: { ...ws.slotBinding, right: null },
    });
  }, [workspaceId]);

  return (
    <div className="krig-translate-web-view">
      {/* L5-B4.2.2 顶部信息条 — 跟左栏 WebToolbar 高度对齐,显示译文方向 + 切语言 + 关闭 */}
      <div className="krig-translate-bar">
        <div className="krig-translate-bar__direction">
          <span className="krig-translate-bar__source">自动检测</span>
          <span className="krig-translate-bar__arrow">→</span>
          <span className="krig-translate-bar__target">{getLangLabel(wsTargetLang)}</span>
        </div>
        <div className="krig-translate-bar__actions" ref={langMenuRef}>
          <button
            type="button"
            className="krig-translate-bar__btn"
            onClick={() => setLangMenuOpen((v) => !v)}
            title="切换目标语言"
            aria-expanded={langMenuOpen}
          >
            ▾
          </button>
          <button
            type="button"
            className="krig-translate-bar__btn"
            onClick={handleCloseTranslate}
            title="关闭翻译"
            aria-label="关闭翻译"
          >
            ×
          </button>
          {langMenuOpen && (
            <div className="krig-translate-bar__lang-menu" role="menu">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  className={`krig-translate-bar__lang-item${
                    opt.value === wsTargetLang ? ' active' : ''
                  }`}
                  onClick={() => handleSelectLang(opt.value)}
                >
                  <span className="krig-translate-bar__lang-check">
                    {opt.value === wsTargetLang ? '✓' : ''}
                  </span>
                  <span className="krig-translate-bar__lang-label">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <TranslateHost
        workspaceId={workspaceId}
        partition={WEBVIEW_TRANSLATE_PARTITION}
        targetLang={wsTargetLang}
        className="krig-translate-web-view__webview"
      />
    </div>
  );
}
