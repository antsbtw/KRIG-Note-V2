/**
 * 📋 任务 → 搜索配方(2026-10-26 从操作台搬过来)
 *
 * 配方 = 找人 / 找帖子用的搜索条件(找蓝V、找求助帖都靠它)。原来只在操作台(测试后台)里能建 / 改 / 删;
 * 操作台拆掉(Module5-04 收尾:它在界面里直接驱动网页、在界面进程跑整套采集),配方是业务 → 搬到「任务」。
 * 用户 10-26:「「运营」--这个等于dashboard,「任务」--才是真正的执行者。」
 *
 * ⚠️ 配方记的是**意图**(要哪些词、谁发的、多久以内、热度门槛),真正发出去的查询串由 `recipeToQuery` 翻译 ——
 * 两者不是一回事,所以每条都把「实际会搜什么」显示出来,人点之前看得见。
 * 「按它搜索」只让左边 X 网页打开那个搜索(能力 x.page.open,占着网页那一下),不采集;采集由各任务做。
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import { xDataCall } from './x-data-types';
import { recipeToQuery } from './x-recipe-query';
import { openInLeft } from './x-unfollow-run';

export function RecipesTask({ wsId }: { wsId: string }): ReactElement {
  const [recipes, setRecipes] = useState<SearchRecipe[]>([]);
  const [busy, setBusy] = useState(false);
  /** ⚠️ 读写失败要**看得见** —— 静默的话人以为「还没建过配方」 */
  const [err, setErr] = useState<string | null>(null);
  /** 正在编辑的那条;null = 没在编辑 */
  const [editing, setEditing] = useState<SearchRecipe | null>(null);
  /** 「按它搜索」没打开的原因(网页被占着 / 没开) */
  const [openNote, setOpenNote] = useState<string | null>(null);

  /** ⭐ 读配方 —— 失败如实报,不回空数组充数 */
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await xDataCall({ op: 'list' });
    setBusy(false);
    if (r.status === 'ok') setRecipes(r.value as SearchRecipe[]);
    else setErr(r.reason);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** ⚠️ 存完**重新读一遍** —— 不拿本地那份充数(库里可能改了别的字段) */
  const save = async (r: SearchRecipe): Promise<void> => {
    setErr(null);
    const res = await xDataCall({ op: 'upsert', recipe: r });
    if (res.status !== 'ok') { setErr(res.reason); return; }
    setEditing(null);
    await load();
  };
  const remove = async (r: SearchRecipe): Promise<void> => {
    setErr(null);
    const res = await xDataCall({ op: 'delete', recipeId: r.id });
    if (res.status !== 'ok') { setErr(res.reason); return; }
    await load();
  };
  const search = async (q: { q: string; resultType: string }): Promise<void> => {
    const why = await openInLeft(wsId, { q: q.q, f: q.resultType });
    setOpenNote(why === null ? null : `没打开搜索:${why}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={S.row}>
        <button type="button" disabled={busy} onClick={() => void load()} style={S.btn}>{busy ? '读取中…' : '刷新'}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(blankRecipe())} style={S.btn}>新建配方</button>
        <span style={{ fontSize: 11, opacity: 0.6 }}>共 {recipes.length} 条</span>
      </div>
      {err !== null && <div style={{ color: '#f87171' }}>⚠️ {err}</div>}
      {openNote !== null && <div style={{ color: '#d97706' }}>⚠️ {openNote}</div>}
      {editing !== null && <RecipeEditor value={editing} onCancel={() => setEditing(null)} onSave={(r) => void save(r)} />}
      {recipes.length === 0 && !busy && <div style={{ opacity: 0.6 }}>还没有配方。</div>}
      {recipes.map((r) => {
        const q = recipeToQuery(r);
        return (
          <div key={r.id} style={{ border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: 8 }}>
            <div>
              <strong>{r.name}</strong>
              <span style={{ opacity: 0.6 }}>　{r.template}</span>
              {!r.enabled && <span style={{ opacity: 0.6 }}>　(已停用)</span>}
            </div>
            {/* ⭐⭐ 实际会搜什么 —— 配方填的词与发出去的串不是一回事 */}
            <div style={{ fontSize: 11, opacity: 0.75 }}>{q.explain}</div>
            <div style={{ fontSize: 11, opacity: 0.6, wordBreak: 'break-all' }}><code>{q.q}</code></div>
            {/* ⚠️ 翻译不出来的要**挡住**,不许点了才失败 */}
            {q.problems.map((p, i) => <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠️ {p}</div>)}
            <div style={{ ...S.row, marginTop: 4 }}>
              <button type="button" disabled={q.problems.length > 0} onClick={() => void search(q)} style={S.btn}
                title={q.problems.length > 0 ? '这条配方还搜不出东西' : '左边 X 网页打开这个搜索(只打开,不采集)'}>按它搜索</button>
              <button type="button" onClick={() => setEditing(r)} style={S.btn}>编辑</button>
              <button type="button" onClick={() => void remove(r)} style={S.btn}>删除</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ⭐ 新配方的空壳 —— ⚠️ `id` 空串表示「新增」(由 repo 生成 ULID)。
 * ⭐ 默认值照搬 `SearchRecipe` 注释里的实测结论:
 * `sinceHours` 默认 24、`resultType` 默认 latest。
 */
function blankRecipe(): SearchRecipe {
  return {
    id: '', name: '', enabled: true, template: 'trending',
    keywords: [], fromAccounts: [], helpSignals: [],
    sinceHours: 24, resultType: 'latest', intervalMinutes: 60,
  };
}

/** ⭐ 逗号/空格分隔 ↔ 数组 —— 人填的是一行字,库里存的是数组 */
const toList = (v: string): string[] =>
  v.split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean);
const fromList = (v: readonly string[] | undefined): string => (v ?? []).join('，');

/**
 * ⭐⭐ 配方编辑器 —— 用户 2026-10-04:「配方的配置功能也要增加上来哦。」
 *
 * ⚠️ 字段**按模板显示**:盯人模板不显示关键词(它根本不筛词),
 * 求助模板才显示信号词 —— 显示用不上的框等于请人填错。
 */
function RecipeEditor(
  { value, onSave, onCancel }:
  { value: SearchRecipe; onSave: (r: SearchRecipe) => void; onCancel: () => void },
): ReactElement {
  const [r, setR] = useState<SearchRecipe>(value);
  /** ⚠️ 换一条编辑时要跟着换 —— 否则点「编辑」第二条还显示第一条 */
  useEffect(() => { setR(value); }, [value]);
  const set = <K extends keyof SearchRecipe>(k: K, v: SearchRecipe[K]): void =>
    setR((x) => ({ ...x, [k]: v }));

  const preview = recipeToQuery(r);
  const isVip = r.template === 'vip-tracking';
  const isHelp = r.template === 'help-wanted';

  return (
    <div style={{ ...S.diagnose, marginBottom: 8 }}>
      <div style={S.sectionTitle}>{r.id ? '编辑配方' : '新建配方'}</div>
      <div style={S.row}>
        <input
          value={r.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="配方名字（必填）"
          style={S.input}
        />
        <select
          value={r.template}
          onChange={(e) => set('template', e.target.value as SearchRecipe['template'])}
          style={{ ...S.input, flex: 'none', width: 150 }}
        >
          <option value="trending">关键词</option>
          <option value="vip-tracking">盯人（只看这些账号）</option>
          <option value="help-wanted">求助（词 + 信号词）</option>
          <option value="custom">自定义</option>
        </select>
      </div>

      {/* ⚠️ 盯人模板不显示关键词 —— 它根本不筛词,显示出来只会请人填错 */}
      {!isVip && (
        <div style={S.row}>
          <input
            value={fromList(r.keywords)}
            onChange={(e) => set('keywords', toList(e.target.value))}
            placeholder="关键词（逗号分隔，任一命中）"
            style={S.input}
          />
        </div>
      )}
      {isHelp && (
        <div style={S.row}>
          <input
            value={fromList(r.helpSignals)}
            onChange={(e) => set('helpSignals', toList(e.target.value))}
            placeholder="求助信号词（逗号分隔，与关键词同时命中才算）"
            style={S.input}
          />
        </div>
      )}
      <div style={S.row}>
        <input
          value={fromList(r.fromAccounts)}
          onChange={(e) => set('fromAccounts', toList(e.target.value))}
          placeholder={isVip ? '盯哪些账号（逗号分隔，必填）' : '限这些账号（可留空）'}
          style={S.input}
        />
      </div>
      <div style={S.row}>
        <input
          value={r.minLikes ?? ''}
          onChange={(e) => set('minLikes', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="赞≥"
          style={{ ...S.input, flex: 'none', width: 64 }}
        />
        <input
          value={r.minRetweets ?? ''}
          onChange={(e) => set('minRetweets', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="转≥"
          style={{ ...S.input, flex: 'none', width: 64 }}
        />
        <input
          value={r.lang ?? ''}
          onChange={(e) => set('lang', e.target.value.trim() || undefined)}
          placeholder="语言 zh/en"
          style={{ ...S.input, flex: 'none', width: 90 }}
        />
        <input
          value={r.sinceHours ?? ''}
          onChange={(e) => set('sinceHours', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="几小时内"
          style={{ ...S.input, flex: 'none', width: 90 }}
        />
        <select
          value={r.resultType}
          onChange={(e) => set('resultType', e.target.value as SearchRecipe['resultType'])}
          style={{ ...S.input, flex: 'none', width: 90 }}
        >
          <option value="latest">最新</option>
          <option value="top">热门</option>
        </select>
      </div>
      <div style={S.row}>
        <label style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={r.includeReplies ?? false}
            onChange={(e) => set('includeReplies', e.target.checked)}
          />
          {' '}连回复一起（filter:replies）
        </label>
        <label style={{ fontSize: 11 }} title="蓝V互关配方用;语法未经真机验证,第一次搜要看结果是不是全是蓝V">
          <input
            type="checkbox"
            checked={r.blueOnly ?? false}
            onChange={(e) => set('blueOnly', e.target.checked)}
          />
          {' '}只看蓝V作者（filter:blue_verified）
        </label>
        <label style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          {' '}启用
        </label>
      </div>

      {/* ⭐⭐ 改一个字就看得见最终会搜什么 —— 不用存了再看 */}
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
        实际会搜：<code style={{ wordBreak: 'break-all' }}>{preview.q || '（还搜不出东西）'}</code>
      </div>
      {preview.problems.map((p, i) => (
        <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠️ {p}</div>
      ))}

      <div style={{ ...S.row, marginTop: 4 }}>
        <button
          type="button"
          disabled={r.name.trim() === ''}
          onClick={() => onSave(r)}
          style={S.btn}
          title={r.name.trim() === '' ? '配方必须有名字' : '存进库'}
        >
          保存
        </button>
        <button type="button" onClick={onCancel} style={S.btn}>取消</button>
      </div>
    </div>
  );
}

/**
 * ⭐ 一行字段 —— ⚠️ `ok` 不给时**不染色**:
 * 「蓝V 否」「是回复 否」这些是**事实**不是缺失,染红会制造假警报。
 */

const S: Record<string, CSSProperties> = {
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  sectionTitle: { fontSize: 12, color: 'var(--text-primary, #ccc)', display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, background: 'var(--bg-secondary, #1b1b1b)', border: '1px solid var(--border-color, #3a3a3a)',
    borderRadius: 4, color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '4px 6px',
  },
  btn: {
    background: 'transparent', border: '1px solid var(--border-color, #4a4a4a)', borderRadius: 4,
    color: 'var(--text-secondary, #bbb)', cursor: 'pointer', fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap',
  },
  diagnose: {
    fontSize: 11, lineHeight: 1.6, color: '#b45309',
    background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.35)', borderRadius: 4, padding: '6px 8px',
  },
};
