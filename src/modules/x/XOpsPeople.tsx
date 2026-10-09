/**
 * XOpsPeople —— ⭐⭐ 运营 → 「人」(2026-10-08,第 1 块:只读骨架)
 *
 * 用户定的三段:① 我的号 ② 关系概览(点格子列出这群人)③ 列表 + 人卡。
 * 规矩:事实只从三个标记来;每个数字带采集时间;没采到写「还没采集」不写 0;
 * 人卡「事实」与「推断」分开;缺数据处就是采集入口。
 *
 * ⚠️ 第 1 块**不动数据结构**。还没做的(我的号曲线 / 回复往来 / 大陆背景标注 /
 * 采他的推文 / 分析他)都**明说「还没做」**,不做成点了没反应的假按钮。
 *
 * 布局随自身宽度变:窄(右栏)时人卡盖住列表、点返回回来;宽(全屏)时左右并排。
 *
 * ⭐ 排除(2026-10-08,schema 1.2.21):用户「我看到不愿意再需要分析的用户，就右键排除」。
 * 右键一行 → 排除;立刻从列表消失,上方给「撤销」;概览只算范围内的人。
 *
 * ⭐ 标签(2026-10-08,schema 1.2.22):用户「增加第三个功能，就是打标签，点击后弹出一个简单的对话框，
 * 我输入我自己想要的标签。最后提供一个标签关键词的过滤方式就好了，标签可以打多个的，自由一点。」
 *
 * ⭐ 关联(2026-10-08):用户「点击选定用户时，右边的x view跳转到这个人的主页」。
 * ⭐⭐ 核对(2026-10-09):跳转时**顺手读这一页**(主页加载本来就会请求 UserByScreenName),
 * 有变化直接更新库并在这一行提示。一次只核对一个;连点时只核对最后点的那个。
 * ⚠️ 操作台采集中不跳(跳走会打断采集),并说出来;已经在他主页就不重载。
 */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactElement,
} from 'react';
import { xDataCall } from './x-data-types';
import { X_NOISY_URLS, X_PAGE_NAME } from './x-pages';
import { getXHostBusy, setXHostBusy, subscribeXHost, getXHostState } from './x-host-registry';
import { auditUserPayload, type XUserRecord } from './x-user-audit';
import { PROFILE_ENDPOINT, pickProfileUser } from './x-person-refresh';
import {
  DEFAULT_PEOPLE_FILTER, PEOPLE_GROUPS, PEOPLE_SORTS, relationLabel, normalizeTags, splitTagInput,
  type PeopleFilter, type PeopleGroup, type PeopleOverview, type PeopleScope, type PeopleSort,
  type PersonDetail, type PersonRow,
} from './x-people-query';

const PAGE = 200;
/** 宽于此就并排显示列表与人卡 */
const WIDE = 760;

const fmt = (n: number | undefined): string => (n === undefined ? '—' : n.toLocaleString());

