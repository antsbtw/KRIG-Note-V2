/**
 * 守卫:注入浏览器的脚本,**求值后**必须是合法 JS。
 *
 * 起因(2026-09-07,采集停摆一整天):
 * 我在 extract-script.ts 的模板字面量里写了 `/^\/([A-Za-z0-9_]{1,15})$/`。
 * 那一段整体是**模板字面量**,`\/` 在求值时被吃掉,浏览器实际收到:
 *     var rm = rh.match(/^/([A-Za-z0-9_]{1,15})$/);
 * —— 正则在 `/^/` 就结束了,后面是语法错误,**整个脚本解析失败**。
 * 于是 `executeJavaScript` 每次都抛,`fetched` 恒为 0。
 *
 * 更糟的是日志把真因盖住了:catch 里写着「注入失败(多半撞上导航)」——
 * 一句**猜测**被当成了结论,连续报了一整天没人怀疑。
 *
 * ⚠️ 这类 bug 的特征:**TypeScript 编译通过、单测通过、看代码也没问题**,
 * 因为源码里那个正则是对的 —— 错的是**求值之后**的样子。
 * 所以必须真的求值一次再检查,这是 tsc 覆盖不到的盲区。
 *
 * 同文件 line 79 的 `\\/status\\/` 是正确写法(双反斜杠),可作对照。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 把源码里的模板字面量真正求值,得到浏览器实际收到的字符串 */
function evaluateTemplate(filePath: string, exportName: string): string {
  const src = readFileSync(filePath, 'utf-8');
  const i = src.indexOf(`export const ${exportName}`);
  expect(i, `找不到 ${exportName}`).toBeGreaterThan(-1);
  const start = src.indexOf('`', i);
  const end = src.indexOf('`;', start);
  expect(end, `${exportName} 的模板字面量没有正常结束`).toBeGreaterThan(start);
  const literal = src.slice(start, end + 1);
  // eslint-disable-next-line no-eval
  return eval(literal) as string;
}

const EXTRACT = resolve(__dirname, '../../src/platform/main/tweet-fetcher/extract-script.ts');

describe('注入脚本求值后必须是合法 JS', () => {
  it('⭐ TWEET_SCRAPE_FN_BODY 求值后能解析', () => {
    // 这是采集链路的命脉:它挂了,fetched 恒为 0 且**不报错**
    const body = evaluateTemplate(EXTRACT, 'TWEET_SCRAPE_FN_BODY');
    expect(() => new Function(`${body}; return scrapeTweetArticle;`)).not.toThrow();
  });

  it('⭐ 完整注入脚本(含外层包装)求值后能解析', () => {
    // x-timeline-scan 实际注入的是包了一层的版本,要按那个形态测
    const body = evaluateTemplate(EXTRACT, 'TWEET_SCRAPE_FN_BODY');
    const full = `
      (function() {
        ${body}
        try {
          var articles = document.querySelectorAll('article[data-testid="tweet"]');
          var results = [];
          for (var i = 0; i < articles.length; i++) {
            try { results.push(scrapeTweetArticle(articles[i])); } catch(e) {}
          }
          return results;
        } catch(e) { return []; }
      })()
    `;
    expect(() => new Function(`return ${full}`)).not.toThrow();
  });

  it('⭐ 求值后不得出现被吃掉转义的坏正则', () => {
    // 特征:`/^/` —— 正则刚开头就被一个裸斜杠终止
    const body = evaluateTemplate(EXTRACT, 'TWEET_SCRAPE_FN_BODY');
    const bad = body.split('\n').filter((l) => /match\(\/\^\//.test(l));
    expect(
      bad,
      `这些行的转义被模板字面量吃掉了(应写 \\\\/ 而非 \\/):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('⭐ 拿真实结构的 article 跑一遍不抛', () => {
    // 语法对不代表跑得动 —— 造个带回复行的元素走一遍主要分支
    const body = evaluateTemplate(EXTRACT, 'TWEET_SCRAPE_FN_BODY');
    const fn = new Function(`${body}; return scrapeTweetArticle;`)() as (a: unknown) => unknown;
    const mkEl = (text: string, href?: string) => ({
      textContent: text, innerText: text,
      getAttribute: () => href ?? null,
      querySelector: (s: string) => (s.startsWith('a[href^=') && href ? mkEl('', href) : null),
      querySelectorAll: () => [],
      closest: () => null,
    });
    const article = {
      textContent: '', innerText: '',
      getAttribute: () => null,
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: (sel: string) =>
        sel === 'div[dir]' ? [mkEl('Replying to @someone', '/someone')] : [],
    };
    expect(() => fn(article)).not.toThrow();
  });
});
