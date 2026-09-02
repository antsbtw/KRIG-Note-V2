import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import type { SearchRecipe, TweetInboxRecord, TweetInboxStatus, FeedbackVerdict } from '@shared/types/x-timeline-types';
import { DEFAULT_TASK_ID, normalizeHandle } from '@shared/types/x-timeline-types';

interface XInboxViewProps {
  workspaceId: string;
}

const api = () => window.electronAPI?.xTimeline;

// ── 视图模型：三段数据流(爬回→Gemma判→人工确认)按复核状态切片 ──
// suggested/audit 靠 ai_verdict.reason 是否 human:* 区分「Gemma 原判」和「人工已表态」
type InboxViewKey = 'pending' | 'suggested' | 'audit' | 'confirmed' | 'all';

const VIEW_QUERY: Record<InboxViewKey, {
  status?: string; statuses?: string[]; humanReviewed?: boolean; orderBy?: string;
}> = {
  pending:   { status: 'pending' },                                            // 爬回来还没判的
  suggested: { status: 'worth', humanReviewed: false },                        // Gemma 建议值得,等表态
  audit:     { status: 'skip',  humanReviewed: false, orderBy: 'confidence' }, // Gemma 判不值,按置信度升序抽查漏判
  confirmed: { status: 'worth', humanReviewed: true },                         // 人工已 ✓
  all:       { statuses: ['pending', 'worth'] },
};

const VIEW_ITEMS: Array<{ view: InboxViewKey; label: string; icon: string }> = [
  { view: 'pending',   label: '待判',      icon: '⏳' },
  { view: 'suggested', label: 'Gemma建议', icon: '✦' },
  { view: 'audit',     label: '漏判抽查',  icon: '🔍' },
  { view: 'confirmed', label: '已确认',    icon: '✅' },
  { view: 'all',       label: '全部',      icon: '📋' },
];

// ── 统计类型（内联，与 electron-api.d.ts 一致） ──────────────────────
interface RecipeStats {
  recipeId: string;
  total: number;
  gemmaPass: number;
  adopted: number;
  rejected: number;
  adoptRate: number;
}

// ── 编辑弹窗默认空配方 ─────────────────────────────────────────────
function emptyRecipe(): Omit<SearchRecipe, 'id'> & { id?: string } {
  return {
    name: '',
    enabled: true,
    template: 'help-wanted',
    keywords: [],
    helpSignals: [],
    fromAccounts: [],
    minLikes: 0,
    minRetweets: 0,
    lang: undefined,
    sinceHours: 24,
    resultType: 'latest',
    intervalMinutes: 30,
  };
}

