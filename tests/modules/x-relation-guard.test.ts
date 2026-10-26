/**
 * ⭐⭐⭐ 守卫:关系只按号存、按号读(2026-10-16,schema 1.2.27,蓝V互关 M0)
 *
 * 用户 10-16:「互相覆盖是很严重的问题哦,应该是分字段,判断起来简单吧?」
 * 人表上的 `x_author.i_follow / follows_me` 是全库一份的旧字段 —— 保留不删,但**再没有代码写它、读它**。
 * 行为验证在 x-relation.verify.test.ts(真库);这里钉「新代码不会绕回旧字段」与接线。
 *
 * ⚠️ 源码扫描看不见会不会执行(记忆 feedback-source-scan-cant-see-execution)——
 * 所以写入侧另有**行为**断言:拿带关系的载荷调纯函数,看 SQL 里有没有关系字段。
 */
import { describe, it, expect } from 'vitest';
import { capBlock, capOfOp, ipcHandles, readCapBlock, saveFnBody } from './_x-ipc-wiring';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildAuthorUpsert } from '@modules/x/x-tweet-authors';
import { buildPersonRefresh, PERSON_REFRESH_FIELDS } from '@modules/x/x-person-refresh';
import { USER_COLLECTED_FIELDS } from '@modules/x/x-user-repo';
import { buildPeopleQuery, buildOverviewQuery, PERSON_DETAIL_SQL, DEFAULT_PEOPLE_FILTER } from '@modules/x/x-people-query';
import { buildOpsStatusQuery } from '@modules/x/x-ops-status';
import { PEOPLE_WITH_RELATION, PERSON_WITH_RELATION } from '@modules/x/x-account';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** 源码文件 —— 从目录现扫,不写死清单(新文件天然在视野内) */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === 'dist' || name === 'node_modules') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

/** 剥注释 —— ⚠️ `//` 前不能是 `:`,否则吃掉 https:// (记忆 feedback-guard-stripper-eats-urls) */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 字符串 / 模板字面量(粗切:够用来找 SQL) */
const literals = (s: string): string[] => s.match(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g) ?? [];

const REL_FIELD = /\bi_follow\b|\bfollows_me\b/;
/** 经关系表的写法:直接写 x_relation,或插值关系来源常量(x-account.ts 的 REL / PEOPLE_WITH_RELATION / PERSON_WITH_RELATION) */
const VIA_RELATION = /x_relation|\$\{(REL|PEOPLE_WITH_RELATION|PERSON_WITH_RELATION)\}/;

describe('守卫自检', () => {
  it('剥注释不吃 URL、能剥掉注释里的关系字段', () => {
    expect(strip("const u = 'https://x.com'; // i_follow x_author")).toBe("const u = 'https://x.com'; ");
    expect(strip('/* x_author.i_follow */ ok')).toBe(' ok');
  });

  it('扫描范围真的扫到了文件(不是空集合全绿)', () => {
    const files = [...sources('src'), ...sources('scripts')];
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join('src', 'modules', 'x', 'x-user-repo.ts'));
  });
});

describe('⭐⭐⭐ 不许绕回人表上的旧关系字段', () => {
  it('任何字面量里同时有 x_author 与 i_follow/follows_me,就必须是经 x_relation 的(迁移定义除外)', () => {
    const bad: string[] = [];
    for (const f of [...sources('src'), ...sources('scripts')]) {
      /** 例外只有两个「本来就是读旧字段的一方」:迁移定义,与把旧关系搬进关系表的迁移脚本 */
      if (f.endsWith('x-schema.ts') || f.endsWith('x-migrate-relation-to-account.ts')) continue;
      for (const lit of literals(strip(readFileSync(join(ROOT, f), 'utf8')))) {
        /** ⚠️ 按语句查:一个模板里多条语句时,别让「经关系的那条」替「直接读人表的那条」打掩护 */
        for (const stmt of lit.split(';')) {
          if (stmt.includes('x_author') && REL_FIELD.test(stmt) && !VIA_RELATION.test(stmt)) {
            bad.push(`${f}: ${stmt.slice(0, 80).replace(/\s+/g, ' ')}`);
          }
        }
      }
    }
    expect(bad, `这些地方直接拿人表的关系字段:\n${bad.join('\n')}`).toEqual([]);
  });

  it('⭐⭐ 行为:带关系的载荷进三个写入函数,人表 SQL 里都没有关系字段', () => {
    const OBS = '2026-10-16T00:00:00.000Z';
    const a = buildAuthorUpsert({ restId: '1', handle: 'h', iFollow: true, followsMe: true, observedAt: OBS }, undefined);
    expect(a.sql).not.toMatch(REL_FIELD);
    const r = buildPersonRefresh({ handle: 'h', restId: '1', following: true, followedBy: true } as never, OBS);
    expect(r.sql).not.toMatch(REL_FIELD);
    expect(PERSON_REFRESH_FIELDS.filter((f) => REL_FIELD.test(f))).toEqual([]);
    expect(USER_COLLECTED_FIELDS.filter((f) => REL_FIELD.test(f))).toEqual([]);
  });

  it('⭐⭐ 读关系的查询都从「人表 + 当前号的关系」查,并带上号', () => {
    const p = buildPeopleQuery('A', DEFAULT_PEOPLE_FILTER, 1, 0);
    const o = buildOverviewQuery('A');
    const s = buildOpsStatusQuery('A');
    for (const q of [p, o, s]) {
      expect(q.sql).toContain(PEOPLE_WITH_RELATION);
      expect(q.vars).toMatchObject({ acct: 'A' });
    }
    expect(PERSON_DETAIL_SQL).toContain(PERSON_WITH_RELATION);
    expect(() => buildPeopleQuery('', DEFAULT_PEOPLE_FILTER, 1, 0)).toThrow();
    expect(() => buildOverviewQuery('')).toThrow();
    expect(() => buildOpsStatusQuery('')).toThrow();
  });
});

