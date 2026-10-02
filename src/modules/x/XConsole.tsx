/**
 * X Console —— ⭐ **调试台**:逐个原子能力单独跑、看**原样**返回值
 *
 * ── 用户 2026-10-01 定的用途 ──
 *
 * 「专门用于调试控制、输入、输出(采集)等子函数使用」
 * · 控制 —— 跳转各页面、滚动、选定输入框
 * · 输入 —— 在选定输入框内输入、确认、发送
 * · 输出 —— 完整获取页面信息并落进数据模型
 *
 * ── ⭐ 它是调试台,不是功能面板 ──
 *
 * 判据:**每个按钮只调一个底座函数,返回值原样显示,不美化**。
 * ⚠️ 一旦开始「帮用户把两步连起来」,它就从调试台变成了业务流水线 ——
 * 而那时出问题就分不清是哪一步坏的。
 *
 * ⚠️⚠️ **红线:绝不提供「点发布」按钮。**
 * 用户反复确认过:只填内容,发布永远由人点。
 * 本文件可以 `type`(填进输入框),**不可以** `tap` 发布按钮。
 *
 * ── 本步(第 1 步)的范围 ──
 *
 * 骨架 + 控制那栏接通。输入/输出两栏先占位 ——
 * ⭐ 把「能不能调通」与「调得对不对」分开验。
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { WebDomInvoke, WebDomResult } from '@shared/ipc/web-dom-types';

type PageTable = {
  owner: string;
  names: string[];
  /** ⭐ 每个页面要哪些参数 —— **从真表来**,面板不抄 */
  params: Record<string, string[]>;
  /** ⭐ 每个参数该填什么 —— **从真表来**,面板不许自己写 `k === 'handle'` 分支 */
  hints: Record<string, string>;
};

/** 一次调用的留痕 —— ⭐ 存**整个 Result**,不只存成功与否 */
type LogEntry = {
  at: string;
  label: string;
  result: WebDomResult | { status: 'error'; reason: string };
};