export function XOpsPeople({ workspaceId }: { workspaceId: string }): ReactElement {
  const [overview, setOverview] = useState<PeopleOverview | null>(null);
  const [filter, setFilter] = useState<PeopleFilter>(DEFAULT_PEOPLE_FILTER);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 选中(高亮)的那一行 —— 单击即选中 */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * ⭐ 人卡开着的那个人 —— **双击才开**(用户 2026-10-08:「个人card双击的时候再显示，
   * 单击用户不要显示好操作一点」)。与「选中」分开:单击只高亮 + X 网页跟着跳。
   */
  const [cardId, setCardId] = useState<string | null>(null);
  /** 右键菜单 —— 位置 + 对象 */
  const [menu, setMenu] = useState<{ x: number; y: number; p: PersonRow; index: number } | null>(null);
  /** ⭐ 标签目录(有哪些标签、各几人)—— 对话框提示与过滤提示共用 */
  const [catalog, setCatalog] = useState<Array<{ tag: string; count: number }>>([]);
  /** 正在打标签的人 */
  const [tagging, setTagging] = useState<PersonRow | null>(null);
  /** 人卡要重读(标签改了)—— 递增即重读 */
  const [cardRev, setCardRev] = useState(0);
  /** ⭐ 刚做的那次排除/取消 —— 点错了能马上撤回 */
  const [undo, setUndo] = useState<{ p: PersonRow; index: number; excluded: boolean } | null>(null);

  /** ⭐ 自身宽度 —— 决定人卡是盖住列表还是并排 */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= WIDE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** X 网页的 wcId —— 「点人跳主页」要用;没开就不跳并说明 */
  const wcId = useSyncExternalStore(subscribeXHost, () => getXHostState(workspaceId)?.wcId ?? null);
  /** ⭐ 点人时 X 网页跟着跳 —— 默认开;只想翻列表不想跳时可以关 */
  const [follow, setFollow] = useState(true);
  /** 没跳的原因 —— 说出来,不静默 */
  const [followNote, setFollowNote] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    void xDataCall({ op: 'peopleOverview' }).then((r) => {
      if (r.status === 'ok') setOverview(r.value as PeopleOverview);
      else setErr(r.reason);
    });
  }, []);
  /** ⭐ 每个人最近一次核对的结果 —— 显示在列表那一行 */
  const [verify, setVerify] = useState<Record<string, { kind: 'running' | 'same' | 'changed' | 'new' | 'miss'; text: string; at: number }>>({});
  const verifying = useRef(false);
  const pending = useRef<PersonRow | null>(null);

  /** 把核对到的资料补进列表那一行(不重查整页) */
  const patchRow = (r: XUserRecord): void => {
    setRows((prev) => prev.map((x) => (x.rest_id !== r.restId ? x : {
      ...x,
      handle: r.handle.toLowerCase() || x.handle,
      display_name: r.name || x.display_name,
      avatar: r.avatar || x.avatar,
      bio: r.bio || x.bio,
      followers_count: r.followersCount ?? x.followers_count,
      is_blue_verified: r.isBlueVerified ?? x.is_blue_verified,
      i_follow: r.following ?? x.i_follow,
      follows_me: r.followedBy ?? x.follows_me,
    })));
  };

  /**
   * ⭐⭐ 让 X 网页打开这个人的主页,并**顺手核对**。
   * ⚠️ 不跳的情况都说出来:X 网页没开 / 操作台正在采集(跳走会打断采集)。
   * ⚠️ 核对期间登记「忙」,免得操作台同时在这个页面上采。
   */
  const VERIFY_BUSY = '运营正在核对这个人';
  const runVerify = useCallback(async (p: PersonRow): Promise<void> => {
    if (wcId == null) { setFollowNote('X 网页没开,没跳转'); return; }
    const busy = getXHostBusy(wcId);
    if (busy !== null && busy !== VERIFY_BUSY) { setFollowNote(`${busy},没跳转(跳走会打断采集)`); return; }
    setFollowNote(null);
    setVerify((v) => ({ ...v, [p.rest_id]: { kind: 'running', text: '核对中…', at: Date.now() } }));
    setXHostBusy(wcId, VERIFY_BUSY);
    let result: { kind: 'same' | 'changed' | 'new' | 'miss'; text: string };
    try {
      const h = await window.electronAPI!.webDomInvoke({
        op: 'harvest', pageRef: { wcId },
        plan: {
          gotoPage: { name: X_PAGE_NAME.profile, params: { handle: p.handle } },
          /** 只等主页资料那一条;来了就停,最多 3 轮、10 秒 */
          pageUrlIncludes: [PROFILE_ENDPOINT], wantPages: 1, maxRounds: 3, maxMs: 10_000,
          noisyUrlSubstrings: X_NOISY_URLS,
        },
      });
      if (h.status === 'failed') {
        result = { kind: 'miss', text: `没读到:${h.reason ?? '原因未知'}` };
      } else {
        const rep = h.value as { items?: Array<{ url: string; text: string }>; problems?: string[] };
        const items = (rep.items ?? []).filter((it) => it.url.includes(PROFILE_ENDPOINT));
        const users = items.flatMap((it) => auditUserPayload(it.text).items);
        const rec = pickProfileUser(users, p.handle, p.rest_id);
        if (!rec) {
          /** ⚠️ 把采集层报的原因也带上(如「没能去到这一页」)—— 不只说「没来」 */
          const why = rep.problems?.[0];
          result = { kind: 'miss', text: items.length === 0
            ? `没读到(主页资料那条请求没来${why ? `:${why}` : ''})` : '没读到(载荷里找不到这个人)' };
        } else {
          const r = await xDataCall({ op: 'refreshPerson', record: rec });
          if (r.status === 'failed') {
            result = { kind: 'miss', text: `没写进库:${r.reason}` };
          } else {
            const d = r.value as { isNew: boolean; changes: string[] };
            patchRow(rec);
            setCardRev((v) => v + 1);
            if (d.changes.length > 0 || d.isNew) loadOverview();
            result = d.isNew ? { kind: 'new', text: '库里没有,已补进来' }
              : d.changes.length > 0 ? { kind: 'changed', text: `有变化:${d.changes.join(';')}(已更新)` }
                : { kind: 'same', text: '刚核对,与库里一致' };
          }
        }
      }
    } catch (e) {
      result = { kind: 'miss', text: `没读到:${e instanceof Error ? e.message : String(e)}` };
    } finally {
      setXHostBusy(wcId, null);
    }
    setVerify((v) => ({ ...v, [p.rest_id]: { ...result, at: Date.now() } }));
  }, [wcId, loadOverview]);

  /** ⭐ 一次只核对一个;核对中又点了别人,只记住**最后点的那个** */
  const openInX = useCallback((p: PersonRow): void => {
    const last = verify[p.rest_id];
    /** 15 秒内刚核对过同一个人就不重来(双击也会先触发两次单击) */
    if (last && last.kind !== 'miss' && Date.now() - last.at < 15_000) return;
    if (verifying.current) { pending.current = p; return; }
    verifying.current = true;
    void (async () => {
      let next: PersonRow | null = p;
      while (next) {
        await runVerify(next);
        next = pending.current;
        pending.current = null;
      }
      verifying.current = false;
    })();
  }, [runVerify, verify]);

  /** 单击:选中 + X 网页跟着跳 —— **不开人卡** */
  const selectPerson = (p: PersonRow): void => {
    setSelected(p.rest_id);
    if (follow) openInX(p);
  };

  /** 双击 / 右键「打开人卡」:开人卡 */
  const openCard = (p: PersonRow): void => {
    setSelected(p.rest_id);
    setCardId(p.rest_id);
  };

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const loadCatalog = useCallback(() => {
    void xDataCall({ op: 'tagCatalog' }).then((r) => {
      if (r.status === 'ok') setCatalog(r.value as Array<{ tag: string; count: number }>);
      else setErr(r.reason);
    });
  }, []);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  /**
   * ⭐⭐ 存标签 —— 写成功后**用库返回的**(清洗后的)标签更新列表,不用自己手里那份。
   * ⚠️ 失败如实报,对话框不关(人填的东西别丢)。
   */
  const saveTags = useCallback(async (p: PersonRow, tags: string[]): Promise<string | null> => {
    const r = await xDataCall({ op: 'setTags', restId: p.rest_id, tags });
    if (r.status === 'failed') return r.reason;
    const saved = r.value as string[];
    setRows((prev) => prev.map((x) => (x.rest_id === p.rest_id ? { ...x, tags: saved } : x)));
    setCardRev((v) => v + 1);
    loadCatalog();
    return null;
  }, [loadCatalog]);

  /** 菜单:点别处 / Esc / 滚动就关 */
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  /** ⚠️ 只认最后一次请求 —— 打字时先发的慢请求不许覆盖后发的 */
  const seq = useRef(0);
  const load = useCallback(async (f: PeopleFilter, start: number) => {
    const my = ++seq.current;
    setBusy(true);
    const r = await xDataCall({ op: 'queryPeople', filter: f, limit: PAGE, start });
    if (my !== seq.current) return;
    setBusy(false);
    if (r.status === 'failed') { setErr(r.reason); return; }
    const v = r.value as { total: number; rows: PersonRow[] };
    setErr(null);
    setTotal(v.total);
    setRows((prev) => (start === 0 ? v.rows : [...prev, ...v.rows]));
  }, []);

  const key = JSON.stringify(filter);
  useEffect(() => {
    const t = setTimeout(() => void load(JSON.parse(key) as PeopleFilter, 0), 250);
    return () => clearTimeout(t);
  }, [key, load]);

  /**
   * ⭐⭐ 排除 / 取消排除 —— 成功后这个人离开当前列表(它已不属于这个范围),
   * 记下原位置供「撤销」放回去;概览重读。
   * ⚠️ 失败如实报,不先从列表里拿掉 —— 否则「看着排除了、库里没变」。
   */
  const applyExcluded = useCallback(async (p: PersonRow, excluded: boolean): Promise<boolean> => {
    const r = await xDataCall({ op: 'setExcluded', restId: p.rest_id, excluded });
    if (r.status === 'failed') { setErr(r.reason); return false; }
    setErr(null);
    setRows((prev) => prev.filter((x) => x.rest_id !== p.rest_id));
    setTotal((t) => (t === null ? t : t - 1));
    if (selected === p.rest_id) setSelected(null);
    if (cardId === p.rest_id) setCardId(null);
    loadOverview();
    return true;
  }, [loadOverview, selected, cardId]);

  const toggleExclude = async (p: PersonRow, index: number): Promise<void> => {
    const excluded = p.excluded !== true;
    if (await applyExcluded(p, excluded)) setUndo({ p, index, excluded });
  };

  const doUndo = async (): Promise<void> => {
    if (!undo) return;
    const r = await xDataCall({ op: 'setExcluded', restId: undo.p.rest_id, excluded: !undo.excluded });
    if (r.status === 'failed') { setErr(r.reason); return; }
    /** 放回原位置 —— 撤销后列表应与操作前一样 */
    setRows((prev) => [...prev.slice(0, undo.index), { ...undo.p }, ...prev.slice(undo.index)]);
    setTotal((t) => (t === null ? t : t + 1));
    setUndo(null);
    loadOverview();
  };

  const pickGroup = (g: PeopleGroup): void =>
    setFilter((f) => ({ ...f, group: f.group === g ? 'all' : g }));

  const showCard = cardId !== null;
  const listHidden = showCard && !wide;

  return (
    <div ref={rootRef} style={S.root}>
      {/* ① 我的号 */}
      <div style={S.card}>
        <div style={S.cardTitle}>我的号</div>
        <div style={S.muted}>
          增长曲线还没做 —— 要先定「什么时候记一次自己号的粉丝数」(打开运营时自动记,还是手动点)。
        </div>
      </div>

      {/* ② 关系概览 —— 点一格,下面列出这群人;再点一次回到全部 */}
      <div style={S.cells}>
        {PEOPLE_GROUPS.filter((g) => g.id !== 'all'
          /** 「关系不明」只在真有这类人时才占一格 */
          && (g.id !== 'unknown' || (overview?.unknown.total ?? 0) > 0)).map((g) => {
          const v = overview?.[g.id];
          const active = filter.group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => pickGroup(g.id)}
              style={{ ...S.cell, ...(active ? S.cellActive : null) }}
              title={active ? '再点一次回到全部' : `列出「${g.label}」的人`}
            >
              <span style={S.cellLabel}>{g.label}</span>
              <span style={S.cellNum}>{v ? v.total.toLocaleString() : '…'}</span>
              <span style={S.muted}>蓝V {v ? v.blue.toLocaleString() : '…'}</span>
              {g.id === 'none' && <span style={S.muted}>多为配方找到的</span>}
              {g.id === 'unknown' && <span style={S.muted}>推文没带关系标记</span>}
            </button>
          );
        })}
        <div style={{ ...S.cell, cursor: 'default', opacity: 0.75 }} title="第 3 块:先采「我回复过他」">
          <span style={S.cellLabel}>回复往来</span>
          <span style={S.muted}>我回复过他:还没采集</span>
          <span style={S.muted}>他回复过我:还没采集</span>
        </div>
      </div>

      {err !== null && <div style={S.error}>⚠️ {err}</div>}

      {/* ③ 列表 + 人卡 */}
      <div style={S.split}>
        {!listHidden && (
          <div style={{ ...S.listPane, ...(showCard && wide ? { flex: '1 1 55%' } : null) }}>
            <div style={S.controls}>
              <label style={S.check}>
                <input type="checkbox" checked={filter.blueOnly}
                  onChange={(e) => setFilter({ ...filter, blueOnly: e.target.checked })} /> 蓝V
              </label>
              <label style={S.check} title="字面信号:有汉字、且没有 2 个以上假名字母(排除日文)。港台、海外华人也会命中;中日双语的中文用户会被当成日文">
                <input type="checkbox" checked={filter.cnText}
                  onChange={(e) => setFilter({ ...filter, cnText: e.target.checked })} /> 中文名或 bio(不含日文)
              </label>
              <select
                value={filter.scope} style={S.select}
                onChange={(e) => { setUndo(null); setFilter({ ...filter, scope: e.target.value as PeopleScope }); }}
                title="排除过的人默认不显示"
              >
                <option value="in">范围内</option>
                <option value="excluded">已排除{overview ? ` (${overview.excludedTotal.toLocaleString()})` : ''}</option>
              </select>
              <select value={filter.sort} style={S.select}
                onChange={(e) => setFilter({ ...filter, sort: e.target.value as PeopleSort })}>
                {PEOPLE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <label style={S.check} title="点一个人时,X 网页跳到他的主页">
                <input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); setFollowNote(null); }} />
                点人时 X 网页跟着跳
              </label>
              <input value={filter.text} placeholder="搜 handle / 名字 / bio" style={S.input}
                onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
              {/* ⭐ 标签关键词 —— 有任一标签包含它就命中;输入时提示已有标签 */}
              <input
                value={filter.tag} placeholder="标签关键词" style={{ ...S.input, flex: '0 1 140px' }}
                list="x-ops-tag-catalog"
                onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
                title={catalog.length > 0 ? `已有 ${catalog.length} 个标签` : '还没有标签 —— 右键一个人「打标签…」'}
              />
              <datalist id="x-ops-tag-catalog">
                {catalog.map((c) => <option key={c.tag} value={c.tag}>{`${c.count} 人`}</option>)}
              </datalist>
            </div>
            {followNote !== null && <div style={S.muted}>⚠️ {followNote}</div>}
            {undo && (
              <div style={S.undo}>
                已{undo.excluded ? '排除' : '取消排除'} {undo.p.display_name ?? undo.p.handle}(@{undo.p.handle})
                <button type="button" style={S.linkBtn} onClick={() => void doUndo()}>撤销</button>
                <button type="button" style={S.linkBtn} onClick={() => setUndo(null)} title="知道了">✕</button>
              </div>
            )}
            <div style={S.muted}>
              {filter.scope === 'excluded' ? '已排除 · ' : ''}
              {PEOPLE_GROUPS.find((g) => g.id === filter.group)?.label}
              {total === null ? ' · 读取中…' : ` · 共 ${total.toLocaleString()} 人,显示 ${rows.length.toLocaleString()}`}
              {busy && total !== null && ' · 刷新中…'}
            </div>
            <div style={S.list}>
              {rows.map((p, index) => (
                <div
                  key={p.rest_id}
                  onClick={() => selectPerson(p)}
                  onDoubleClick={() => openCard(p)}
                  /** 双击时浏览器会选中一段文字 —— 只挡「第二下」,单击拖选复制照常 */
                  onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, p, index }); }}
                  style={{ ...S.row, ...(selected === p.rest_id ? S.rowActive : null) }}
                >
                  {p.avatar ? <img src={p.avatar} alt="" style={S.avatar} /> : <div style={S.avatar} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={S.line}>
                      <strong style={S.name}>{p.display_name ?? p.handle}</strong>
                      {p.is_blue_verified === true && <span style={S.blue} title="蓝V">✓</span>}
                      <span style={S.muted}>@{p.handle}</span>
                    </div>
                    <div style={S.line}>
                      <span style={S.tag}>{relationLabel(p)}</span>
                      <span style={S.muted}>粉丝 {fmt(p.followers_count)}</span>
                      {(p.tags ?? []).map((t) => <span key={t} style={S.userTag}>{t}</span>)}
                      {(p.found_via_recipes ?? []).map((r) => <span key={`r:${r}`} style={S.recipeTag}>配方:{r}</span>)}
                    </div>
                    {p.bio && <div style={S.bio}>{p.bio}</div>}
                    {verify[p.rest_id] && (
                      <div style={verify[p.rest_id].kind === 'changed' || verify[p.rest_id].kind === 'miss' ? S.verifyWarn : S.muted}>
                        {{ running: '⏳', same: '✓', changed: '⚠', new: '＋', miss: '?' }[verify[p.rest_id].kind]} {verify[p.rest_id].text}
                        {verify[p.rest_id].kind === 'miss' && (
                          <button type="button" style={S.linkBtn} onClick={(e) => { e.stopPropagation(); openInX(p); }}>再读</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {total !== null && rows.length < total && (
                <button type="button" style={S.btn} disabled={busy} onClick={() => void load(filter, rows.length)}>
                  {busy ? '读取中…' : `再显示 ${Math.min(PAGE, total - rows.length)} 人`}
                </button>
              )}
            </div>
          </div>
        )}
        {showCard && (
          <PersonCard
            restId={cardId!}
            wcId={wcId}
            onOpenInX={(person) => openInX(person)}
            rev={cardRev}
            onEditTags={(p) => setTagging(p)}
            onToggleExclude={(p) => {
              const index = rows.findIndex((x) => x.rest_id === p.rest_id);
              void toggleExclude(p, index < 0 ? 0 : index);
            }}
            onBack={wide ? undefined : () => setCardId(null)}
            onClose={() => setCardId(null)}
          />
        )}
      </div>

      {/* ⭐ 右键菜单 —— 点别处 / Esc / 滚动就关 */}
      {menu && (
        <div style={{ ...S.menu, left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button" style={S.menuItem}
            onClick={() => { const m = menu; setMenu(null); void toggleExclude(m.p, m.index); }}
          >
            {menu.p.excluded === true ? '取消排除(放回分析范围)' : '排除(不在分析范围)'}
          </button>
          <button
            type="button" style={S.menuItem}
            onClick={() => { openCard(menu.p); setMenu(null); }}
          >
            打开人卡
          </button>
          <button
            type="button" style={S.menuItem}
            onClick={() => { setTagging(menu.p); setMenu(null); }}
          >
            打标签…
          </button>
        </div>
      )}

      {tagging && (
        <TagDialog
          person={tagging}
          catalog={catalog}
          onSave={async (tags) => {
            const why = await saveTags(tagging, tags);
            if (why === null) setTagging(null);
            return why;
          }}
          onCancel={() => setTagging(null)}
        />
      )}
    </div>
  );
}

/** ⭐ 人卡 —— 事实(采来的)与推断(AI 猜的)分开;缺的就是采集入口 */
function PersonCard(
  { restId, wcId, onBack, onClose, onToggleExclude, onOpenInX, onEditTags, rev }: {
    restId: string; wcId: number | null; onBack?: () => void; onClose: () => void;
    onToggleExclude: (p: PersonRow) => void;
    onEditTags: (p: PersonRow) => void;
    /** 标签改了要重读 —— 递增即重读 */
    rev: number;
    /** ⭐ 与「点人跳主页」同一个函数 —— 忙不跳、一次只核对一个的规矩只有一份 */
    onOpenInX: (p: PersonRow) => void;
  },
): ReactElement {
  const [p, setP] = useState<PersonDetail | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setP(undefined);
    void xDataCall({ op: 'personDetail', restId }).then((r) => {
      if (r.status === 'ok') { setP(r.value as PersonDetail | null); setErr(null); }
      else setErr(r.reason);
    });
  }, [restId, rev]);

  const openProfile = (): void => {
    if (p) onOpenInX(p);
  };

  return (
    <div style={S.cardPane}>
      <div style={S.line}>
        {onBack && <button type="button" style={S.btn} onClick={onBack}>← 返回列表</button>}
        <span style={{ flex: 1 }} />
        {!onBack && <button type="button" style={S.btn} onClick={onClose} title="关闭人卡">✕</button>}
      </div>
      {err !== null && <div style={S.error}>⚠️ {err}</div>}
      {p === undefined && err === null && <div style={S.muted}>读取中…</div>}
      {p === null && <div style={S.error}>这个人不在库里了(数字 id {restId})</div>}
      {p && (
        <>
          <div style={S.cardHead}>
            {p.avatar ? <img src={p.avatar} alt="" style={S.bigAvatar} /> : <div style={S.bigAvatar} />}
            <div style={{ minWidth: 0 }}>
              <div style={S.line}>
                <strong style={{ ...S.name, fontSize: 15 }}>{p.display_name ?? p.handle}</strong>
                {p.is_blue_verified === true && <span style={S.blue}>✓ 蓝V</span>}
                {p.is_verified === true && <span style={S.tag}>认证</span>}
                {p.is_protected === true && <span title="受保护:采不到他的推文">🔒</span>}
              </div>
              <div style={S.line}>
                <span style={S.muted}>@{p.handle}</span>
                <span style={S.tag}>{relationLabel(p)}</span>
              </div>
            </div>
          </div>

          <div style={S.line}>
            <span style={S.muted}>
              {p.excluded === true
                ? `已排除(${p.excluded_source === 'human' ? '你' : p.excluded_source ?? '?'}${p.excluded_at ? ` · ${new Date(p.excluded_at).toLocaleDateString()}` : ''})`
                : '在分析范围内'}
            </span>
            <button type="button" style={S.btn} onClick={() => onToggleExclude(p)}>
              {p.excluded === true ? '取消排除' : '排除'}
            </button>
          </div>

          <div style={S.line}>
            <span style={S.factKey}>标签</span>
            {(p.tags ?? []).length === 0
              ? <span style={S.muted}>还没有</span>
              : (p.tags ?? []).map((t) => <span key={t} style={S.userTag}>{t}</span>)}
            <button type="button" style={S.btn} onClick={() => onEditTags(p)}>编辑标签</button>
          </div>
          {(p.found_via_recipes ?? []).length > 0 && (
            <div style={S.line}>
              <span style={S.factKey}>来源</span>
              {(p.found_via_recipes ?? []).map((r) => <span key={r} style={S.recipeTag}>配方:{r}</span>)}
            </div>
          )}

          <Section title="事实" note={p.fetched_at ? `采于 ${new Date(p.fetched_at).toLocaleString()}` : '采集时间未知'}>
            <Fact k="粉丝 / 关注 / 发推" v={`${fmt(p.followers_count)} / ${fmt(p.following_count)} / ${fmt(p.tweet_count)}`} />
            <Fact k="注册" v={p.account_created_at ? p.account_created_at.slice(0, 10) : '—'} />
            <Fact k="地点" v={p.location || '未填'} />
            {p.website && <Fact k="网站" v={p.website} />}
            <Fact k="曾用名" v={p.handle_history && p.handle_history.length > 0 ? p.handle_history.map((h) => `@${h}`).join('、') : '无'} />
            <Fact k="数字 id" v={p.rest_id} />
            {p.bio && <div style={S.bioFull}>{p.bio}</div>}
          </Section>

          <Section title="推断" note="AI / 算法 —— 还没做">
            <Fact k="大陆背景" v="还没做(下一块:你标 > AI > 算法)" />
            <Fact k="省份 / 内容定位" v="还没做" />
            <button type="button" style={S.btn} disabled title="第 4 块">分析他(还没做)</button>
          </Section>

          <Section title="他的推文" note="还没采集">
            <button type="button" style={S.btn} disabled title="第 4 块">采他的推文(还没做)</button>
          </Section>

          <Section title="我们的互动" note="还没采集">
            <div style={S.muted}>回复往来在第 3 块采(先采「我回复过他」)。</div>
          </Section>

          <button
            type="button"
            style={S.btn}
            disabled={wcId == null}
            onClick={openProfile}
            title={wcId == null ? 'X 网页没开,打不开' : '在 X 网页打开他的主页'}
          >
            在 X 网页打开他的主页
          </button>
        </>
      )}
    </div>
  );
}

/**
 * ⭐ 打标签对话框 —— 用户要的是「一个简单的对话框，我输入我自己想要的标签」。
 * 回车加一个(逗号/顿号可一次加多个),✕ 去掉;输入时提示已有标签(防同义写法分叉)。
 * ⚠️ 存失败对话框不关,原因显示出来 —— 人填的东西别丢。
 */
function TagDialog(
  { person, catalog, onSave, onCancel }: {
    person: PersonRow;
    catalog: ReadonlyArray<{ tag: string; count: number }>;
    onSave: (tags: string[]) => Promise<string | null>;
    onCancel: () => void;
  },
): ReactElement {
  const [tags, setTags] = useState<string[]>([...(person.tags ?? [])]);
  const [input, setInput] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 把输入框里的东西加进去 —— 清洗规则与存库同一个函数 */
  const commit = (): string[] => {
    const { tags: next, problems } = normalizeTags([...tags, ...splitTagInput(input)]);
    setWhy(problems.length > 0 ? problems.join(';') : null);
    if (problems.length === 0) setInput('');
    setTags(next);
    return problems.length === 0 ? next : tags;
  };

  const save = async (): Promise<void> => {
    const next = input.trim() === '' ? tags : commit();
    if (input.trim() !== '' && next === tags) return;
    setSaving(true);
    const err = await onSave(next);
    setSaving(false);
    if (err !== null) setWhy(err);
  };

  /**
   * ⭐ 已有标签 —— 用户 2026-10-08:「输入框+已存在的标签的方式组合，这样我不用一个一个输入标签，
   * 可以从历史标签中选择。」点一下加上、再点去掉;打字时只留包含这几个字的。
   */
  const has = (t: string): boolean => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const toggle = (t: string): void => {
    setWhy(null);
    setTags(has(t) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  };
  const kw = input.trim().toLowerCase();
  const shown = kw === '' ? catalog : catalog.filter((c) => c.tag.toLowerCase().includes(kw));

  return (
    <div style={S.backdrop} onClick={onCancel}>
      <div
        style={S.dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      >
        <div style={S.cardTitle}>给 {person.display_name ?? person.handle}(@{person.handle})打标签</div>
        <div style={{ ...S.line, minHeight: 26 }}>
          <span style={S.muted}>已选:</span>
          {tags.length === 0 && <span style={S.muted}>还没有</span>}
          {tags.map((t) => (
            <span key={t} style={S.userTag}>
              {t}
              <button type="button" style={S.chipX} onClick={() => setTags(tags.filter((x) => x !== t))} title="去掉">✕</button>
            </span>
          ))}
        </div>
        <input
          autoFocus
          value={input}
          placeholder="输入新标签,回车加入(逗号可一次加多个);也会筛下面的已有标签"
          /** ⚠️ flex: none —— 借用的 S.input 带 flex-basis 140px,放进竖排对话框会变成 140px 高(2026-10-08 截图) */
          style={{ ...S.input, flex: 'none' }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (input.trim() === '') void save(); else commit();
            }
          }}
        />
        {catalog.length > 0 && (
          <div style={S.catalogBox}>
            <div style={S.muted}>
              已有标签(点一下加上 / 再点去掉){kw !== '' && ` · 包含「${input.trim()}」的 ${shown.length} 个`}
            </div>
            <div style={S.catalogChips}>
              {shown.length === 0 && <span style={S.muted}>没有匹配的 —— 回车就加成新标签</span>}
              {shown.map((c) => (
                <button
                  key={c.tag}
                  type="button"
                  onClick={() => toggle(c.tag)}
                  style={has(c.tag) ? S.pickOn : S.pickOff}
                  title={has(c.tag) ? '已选,点一下去掉' : `${c.count} 人用过,点一下加上`}
                >
                  {c.tag} <span style={{ opacity: 0.6 }}>{c.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {why !== null && <div style={S.error}>⚠️ {why}</div>}
        <div style={{ ...S.line, justifyContent: 'flex-end' }}>
          <button type="button" style={S.btn} onClick={onCancel}>取消</button>
          <button type="button" style={S.btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={S.section}>
      <div style={S.line}><span style={S.cardTitle}>{title}</span>{note && <span style={S.muted}>{note}</span>}</div>
      {children}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div style={S.fact}><span style={S.factKey}>{k}</span><span style={S.factVal}>{v}</span></div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 },
  card: {
    border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  cardTitle: { fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  muted: { fontSize: 11, color: 'var(--text-muted, #888)' },
  error: { fontSize: 12, color: 'var(--text-primary, #ddd)', border: '1px solid #7a3b3b', borderRadius: 4, padding: 8 },
  cells: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 },
  cell: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left',
    background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: 6,
    padding: '8px 10px', cursor: 'pointer', color: 'var(--text-secondary, #aaa)',
  },
  cellActive: { borderColor: 'var(--accent-bar, #6b9fff)', background: 'var(--accent-bg, rgba(138,180,248,0.15))' },
  cellLabel: { fontSize: 11, color: 'var(--text-secondary, #aaa)' },
  cellNum: { fontSize: 18, color: 'var(--text-primary, #ddd)', fontVariantNumeric: 'tabular-nums' },
  split: { flex: 1, minHeight: 0, display: 'flex', gap: 10 },
  listPane: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  check: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  select: {
    background: 'var(--bg-elevated, #1b1b1b)', border: '1px solid var(--border-color, #3a3a3a)', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '3px 4px',
  },
  input: {
    flex: '1 1 140px', minWidth: 0, background: 'var(--bg-elevated, #1b1b1b)',
    border: '1px solid var(--border-color, #3a3a3a)', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '4px 6px',
  },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 4px', cursor: 'pointer',
    borderTop: '1px solid var(--border-color, #2a2a2a)',
  },
  rowActive: { background: 'var(--accent-bg, rgba(138,180,248,0.15))' },
  avatar: { width: 32, height: 32, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 },
  bigAvatar: { width: 48, height: 48, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 },
  line: { display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexWrap: 'wrap', lineHeight: 1.6 },
  name: { color: 'var(--text-primary, #ddd)' },
  blue: { color: '#1d9bf0', fontWeight: 700, fontSize: 12 },
  tag: { fontSize: 10, border: '1px solid var(--border-color, #444)', borderRadius: 3, padding: '0 4px', color: 'var(--text-secondary, #aaa)' },
  bio: {
    fontSize: 11, color: 'var(--text-muted, #888)', lineHeight: 1.6,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  btn: {
    background: 'transparent', border: '1px solid var(--border-color, #444)', borderRadius: 4,
    color: 'var(--text-secondary, #aaa)', cursor: 'pointer', fontSize: 12, padding: '4px 10px',
    alignSelf: 'flex-start',
  },
  cardPane: {
    flex: '1 1 45%', minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10,
    border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: 12,
  },
  cardHead: { display: 'flex', gap: 10, alignItems: 'center' },
  section: {
    display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8,
    borderTop: '1px solid var(--border-color, #2a2a2a)',
  },
  fact: { display: 'flex', gap: 8, fontSize: 12 },
  factKey: { width: 104, flexShrink: 0, color: 'var(--text-muted, #888)' },
  factVal: { color: 'var(--text-primary, #ddd)', wordBreak: 'break-all' },
  /** 核对有变化 / 没读到 —— 要让人注意,用正文色,不只靠颜色(前面有 ⚠ / ? 图标) */
  verifyWarn: { fontSize: 11, color: 'var(--text-primary, #ddd)' },
  undo: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', background: 'var(--accent-bg, rgba(138,180,248,0.15))',
  },
  linkBtn: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12,
    color: 'var(--accent-text, #8ab4f8)',
  },
  /** ⚠️ z-index 1000:与 app 的 popup 同层,高于运营全屏覆盖层(900) */
  menu: {
    position: 'fixed', zIndex: 1000, display: 'flex', flexDirection: 'column', minWidth: 180, padding: 4,
    background: 'var(--bg-popup, #2a2a2a)', border: '1px solid var(--border-color, #444)', borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
  },
  menuItem: {
    textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '6px 10px',
  },
  /** 你打的标签 —— 与「关系」那种系统标签样子要分得开 */
  userTag: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, borderRadius: 10, padding: '0 8px',
    color: 'var(--accent-text, #8ab4f8)', background: 'var(--accent-bg, rgba(138,180,248,0.15))',
  },
  /** ⭐ 配方来源 —— 系统记录的事实,与你手打的标签样子分开(虚线框、不填色) */
  recipeTag: {
    display: 'inline-flex', alignItems: 'center', fontSize: 11, borderRadius: 10, padding: '0 8px',
    color: 'var(--text-secondary, #aaa)', border: '1px dashed var(--border-color, #555)',
  },
  chipX: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10,
    color: 'var(--accent-text, #8ab4f8)',
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    width: 'min(420px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: 10, padding: 16,
    background: 'var(--bg-popup, #2a2a2a)', border: '1px solid var(--border-color, #444)', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
  },
  catalogBox: { display: 'flex', flexDirection: 'column', gap: 6 },
  /** 标签多了也不撑爆对话框 —— 自己滚 */
  catalogChips: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' },
  pickOff: {
    fontSize: 12, borderRadius: 12, padding: '2px 10px', cursor: 'pointer',
    background: 'transparent', color: 'var(--text-secondary, #aaa)',
    border: '1px solid var(--border-color, #444)',
  },
  pickOn: {
    fontSize: 12, borderRadius: 12, padding: '2px 10px', cursor: 'pointer',
    background: 'var(--accent-bg, rgba(138,180,248,0.15))', color: 'var(--accent-text, #8ab4f8)',
    border: '1px solid var(--accent-bar, #6b9fff)',
  },
  btnPrimary: {
    background: 'var(--accent, #1d4ed8)', border: '1px solid var(--accent, #1d4ed8)', borderRadius: 4,
    color: '#fff', cursor: 'pointer', fontSize: 12, padding: '4px 14px',
  },
  bioFull: { fontSize: 12, color: 'var(--text-secondary, #aaa)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginTop: 4 },
};
