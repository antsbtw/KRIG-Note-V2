/**
 * ⭐⭐ 运营 → 「人」(第 1 块:只读骨架)
 *
 * ⚠️ SQL 在真库上的行为本文件证明不了 —— 要等 app 开着时只读跑一次(见交付说明)。
 * 这里钉:分组口径、事实只从三标记来、身份按 rest_id、用户输入走参数、接线不断。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PEOPLE_GROUPS, buildPeopleQuery, buildOverviewQuery, parseOverview, parsePeopleResult,
  PERSON_DETAIL_SQL, relationLabel, DEFAULT_PEOPLE_FILTER,
} from '@modules/x/x-people-query';
import { PEOPLE_WITH_RELATION, PERSON_WITH_RELATION } from '@modules/x/x-account';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('分组口径', () => {
  it('⭐⭐ 「否」用 != true —— NONE(不知道)也算没有,与状态页一致', () => {
    const w = Object.fromEntries(PEOPLE_GROUPS.map((g) => [g.id, g.where]));
    expect(w.mutual).toBe('i_follow = true AND follows_me = true');
    expect(w.iWait).toBe('i_follow = true AND follows_me != true');
    expect(w.theyWait).toBe('follows_me = true AND i_follow != true');
  });

  it('⭐⭐⭐ 事实只从三个标记来 —— 列表与概览都不用名单归属', () => {
    const { sql } = buildPeopleQuery('A', { ...DEFAULT_PEOPLE_FILTER, group: 'iWait', blueOnly: true }, 50, 0);
    for (const s of [sql, buildOverviewQuery('A').sql, PERSON_DETAIL_SQL]) {
      expect(s).not.toContain('list_memberships');
      expect(s).not.toContain('list_source');
    }
    expect(sql).toContain('is_blue_verified = true');
  });

  it('关系的说法与分组一致', () => {
    expect(relationLabel({ i_follow: true, follows_me: true })).toBe('互关');
    expect(relationLabel({ i_follow: true })).toBe('我关注·他没回关');
    expect(relationLabel({ follows_me: true, i_follow: false })).toBe('他关注·我没回关');
    expect(relationLabel({})).toBe('无关注关系');
  });
});

describe('buildPeopleQuery', () => {
  it('⭐⭐ 用户输入走参数;@ 去掉;中文判断的正则也走参数', () => {
    const evil = "x'); DELETE x_author; --";
    const q = buildPeopleQuery('A', { ...DEFAULT_PEOPLE_FILTER, text: evil, cnText: true }, 50, 100);
    expect(q.sql).not.toContain('DELETE');
    expect(q.vars.text).toBe(evil.toLowerCase());
    expect(q.vars.cn).toBe('[\\x{4e00}-\\x{9fff}]');
    expect(q.vars).toMatchObject({ limit: 50, start: 100 });
    expect(buildPeopleQuery('A', { ...DEFAULT_PEOPLE_FILTER, text: '@Foo' }, 1, 0).vars.text).toBe('foo');
  });

  it('不认识的分组要抛,不静默当成全部', () => {
    expect(() => buildPeopleQuery('A', { ...DEFAULT_PEOPLE_FILTER, group: 'xx' as never }, 1, 0)).toThrow();
  });

  it('⭐ 时间转字符串、不 SELECT *(RecordId / DateTime 过不了 IPC)', () => {
    const { sql } = buildPeopleQuery('A', DEFAULT_PEOPLE_FILTER, 1, 0);
    /**
     * ⚠️ 内层「人表 + 这个号的关系」子查询里有 SELECT *(1.2.27)—— 它不出库,外层只挑字段。
     * 去掉那段再查:**外层**不许 SELECT *。
     */
    expect(sql).toContain(PEOPLE_WITH_RELATION);
    expect(sql.split(PEOPLE_WITH_RELATION).join('(src)')).not.toMatch(/SELECT \*/);
    expect(PERSON_DETAIL_SQL.split(PERSON_WITH_RELATION).join('(src)')).not.toMatch(/SELECT \*/);
    expect(sql).toMatch(/<string> account_created_at/);
    expect(PERSON_DETAIL_SQL).toMatch(/<string> fetched_at/);
  });

  it('解析:总数与行分开给', () => {
    const r = parsePeopleResult([[{ n: 560 }], [{ rest_id: '1', handle: 'a' }]]);
    expect(r).toEqual({ total: 560, rows: [{ rest_id: '1', handle: 'a' }] });
    expect(parsePeopleResult([[], []])).toEqual({ total: 0, rows: [] });
  });
});

