/**
 * WebSettingsPanel — Web 设置面板(per-ws 代理工程 · 阶段3)
 *
 * 入口:WebToolbar 右侧 ⚙ 按钮 → WebView toggle open。本组件由 WebView 渲染,
 * popover 锚 toolbar(照语言菜单弹层模式:ref + 外点击关闭 + Esc 关闭)。
 *
 * 四块:
 * ① 代理(本工作区):选当前 ws 节点(直连 + 节点列表)+ 节点增删。
 * ② 清除浏览数据(本工作区):二次确认 → clearWebStorageData。
 * ③ 默认搜索引擎(全局):预设 Google/Bing/DuckDuckGo/百度 + 自定义(校验含 %s)。
 * ④ 默认主页(全局):填 URL。
 *
 * 节点编辑(改名/改 host)未做 —— 改 = 删了重加(实现包 §3.6 允许只做增删)。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProxyNode, ProxyNodeType } from '@shared/types/proxy-types';
import {
  setWebProxyId,
  getWebWsState,
} from './data-model';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getWebSettings, setWebSettingsCache } from './web-settings-cache';

interface WebSettingsPanelProps {
  workspaceId: string;
  /** 当前 ws 选中的代理节点 id(直连 = undefined)*/
  proxyId: string | undefined;
  open: boolean;
  onClose: () => void;
}

/** 搜索引擎预设(value = URL 模板,含 %s)*/
const SEARCH_PRESETS: { label: string; value: string }[] = [
  { label: 'Google', value: 'https://www.google.com/search?q=%s' },
  { label: 'Bing', value: 'https://www.bing.com/search?q=%s' },
  { label: 'DuckDuckGo', value: 'https://duckduckgo.com/?q=%s' },
  { label: '百度', value: 'https://www.baidu.com/s?wd=%s' },
];

const CUSTOM_VALUE = '__custom__';

