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

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('分组口径', () => {
  it('⭐⭐ 「否」用 != true —— NONE(不知道)也算没有,与状态页一致', () => {
    const w = Object.fromEntries(PEOPLE_GROUPS.map((g) => [g.id, g.where]));
    expect(w.mutual).toBe('i_follow = true AND follows_me = true');
    expect(w.iWait).toBe('i_follow = true AND follows_me != true');
    expect(w.theyWait).toBe('follows_me = true AND i_follow != true');
  });

  it('⭐⭐⭐ 事实只从三个标记来 —— 列表与概览都不用名单归属', () => {
    const { sql } = buildPeopleQuery({ ...DEFAULT_PEOPLE_FILTER, group: 'iWait', blueOnly: true }, 50, 0);
    for (const s of [sql, buildOverviewQuery(), PERSON_DETAIL_SQL]) {
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
    const q = buildPeopleQuery({ ...DEFAULT_PEOPLE_FILTER, text: evil, cnText: true }, 50, 100);
    expect(q.sql).not.toContain('DELETE');
    expect(q.vars.text).toBe(evil.toLowerCase());
    expect(q.vars.cn).toBe('[\\x{4e00}-\\x{9fff}]');
    expect(q.vars).toMatchObject({ limit: 50, start: 100 });
    expect(buildPeopleQuery({ ...DEFAULT_PEOPLE_FILTER, text: '@Foo' }, 1, 0).vars.text).toBe('foo');
  });

  it('不认识的分组要抛,不静默当成全部', () => {
    expect(() => buildPeopleQuery({ ...DEFAULT_PEOPLE_FILTER, group: 'xx' as never }, 1, 0)).toThrow();
  });

  it('⭐ 时间转字符串、不 SELECT *(RecordId / DateTime 过不了 IPC)', () => {
    const { sql } = buildPeopleQuery(DEFAULT_PEOPLE_FILTER, 1, 0);
    expect(sql).not.toMatch(/SELECT \*/);
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
    const sql = buildOverviewQuery();
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
    expect(read('src/modules/x/XOpsView.tsx')).toMatch(/category === 'people' && <XOpsPeople workspaceId=\{workspaceId\} \/>/);
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toContain('X_PAGE_NAME.profile');
    expect(PAGE).not.toContain("'x.profile'");
  });

  it('⭐⭐ 还没做的按钮必须禁用并说「还没做」—— 不做成点了没反应的假按钮', () => {
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    for (const label of ['分析他(还没做)', '采他的推文(还没做)']) {
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
    expect(b(d, 1, 0).sql).toContain('excluded != true');
    expect(b({ ...d, scope: 'excluded' }, 1, 0).sql).toContain('excluded = true');
    const ov = o();
    expect(ov).toMatch(/count\(excluded != true AND i_follow = true AND follows_me = true\) AS mutual_total/);
    expect(ov).toContain('AS excluded_total');
    expect(() => b({ ...d, scope: 'xx' as never }, 1, 0)).toThrow();
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
    expect(fn).toMatch(/if \(follow\) openInX\(p\.handle\)/);
  });

  it('⭐⭐⭐ 采集中不跳 —— 先问「忙不忙」再 goto,且没跳要说出来', () => {
    const fn = PAGE.slice(PAGE.indexOf('const openInX'), PAGE.indexOf('const selectPerson'));
    expect(fn.length).toBeGreaterThan(200);
    const busy = fn.indexOf('getXHostBusy(wcId)');
    const go = fn.indexOf("op: 'goto'");
    expect(busy, '没问忙不忙').toBeGreaterThan(-1);
    expect(go).toBeGreaterThan(-1);
    expect(busy, '先 goto 后问忙 —— 采集已经被打断了').toBeLessThan(go);
    expect(fn).toMatch(/setFollowNote\(`\$\{busy\},没跳转/);
  });

  it('⭐⭐ 操作台采集中登记「忙」,结束时清掉', () => {
    const C = read('src/modules/x/XConsole.tsx');
    expect(C).toMatch(/if \(wcId == null \|\| !running\) return;\s*setXHostBusy\(wcId, '操作台正在采集'\);\s*return \(\) => setXHostBusy\(wcId, null\);/);
  });

  it('⭐ 人卡的按钮与点人走同一个 openInX(判断只有一份)', () => {
    expect(PAGE).toMatch(/onOpenInX=\{openInX\}/);
    const card = PAGE.slice(PAGE.indexOf('function PersonCard'));
    expect(card).not.toMatch(/op: 'goto'/);
    expect(PAGE).not.toContain('左栏');
  });
});

describe('x-host-registry 的「忙」', () => {
  it('登记、查询、清除;按 wcId 分开', async () => {
    const { setXHostBusy, getXHostBusy } = await import('@modules/x/x-host-registry');
    expect(getXHostBusy(7)).toBeNull();
    setXHostBusy(7, '操作台正在采集');
    expect(getXHostBusy(7)).toBe('操作台正在采集');
    expect(getXHostBusy(8)).toBeNull();
    setXHostBusy(7, null);
    expect(getXHostBusy(7)).toBeNull();
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
    const q = b({ ...d, tag: '  客户 ' }, 10, 0);
    /** 配方来源也一起搜(2026-10-08) */
    expect(q.sql).toContain("array::join(array::concat(tags ?? [], found_via_recipes ?? []), '\\n')");
    expect(q.vars.tag).toBe('客户');
    expect(b(d, 10, 0).sql).not.toContain('$tag');
    expect(b({ ...d, tag: "'); DELETE x_author; --" }, 1, 0).sql).not.toContain('DELETE');
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
    const q = b({ ...d, cnText: true }, 1, 0);
    expect(q.sql).toMatch(/string::matches\(string::concat\(display_name \?\? '', ' ', bio \?\? ''\), \$cn\) AND !string::matches\(string::concat\(display_name \?\? '', ' ', bio \?\? ''\), \$ja\)/);
    expect(typeof q.vars.ja).toBe('string');
    expect(b(d, 1, 0).vars.ja).toBeUndefined();
  });
});