describe('关系概览', () => {
  it('⭐ 每组都有「人数」与「其中蓝V」两列,一条语句', () => {
    const { sql } = buildOverviewQuery('A');
    for (const g of PEOPLE_GROUPS) {
      expect(sql).toContain(`AS ${g.id}_total`);
      expect(sql).toContain(`AS ${g.id}_blue`);
    }
    const o = parseOverview([[{ mutual_total: 4800, mutual_blue: 4300, iWait_total: 560, iWait_blue: 496 }]]);
    expect(o.mutual).toEqual({ total: 4800, blue: 4300 });
    expect(o.iWait).toEqual({ total: 560, blue: 496 });
    expect(o.theyWait).toEqual({ total: 0, blue: 0 });
  });
});

describe('人卡与接线', () => {
  it('⭐⭐⭐ 人卡按数字 id 取,不按 handle(身份是 rest_id)', () => {
    expect(PERSON_DETAIL_SQL).toContain("type::record('x_author', $rest_id)");
    expect(PERSON_DETAIL_SQL).not.toMatch(/WHERE handle/);
  });

  it('⭐⭐ 三个 op 契约有、handler 有、页面真的调', () => {
    const TYPES = read('src/modules/x/x-data-types.ts');
    const IPC = read('src/modules/x/x-data-ipc.ts');
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    for (const op of ['peopleOverview', 'queryPeople', 'personDetail']) {
      expect(TYPES, `契约缺 ${op}`).toMatch(new RegExp(`op: '${op}'`));
      expect(IPC, `handler 缺 ${op}`).toMatch(new RegExp(`case '${op}':`));
      expect(PAGE, `页面没调 ${op}`).toMatch(new RegExp(`op: '${op}'`));
    }
  });

  it('⭐ 「人」类真的渲染人页;页面不写死页名', () => {
    expect(read('src/modules/x/XOpsView.tsx')).toMatch(/category === 'people' && <XOpsPeople key=\{accountKey\} workspaceId=\{workspaceId\} \/>/);
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    /** 2026-10-19 去主页的动作(核对 / 取关)抽到 x-unfollow-run.ts —— 两处都不许写死页名 */
    const RUN = read('src/modules/x/x-unfollow-run.ts');
    expect(RUN).toContain('X_PAGE_NAME.profile');
    expect(PAGE).not.toContain("'x.profile'");
    expect(RUN).not.toContain("'x.profile'");
  });

  it('⭐⭐ 还没做的按钮必须禁用并说「还没做」—— 不做成点了没反应的假按钮', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    /** 「采他的推文」2026-10-09 已做成真按钮(见下面「采他的帖子和回复」),只剩「分析他」还没做 */
    for (const label of ['分析他(还没做)']) {
      const i = PAGE.indexOf(label);
      expect(i, `${label} 不见了`).toBeGreaterThan(-1);
      const tag = PAGE.slice(PAGE.lastIndexOf('<button', i), i);
      expect(tag, `${label} 没禁用`).toMatch(/\bdisabled\b/);
      expect(tag, `${label} 挂了点击处理 —— 那就成了假按钮`).not.toMatch(/onClick/);
    }
  });
});