export function WebSettingsPanel({
  workspaceId,
  proxyId,
  open,
  onClose,
}: WebSettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ── 代理节点列表 ──
  const [nodes, setNodes] = useState<ProxyNode[]>([]);
  const refreshNodes = useCallback(() => {
    void window.electronAPI.listProxyNodes().then((list) => setNodes(list ?? []));
  }, []);

  // ── 添加节点表单 ──
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ProxyNodeType>('socks5');
  const [formHost, setFormHost] = useState('');

  // ── 清数据二次确认 ──
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedToast, setClearedToast] = useState(false);

  // ── 搜索引擎 ──
  const [searchPreset, setSearchPreset] = useState<string>(SEARCH_PRESETS[0].value);
  const [customSearch, setCustomSearch] = useState('');
  const [searchErr, setSearchErr] = useState('');

  // ── 默认主页 ──
  const [homeUrl, setHomeUrl] = useState('');

  // 面板打开时:拉节点列表 + 用当前全局设置初始化搜索/主页表单
  useEffect(() => {
    if (!open) return;
    refreshNodes();
    setShowAddForm(false);
    setConfirmClear(false);
    setClearedToast(false);
    setSearchErr('');

    const s = getWebSettings();
    const matched = SEARCH_PRESETS.find((p) => p.value === s.searchEngineTemplate);
    if (matched) {
      setSearchPreset(matched.value);
      setCustomSearch('');
    } else {
      setSearchPreset(CUSTOM_VALUE);
      setCustomSearch(s.searchEngineTemplate);
    }
    setHomeUrl(s.defaultUrl);
  }, [open, refreshNodes]);

  // 外点击关闭 + Esc 关闭(照语言菜单弹层模式)
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // ── 代理:选节点 ──
  const handleSelectProxy = useCallback(
    (id: string | undefined) => {
      setWebProxyId(workspaceId, id);
      // 立即切出口(不等下次 mount 的 useEffect)
      void window.electronAPI.setWebProxy({ workspaceId, proxyId: id });
    },
    [workspaceId],
  );

  // ── 代理:添加节点 ──
  const handleAddNode = useCallback(() => {
    const name = formName.trim() || formHost.trim() || '节点';
    const host = formType === 'direct' ? '' : formHost.trim();
    if (formType !== 'direct' && !host) return;
    void window.electronAPI
      .addProxyNode({ name, type: formType, host })
      .then(() => {
        setFormName('');
        setFormHost('');
        setFormType('socks5');
        setShowAddForm(false);
        refreshNodes();
      });
  }, [formName, formType, formHost, refreshNodes]);

  // ── 代理:删节点 ──
  const handleRemoveNode = useCallback(
    (id: string) => {
      void window.electronAPI.removeProxyNode(id).then(() => {
        // 若删的是当前 ws 选中的 → 置直连
        const ws = workspaceManager.get(workspaceId);
        const curProxy = ws ? getWebWsState(ws).proxyId : undefined;
        if (curProxy === id) handleSelectProxy(undefined);
        refreshNodes();
      });
    },
    [workspaceId, refreshNodes, handleSelectProxy],
  );

  // ── 清数据 ──
  const handleClearData = useCallback(() => {
    void window.electronAPI.clearWebStorageData({ workspaceId }).then(() => {
      setConfirmClear(false);
      setClearedToast(true);
      setTimeout(() => setClearedToast(false), 2500);
    });
  }, [workspaceId]);

  // ── 搜索引擎:选预设 / 自定义 ──
  const applySearchTemplate = useCallback((template: string) => {
    void window.electronAPI.updateWebSettings({ searchEngineTemplate: template }).then((s) => {
      if (s) setWebSettingsCache(s);
    });
  }, []);

  const handleSelectSearchPreset = useCallback(
    (value: string) => {
      setSearchPreset(value);
      setSearchErr('');
      if (value !== CUSTOM_VALUE) {
        applySearchTemplate(value);
      }
    },
    [applySearchTemplate],
  );

  const handleSaveCustomSearch = useCallback(() => {
    const v = customSearch.trim();
    if (!v.includes('%s')) {
      setSearchErr('模板必须含 %s 占位符(查询词位置)');
      return;
    }
    setSearchErr('');
    applySearchTemplate(v);
  }, [customSearch, applySearchTemplate]);

  // ── 默认主页 ──
  const handleSaveHome = useCallback(() => {
    const v = homeUrl.trim();
    if (!v) return;
    void window.electronAPI.updateWebSettings({ defaultUrl: v }).then((s) => {
      if (s) setWebSettingsCache(s);
    });
  }, [homeUrl]);

  if (!open) return null;

  return (
    <div className="krig-web-settings-panel" ref={panelRef} role="dialog" aria-label="Web 设置">
      <div className="krig-web-settings__header">
        <span className="krig-web-settings__title">设置</span>
        <button
          type="button"
          className="krig-web-settings__close"
          onClick={onClose}
          aria-label="关闭设置"
        >
          ×
        </button>
      </div>

      {/* ① 代理(本工作区) */}
      <section className="krig-web-settings__section">
        <div className="krig-web-settings__section-head">
          <span className="krig-web-settings__section-title">代理出口</span>
          <span className="krig-web-settings__scope">本工作区</span>
        </div>
        <select
          className="krig-web-settings__select"
          value={proxyId ?? ''}
          onChange={(e) => handleSelectProxy(e.target.value || undefined)}
        >
          <option value="">直连(不走代理)</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} {n.type !== 'direct' ? `(${n.type} ${n.host})` : '(直连)'}
            </option>
          ))}
        </select>

        <div className="krig-web-settings__node-list">
          {nodes.map((n) => (
            <div key={n.id} className="krig-web-settings__node-row">
              <span className="krig-web-settings__node-name">{n.name}</span>
              <span className="krig-web-settings__node-meta">
                {n.type === 'direct' ? '直连' : `${n.type} · ${n.host}`}
              </span>
              <button
                type="button"
                className="krig-web-settings__node-del"
                onClick={() => handleRemoveNode(n.id)}
                title="删除节点"
                aria-label="删除节点"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {showAddForm ? (
          <div className="krig-web-settings__add-form">
            <input
              className="krig-web-settings__input"
              placeholder="名称(可选)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <select
              className="krig-web-settings__select"
              value={formType}
              onChange={(e) => setFormType(e.target.value as ProxyNodeType)}
            >
              <option value="socks5">socks5</option>
              <option value="http">http</option>
              <option value="direct">direct(直连)</option>
            </select>
            {formType !== 'direct' && (
              <input
                className="krig-web-settings__input"
                placeholder="host:port(如 192.168.1.162:1080)"
                value={formHost}
                onChange={(e) => setFormHost(e.target.value)}
              />
            )}
            <div className="krig-web-settings__form-actions">
              <button
                type="button"
                className="krig-web-settings__btn krig-web-settings__btn--primary"
                onClick={handleAddNode}
              >
                添加
              </button>
              <button
                type="button"
                className="krig-web-settings__btn"
                onClick={() => setShowAddForm(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="krig-web-settings__btn"
            onClick={() => setShowAddForm(true)}
          >
            + 添加节点
          </button>
        )}
      </section>

      {/* ② 清除浏览数据(本工作区) */}
      <section className="krig-web-settings__section">
        <div className="krig-web-settings__section-head">
          <span className="krig-web-settings__section-title">清除浏览数据</span>
          <span className="krig-web-settings__scope">本工作区</span>
        </div>
        {confirmClear ? (
          <div className="krig-web-settings__confirm">
            <p className="krig-web-settings__confirm-msg">
              将清除本工作区的 cookies、缓存、localStorage 等,登录态会丢失,不可恢复。
            </p>
            <div className="krig-web-settings__form-actions">
              <button
                type="button"
                className="krig-web-settings__btn krig-web-settings__btn--danger"
                onClick={handleClearData}
              >
                确认清除
              </button>
              <button
                type="button"
                className="krig-web-settings__btn"
                onClick={() => setConfirmClear(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="krig-web-settings__btn"
            onClick={() => setConfirmClear(true)}
          >
            清除本工作区浏览数据
          </button>
        )}
        {clearedToast && <span className="krig-web-settings__toast">已清除</span>}
      </section>

      {/* ③ 默认搜索引擎(全局) */}
      <section className="krig-web-settings__section">
        <div className="krig-web-settings__section-head">
          <span className="krig-web-settings__section-title">默认搜索引擎</span>
          <span className="krig-web-settings__scope krig-web-settings__scope--global">全局</span>
        </div>
        <select
          className="krig-web-settings__select"
          value={searchPreset}
          onChange={(e) => handleSelectSearchPreset(e.target.value)}
        >
          {SEARCH_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_VALUE}>自定义</option>
        </select>
        {searchPreset === CUSTOM_VALUE && (
          <div className="krig-web-settings__custom-search">
            <input
              className="krig-web-settings__input"
              placeholder="https://example.com/search?q=%s"
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              onBlur={handleSaveCustomSearch}
            />
            {searchErr && <span className="krig-web-settings__err">{searchErr}</span>}
          </div>
        )}
      </section>

      {/* ④ 默认主页(全局) */}
      <section className="krig-web-settings__section">
        <div className="krig-web-settings__section-head">
          <span className="krig-web-settings__section-title">默认主页</span>
          <span className="krig-web-settings__scope krig-web-settings__scope--global">全局</span>
        </div>
        <input
          className="krig-web-settings__input"
          placeholder="https://www.google.com"
          value={homeUrl}
          onChange={(e) => setHomeUrl(e.target.value)}
          onBlur={handleSaveHome}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSaveHome();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </section>
    </div>
  );
}