describe('⭐⭐ 接线:写要认号,读要按号', () => {
  const IPC = read('src/modules/x/x-data-ipc.ts');
  /** 取一个 case 的处理体 —— 到下一个 case / default 为止;断言非空(记忆 feedback-guard-scope-to-the-branch) */
  const caseBody = (op: string): string => {
    const i = IPC.indexOf(`case '${op}':`);
    expect(i, `handler 缺 ${op}`).toBeGreaterThan(-1);
    const rest = IPC.slice(i + 6);
    const j = rest.search(/\n\s+case '|\n\s+default:/);
    const body = rest.slice(0, j);
    expect(body.length).toBeGreaterThan(40);
    return body;
  };

  it('写:saveUsers / saveTweets(作者)/ refreshPerson 都按采集网页认号', () => {
    /** 2026-10-24 三个都迁走:存人 / 存推文在 x-save-batch.ts,刷新资料在能力 x.person.refresh */
    void caseBody;
    expect(saveFnBody('saveUserBatch')).toMatch(/saveUsers\(records, ctx, await accountForWrite\(ctx\.wcId\)\)/);
    expect(saveFnBody('saveTweetBatch')).toMatch(/accountForWrite\(ctx\?\.wcId\)/);
    expect(capBlock('x.person.refresh')).toMatch(/refreshPerson\(rec, await accountForWrite\(i\.wcId\)\)/);
  });

  it('读:概览 / 列表 / 人卡 / 朋友圈 / 状态页都先拿这个 ws 的号,没有就明说', () => {
    /**
     * 2026-10-24 这五个迁到读库能力(x-capabilities-read.ts):认号在执行器的前提检查里(account: true),
     * 认出的号是 run 的第二个参数 a;号没认出三个入口都 refused 同一句话 —— 行为见 x-capabilities-read.test.ts
     */
    for (const op of ['peopleOverview', 'queryPeople', 'personDetail', 'friendCircle', 'opsStatus']) {
      const id = capOfOp(IPC, op);
      expect(id, `${op} 没迁到能力`).toBeDefined();
      const b = readCapBlock(id!);
      expect(b.length, id).toBeGreaterThan(40);
      expect(b, `${op} 没按号读`).toMatch(/account: true/);
      expect(b).toMatch(/a\.restId/);
    }
  });

  it('页面:采集落库与核对都把采集网页的 wcId 带上', () => {
    const CON = read('src/modules/x/XConsole.tsx');
    expect(CON).toMatch(/op: 'saveUsers', records: users, ctx: \{ listSource, wcId: wcId \?\? undefined \}/);
    expect(CON).toMatch(/searchRecipe: origin\?\.params\.q,[\s\S]{0,200}wcId: wcId \?\? undefined/);
    /** 2026-10-26 核对搬到主进程 x-person-act.ts:按读到它的那个网页认号 */
    expect(read('src/modules/x/x-person-act.ts')).toMatch(/await refreshPerson\(rec, await accountForWrite\(wcId\)\)/);
  });

  it('认号:脚本已注册、迁移已登记、运营顶栏真的挂了', () => {
    expect(read('src/modules/x/x-dom-scripts.ts')).toMatch(/id: X_SCRIPTS\.whoAmI,/);
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.27'[\s\S]{0,200}up: x_migration_1_2_27/);
    expect(read('src/storage/migrations/x-runner.ts')).toMatch(/version: '1\.2\.28'[\s\S]{0,200}up: x_migration_1_2_28/);
    expect(read('src/modules/x/XOpsView.tsx')).toMatch(/<XAccountBadge wsId=\{workspaceId\} onAccount=\{onAccount\} \/>/);
  });
});