describe('⭐⭐ 排除(schema 1.2.21)', () => {
  /**
   * 用户 2026-10-08:「我看到不愿意再需要分析的用户，就右键排除如何？」
   * 覆盖规则(用户定):人 > AI > 算法,人定了另外两种不能覆盖。
   */
  it('⭐⭐⭐ 默认只看范围内 —— 列表与概览都不算已排除的人', async () => {
    const { buildPeopleQuery: b, buildOverviewQuery: o, DEFAULT_PEOPLE_FILTER: d } = await import('@modules/x/x-people-query');
    expect(d.scope).toBe('in');
    expect(b('A', d, 1, 0).sql).toContain('excluded != true');
    expect(b('A', { ...d, scope: 'excluded' }, 1, 0).sql).toContain('excluded = true');
    const ov = o('A').sql;
    expect(ov).toMatch(/count\(excluded != true AND i_follow = true AND follows_me = true\) AS mutual_total/);
    expect(ov).toContain('AS excluded_total');
    expect(() => b('A', { ...d, scope: 'xx' as never }, 1, 0)).toThrow();
  });

  it('⭐⭐ 写排除记成人的决定;取消也是人的决定(不清空,免得算法再建议)', async () => {
    const { SET_EXCLUDED_SQL } = await import('@modules/x/x-people-query');
    expect(SET_EXCLUDED_SQL).toContain("type::record('x_author', $rest_id)");
    expect(SET_EXCLUDED_SQL).toContain("excluded_source = 'human'");
    expect(SET_EXCLUDED_SQL).toContain('excluded = $excluded');
    expect(SET_EXCLUDED_SQL).not.toMatch(/excluded = NONE|excluded_source = NONE/);
  });

  it('⭐⭐⭐ 人不存在时 UPDATE 返回空且不报错 —— repo 必须检查并抛', () => {
    const REPO = read('src/modules/x/x-people-repo.ts');
    const fn = REPO.slice(REPO.indexOf('export async function setExcluded'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/rows\.length !== 1/);
    expect(fn).toMatch(/throw new Error/);
  });

  it('⭐⭐⭐ 排除字段是人工字段 —— 采集绝不能碰', async () => {
    const { USER_BUSINESS_FIELDS } = await import('@modules/x/x-user-repo');
    for (const f of ['excluded', 'excluded_source', 'excluded_at', 'excluded_reason']) {
      expect(USER_BUSINESS_FIELDS as readonly string[], `${f} 不在人工字段清单里`).toContain(f);
    }
  });

  it('⭐ 迁移 1.2.21 登记了;来源限定三种', () => {
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.21'[\s\S]{0,200}up: x_migration_1_2_21/);
    expect(read('src/storage/surreal/x-schema.ts')).toMatch(/excluded_source ON x_author[\s\S]{0,120}INSIDE \['human', 'ai', 'rule'\]/);
  });

  it('⭐⭐ 页面:右键能排除、有撤销、失败不先从列表拿掉', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toMatch(/onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); setMenu\(/);
    expect(PAGE).toMatch(/op: 'setExcluded'/);
    expect(PAGE).toContain('撤销');
    const fn = PAGE.slice(PAGE.indexOf('const applyExcluded'), PAGE.indexOf('const toggleExclude'));
    expect(fn.length).toBeGreaterThan(100);
    /** 先确认写成功,再从列表拿掉 —— 顺序反了就是「看着排除了、库里没变」 */
    expect(fn.indexOf("r.status === 'failed'")).toBeLessThan(fn.indexOf('setRows('));
  });
});