// ── 时间差展示（中文） ──────────────────────────────────────────────
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h前`;
  return `${Math.floor(h / 24)}d前`;
}

function timeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '已到期';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}分后`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h后`;
  return `${Math.floor(h / 24)}d后`;
}

// ══════════════════════════════════════════════════════════════════════
// 编辑弹窗
// ══════════════════════════════════════════════════════════════════════
interface RecipeEditModalProps {
  initial: (Omit<SearchRecipe, 'id'> & { id?: string }) | null;
  onSave: (recipe: Omit<SearchRecipe, 'id'> & { id?: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

function RecipeEditModal({ initial, onSave, onDelete, onCancel }: RecipeEditModalProps) {
  const [draft, setDraft] = useState<Omit<SearchRecipe, 'id'> & { id?: string }>(
    initial ?? emptyRecipe(),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newSignal, setNewSignal] = useState('');
  const [newAccount, setNewAccount] = useState('');

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const addTag = (field: 'keywords' | 'helpSignals' | 'fromAccounts', val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    setDraft((prev) => ({ ...prev, [field]: [...(prev[field] ?? []), trimmed] }));
  };
  const removeTag = (field: 'keywords' | 'helpSignals' | 'fromAccounts', idx: number) =>
    setDraft((prev) => ({ ...prev, [field]: (prev[field] ?? []).filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm(`确认删除配方「${draft.name}」？此操作不可撤销。`)) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };

  const tagStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    background: '#1e3a5f', color: '#7dd3fc', fontSize: 11,
    padding: '2px 8px', borderRadius: 10, cursor: 'default',
  };
  const inputRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap',
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)',
        width: 480, maxHeight: '90vh', overflowY: 'auto', padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-bright)' }}>
          {draft.id ? '编辑配方' : '新建配方'}
        </div>

        {/* 名称 */}
        <Field label="名称">
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="如：VPN求助-英文"
            style={inputStyle}
          />
        </Field>

        {/* 语言 */}
        <Field label="语言">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['', 'zh', 'en'] as const).map((l) => (
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
                <input
                  type="radio"
                  checked={(draft.lang ?? '') === l}
                  onChange={() => set('lang', l === '' ? undefined : l)}
                />
                {l === '' ? '不限' : l}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
              <input
                type="radio"
                checked={!!draft.lang && draft.lang !== 'zh' && draft.lang !== 'en'}
                onChange={() => set('lang', 'other')}
              />
              其他
              {!!draft.lang && draft.lang !== 'zh' && draft.lang !== 'en' && (
                <input
                  value={draft.lang}
                  onChange={(e) => set('lang', e.target.value)}
                  placeholder="如 ja"
                  style={{ ...inputStyle, width: 60, padding: '1px 5px' }}
                />
              )}
            </label>
          </div>
        </Field>

        {/* 关键词 */}
        <Field label="关键词">
          <div style={inputRow}>
            {(draft.keywords ?? []).map((kw, i) => (
              <span key={i} style={tagStyle}>
                {kw}
                <span onClick={() => removeTag('keywords', i)} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}>×</span>
              </span>
            ))}
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { addTag('keywords', newKeyword); setNewKeyword(''); e.preventDefault(); } }}
              placeholder="输入后回车添加"
              style={{ ...inputStyle, flex: 1, minWidth: 100 }}
            />
            <Btn sm onClick={() => { addTag('keywords', newKeyword); setNewKeyword(''); }}>+ 添加</Btn>
          </div>
        </Field>

        {/* 求助信号 */}
        <Field label="求助信号">
          <div style={inputRow}>
            {(draft.helpSignals ?? []).map((s, i) => (
              <span key={i} style={{ ...tagStyle, background: '#1a3a2a', color: '#86efac' }}>
                {s}
                <span onClick={() => removeTag('helpSignals', i)} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}>×</span>
              </span>
            ))}
            <input
              value={newSignal}
              onChange={(e) => setNewSignal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { addTag('helpSignals', newSignal); setNewSignal(''); e.preventDefault(); } }}
              placeholder="如 help / 求助"
              style={{ ...inputStyle, flex: 1, minWidth: 100 }}
            />
            <Btn sm onClick={() => { addTag('helpSignals', newSignal); setNewSignal(''); }}>+ 添加</Btn>
          </div>
        </Field>

        {/* 指定账号 */}
        <Field label="指定账号">
          <div style={inputRow}>
            {(draft.fromAccounts ?? []).map((a, i) => (
              <span key={i} style={{ ...tagStyle, background: '#2d1a4a', color: '#c4b5fd' }}>
                @{a}
                <span onClick={() => removeTag('fromAccounts', i)} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}>×</span>
              </span>
            ))}
            <input
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { addTag('fromAccounts', newAccount.replace('@', '')); setNewAccount(''); e.preventDefault(); } }}
              placeholder="@handle"
              style={{ ...inputStyle, flex: 1, minWidth: 100 }}
            />
            <Btn sm onClick={() => { addTag('fromAccounts', newAccount.replace('@', '')); setNewAccount(''); }}>+ 添加</Btn>
          </div>
        </Field>

        {/* 数字字段行 */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Field label="最少点赞" inline>
            <input type="number" min={0} value={draft.minLikes ?? 0}
              onChange={(e) => set('minLikes', Number(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
          </Field>
          <Field label="最少转发" inline>
            <input type="number" min={0} value={draft.minRetweets ?? 0}
              onChange={(e) => set('minRetweets', Number(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
          </Field>
          <Field label="时间范围" inline>
            <input type="number" min={1} value={draft.sinceHours ?? 24}
              onChange={(e) => set('sinceHours', Number(e.target.value))}
              style={{ ...inputStyle, width: 60 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>小时内</span>
          </Field>
          <Field label="采集频率" inline>
            每
            <input type="number" min={5} value={draft.intervalMinutes}
              onChange={(e) => set('intervalMinutes', Number(e.target.value))}
              style={{ ...inputStyle, width: 55, margin: '0 4px' }} />
            分钟
          </Field>
        </div>

        {/* 结果类型 */}
        <Field label="结果类型">
          <div style={{ display: 'flex', gap: 14 }}>
            {(['latest', 'top'] as const).map((rt) => (
              <label key={rt} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
                <input type="radio" checked={draft.resultType === rt} onChange={() => set('resultType', rt)} />
                {rt === 'latest' ? '最新' : '热门'}
              </label>
            ))}
          </div>
        </Field>

        {/* 启用 */}
        <Field label="启用">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            {draft.enabled ? '是' : '否'}
          </label>
        </Field>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          {draft.id && onDelete && (
            <Btn onClick={handleDelete} disabled={deleting} style={{ background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fca5a5' }}>
              {deleting ? '删除中...' : '删除'}
            </Btn>
          )}
          <Btn onClick={onCancel}>取消</Btn>
          <Btn primary onClick={handleSave} disabled={saving || !draft.name.trim()}>
            {saving ? '保存中...' : '保存'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 配方管理视图
// ══════════════════════════════════════════════════════════════════════
interface RecipeManagerViewProps {
  workspaceId: string;
  onBack: () => void;
  onRefreshRecipes: () => void;
}

function RecipeManagerView({ workspaceId, onBack, onRefreshRecipes }: RecipeManagerViewProps) {
  const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
  const [recipes, setRecipes] = useState<SearchRecipe[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, RecipeStats>>({});
  const [editTarget, setEditTarget] = useState<(Omit<SearchRecipe, 'id'> & { id?: string }) | null | 'new'>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const loadRecipes = useCallback(async () => {
    const r = await api()?.listRecipes();
    if (r?.success && r.recipes) {
      setRecipes(r.recipes);
      // 并行拉取所有配方统计
      const entries = await Promise.all(
        r.recipes.map(async (recipe) => {
          const sr = await api()?.getRecipeStats(recipe.id as string);
          return [recipe.id as string, sr?.stats ?? { recipeId: recipe.id as string, total: 0, gemmaPass: 0, adopted: 0, rejected: 0, adoptRate: 0 }] as const;
        }),
      );
      setStatsMap(Object.fromEntries(entries));
    }
  }, []);

  useEffect(() => { loadRecipes(); }, [loadRecipes]);

  const handleRunRecipe = async (recipe: SearchRecipe) => {
    const wcId = xApi.getXHostWcId(workspaceId);
    if (!wcId) {
      setStatusMsg('请先在 X 视图登录（无活跃 X webview）');
      return;
    }
    setRunningId(recipe.id as string);
    setStatusMsg(`运行配方「${recipe.name}」中...`);
    const r = await api()?.runRecipe(recipe.id as string, workspaceId, wcId);
    setStatusMsg(r?.success ? `完成：采集 ${r.saved ?? 0} 条` : `失败：${r?.error}`);
    setRunningId(null);
  };

  const handleSave = async (draft: Omit<SearchRecipe, 'id'> & { id?: string }) => {
    const r = await api()?.upsertRecipe(draft);
    if (!r?.success) throw new Error(r?.error ?? 'upsert failed');
    setEditTarget(null);
    await loadRecipes();
    onRefreshRecipes();
  };

  const handleDelete = async (recipeId: string) => {
    const r = await api()?.deleteRecipe(recipeId);
    if (!r?.success) throw new Error(r?.error ?? 'delete failed');
    setEditTarget(null);
    await loadRecipes();
    onRefreshRecipes();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, position: 'relative' }}>
      {/* 顶部栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8 }}>
        <Btn sm onClick={() => setEditTarget('new')}>+ 新建配方</Btn>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {statusMsg && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusMsg}</span>}
          <Btn sm onClick={onBack}>← 返回收件箱</Btn>
        </div>
      </div>

      {/* 配方列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg)' }}>
        {recipes.length === 0 && (
          <div style={{ color: 'var(--text-faint)', textAlign: 'center', marginTop: 40 }}>暂无配方，点击「+ 新建配方」创建</div>
        )}
        {recipes.map((recipe) => {
          const stats = statsMap[recipe.id as string];
          const lastRunMs = recipe.lastRunAt ? new Date(String(recipe.lastRunAt)).getTime() : NaN;
          const nextRunAt = Number.isFinite(lastRunMs)
            ? new Date(lastRunMs + recipe.intervalMinutes * 60_000).toISOString()
            : null;
          const isRunning = runningId === (recipe.id as string);

          return (
            <div key={recipe.id as string} style={{
              background: 'var(--bg-card)', borderRadius: 8, padding: '10px 14px',
              borderLeft: `3px solid ${recipe.enabled ? '#22c55e' : '#475569'}`,
            }}>
              {/* 名称行 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: recipe.enabled ? '#22c55e' : 'var(--text-disabled)' }}>
                  {recipe.enabled ? '●' : '○'}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-bright)', flex: 1 }}>{recipe.name}</span>
                <Btn sm onClick={() => handleRunRecipe(recipe)} disabled={isRunning}>
                  {isRunning ? '运行中...' : '▶ 立即运行'}
                </Btn>
                <Btn sm onClick={() => setEditTarget({ ...recipe, id: recipe.id as string })}>编辑</Btn>
              </div>

              {/* 关键词预览 */}
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 5, lineHeight: 1.4 }}>
                关键词: {(recipe.keywords ?? []).slice(0, 8).join(' · ')}
                {(recipe.keywords ?? []).length > 8 && ' ...'}
              </div>

              {/* 调度信息 */}
              <div style={{ fontSize: 11, color: 'var(--text-disabled)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span>每 {recipe.intervalMinutes} 分钟</span>
                {recipe.lastRunAt && <span>上次: {timeAgo(recipe.lastRunAt)}</span>}
                {nextRunAt && <span>下次: {timeFromNow(nextRunAt)}</span>}
                {!recipe.lastRunAt && <span style={{ color: 'var(--text-faint)' }}>尚未运行</span>}
              </div>

              {/* 统计行 */}
              {stats && (
                <div style={{ fontSize: 11, color: 'var(--text-disabled)', display: 'flex', gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--bg-card)', paddingTop: 6 }}>
                  <span>采集 <strong style={{ color: 'var(--text-muted)' }}>{stats.total}</strong> 条</span>
                  <span>Gemma通过 <strong style={{ color: '#7dd3fc' }}>{stats.gemmaPass}</strong></span>
                  <span>人工采纳 <strong style={{ color: '#86efac' }}>{stats.adopted}</strong></span>
                  <span>采纳率 <strong style={{ color: stats.adoptRate > 0 ? '#fbbf24' : 'var(--text-faint)' }}>{stats.adoptRate}%</strong></span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 编辑弹窗 */}
      {editTarget !== null && (
        <RecipeEditModal
          initial={editTarget === 'new' ? null : editTarget}
          onSave={handleSave}
          onDelete={editTarget !== 'new' && editTarget.id ? () => handleDelete(editTarget.id!) : undefined}
          onCancel={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 主视图
// ══════════════════════════════════════════════════════════════════════
export function XInboxView({ workspaceId }: XInboxViewProps) {
  const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
  const isInRightSlot = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right === 'x-inbox-view',
  );

  const handleClose = useCallback(() => {
    workspaceManager.getBus(workspaceId)?.slot.closeRight();
  }, [workspaceId]);

  const PAGE_SIZE = 20;

  const [view, setView] = useState<'inbox' | 'recipes' | 'blocked'>('inbox');
  const [recipes, setRecipes] = useState<SearchRecipe[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [filterRecipeId, setFilterRecipeId] = useState('');   // '' = 全部配方（切片用，独立于触发采集的 selectedRecipeId）
  const [filterTaskId, setFilterTaskId] = useState('');       // '' = 全部任务；阶段B唯一具体任务为 DEFAULT_TASK_ID
  const [currentView, setCurrentView] = useState<InboxViewKey>('suggested');
  const [fbStats, setFbStats] = useState<{ suggestedTotal: number; suggestedAccepted: number; rescuedFn: number } | null>(null);
  const [currentLang, setCurrentLang] = useState<'zh' | 'en' | 'all'>('all');
  const [tweets, setTweets] = useState<TweetInboxRecord[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const offsetRef = useRef(0);
  const [scanStatus, setScanStatus] = useState('');
  const [scanning, setScanning] = useState(false);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackVerdict>>({});
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRecipes = useCallback(async () => {
    const r = await api()?.listRecipes();
    if (r?.success && r.recipes?.length) {
      setRecipes(r.recipes);
      setSelectedRecipeId((prev) => prev || (r.recipes[0].id as string));
    }
  }, []);

  useEffect(() => { loadRecipes(); }, [loadRecipes]);

  const loadPage = useCallback(async (targetPage: number) => {
    const xApiT = api();
    if (!xApiT) return;
    setLoading(true);
    try {
      const langFilter = currentLang === 'all' ? undefined : currentLang;
      const recipeFilter = filterRecipeId || undefined;
      const taskFilter = filterTaskId || undefined;
      const offset = targetPage * PAGE_SIZE;
      const r = await xApiT.queryInbox({
        ...VIEW_QUERY[currentView],
        lang: langFilter,
        searchRecipe: recipeFilter,
        taskId: taskFilter,
        limit: PAGE_SIZE,
        offset,
      });
      if (r?.records) {
        setTweets([...r.records as TweetInboxRecord[]]);
        setPage(targetPage);
        offsetRef.current = offset;
        setExpandedIds(new Set());
        setFeedbackMap({});
      }
      const countViews: InboxViewKey[] = ['pending', 'suggested', 'audit', 'confirmed'];
      const newCounts: Record<string, number> = {};
      await Promise.all(countViews.map(async (v) => {
        const cr = await xApiT.queryInbox({ ...VIEW_QUERY[v], lang: langFilter, searchRecipe: recipeFilter, taskId: taskFilter, limit: 5000, offset: 0 });
        newCounts[v] = cr?.records?.length ?? 0;
      }));
      setCounts(newCounts);
      setTotalCount(
        currentView === 'all'
          ? (newCounts['pending'] ?? 0) + (newCounts['suggested'] ?? 0) + (newCounts['confirmed'] ?? 0)
          : (newCounts[currentView] ?? 0),
      );
    } finally {
      setLoading(false);
    }
  }, [currentView, currentLang, filterRecipeId, filterTaskId]);

  const loadStats = useCallback(async () => {
    const r = await api()?.feedbackStats();
    if (r?.success && r.stats) setFbStats(r.stats);
  }, []);

  useEffect(() => {
    loadPage(0);
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, currentLang, filterRecipeId, filterTaskId, workspaceId]);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('http://localhost:11434/api/tags');
        setOllamaOk(r.ok);
      } catch {
        setOllamaOk(false);
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  const startScan = async () => {
    if (!selectedRecipeId) return;
    const tApi = api();
    if (!tApi) return;
    const wcId = xApi.getXHostWcId(workspaceId);
    if (!wcId) {
      setScanStatus('请先在 X 视图登录（无活跃 X webview）');
      return;
    }
    setScanning(true);
    setScanStatus('扫描中...');
    const r = await tApi.runRecipe(selectedRecipeId, workspaceId, wcId);
    setScanStatus(r?.success ? `完成：采集 ${r.saved ?? 0} 条` : `失败：${r?.error}`);
    setScanning(false);
    loadPage(0);
  };

  const stopScan = async () => {
    await api()?.pauseScan(workspaceId);
    setScanStatus('已暂停');
    setScanning(false);
  };

  const triggerJudge = async () => {
    const tApi = api();
    if (!tApi) return;
    setScanStatus('AI 判断中（一批约3分钟,模型冷启动更久）...');
    const r = await tApi.judgeNow(workspaceId);
    if (!r?.success) {
      setScanStatus(`判断失败：${r?.error}`);
    } else if (r.draining) {
      setScanStatus(`首批判 ${r.judged} 条(worth ${r.worth}),剩 ${r.remaining} 条后台继续,点「刷新」看进度`);
    } else {
      setScanStatus(r.judged ? `判断完成:${r.judged} 条(worth ${r.worth})` : '无待判推文');
    }
    loadPage(0);
  };

  const sendToReply = async (tweet: TweetInboxRecord) => {
    // 同 894 行:库值自带 @,须归一化后再由模板补,否则弹窗显示 @@xxx
    const msg = `即将在 X 中打开 @${normalizeHandle(tweet.author_handle ?? '')} 的推文准备回复。\n\n${tweet.text?.slice(0, 120)}`;
    if (window.confirm(msg)) {
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await api()?.replyToTweet(tweet.tweet_url ?? '', tweet.tweet_id, workspaceId, wcId);
      if (!r?.success) alert(`导航失败：${r?.error}`);
    }
  };

  const viewTweet = async (tweet: TweetInboxRecord) => {
    if (!tweet.tweet_url) return;
    const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
    const r = await api()?.replyToTweet(tweet.tweet_url, tweet.tweet_id, workspaceId, wcId);
    if (r?.success) {
      setViewingId(tweet.tweet_id);
      setTimeout(() => setViewingId((prev) => prev === tweet.tweet_id ? null : prev), 2500);
    } else {
      setScanStatus(`导航失败：${r?.error}`);
    }
  };

  const submitFeedback = async (tweet: TweetInboxRecord, verdict: FeedbackVerdict) => {
    setFeedbackMap((prev) => ({ ...prev, [tweet.tweet_id]: verdict }));
    // suggested/audit 视图:表态后推文即离开本视图(去了 confirmed 或确认 skip),两种表态都移卡;
    // 其余视图保持旧行为:✗ 移卡,✓ 留卡变绿
    const removeCard = verdict === 'reject' || currentView === 'suggested' || currentView === 'audit';
    if (removeCard) {
      setTweets((prev) => prev.filter((t) => t.tweet_id !== tweet.tweet_id));
      setTotalCount((c) => Math.max(0, c - 1));
    }
    const r = await api()?.submitFeedback({
      tweet_id:      tweet.tweet_id,
      text:          tweet.text,
      lang:          tweet.lang,
      author_handle: tweet.author_handle,
      verdict,
      source_recipe: tweet.search_recipe,
    });
    if (!r?.success) {
      setFeedbackMap((prev) => {
        const next = { ...prev };
        delete next[tweet.tweet_id];
        return next;
      });
      if (removeCard) {
        setTweets((prev) => [...prev, tweet]);
        setTotalCount((c) => c + 1);
      }
      setScanStatus(`反馈写入失败：${r?.error}`);
      return;
    }
    loadStats();  // ✓✗ 会改变近7天采纳率/捞回数,刷新侧栏仪表
  };

  const handleMarkReplied = async (tweet: TweetInboxRecord) => {
    setTweets((prev) => prev.filter((t) => t.tweet_id !== tweet.tweet_id));
    setTotalCount((c) => Math.max(0, c - 1));
    const r = await api()?.markReplied(tweet.tweet_id);
    if (!r?.success) {
      setTweets((prev) => [...prev, tweet]);
      setTotalCount((c) => c + 1);
      setScanStatus(`标记已回复失败：${r?.error}`);
    }
  };

  /**
   * 屏蔽此人 —— 只约束未来采集,已抓的历史推文一律保留(方案 §3.3)。
   * 确认文案必须把这层语义说清楚,否则用户会以为点了就清空他的所有推文。
   */
  const handleBlockAuthor = async (tweet: TweetInboxRecord) => {
    const handle = tweet.author_handle ?? '';
    if (!handle) return;
    const shown = normalizeHandle(handle);  // 复用共享函数,不自己写一份去 @ 逻辑
    const ok = window.confirm(
      `屏蔽 @${shown}?\n\n`
      + `· 以后的采集不再收录他的推文\n`
      + `· 已经抓到的历史推文**保留不动**\n\n`
      + `可在「🚫 屏蔽名单」里随时解除。`,
    );
    if (!ok) return;

    const r = await api()?.blockAuthor(handle);
    if (!r?.success) {
      setScanStatus(`屏蔽失败:${r?.error}`);
      return;
    }
    setScanStatus(`已屏蔽 @${shown}(历史推文保留)`);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── 屏蔽名单视图 ──────────────────────────────────────────────────
  if (view === 'blocked') {
    return <BlockedManagerView workspaceId={workspaceId} onBack={() => setView('inbox')} />;
  }

  // ── 配方管理视图 ──────────────────────────────────────────────────
  if (view === 'recipes') {
    return (
      <RecipeManagerView
        workspaceId={workspaceId}
        onBack={() => setView('inbox')}
        onRefreshRecipes={loadRecipes}
      />
    );
  }

  const cardBorderColor = (status: string) => {
    if (status === 'worth') return '#22c55e';
    if (status === 'pending') return '#f59e0b';
    if (status === 'ai_judging') return '#8b5cf6';
    return 'var(--border)';
  };

  // 漏判抽查视图里 skip 卡片是工作对象,不降透明度
  const cardOpacity = (status: string) =>
    currentView !== 'audit' && (status === 'skip' || status === 'filtered_out') ? 0.5 : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* 顶部栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>📥 X Inbox</span>
        <span style={{ background: 'var(--border)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{workspaceId}</span>
        <div style={{ flex: 1, height: '100%', WebkitAppRegion: 'drag' as never }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={() => loadPage(page)} disabled={loading}>{loading ? '加载中...' : '刷新'}</Btn>
          <Btn primary onClick={triggerJudge}>AI 判断</Btn>
          <Btn onClick={() => setView('recipes')}>⚙ 配方</Btn>
          <Btn onClick={() => setView('blocked')}>🚫 屏蔽名单</Btn>
          {isInRightSlot && (
            <button onClick={handleClose} style={closeBtn}>✕</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧栏 */}
        <div style={{ width: 160, minWidth: 160, background: 'var(--bg-card)', borderRight: '1px solid var(--border)', padding: 10, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {/* 语言过滤 */}
          <div>
            <div style={sectionTitle}>语言</div>
            {([['all', '全部', '🌐'], ['zh', '中文', '🇨🇳'], ['en', 'English', '🇺🇸']] as const).map(([lang, label, icon]) => (
              <div
                key={lang}
                onClick={() => setCurrentLang(lang)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px',
                  borderRadius: 5, cursor: 'pointer', marginBottom: 2,
                  background: currentLang === lang ? '#0f4c75' : 'transparent',
                  color: currentLang === lang ? '#7dd3fc' : 'var(--text-muted)',
                }}
              >
                <span>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* 视图切分:待判 → Gemma建议 → 漏判抽查 → 已确认 */}
          <div>
            <div style={sectionTitle}>视图</div>
            {VIEW_ITEMS.map(({ view: v, label, icon }) => (
              <div
                key={v}
                onClick={() => setCurrentView(v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px',
                  borderRadius: 5, cursor: 'pointer', marginBottom: 2,
                  background: currentView === v ? 'var(--accent)' : 'transparent',
                  color: currentView === v ? '#fff' : 'var(--text-muted)',
                }}
              >
                <span>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, background: currentView === v ? 'rgba(255,255,255,0.2)' : 'var(--border)', padding: '1px 5px', borderRadius: 8 }}>
                  {v === 'all'
                    ? (counts['pending'] ?? 0) + (counts['suggested'] ?? 0) + (counts['confirmed'] ?? 0)
                    : (counts[v] ?? '-')}
                </span>
              </div>
            ))}
          </div>

          {/* 配方切片 */}
          <div>
            <div style={sectionTitle}>配方</div>
            <select
              value={filterRecipeId}
              onChange={(e) => setFilterRecipeId(e.target.value)}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', borderRadius: 5, fontSize: 11 }}
            >
              <option value="">🌐 全部</option>
              {recipes.map((r) => <option key={String(r.id)} value={String(r.id)}>{r.name}</option>)}
            </select>
          </div>

          {/* 任务切片（阶段B占位维度，唯一具体任务 = judge-value）*/}
          <div>
            <div style={sectionTitle}>任务</div>
            <select
              value={filterTaskId}
              onChange={(e) => setFilterTaskId(e.target.value)}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', borderRadius: 5, fontSize: 11 }}
            >
              <option value="">🌐 全部</option>
              <option value={DEFAULT_TASK_ID}>判断价值</option>
            </select>
          </div>

          {/* 触发采集 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionTitle}>触发采集</div>
            <select
              value={selectedRecipeId}
              onChange={(e) => setSelectedRecipeId(e.target.value)}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', borderRadius: 5, fontSize: 11 }}
            >
              {recipes.length === 0
                ? <option value="">加载中...</option>
                : recipes.map((r) => <option key={String(r.id)} value={String(r.id)}>{r.name}</option>)
              }
            </select>
            <div style={{ display: 'flex', gap: 5 }}>
              <Btn primary onClick={startScan} disabled={scanning} style={{ flex: 1 }}>
                {scanning ? '扫描中' : '开始扫描'}
              </Btn>
              <Btn onClick={stopScan}>停</Btn>
            </div>
            {scanStatus && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{scanStatus}</div>}
          </div>

          {/* Gemma 观察仪表(近7天,靠 ai_verdict 快照;1.8.7 之前的旧标注不计入) */}
          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={sectionTitle}>近7天 Gemma 观察</div>
            {fbStats && fbStats.suggestedTotal > 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                建议采纳率 <span style={{ color: '#22c55e', fontWeight: 600 }}>
                  {fbStats.suggestedAccepted}/{fbStats.suggestedTotal}
                  （{Math.round(fbStats.suggestedAccepted / fbStats.suggestedTotal * 100)}%）
                </span>
                <br />
                捞回漏判 <span style={{ color: fbStats.rescuedFn > 0 ? '#f59e0b' : 'var(--text-disabled)', fontWeight: 600 }}>{fbStats.rescuedFn} 条</span>
              </div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--text-disabled)', lineHeight: 1.5 }}>暂无数据（对新判断的推文 ✓✗ 后开始累计）</div>
            )}
          </div>

          {/* Ollama 状态 */}
          <div style={{ paddingTop: 8, fontSize: 11, color: 'var(--text-disabled)' }}>
            Ollama: <span style={{ fontWeight: 500, color: ollamaOk === true ? '#22c55e' : ollamaOk === false ? '#ef4444' : 'var(--text-muted)' }}>
              {ollamaOk === true ? '✅ 就绪' : ollamaOk === false ? '❌ 不可用' : '检测中...'}
            </span>
          </div>
        </div>

        {/* 右侧推文列表 + 分页 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)' }}>
            {tweets.length === 0 && (
              <div style={{ color: 'var(--text-faint)', textAlign: 'center', marginTop: 40 }}>暂无推文</div>
            )}
            {tweets.map((t) => {
              const expanded = expandedIds.has(t.tweet_id);
              const tags = t.ai_verdict?.tags ?? [];
              const reason = t.ai_verdict?.reason ?? '';
              return (
                <div key={t.tweet_id} style={{
                  background: 'var(--bg-card)', borderRadius: 8, padding: 10,
                  borderLeft: `3px solid ${cardBorderColor(t.status)}`,
                  opacity: cardOpacity(t.status),
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: 12 }}>{t.author_name}</span>
                    {/* ⚠️ 库里 author_handle 自带 @('@angeelfv'),模板再加一个会渲染成 @@angeelfv。
                        统一过 normalizeHandle 后由模板补 @ —— 与屏蔽名单页显示形态一致。
                        只改显示:库值形态是历史既成事实,改它会牵动去重/统计,不在此处动。 */}
                    <span style={{ color: 'var(--text-disabled)', fontSize: 11 }}>@{normalizeHandle(t.author_handle ?? '')}</span>
                    {(() => {
                      // 状态徽章:一眼看出这条推文处在三段流的哪一段
                      const isHuman = reason.startsWith('human:');
                      const [label, color] =
                        isHuman && reason === 'human:accept' ? ['✓ 已采纳', '#22c55e'] :
                        isHuman                              ? ['✗ 已拒绝', '#ef4444'] :
                        t.ai_verdict && t.ai_verdict.worth   ? ['✦ Gemma:建议采纳', '#a78bfa'] :
                        t.ai_verdict                         ? ['✦ Gemma:建议跳过', '#f59e0b'] :
                        ['⏳ 未判', 'var(--text-disabled)'];
                      return (
                        <span style={{ fontSize: 10, color, border: `1px solid ${color}`, padding: '0px 5px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                          {label}
                        </span>
                      );
                    })()}
                    <span style={{ marginLeft: 'auto', color: 'var(--text-disabled)', fontSize: 11 }}>
                      {t.fetched_at ? timeAgo(t.fetched_at) : ''} · ❤ {t.metrics?.likes ?? 0}
                    </span>
                  </div>
                  <div style={{
                    color: 'var(--text)', lineHeight: 1.5, fontSize: 12,
                    overflow: expanded ? 'visible' : 'hidden',
                    display: expanded ? 'block' : '-webkit-box',
                    WebkitLineClamp: expanded ? undefined : 3,
                    WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {t.text}
                  </div>
                  {t.text && t.text.length > 160 && (
                    <div onClick={() => toggleExpand(t.tweet_id)} style={{ color: '#3b82f6', fontSize: 11, cursor: 'pointer', marginTop: 2 }}>
                      {expanded ? '收起' : '展开'}
                    </div>
                  )}
                  {tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                      {tags.map((tag: string) => (
                        <span key={tag} style={{ background: 'var(--accent)', color: '#bfdbfe', fontSize: 10, padding: '1px 6px', borderRadius: 10 }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  {t.translation && (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 11, marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                      🌐 {t.translation}
                    </div>
                  )}
                  {reason && (reason.startsWith('human:') ? (
                    <div style={{ color: 'var(--text-disabled)', fontSize: 11, marginTop: 3 }}>
                      ✋ 已人工{reason === 'human:accept' ? '采纳' : '拒绝'}
                    </div>
                  ) : (
                    <div style={{ color: '#a78bfa', fontStyle: 'italic', fontSize: 11, marginTop: 3 }}>
                      ✦ Gemma：{reason}
                      {typeof t.ai_verdict?.confidence === 'number' && (
                        <span style={{ color: 'var(--text-disabled)', marginLeft: 5 }}>置信 {Math.round(t.ai_verdict.confidence * 100)}%</span>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                    {t.tweet_url && (
                      <Btn sm onClick={() => viewTweet(t)}>
                        {viewingId === t.tweet_id ? '↗ 已在 X 中打开' : '查看原推'}
                      </Btn>
                    )}
                    {t.tweet_url && <Btn sm primary onClick={() => sendToReply(t)}>送入回复</Btn>}
                    {(() => {
                      // 本次会话点过的优先(乐观更新不被覆盖),否则回落到库里的真实状态。
                      // feedbackMap 是会话内 state,翻页/重启即清空 —— 只靠它会让
                      // 库里 accepted=true 的历史条目渲染成"没点过",看不出以前采纳过。
                      const fb = feedbackMap[t.tweet_id]
                        ?? (t.accepted === true ? 'accept' as const : undefined);
                      const isAudit = currentView === 'audit';
                      return (
                        <>
                          <Btn sm primary={fb === 'accept'} onClick={() => submitFeedback(t, 'accept')}
                            style={fb === 'accept' ? { background: '#16a34a', borderColor: '#16a34a' } : {}}>
                            {fb === 'accept' ? '✓ 已采纳' : isAudit ? '✓ 捞回' : '✓ 采纳'}
                          </Btn>
                          <Btn sm onClick={() => submitFeedback(t, 'reject')}
                            style={fb === 'reject' ? { background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fca5a5' } : {}}>
                            {fb === 'reject' ? '✗ 已拒绝' : isAudit ? '✗ 确实不值' : '✗ 不采纳'}
                          </Btn>
                          {/* 已回复:优先按库里的客观事实显示(采集自 X 的权威回复字段);
                              t.replied 为真 = 确实回复过(手机/网页上回的都算),按钮变绿不可再点。
                              否则保留手动标记入口。 */}
                          {t.replied === true ? (
                            <Btn sm style={{ background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}>
                              ↩ 已回复
                            </Btn>
                          ) : currentView === 'confirmed' ? (
                            <Btn sm onClick={() => handleMarkReplied(t)}>↩ 已回复</Btn>
                          ) : null}
                          {t.author_handle && (
                            <Btn sm onClick={() => handleBlockAuthor(t)}
                              style={{ marginLeft: 'auto', color: '#fca5a5' }}>
                              🚫 屏蔽此人
                            </Btn>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          {totalCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--bg-card)', flexShrink: 0 }}>
              <Btn sm onClick={() => loadPage(page - 1)} disabled={page === 0}>‹ 上一页</Btn>
              <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>
                第 {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)} 页
                <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>({totalCount} 条)</span>
              </span>
              <Btn sm onClick={() => loadPage(page + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount}>下一页 ›</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 小组件 ──────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '4px 8px', borderRadius: 5, fontSize: 12, outline: 'none',
};

interface FieldProps {
  label: string;
  inline?: boolean;
  children: React.ReactNode;
}
function Field({ label, inline, children }: FieldProps) {
  return (
    <div style={{ display: inline ? 'flex' : 'block', alignItems: inline ? 'center' : undefined, gap: inline ? 6 : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontWeight: 600, marginBottom: inline ? 0 : 4, whiteSpace: 'nowrap' }}>{label}</div>
      {children}
    </div>
  );
}

// ── 屏蔽名单管理视图 ────────────────────────────────────────────────
// 语义提醒:屏蔽只约束未来采集,不抹除历史数据(方案 §3.3 已拍板)。
// 名单里的 handle 是**归一化形态**(无 @、全小写),展示时补回 @。
interface BlockedAuthorItem {
  handle: string;
  displayName?: string;
  blockedAt?: string;
  blockedReason?: string;
}

function BlockedManagerView({ workspaceId, onBack }: { workspaceId: string; onBack: () => void }) {
  const [authors, setAuthors] = useState<BlockedAuthorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [selfHandle, setSelfHandle] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [spikeOut, setSpikeOut] = useState<string>('');
  const [spikeHandle, setSpikeHandle] = useState<string>('');
  const [spiking, setSpiking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api()?.listBlocked();
    if (!r?.success) {
      // fail loud:查不到 ≠ 名单为空,必须让用户看见
      setStatusMsg(`加载失败:${r?.error ?? 'no api'}`);
      setAuthors([]);
    } else {
      setStatusMsg('');
      setAuthors(r.authors ?? []);
    }
    setLoading(false);
  }, []);

  const loadSelf = useCallback(async () => {
    const r = await api()?.getSelf();
    setSelfHandle(r?.handle ?? null);
  }, []);

  useEffect(() => { load(); loadSelf(); }, [load, loadSelf]);

  /**
   * 识别当前登录账号 —— 探测不到就如实报错,不写猜测值。
   * X 的 DOM 会变,失败时把 tried 明细显示出来,便于定位是哪条策略失效。
   */
  const handleDetectSelf = async () => {
    setDetecting(true);
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await api()?.detectSelf(wcId);
      if (!r?.success) {
        setStatusMsg(`识别失败:${r?.error ?? '未知'}(请确认 X 已登录并在前台)`);
        return;
      }
      setStatusMsg(`已识别:@${r.handle}(via ${r.via})`);
      await loadSelf();
    } finally {
      setDetecting(false);
    }
  };

  const handleUnblock = async (handle: string) => {
    const r = await api()?.unblockAuthor(handle);
    if (!r?.success) {
      setStatusMsg(`解除失败:${r?.error}`);
      return;
    }
    setStatusMsg(`已解除 @${handle}`);
    await load();
  };

  /**
   * 「取某账号全部发言」实机诊断 —— 画像基础方法的可行性验证。
   * 走个人主页 /with_replies(回复与被回复的原推上下相邻,关系是页面结构自带的),
   * 不试搜索语法。⚠️ 只读:不落库不改状态,占用前台 X webview 约 15 秒。
   */
  const handleSpike = async () => {
    // ⚠️ 不能用 window.prompt —— Electron renderer 不支持(报
    // "prompt() is not supported"),全仓也没有第二处在用。改用行内输入框。
    const handle = spikeHandle.trim() || selfHandle;
    if (!handle) { setSpikeOut('请先填 handle,或先「识别我的账号」'); return; }

    setSpiking(true);
    setSpikeOut(`诊断 @${normalizeHandle(handle)} 中(约 15 秒,期间请勿操作 X)...`);
    try {
    const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
    const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
    const r = await api()?.watchlistSpike(handle, wcId);
    if (!r?.success || !r.result) {
      setSpikeOut(`诊断失败:${r?.error ?? '未知'}`);
      return;
    }
    const x = r.result;
    const rounds = x.rounds.map((rd) =>
      `  轮${rd.round}: DOM ${rd.domCount} | 累计 ${rd.cumulative} (+${rd.newIds}) | 最旧 ${rd.spanDays ?? '?'} 天前`,
    ).join('\n');
    const adj = x.adjacency;
    setSpikeOut(
      `@${x.handle}  ${x.url}\n`
      + `\n① 配对结构(本人回复的前一条是谁的)\n`
      + `  检出本人回复 ${adj.checked} 条 → 前一条是他人 ${adj.precededByOther} / `
      + `是本人 ${adj.precededBySelf} / 在顶部 ${adj.atTop}\n`
      + `  ${adj.checked > 0 && adj.precededByOther === adj.checked - adj.atTop
            ? '✓ 相邻配对成立(可据此还原 in_reply_to)'
            : adj.checked === 0 ? '· 没检出回复 —— 换个有回复的账号再试'
            : '⚠ 配对不稳定,需另寻办法'}\n`
      + `\n② 时间覆盖(决定「回溯窗口」变量的可行上限)\n${rounds}\n`
      + `  停止原因:${x.stopReason}\n`
      + `\n③ 判据对照\n`
      + `  累计 ${x.totalItems} 条 | 本人 ${x.selfItems} | A「Replying to」${x.replyItems} | `
      + `B 连接线 ${x.threadLineItems} | socialContext ${x.socialItems}\n`
      + `  ${x.selfItems > 0 && x.threadLineItems < x.selfItems
            ? `⚠ 本人 ${x.selfItems} 条,连接线只判出 ${x.threadLineItems} 条 —— `
              + `漏 ${x.selfItems - x.threadLineItems} 条。/with_replies 上本人每条都是回复,`
              + `连接线是有损代理,不能拿来筛候选`
            : '→ 连接线与本人条数一致'}\n`
      + `\n④ X 自己声明的关系载体(原样 dump,不做解读)\n`
      + x.samples.filter((sp) => sp.isSelf).slice(0, 4).map((sp) => {
          const rs = sp.relSignals ?? {};
          const links = (rs.statusLinks ?? []).join(' , ') || '(无)';
          const attrs = JSON.stringify(rs.articleAttrs ?? {});
          const anc = JSON.stringify(rs.ancestorAttrs ?? []);
          return `  ── ${sp.tweetId ?? 'no-id'} ${sp.text.slice(0, 20)}\n`
            + `     status链接: ${links}\n`
            + `     article属性: ${attrs.slice(0, 160)}\n`
            + `     祖先属性: ${anc.slice(0, 200)}`;
        }).join('\n')
      + `\n\n⑤ 回复关系(开详情页解 —— 这才是「回复了谁」的真源)\n`
      + (x.relationProbe.length === 0
          ? '  没有候选(需先有本人带连接线的推)'
          : x.relationProbe.map((rp) =>
              `  ${rp.tweetId} → 回复给 ${rp.replyingTo ?? '✗'} | 父推 ${rp.parentId ?? '✗'}`,
            ).join('\n')),
    );
    } finally {
      setSpiking(false);
    }
  };

  /**
   * 采集回复关系 —— 主线第一环:「我回复了谁的哪条推」。
   * 拦截 GraphQL 取权威字段(in_reply_to_*),不从 DOM 猜。
   * 回填 replied 用的是客观事实,手机/网页上回的一律算数。
   */
  const handleCollectReplies = async () => {
    const handle = spikeHandle.trim() || selfHandle;
    if (!handle) { setSpikeOut('请先填 handle,或先「识别我的账号」'); return; }
    setSpiking(true);
    setSpikeOut(`采集 @${normalizeHandle(handle)} 的回复中(自然滚动,期间请勿操作 X)...`);
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      // 不传 mode:有游标就续传、没有就从头,由 main 侧决定 —— 用户不必知道
      // 不设目标天数:抓到滚不动为止(用户 2026-09-02 定的判据)
      const r = await api()?.collectReplies(handle, wcId);
      if (!r?.success || !r.result) {
        setSpikeOut(`采集失败:${r?.error ?? '未知'}`);
        return;
      }
      const x = r.result;
      const b = x.backfill;
      setSpikeOut(
        `回复关系采集完成 —— @${normalizeHandle(handle)}\n`
        + `\n滚了 ${x.rounds} 轮,捕获 ${x.payloads} 个响应\n`
        + `本次最旧抓到 ${x.oldestDays ?? '?'} 天前\n`
        + `停因:${x.stopReason}\n`
        + `解出回复关系 ${x.relations} 条,其中我自己发的 ${x.ownReplies} 条\n`
        + `\n【落库】\n`
        + `  自己的回复入库:${x.ownSaved.inserted} 条(已存在 ${x.ownSaved.skipped} 条)\n`
        + `  补上关系:${x.savedOnReplies} 条\n`
        + `  标记「已回复」:${b.markedReplied} 条\n`
        + `  其中是已采纳线索:${b.amongAccepted} 条  ← 主线产出\n`
        + `  父推不在库里:${b.parentNotInDb} 条(回复过但没采集过的)\n`
        + (r.stats
            ? `\n【累计】已采纳 ${r.stats.totalAccepted} 条,其中回复过 ${r.stats.repliedAccepted} 条\n`
            : '')
        + (r.coverage && r.baseline?.tweetCount
            ? `\n【采集完整度】库存 ${r.coverage.count} / 基线 ${r.baseline.tweetCount} 条`
              + ` = ${Math.round(r.coverage.count * 1000 / r.baseline.tweetCount) / 10}%\n`
              + `  原创 ${r.coverage.posts} + 回复 ${r.coverage.replies}(AI 学说话方式两者都要)\n`
              + `  最旧 ${(r.coverage.oldest ?? '').slice(0, 10)} —— 有游标续传,多跑几次会一次比一次深\n`
            : r.coverage
            ? `\n【库存回复】${r.coverage.count} 条,覆盖最近 ${r.coverage.spanDays ?? '?'} 天\n`
            : '')
        + (x.dumpPath ? `\n📦 明细:${x.dumpPath}` : '')
        + `\n\n(返回收件箱后刷新即可看到「已回复」状态)`,
      );
    } finally {
      setSpiking(false);
    }
  };

  /**
   * 滚动验证 —— 底座函数 harvestTimeline 的验收入口。
   * 用户 2026-09-02:「先做好网页自动滚动…包含校验方法。这个函数过关再考虑其他的问题。」
   * 只读不落库:先证明能把一页推文抓全,再谈接业务。
   */
  const handleHarvest = async () => {
    const h = spikeHandle.trim() || selfHandle;
    if (!h) { setSpikeOut('请先填 handle,或先「识别我的账号」'); return; }
    const url = `https://x.com/${normalizeHandle(h)}/with_replies`;
    setSpiking(true);
    setSpikeOut(`滚动采集 ${url}\n(滚到底为止,可能数分钟,期间请勿操作 X)...`);
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await api()?.harvest(url, wcId);
      if (!r?.success || !r.report) { setSpikeOut(`失败:${r?.error ?? '未知'}`); return; }
      const x = r.report;
      const tr = x.trace.map((t) =>
        `  轮${String(t.round).padStart(3)} y=${String(t.scrollY).padStart(6)} `
        + `article=${String(t.domArticles).padStart(3)} 累计=${String(t.cumulative).padStart(4)} `
        + `新增=${t.newThisRound} 卡=${t.stuck}`).join('\n');
      setSpikeOut(
        `${x.ok ? '✅ 校验通过' : '❌ 校验未通过'} — ${x.url}\n`
        + (x.problems.length ? `\n【问题】\n${x.problems.map((p) => `  ⚠ ${p}`).join('\n')}\n` : '')
        + `\n抓到 ${x.tweets} 条 | ${x.rounds} 轮 | ${x.payloads} 个响应\n`
        + `停因:${x.stopReason}\n`
        + `\n【日期覆盖】${x.dateSpan.oldest ?? '?'} ~ ${x.dateSpan.newest ?? '?'}`
        + ` 共 ${x.dateSpan.days} 天\n`
        + (x.dateSpan.gaps.length
            ? `  空洞:${x.dateSpan.gaps.join(' / ')}\n` : '  无空洞 ✓\n')
        + `\n【滚动轨迹(首尾各5轮)】\n${tr}`,
      );
    } finally {
      setSpiking(false);
    }
  };

  /**
   * 载荷勘查 —— 直接量 X GraphQL 原始响应,搞清底层到底供给哪些元数据。
   * 这是「能做到哪一步」的真实依据,不靠 DOM 推断、不靠我猜。
   */
  const handleSurvey = async () => {
    setSpiking(true);
    setSpikeOut('勘查中(约 30 秒,会依次走通知页/主页,期间请勿操作 X)...');
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      const wcId = xApi.getXHostWcId(workspaceId) ?? undefined;
      const r = await api()?.payloadSurvey(wcId, 30);
      if (!r?.success || !r.result) {
        setSpikeOut(`勘查失败:${r?.error ?? '未知'}`);
        return;
      }
      const x = r.result;
      const ops = x.operations.slice(0, 12)
        .map((o) => `  ${o.name} ×${o.count} (${Math.round(o.bytes / 1024)}KB)`).join('\n');
      const rel = x.relationFields.slice(0, 60)
        .map((f) => `  ${f.path}  ×${f.count}  = ${f.sample}`).join('\n');
      setSpikeOut(
        `X 原始载荷勘查 —— 捕获 ${x.totalPayloads} 个响应,${x.fields.length} 个字段\n`
        + `${x.note}\n`
        + `\n📄 完整报告(UI 只显示摘要,全量在文件里):\n  ${x.reportPath}\n`
        + `📦 原始响应(供日后重新分析,不必再跑):\n  ${x.rawPath}\n`
        + `\n【捕获的接口(按来源页)】\n${ops || '  (无)'}\n`
        + `\n【关系类字段 —— 能做什么的真实依据】\n${rel || '  (无)'}\n`
        + `\n【全部字段共 ${x.fields.length} 个,此处前 80,余见报告文件】\n`
        + x.fields.slice(0, 80).map((f) => `  ${f.path} ×${f.count}`).join('\n'),
      );
    } finally {
      setSpiking(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 8 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>🚫 屏蔽名单</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>不再采集其新推,已抓历史保留</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {statusMsg && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusMsg}</span>}
          <Btn sm onClick={handleDetectSelf} disabled={detecting}>
            {detecting ? '识别中...' : '识别我的账号'}
          </Btn>
          <input
            value={spikeHandle}
            onChange={(e) => setSpikeHandle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !spiking) handleSpike(); }}
            placeholder={selfHandle ? `@${selfHandle}` : 'handle'}
            style={{
              width: 120, fontSize: 11, padding: '2px 6px', borderRadius: 5,
              border: '1px solid var(--text-faint)', background: 'var(--bg)', color: 'var(--text)',
            }}
          />
          <Btn sm onClick={handleSpike} disabled={spiking}>
            {spiking ? '诊断中...' : 'B′ 诊断'}
          </Btn>
          <Btn sm onClick={handleSurvey} disabled={spiking}>
            {spiking ? '勘查中...' : '载荷勘查'}
          </Btn>
          <Btn sm primary onClick={() => handleCollectReplies()} disabled={spiking}>
            {spiking ? '采集中...' : '采集回复'}
          </Btn>
          <Btn sm onClick={handleHarvest} disabled={spiking}>
            {spiking ? '采集中...' : '滚动验证'}
          </Btn>
          <Btn sm onClick={load} disabled={loading}>{loading ? '加载中...' : '刷新'}</Btn>
          <Btn sm onClick={onBack}>← 返回收件箱</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          background: 'var(--bg-card)', borderRadius: 8, padding: '8px 14px',
          borderLeft: `3px solid ${selfHandle ? '#3b82f6' : 'var(--text-faint)'}`,
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          {selfHandle
            ? <>我的账号:<strong style={{ color: '#60a5fa' }}>@{selfHandle}</strong> —— 自己发的推不显示在收件箱</>
            : <>尚未识别本人账号。点右上「识别我的账号」后,自己发的推将不再出现在收件箱。</>}
        </div>
        {spikeOut && (
          <pre style={{
            background: 'var(--bg-card)', borderRadius: 8, padding: '10px 14px',
            borderLeft: '3px solid #a78bfa', fontSize: 11, color: 'var(--text)',
            whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'ui-monospace, monospace',
          }}>{spikeOut}</pre>
        )}
        {!loading && authors.length === 0 && (
          <div style={{ color: 'var(--text-faint)', textAlign: 'center', marginTop: 40 }}>
            暂无屏蔽的账号。在收件箱推文卡片上点「🚫 屏蔽此人」即可加入。
          </div>
        )}
        {authors.map((a) => (
          <div key={a.handle} style={{
            background: 'var(--bg-card)', borderRadius: 8, padding: '10px 14px',
            borderLeft: '3px solid #7f1d1d', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {a.displayName && (
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-bright)' }}>{a.displayName}</span>
                )}
                <span style={{ color: 'var(--text-disabled)', fontSize: 11 }}>@{a.handle}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                {a.blockedAt ? `${timeAgo(String(a.blockedAt))}屏蔽` : '屏蔽时间未知'}
                {a.blockedReason ? ` · ${a.blockedReason}` : ''}
              </div>
            </div>
            <Btn sm onClick={() => handleUnblock(a.handle)}>解除</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BtnProps {
  onClick?: () => void;
  primary?: boolean;
  sm?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

function Btn({ onClick, primary, sm, disabled, children, style }: BtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: sm ? '2px 7px' : '3px 10px',
        borderRadius: 5, fontSize: sm ? 11 : 12, cursor: disabled ? 'not-allowed' : 'pointer',
        border: '1px solid',
        background: primary ? 'var(--accent)' : 'var(--border)',
        color: primary ? '#fff' : 'var(--text)',
        borderColor: primary ? 'var(--accent)' : 'var(--text-faint)',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
