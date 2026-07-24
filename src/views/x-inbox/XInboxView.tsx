import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import type { SearchRecipe, TweetInboxRecord, TweetInboxStatus, FeedbackVerdict } from '@shared/types/x-timeline-types';

interface XInboxViewProps {
  workspaceId: string;
}

const api = () => window.electronAPI?.xTimeline;

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
        background: '#1e293b', borderRadius: 10, border: '1px solid #334155',
        width: 480, maxHeight: '90vh', overflowY: 'auto', padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>
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
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: '#cbd5e1' }}>
                <input
                  type="radio"
                  checked={(draft.lang ?? '') === l}
                  onChange={() => set('lang', l === '' ? undefined : l)}
                />
                {l === '' ? '不限' : l}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: '#cbd5e1' }}>
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
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>小时内</span>
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
              <label key={rt} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: '#cbd5e1' }}>
                <input type="radio" checked={draft.resultType === rt} onChange={() => set('resultType', rt)} />
                {rt === 'latest' ? '最新' : '热门'}
              </label>
            ))}
          </div>
        </Field>

        {/* 启用 */}
        <Field label="启用">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#cbd5e1' }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            {draft.enabled ? '是' : '否'}
          </label>
        </Field>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 6, borderTop: '1px solid #334155' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontSize: 12, position: 'relative' }}>
      {/* 顶部栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, gap: 8 }}>
        <Btn sm onClick={() => setEditTarget('new')}>+ 新建配方</Btn>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {statusMsg && <span style={{ fontSize: 11, color: '#94a3b8' }}>{statusMsg}</span>}
          <Btn sm onClick={onBack}>← 返回收件箱</Btn>
        </div>
      </div>

      {/* 配方列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recipes.length === 0 && (
          <div style={{ color: '#475569', textAlign: 'center', marginTop: 40 }}>暂无配方，点击「+ 新建配方」创建</div>
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
              background: '#1e293b', borderRadius: 8, padding: '10px 14px',
              borderLeft: `3px solid ${recipe.enabled ? '#22c55e' : '#475569'}`,
            }}>
              {/* 名称行 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: recipe.enabled ? '#22c55e' : '#64748b' }}>
                  {recipe.enabled ? '●' : '○'}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9', flex: 1 }}>{recipe.name}</span>
                <Btn sm onClick={() => handleRunRecipe(recipe)} disabled={isRunning}>
                  {isRunning ? '运行中...' : '▶ 立即运行'}
                </Btn>
                <Btn sm onClick={() => setEditTarget({ ...recipe, id: recipe.id as string })}>编辑</Btn>
              </div>

              {/* 关键词预览 */}
              <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 5, lineHeight: 1.4 }}>
                关键词: {(recipe.keywords ?? []).slice(0, 8).join(' · ')}
                {(recipe.keywords ?? []).length > 8 && ' ...'}
              </div>

              {/* 调度信息 */}
              <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span>每 {recipe.intervalMinutes} 分钟</span>
                {recipe.lastRunAt && <span>上次: {timeAgo(recipe.lastRunAt)}</span>}
                {nextRunAt && <span>下次: {timeFromNow(nextRunAt)}</span>}
                {!recipe.lastRunAt && <span style={{ color: '#475569' }}>尚未运行</span>}
              </div>

              {/* 统计行 */}
              {stats && (
                <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap', borderTop: '1px solid #1e293b', paddingTop: 6 }}>
                  <span>采集 <strong style={{ color: '#94a3b8' }}>{stats.total}</strong> 条</span>
                  <span>Gemma通过 <strong style={{ color: '#7dd3fc' }}>{stats.gemmaPass}</strong></span>
                  <span>人工采纳 <strong style={{ color: '#86efac' }}>{stats.adopted}</strong></span>
                  <span>采纳率 <strong style={{ color: stats.adoptRate > 0 ? '#fbbf24' : '#475569' }}>{stats.adoptRate}%</strong></span>
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

  const [view, setView] = useState<'inbox' | 'recipes'>('inbox');
  const [recipes, setRecipes] = useState<SearchRecipe[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [currentStatus, setCurrentStatus] = useState<TweetInboxStatus | 'all'>('pending');
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
      const offset = targetPage * PAGE_SIZE;
      const r = await xApiT.queryInbox({
        ...(currentStatus === 'all'
          ? { statuses: ['pending', 'worth'] }
          : { status: currentStatus }),
        lang: langFilter,
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
      const visibleStatuses: TweetInboxStatus[] = ['pending', 'worth'];
      const newCounts: Record<string, number> = {};
      await Promise.all(visibleStatuses.map(async (s) => {
        const cr = await xApiT.queryInbox({ status: s, lang: langFilter, limit: 5000, offset: 0 });
        newCounts[s] = cr?.records?.length ?? 0;
      }));
      setCounts(newCounts);
      setTotalCount(
        currentStatus === 'all'
          ? (newCounts['pending'] ?? 0) + (newCounts['worth'] ?? 0)
          : (newCounts[currentStatus] ?? 0),
      );
    } finally {
      setLoading(false);
    }
  }, [currentStatus, currentLang]);

  useEffect(() => {
    loadPage(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStatus, currentLang, workspaceId]);

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
    setScanStatus('AI 判断中...');
    const r = await tApi.judgeNow();
    setScanStatus(r?.success ? 'AI 判断完成' : `判断失败：${r?.error}`);
    loadPage(0);
  };

  const sendToReply = async (tweet: TweetInboxRecord) => {
    const msg = `即将在 X 中打开 @${tweet.author_handle} 的推文准备回复。\n\n${tweet.text?.slice(0, 120)}`;
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
    if (verdict === 'reject') {
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
      if (verdict === 'reject') {
        setTweets((prev) => [...prev, tweet]);
        setTotalCount((c) => c + 1);
      }
      setScanStatus(`反馈写入失败：${r?.error}`);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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

  const statusItems: Array<{ status: TweetInboxStatus | 'all'; label: string; icon: string }> = [
    { status: 'pending', label: '待处理', icon: '⏳' },
    { status: 'worth', label: '已采纳', icon: '⭐' },
    { status: 'all', label: '全部', icon: '📋' },
  ];

  const cardBorderColor = (status: string) => {
    if (status === 'worth') return '#22c55e';
    if (status === 'pending') return '#f59e0b';
    if (status === 'ai_judging') return '#8b5cf6';
    return '#334155';
  };

  const cardOpacity = (status: string) =>
    status === 'skip' || status === 'filtered_out' ? 0.5 : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontSize: 12, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* 顶部栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: 36, background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>📥 X Inbox</span>
        <span style={{ background: '#334155', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{workspaceId}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn onClick={() => loadPage(page)} disabled={loading}>{loading ? '加载中...' : '刷新'}</Btn>
          <Btn primary onClick={triggerJudge}>AI 判断</Btn>
          <Btn onClick={() => setView('recipes')}>⚙ 配方</Btn>
          {isInRightSlot && (
            <button onClick={handleClose} style={closeBtn}>✕</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧栏 */}
        <div style={{ width: 160, minWidth: 160, background: '#1e293b', borderRight: '1px solid #334155', padding: 10, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
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
                  color: currentLang === lang ? '#7dd3fc' : '#94a3b8',
                }}
              >
                <span>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* 状态过滤 */}
          <div>
            <div style={sectionTitle}>状态过滤</div>
            {statusItems.map(({ status, label, icon }) => (
              <div
                key={status}
                onClick={() => setCurrentStatus(status)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px',
                  borderRadius: 5, cursor: 'pointer', marginBottom: 2,
                  background: currentStatus === status ? '#1d4ed8' : 'transparent',
                  color: currentStatus === status ? '#fff' : '#94a3b8',
                }}
              >
                <span>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, background: currentStatus === status ? 'rgba(255,255,255,0.2)' : '#334155', padding: '1px 5px', borderRadius: 8 }}>
                  {status === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[status] ?? '-')}
                </span>
              </div>
            ))}
          </div>

          {/* 触发采集 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={sectionTitle}>触发采集</div>
            <select
              value={selectedRecipeId}
              onChange={(e) => setSelectedRecipeId(e.target.value)}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '4px 6px', borderRadius: 5, fontSize: 11 }}
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
            {scanStatus && <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>{scanStatus}</div>}
          </div>

          {/* Ollama 状态 */}
          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #334155', fontSize: 11, color: '#64748b' }}>
            Ollama: <span style={{ fontWeight: 500, color: ollamaOk === true ? '#22c55e' : ollamaOk === false ? '#ef4444' : '#94a3b8' }}>
              {ollamaOk === true ? '✅ 就绪' : ollamaOk === false ? '❌ 不可用' : '检测中...'}
            </span>
          </div>
        </div>

        {/* 右侧推文列表 + 分页 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tweets.length === 0 && (
              <div style={{ color: '#475569', textAlign: 'center', marginTop: 40 }}>暂无推文</div>
            )}
            {tweets.map((t) => {
              const expanded = expandedIds.has(t.tweet_id);
              const tags = t.ai_verdict?.tags ?? [];
              const reason = t.ai_verdict?.reason ?? '';
              return (
                <div key={t.tweet_id} style={{
                  background: '#1e293b', borderRadius: 8, padding: 10,
                  borderLeft: `3px solid ${cardBorderColor(t.status)}`,
                  opacity: cardOpacity(t.status),
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 12 }}>{t.author_name}</span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>@{t.author_handle}</span>
                    <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>
                      {t.fetched_at ? timeAgo(t.fetched_at) : ''} · ❤ {t.metrics?.likes ?? 0}
                    </span>
                  </div>
                  <div style={{
                    color: '#cbd5e1', lineHeight: 1.5, fontSize: 12,
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
                        <span key={tag} style={{ background: '#1d4ed8', color: '#bfdbfe', fontSize: 10, padding: '1px 6px', borderRadius: 10 }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  {t.translation && (
                    <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 11, marginTop: 4, paddingLeft: 8, borderLeft: '2px solid #334155' }}>
                      🌐 {t.translation}
                    </div>
                  )}
                  {reason && (
                    <div style={{ color: '#6b7280', fontStyle: 'italic', fontSize: 11, marginTop: 3 }}>✦ {reason}</div>
                  )}
                  <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                    {t.tweet_url && (
                      <Btn sm onClick={() => viewTweet(t)}>
                        {viewingId === t.tweet_id ? '↗ 已在 X 中打开' : '查看原推'}
                      </Btn>
                    )}
                    {t.tweet_url && <Btn sm primary onClick={() => sendToReply(t)}>送入回复</Btn>}
                    {(() => {
                      const fb = feedbackMap[t.tweet_id];
                      return (
                        <>
                          <Btn sm primary={fb === 'accept'} onClick={() => submitFeedback(t, 'accept')}
                            style={fb === 'accept' ? { background: '#16a34a', borderColor: '#16a34a' } : {}}>
                            {fb === 'accept' ? '✓ 已采纳' : '✓ 采纳'}
                          </Btn>
                          <Btn sm onClick={() => submitFeedback(t, 'reject')}
                            style={fb === 'reject' ? { background: '#7f1d1d', borderColor: '#7f1d1d', color: '#fca5a5' } : {}}>
                            {fb === 'reject' ? '✗ 已拒绝' : '✗ 不采纳'}
                          </Btn>
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          {totalCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
              <Btn sm onClick={() => loadPage(page - 1)} disabled={page === 0}>‹ 上一页</Btn>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                第 {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)} 页
                <span style={{ marginLeft: 6, color: '#475569' }}>({totalCount} 条)</span>
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
  fontSize: 10, fontWeight: 600, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#94a3b8',
  cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px',
};

const inputStyle: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
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
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: inline ? 0 : 4, whiteSpace: 'nowrap' }}>{label}</div>
      {children}
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
        background: primary ? '#1d4ed8' : '#334155',
        color: primary ? '#fff' : '#e2e8f0',
        borderColor: primary ? '#1d4ed8' : '#475569',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