export function XConsole({ wcId }: { wcId: number | null }): ReactElement {
  const [tables, setTables] = useState<PageTable[]>([]);
  const [pageName, setPageName] = useState('');
  /** 参数值:`{ handle: 'elonmusk' }` —— ⭐ 字段**由真表决定**,不写死 */
  const [paramVals, setParamVals] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  /**
   * ⭐ 页面名**从真表读**,面板不抄一份。
   * ⚠️ 抄一份就会漂 —— 漂的表现是「面板上有这个名字、点下去说没登记」
   * (旧实现的注释专门记了这条)。
   */
  useEffect(() => {
    void window.electronAPI?.webPageListNames?.().then(setTables).catch(() => {
      // ⚠️ 不静默:取不到页面表时下拉是空的,要让人看见原因
      setLog((l) => [{
        at: new Date().toLocaleTimeString(),
        label: 'listPageNames',
        result: { status: 'error' as const, reason: '取页面表失败 —— 主进程没注册这个通道?' },
      }, ...l]);
    });
  }, []);

  const call = useCallback(async (label: string, payload: WebDomInvoke) => {
    setBusy(true);
    const at = new Date().toLocaleTimeString();
    try {
      const r = await window.electronAPI!.webDomInvoke(payload);
      // ⭐ 原样存:Result 三态都要看得见,**degraded 不许当成功**
      setLog((l) => [{ at, label, result: r }, ...l].slice(0, 50));
    } catch (e) {
      setLog((l) => [{
        at, label,
        result: { status: 'error' as const, reason: e instanceof Error ? e.message : String(e) },
      }, ...l].slice(0, 50));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * ⭐ 当前页面要哪些参数 —— **问真表**,不靠面板猜。
   *
   * ⚠️ 旧实现栽过(原文):面板有**四处写死的正则**决定「要不要显示 handle
   * 输入框」,新页面不在里面 → 框不显示 → 参数不传 → resolve 返 null。
   * ⚠️ 2026-10-01 Console 第一版没有这张表,用户点 x.profile 直接 failed
   * 「没传参数」—— **面板没办法知道该填什么**。
   */
  const ownerTable = tables.find((t) => t.names.includes(pageName));
  const requiredParams: string[] = ownerTable?.params[pageName] ?? [];

  /** ⚠️ 必填参数没填满就禁用 —— 免得点下去只拿到一句「解析不出 URL」 */
  const missing = requiredParams.filter((k) => !(paramVals[k] ?? '').trim());

  const disabled = busy || wcId == null;

  return (
    <div style={S.root}>
      <div style={S.title}>𝕏 Console</div>
      <div style={S.hint}>
        ⭐ 调试台:每个按钮**只调一个底座函数**，返回值原样显示。
        {wcId == null && <strong style={{ color: '#d88' }}>　⚠️ 左栏 webview 未就绪</strong>}
      </div>

      {/* ── 控制 ── */}
      <section style={S.section}>
        <div style={S.sectionTitle}>控制（web.page）</div>
        <div style={S.row}>
          <select
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
            style={S.input}
          >
            <option value="">（选语义页面）</option>
            {tables.map((t) =>
              t.names.map((n) => (
                <option key={`${t.owner}:${n}`} value={n}>{`${n}  ·  ${t.owner}`}</option>
              )),
            )}
          </select>
          <button
            type="button"
            disabled={disabled || !pageName || missing.length > 0}
            title={missing.length > 0 ? `还缺参数：${missing.join('、')}` : undefined}
            onClick={() => call(`goto ${pageName}`, {
              op: 'goto', pageRef: { wcId: wcId! }, name: pageName, params: paramVals,
            })}
            style={S.btn}
          >
            goto
          </button>
        </div>
        {/* ⭐ 参数框**按真表渲染** —— 加页面时只改页面表,这里自动跟上 */}
        {requiredParams.map((k) => (
          <div key={k} style={S.row}>
            <span style={{ width: 70, opacity: 0.8 }}>{k}</span>
            <input
              value={paramVals[k] ?? ''}
              onChange={(e) => setParamVals((v) => ({ ...v, [k]: e.target.value }))}
              placeholder={ownerTable?.hints[k] ?? k}
              style={S.input}
            />
          </div>
        ))}
        {pageName && requiredParams.length === 0 && (
          <div style={S.todo}>这个页面不需要参数。</div>
        )}
        <div style={S.row}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => call('scrollUntil atBottom', {
              op: 'scrollUntil', pageRef: { wcId: wcId! },
              stop: { kind: 'atBottom' }, maxRounds: 5,
            })}
            style={S.btn}
          >
            scrollUntil（到底／5 轮）
          </button>
        </div>
      </section>

      {/* ── 输入 / 输出:本步占位 ── */}
      <section style={S.section}>
        <div style={S.sectionTitle}>输入（web.input）</div>
        <div style={S.todo}>
          ⏸️ 第 5 步接。⚠️⚠️ <strong>红线：永远不提供「点发布」按钮</strong> —— 只填内容，发布由人点。
        </div>
      </section>
      <section style={S.section}>
        <div style={S.sectionTitle}>输出（web.net 采集）</div>
        <div style={S.todo}>
          ⏸️ 第 3 步接。⭐「原样载荷」与「解析结果」将分两栏看 ——
          解析错了要能分清是「没采到」还是「采到了但解错」。
        </div>
      </section>

      {/* ── 留痕 ── */}
      <section style={{ ...S.section, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={S.sectionTitle}>
          返回值（原样，最近 50 条）
          {log.length > 0 && (
            <button type="button" onClick={() => setLog([])} style={S.linkBtn}>清空</button>
          )}
        </div>
        <div style={S.logBox}>
          {log.length === 0 && <div style={S.todo}>还没调用过。</div>}
          {log.map((e, i) => (
            <div key={`${e.at}-${i}`} style={S.logItem}>
              <div style={S.logHead}>
                <span style={{ ...S.badge, ...badgeStyle(e.result.status) }}>{e.result.status}</span>
                <span style={{ color: '#aaa' }}>{e.label}</span>
                <span style={{ color: '#666', marginLeft: 'auto' }}>{e.at}</span>
              </div>
              {/* ⭐ 原样 JSON —— 不挑字段、不美化;挑了就看不出底座到底回了什么 */}
              <pre style={S.pre}>{JSON.stringify(e.result, null, 2)}</pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** ⚠️ `degraded` 用**警告色**不用成功色 —— 它不是成功 */
function badgeStyle(status: string): React.CSSProperties {
  if (status === 'ok') return { background: '#1f4d2e', color: '#8fd9a8' };
  if (status === 'degraded') return { background: '#4d3f1f', color: '#d9c48f' };
  return { background: '#4d1f1f', color: '#d98f8f' };
}

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
    height: '100%', boxSizing: 'border-box', overflow: 'hidden',
    color: 'var(--text-secondary, #999)', fontSize: 12,
  },
  title: { fontSize: 14, color: 'var(--text-primary, #ddd)' },
  hint: { fontSize: 11, opacity: 0.75, lineHeight: 1.6 },
  section: {
    border: '1px solid var(--border-color, #333)', borderRadius: 6,
    padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
  },
  sectionTitle: {
    fontSize: 12, color: 'var(--text-primary, #ccc)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  input: {
    flex: 1, background: '#1b1b1b', border: '1px solid #3a3a3a',
    borderRadius: 4, color: '#ddd', fontSize: 12, padding: '4px 6px',
  },
  textarea: {
    background: '#1b1b1b', border: '1px solid #3a3a3a', borderRadius: 4,
    color: '#ddd', fontSize: 12, padding: 6, resize: 'vertical', fontFamily: 'monospace',
  },
  btn: {
    background: 'transparent', border: '1px solid #4a4a4a', borderRadius: 4,
    color: '#bbb', cursor: 'pointer', fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap',
  },
  linkBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: '#777', cursor: 'pointer', fontSize: 11,
  },
  todo: { fontSize: 11, opacity: 0.6, lineHeight: 1.6 },
  logBox: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  logItem: { border: '1px solid #2c2c2c', borderRadius: 4, padding: 6 },
  logHead: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, marginBottom: 4 },
  badge: { borderRadius: 3, fontSize: 10, padding: '1px 6px' },
  pre: {
    margin: 0, fontSize: 11, lineHeight: 1.5, color: '#9a9a9a',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflow: 'auto',
  },
};
