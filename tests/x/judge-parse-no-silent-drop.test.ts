/**
 * 守卫:模型返回的 JSON 结构不合预期时,**必须报错,绝不静默丢整批**。
 *
 * 起因(2026-09-04 离线评测实测):80 条评测集只回来 70 条,
 * 整整一批 10 条无声无息地没了。
 *
 * 根因:parseVerdicts 取「第一个 key 的值」——
 *   `parsed[Object.keys(parsed)[0]] ?? []`
 * 外层 key 不是数组(`{"results":{...}}`)、或数组不在第一个 key 上
 * (`{"count":10,"results":[...]}`,JS 对象 key 顺序不保证)时,
 * 它返回**空数组而不是抛错** → 整批推文被当成「模型没返回」全部回退 pending
 * → `judged=0` → drain 把它当成「pending 清空」直接 break。
 * 现象:积压明明还在,drain 却显示正常结束(又一次「看着成功实际没做」)。
 *
 * 自动回复场景后果更重:判断丢一批只是漏几条待处理;
 * 回复丢一批 = 该回的没回,而面板显示一切正常。
 *
 * ⚠️ 本文件测的是**真实行为**(直接喂畸形 JSON 看会不会抛),
 * 不是源码文本匹配 —— 后者在函数被掏空时仍会全绿(见 feedback-verify-guard-can-fail)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../../src/platform/main/x/x-ai-judge.ts');
const src = readFileSync(SRC, 'utf-8');

/**
 * parseVerdicts / extractItems 未导出(内部函数),且模块顶层 import 了
 * Electron 侧依赖,不能直接 import。这里把 extractItems 的源码抠出来单独求值,
 * 测的仍是**生产源码本身**,改坏了这里立刻红。
 */
function loadExtractItems(): (parsed: unknown) => unknown[] {
  const start = src.indexOf('function extractItems');
  expect(start, 'extractItems 不见了 —— 抽取逻辑被改名或删除,守卫失效').toBeGreaterThan(-1);
  // 截到函数结尾(下一个顶层 `\n}` 后)
  const end = src.indexOf('\n}', src.indexOf('throw new Error', start));
  const ts = src.slice(start, end + 2);
  // 抠出来的是 TS,`new Function` 不认类型标注。用 esbuild(vitest 自带)转译,
  // 而不是自己写正则剥离 —— 正则会绑死在某一种签名形态上,
  // 生产代码一重构测试就崩在加载阶段,报成 SyntaxError,
  // 那是「守卫自己坏了」而非「被测逻辑错了」,极易被误读成要去改生产代码。
  let js: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    js = (require('esbuild') as typeof import('esbuild'))
      .transformSync(ts, { loader: 'ts', format: 'cjs' }).code;
  } catch (e) {
    throw new Error(
      `守卫自身失效:extractItems 源码转译不了(${(e as Error).message})。`
      + '请修测试的转译逻辑,不要因为它变红就去改生产代码。',
    );
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return extractItems;`)() as (p: unknown) => unknown[];
}

const extractItems = loadExtractItems();

const VERDICT = { tweetId: '123', worth: true, confidence: 0.9 };

describe('模型返回结构异常时不静默丢批', () => {
  it('顶层就是数组 —— 正常取到', () => {
    expect(extractItems([VERDICT])).toHaveLength(1);
  });

  it('数组包在对象里(Gemma json_object 模式常见)—— 正常取到', () => {
    expect(extractItems({ results: [VERDICT] })).toHaveLength(1);
    expect(extractItems({ tweets: [VERDICT] })).toHaveLength(1);
  });

  it('⭐ 数组不在第一个 key 上 —— 必须仍能取到(旧写法在这里返回空数组)', () => {
    // 旧写法 parsed[Object.keys(parsed)[0]] 取到的是 10(不是数组)→ ?? [] → 空
    const got = extractItems({ count: 10, results: [VERDICT] });
    expect(got, 'key 顺序不保证,不能只认第一个 key').toHaveLength(1);
  });

  it('⭐ 优先取「像判断结果」的数组,不被无关数组带偏', () => {
    // 无关数组排在前面时,不能取错
    const got = extractItems({ tags: ['a', 'b'], results: [VERDICT] }) as Array<Record<string, unknown>>;
    expect(got).toHaveLength(1);
    expect(got[0].tweetId, '取到了 tags 而不是判断结果').toBe('123');
  });

  it('⭐ 压根没有数组 —— 必须 throw,绝不返回空数组当成「空批」', () => {
    // 这是最关键的一条:静默返回 [] 会让整批推文被误判成「模型没返回」
    expect(() => extractItems({ results: { notAnArray: true } })).toThrow();
    expect(() => extractItems({ error: 'model overloaded' })).toThrow();
    expect(() => extractItems('some plain string')).toThrow();
    expect(() => extractItems(null)).toThrow();
  });

  it('报错信息里要带上实际 key,否则线上无从定位', () => {
    expect(() => extractItems({ unexpectedKey: 'x' })).toThrow(/unexpectedKey/);
  });
});

describe('drain 不把「丢批」当成「队列清空」', () => {
  it('⭐ JudgeBatchResult 必须能区分「没取到」和「取到没判成」', () => {
    expect(
      /fetched:\s*number/.test(src),
      'judged===0 有两种成因(队列空 / 整批丢),不区分就会把丢批当成清空',
    ).toBe(true);
  });

  it('⭐ drain 的正常出口只能是 fetched===0(队列真空)', () => {
    const drain = src.slice(src.indexOf('export function startJudgeDrain'));
    expect(
      /if \(r\.fetched === 0\) break/.test(drain),
      'drain 仍按 judged===0 收工 —— 整批解析失败会被当成积压清完',
    ).toBe(true);
    // judged===0 这条路必须计入失败,而不是 break
    const judgedZero = drain.slice(drain.indexOf('r.judged === 0'));
    expect(
      judgedZero.slice(0, 400).includes('consecutiveFailures'),
      'judged===0(取到却没判成)必须计入连续失败,不能悄悄跳过',
    ).toBe(true);
  });
});