describe('⭐⭐ 关联:点人 → X 网页跳到他主页(2026-10-08)', () => {
  /** 用户:「点击选定用户时，右边的x view跳转到这个人的主页」 */
  const PAGE = read('src/modules/x/XOpsPeople.tsx');

  it('⭐⭐ 点一行走 selectPerson,它在开关打开时调 openInX', () => {
    expect(PAGE).toMatch(/onClick=\{\(\) => selectPerson\(p\)\}/);
    const fn = PAGE.slice(PAGE.indexOf('const selectPerson'), PAGE.indexOf('};', PAGE.indexOf('const selectPerson')));
    expect(fn.length).toBeGreaterThan(30);
    /** 2026-10-09 起传整个人(核对要用数字 id),不只传 handle */
    expect(fn).toMatch(/if \(follow\) openInX\(p\)/);
  });

  it('⭐⭐⭐ 采集中不跳 —— 先问「忙不忙」再导航,且没跳要说出来', () => {
    /** 2026-10-09 起导航改为「去主页并核对」(harvest + gotoPage),在 runVerify 里 */
    const fn = PAGE.slice(PAGE.indexOf('const runVerify'), PAGE.indexOf('const openInX'));
    expect(fn.length).toBeGreaterThan(200);
    /** 2026-10-23 起「问忙不忙」= 申请主进程的锁(x-page-lock),拿不到就不跳 */
    const busy = fn.indexOf('await acquireXPage(wcId');
    /** 2026-10-19 去主页 + 读资料抽到 readProfileAndRefresh(x-unfollow-run.ts) */
    const go = fn.indexOf('readProfileAndRefresh(');
    expect(busy, '没问忙不忙').toBeGreaterThan(-1);
    expect(go).toBeGreaterThan(-1);
    expect(busy, '先 goto 后问忙 —— 采集已经被打断了').toBeLessThan(go);
    expect(fn).toMatch(/if \(!lock\.ok\) \{ setFollowNote\(`\$\{lock\.why\},没跳转/);
  });

  it('⭐⭐ 操作台开采前先占住网页(被占着就不开采并说出来),结束时放自己的锁', () => {
    const C = read('src/modules/x/XConsole.tsx');
    expect(C).toMatch(/const lock = await acquireXPage\(wcId!, '操作台正在采集'\);\s*if \(!lock\.ok\) \{ setLockNote\(`没开采:\$\{lock\.why\}`\); return; \}\s*setLockNote\(null\);\s*setRunning\(true\);/);
    expect(C).toMatch(/\} finally \{\s*await releaseXPage\(lock\.token\);\s*setRunning\(false\);/);
    /** ⚠️ 旧写法(useEffect 里直接写忙)会盖掉 / 清掉后台查回关的忙 */
    expect(C).not.toMatch(/setXHostBusy/);
  });

  it('⭐ 人卡的按钮与点人走同一个 openInX(判断只有一份)', () => {
    expect(PAGE).toMatch(/onOpenInX=\{\(person\) => openInX\(person\)\}/);
    const card = PAGE.slice(PAGE.indexOf('function PersonCard'));
    expect(card).not.toMatch(/op: 'goto'|op: 'harvest'/);
    expect(PAGE).not.toContain('左栏');
  });
});

describe('X 网页占用(x-page-lock;原 x-host-registry 的「忙」2026-10-23 退役)', () => {
  it('占住、查询、放掉;按 wcId 分开', async () => {
    const { acquirePage, pageBusy, releasePage } = await import('@modules/x/x-page-lock');
    expect(pageBusy(7)).toBeNull();
    const a = acquirePage(7, '操作台正在采集', 'ui');
    if (!a.ok) throw new Error('应拿到');
    expect(pageBusy(7)).toBe('操作台正在采集');
    expect(pageBusy(8)).toBeNull();
    releasePage(a.token);
    expect(pageBusy(7)).toBeNull();
  });
});

describe('⭐⭐ 自由标签(schema 1.2.22)', () => {
  /**
   * 用户:「增加第三个功能，就是打标签…标签可以打多个的，自由一点」
   * 「部分是精确字段，部分是标签…定义准确的，可以慢慢固定为精确字段。」
   */
  it('⭐⭐ 清洗:去空格、压空白、去空、不分大小写去重(保留第一次写法)、太长报出来', async () => {
    const { normalizeTags, TAG_MAX_LEN } = await import('@modules/x/x-people-query');
    expect(normalizeTags([' 客户 ', '客户', '', '  ', 'VIP', 'vip', '广  东']).tags).toEqual(['客户', 'VIP', '广 东']);
    const long = 'x'.repeat(TAG_MAX_LEN + 1);
    const r = normalizeTags(['ok', long]);
    expect(r.tags).toEqual(['ok']);
    expect(r.problems).toHaveLength(1);
  });

  it('输入一次加多个:中英文逗号、顿号、换行', async () => {
    const { splitTagInput } = await import('@modules/x/x-people-query');
    expect(splitTagInput('客户,广东，信息源、同行\n待跟进')).toEqual(['客户', '广东', '信息源', '同行', '待跟进']);
  });

  it('⭐ 标签目录从人身上统计,按人数排', async () => {
    const { tagCatalog } = await import('@modules/x/x-people-query');
    expect(tagCatalog([{ tags: ['客户', '广东'] }, { tags: ['客户'] }, {}, { tags: [] }]))
      .toEqual([{ tag: '客户', count: 2 }, { tag: '广东', count: 1 }]);
  });

  it('⭐⭐ 关键词过滤:换行拼接后找(不会跨标签误命中),关键词走参数', async () => {
    const { buildPeopleQuery: b, DEFAULT_PEOPLE_FILTER: d } = await import('@modules/x/x-people-query');
    const q = b('A', { ...d, tag: '  客户 ' }, 10, 0);
    /** 配方来源也一起搜(2026-10-08) */
    expect(q.sql).toContain("array::join(array::concat(tags ?? [], found_via_recipes ?? []), '\\n')");
    expect(q.vars.tag).toBe('客户');
    expect(b('A', d, 10, 0).sql).not.toContain('$tag');
    expect(b('A', { ...d, tag: "'); DELETE x_author; --" }, 1, 0).sql).not.toContain('DELETE');
  });

  it('⭐⭐⭐ 写标签:按数字 id、人不存在要抛、库那边再清洗一次', () => {
    const REPO = read('src/modules/x/x-people-repo.ts');
    const fn = REPO.slice(REPO.indexOf('export async function setTags'), REPO.indexOf('export async function readTagCatalog'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/normalizeTags\(raw\)/);
    expect(fn).toMatch(/rows\.length !== 1/);
    expect(fn).toMatch(/throw new Error/);
  });

  it('⭐⭐⭐ 标签是人工字段 —— 采集绝不能碰;迁移登记了', async () => {
    const { USER_BUSINESS_FIELDS } = await import('@modules/x/x-user-repo');
    expect(USER_BUSINESS_FIELDS as readonly string[]).toContain('tags');
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.22'[\s\S]{0,200}up: x_migration_1_2_22/);
  });

  it('⭐⭐ 页面:右键第三项「打标签…」;原来两项不变', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    const menu = PAGE.slice(PAGE.indexOf('{menu && ('), PAGE.indexOf('{tagging && ('));
    expect(menu.length).toBeGreaterThan(200);
    const order = ['排除(不在分析范围)', '打开人卡', '打标签…'].map((t) => menu.indexOf(t));
    expect(order.every((i) => i > -1), '三项不全').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('⭐⭐ 对话框:中文输入法选字时的回车不算加标签;存失败不关对话框', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    const dlg = PAGE.slice(PAGE.indexOf('function TagDialog'), PAGE.indexOf('function Section'));
    expect(dlg).toMatch(/e\.key === 'Enter' && !e\.nativeEvent\.isComposing/);
    expect(dlg).toMatch(/if \(err !== null\) setWhy\(err\)/);
    const save = PAGE.slice(PAGE.indexOf('onSave={async (tags) => {'), PAGE.indexOf('onCancel={() => setTagging(null)}'));
    expect(save).toMatch(/if \(why === null\) setTagging\(null\)/);
  });
});

describe('⭐ 打标签对话框:输入框 + 已有标签(2026-10-08)', () => {
  /** 用户:「输入框+已存在的标签的方式组合，这样我不用一个一个输入标签，可以从历史标签中选择。」 */
  const PAGE = read('src/modules/x/XOpsPeople.tsx');
  const dlg = PAGE.slice(PAGE.indexOf('function TagDialog'), PAGE.indexOf('function Section'));

  it('⭐⭐ 已有标签逐个渲染成按钮,点一下切换(加上/去掉)', () => {
    expect(dlg.length).toBeGreaterThan(500);
    expect(dlg).toMatch(/shown\.map\(\(c\) => \(\s*<button[\s\S]{0,120}onClick=\{\(\) => toggle\(c\.tag\)\}/);
    /** 打字时只留包含关键词的 */
    expect(dlg).toMatch(/catalog\.filter\(\(c\) => c\.tag\.toLowerCase\(\)\.includes\(kw\)\)/);
  });

  it('⚠️ 输入框 flex: none —— 否则在竖排对话框里被撑成 140px 高(截图里那个大框)', () => {
    const input = dlg.slice(dlg.indexOf('<input'), dlg.indexOf('/>', dlg.indexOf('<input')));
    expect(input.length).toBeGreaterThan(50);
    expect(input).toMatch(/style=\{\{ \.\.\.S\.input, flex: 'none' \}\}/);
  });
});

describe('⭐ 单击选中、双击开人卡(2026-10-08)', () => {
  /** 用户:「个人card双击的时候再显示，单击用户不要显示好操作一点。」 */
  const PAGE = read('src/modules/x/XOpsPeople.tsx');

  it('⭐⭐ 单击不开人卡 —— selectPerson 里不许出现 setCardId', () => {
    const fn = PAGE.slice(PAGE.indexOf('const selectPerson'), PAGE.indexOf('const openCard'));
    expect(fn.length).toBeGreaterThan(30);
    expect(fn).not.toMatch(/setCardId/);
  });

  it('⭐⭐ 双击与右键「打开人卡」才开;人卡显示看 cardId 不看 selected', () => {
    expect(PAGE).toMatch(/onDoubleClick=\{\(\) => openCard\(p\)\}/);
    expect(PAGE).toMatch(/onClick=\{\(\) => \{ openCard\(menu\.p\); setMenu\(null\); \}\}/);
    expect(PAGE).toMatch(/const showCard = cardId !== null;/);
    expect(PAGE).toMatch(/restId=\{cardId!\}/);
  });
});

describe('⭐⭐ 中文筛选要排除日文(2026-10-08)', () => {
  /**
   * 用户截图:「マルクロス /恐竜公式声優」被当成中文。日文也有汉字,但有中文没有的假名。
   * 规则:≥ 2 个假名字母才算日文;「の」「・」「ー」不算(中文用户常装饰性地用)。
   * 真库实测:与 JS 算法结果一致(4325);用例全部取自真实简介。
   */
  const toJs = async (): Promise<RegExp> => {
    const { JA_KANA } = await import('@modules/x/x-people-query');
    const k = JA_KANA.replace(/\\x\{([0-9a-f]+)\}/gi, '\\u{$1}');
    return new RegExp(`${k}[\\s\\S]*${k}`, 'u');
  };

  it('⭐⭐ 日文号判为日文', async () => {
    const ja = await toJs();
    for (const t of ['マルクロス /恐竜公式声優', 'オーバーウォッチ の最新情報', '20代｜ふつうの社会人', '台湾人です。日本十年']) {
      expect(ja.test(t), t).toBe(true);
    }
  });

  it('⭐⭐⭐ 只用一个「の」、或用「・」的中文用户不能误伤', async () => {
    const ja = await toJs();
    for (const t of ['希望の凿痕 互关必回', '小刘の算法笔记 ai算法工程师', '程序员・编剧・AI导演', '日本語の初心者 身如黑洞', '加油ー']) {
      expect(ja.test(t), t).toBe(false);
    }
  });

  it('⭐ SQL:有汉字且不匹配日文;两个正则都走参数', async () => {
    const { buildPeopleQuery: b, DEFAULT_PEOPLE_FILTER: d } = await import('@modules/x/x-people-query');
    const q = b('A', { ...d, cnText: true }, 1, 0);
    expect(q.sql).toMatch(/string::matches\(string::concat\(display_name \?\? '', ' ', bio \?\? ''\), \$cn\) AND !string::matches\(string::concat\(display_name \?\? '', ' ', bio \?\? ''\), \$ja\)/);
    expect(typeof q.vars.ja).toBe('string');
    expect(b('A', d, 1, 0).vars.ja).toBeUndefined();
  });
});

describe('⭐⭐ 采他的帖子 / 回复 / 转发 —— 按时间范围(2026-10-10 正式版)', () => {
  /**
   * 用户:「右键点击，获取这三项数据，但是可以配置获取的长度（一个月、半年、一年，全部）…大部分就是一个月就够了」。
   * ⚠️ 取代 10-09 的「各 2 页滚动」探查版:真机滚 8 轮每页都只拿到首屏,改游标翻页 + 按时间收手。
   */
  const PAGE = read('src/modules/x/XOpsPeople.tsx');
  const fn = PAGE.slice(PAGE.indexOf('const collectTweets'), PAGE.indexOf('/** ⭐ 选时间范围的小框'));
  /**
   * ⭐ 2026-10-13(后台策略 3a):「去那一页 → runCollect」搬到主进程 `x-collect-on-webview.ts`
   * (与后台 runner 共用),人卡经 `collectPersonTab` 调它。判据不变,改钉**真在跑**的那份。
   */
  const CORE = read('src/modules/x/x-collect-on-webview.ts');
  const MAIN = read('src/modules/x/x-person-collect.ts');

  it('⭐⭐ 三个标签页来自 PERSON_TABS;每页去那一页再 runCollect;收手用时间窗', () => {
    expect(fn.length).toBeGreaterThan(1000);
    expect(fn).toMatch(/for \(const tab of PERSON_TABS\)/);
    expect(fn).toMatch(/op: 'collectPersonTab', wcId, page: tab\.name, handle: p\.handle, restId: p\.rest_id/);
    /** 页数上限 2026-10-10 起读设置(用户可调),没设就用默认 LIVE_PAGE_CAP */
    expect(fn).toMatch(/pageCap: settingsRef\.current\?\.\['collect\.live_page_cap'\] \?\? LIVE_PAGE_CAP/);
    expect(fn, '没把范围起点交给主进程 —— 按时间收手会失效').toMatch(/start: start\?\.toISOString\(\)/);
    /** 主进程那份:先去那一页(没到就不采),再 runCollect,收手用时间窗 */
    const goAt = CORE.indexOf('ports.goto(input.page, { handle: input.handle })');
    const runAt = CORE.indexOf('await runCollect(');
    expect(goAt, '主进程没去那一页').toBeGreaterThan(-1);
    expect(runAt, '主进程没跑 runCollect').toBeGreaterThan(goAt);
    // 2026-10-14:包一层记翻页前沿(后台进度「采到」),停止判据仍是同一个 timeWindowStop,且结果原样返回
    expect(CORE).toMatch(/const stop = timeWindowStop\(input\.restId, input\.start, input\.pageCap\);/);
    const stopCb = CORE.slice(CORE.indexOf('stopPaging: (st) => {'), CORE.indexOf('cancelled: hooks.cancelled'));
    expect(stopCb.length).toBeGreaterThan(50);
    expect(stopCb).toMatch(/return stop\(st\);\s*\},\s*$/);
    expect(MAIN).toMatch(/start: input\.start \? new Date\(input\.start\) : undefined/);
  });

  it('⭐⭐ 首页采集有明确上限(默认 3000 轮 / 20 分钟是给名单用的)', () => {
    expect(CORE).toMatch(/seedPages: 1, maxRounds: 20, maxMs: 60_000/);
  });

  it('⭐⭐ 忙就不采;采期间登记忙,结束(含出错)一定清掉;能停', () => {
    expect(fn).toMatch(/const lock = await acquireXPage\(wcId, COLLECT_BUSY\);\s*if \(!lock\.ok\)/);
    expect(fn).toMatch(/\} finally \{\s*await releaseXPage\(lock\.token\);\s*\}/);
    /** ⭐ 停:renderer 外层循环看 cancelCollect;翻页在主进程,停止按钮还要通知主进程 */
    expect(fn).toMatch(/if \(cancelCollect\.current\) \{ parts\.push/);
    const btn = PAGE.slice(PAGE.indexOf('onCancelCollect={'), PAGE.indexOf('onCancelCollect={') + 300);
    expect(btn, '停止按钮没通知主进程 —— 翻页停不住').toMatch(/op: 'cancelPersonCollect', wcId/);
    expect(MAIN, '主进程没把停止标记接给 runCollect').toMatch(/cancelled: \(\) => ctl\.cancelled/);
    expect(read('src/modules/x/x-data-ipc.ts')).toMatch(/case 'cancelPersonCollect':[\s\S]{0,120}cancelPersonCollect\(p\.wcId\)/);
  });

  it('⭐ 推文走 saveTweets(作者顺带进人表),来源记成哪一页', () => {
    expect(CORE).toMatch(/run\.summary\?\.items/);
    expect(fn).toMatch(/const records = \[\.\.\.run\.records\]/);
    expect(fn).toMatch(/op: 'saveTweets', records, ctx: \{ source: tab\.name, wcId: wcId \?\? undefined \}/);
  });

  it('⭐⭐⭐ 人卡的「他的推文」按作者数字 id 查,不按 handle', async () => {
    const { PERSON_TWEETS_SQL } = await import('@modules/x/x-people-query');
    expect(PERSON_TWEETS_SQL).toContain('author_rest_id = $rest_id');
    expect(PERSON_TWEETS_SQL).not.toMatch(/author_handle/);
  });

  it('⭐ 右键先选时间范围;一个月当场采,半年/一年/全部建后台任务(2026-10-14 第 4 步)', () => {
    const menu = PAGE.slice(PAGE.indexOf('{menu && ('), PAGE.indexOf('{tagging && ('));
    expect(menu).toContain('采他的帖子/回复/转发…');
    expect(menu).toMatch(/setRangeFor\(m\.p\)/);
    const picker = PAGE.slice(PAGE.indexOf('{rangeFor && ('), PAGE.indexOf('{tagging && ('));
    expect(picker.length).toBeGreaterThan(100);
    // ⭐ 只有 month 走当场采;别的范围必须走后台(不许当场翻几天)
    expect(picker).toMatch(/if \(r\.id === 'month'\) void collectTweets\(pr, r\.id\);\s*else void createBgJob\(pr, r\.id\);/);
    expect(picker).not.toMatch(/disabled=/);
    // ⭐ 建后台任务只调 bgCreateJob,不碰当场采集
    const fn = PAGE.slice(PAGE.indexOf('const createBgJob = useCallback'), PAGE.indexOf('const [rangeFor, setRangeFor]'));
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/op: 'bgCreateJob'/);
    expect(fn).toMatch(/wsId: workspaceId/);
    expect(fn).not.toMatch(/collectTweets|collectPersonTab/);
  });
});

