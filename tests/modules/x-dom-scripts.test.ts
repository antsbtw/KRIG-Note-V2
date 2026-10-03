/**
 * X 的 DOM 补全脚本 —— ⭐ **真 eval 一遍**,不只检查字符串
 *
 * ⚠️⚠️ `project-x-inject-template-escape`:模板字面量里写 `\/` 被求值吃掉 →
 * 浏览器收到非法正则 → 整段解析失败 → **采集恒 0,而 tsc 与单测全绿**。
 * 那一天就那么过去了 —— 所以这里必须真的跑。
 */

import { describe, it, expect, vi } from 'vitest';
import { X_DOM_SCRIPTS, X_SCRIPTS } from '@modules/x/x-dom-scripts';

const script = (): string => {
  const s = X_DOM_SCRIPTS.find((x) => x.id === X_SCRIPTS.expandAll);
  if (!s) throw new Error('expandAll 脚本没注册');
  return s.build({});
};

/** 造一个最小的 DOM —— ⚠️ 只实现脚本真正用到的那几个口 */
function makeDoc(articles: Array<{
  id?: string;
  text?: string;
  showMoreTestId?: boolean;
  showMoreLabel?: string;
  /** ⚠️ 外链伪装成按钮 —— 点了会导航走,必须被排除 */
  linkLabel?: string;
}>) {
  const clicks: string[] = [];
  const mk = (a: typeof articles[number]) => {
    const btns: Array<Record<string, unknown>> = [];
    if (a.showMoreTestId) {
      btns.push({
        tagName: 'BUTTON', textContent: 'Show more',
        closest: () => null,
        click: () => clicks.push('testid'),
        __testid: true,
      });
    }
    if (a.showMoreLabel) {
      btns.push({
        tagName: 'BUTTON', textContent: a.showMoreLabel,
        closest: () => null,
        click: () => clicks.push(`label:${a.showMoreLabel}`),
      });
    }
    if (a.linkLabel) {
      btns.push({
        tagName: 'A', textContent: a.linkLabel,
        closest: () => ({}),          // ⚠️ 它在 <a> 里
        click: () => clicks.push('LINK!'),
      });
    }
    return {
      querySelectorAll: (sel: string) => {
        if (sel.includes('tweet-text-show-more-link')) {
          return btns.filter((b) => b.__testid);
        }
        if (sel.includes('/status/')) {
          return a.id ? [{ getAttribute: () => `/someone/status/${a.id}` }] : [];
        }
        if (sel.includes('button')) return btns;
        return [];
      },
      querySelector: (sel: string) => (sel.includes('tweetText') && a.text
        ? { innerText: a.text, textContent: a.text } : null),
    };
  };
  const doc = {
    querySelectorAll: (sel: string) => (sel.includes('article') ? articles.map(mk) : []),
  };
  return { doc, clicks };
}

function run(src: string, doc: unknown): { expanded: number; tweets: Array<{ id: string; text: string }> } {
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', `return ${src}`);
  return fn(doc) as { expanded: number; tweets: Array<{ id: string; text: string }> };
}

describe('⭐⭐⭐ 脚本必须是合法 JS 且真能跑', () => {
  it('⭐⭐⭐ eval 不抛 —— `inject-template-escape` 唯一能挡住的测试', () => {
    const { doc } = makeDoc([{ id: '1', text: 'hi' }]);
    expect(() => run(script(), doc), '脚本求值抛异常 —— 浏览器里同样整段失效').not.toThrow();
  });

  it('⚠️ 脚本里没有模板字面量(反引号会与页面代码打架)', () => {
    expect(script(), '脚本体里有反引号').not.toContain('`');
  });

  it('⚠️ 脚本**无参数** —— 连拼串的机会都没有', () => {
    const s = X_DOM_SCRIPTS.find((x) => x.id === X_SCRIPTS.expandAll)!;
    // ⭐ 给任何参数都返回同一份脚本 → 运行时值不可能被拼进去
    expect(s.build({ evil: '"; window.x=1; "' } as never)).toBe(s.build({}));
  });
});

describe('⭐⭐ 点开折叠的推文', () => {
  it('⭐ 有 testid 按钮 → 点它(最稳的那条路)', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: '全文', showMoreTestId: true }]);
    const r = run(script(), doc);
    expect(r.expanded, '没点开').toBe(1);
    expect(clicks).toEqual(['testid']);
  });

  it('⭐ 没 testid → 按文案兜底', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: 'x', showMoreLabel: '显示更多' }]);
    const r = run(script(), doc);
    expect(r.expanded).toBe(1);
    expect(clicks).toEqual(['label:显示更多']);
  });

  it('⭐ 多语言文案都认', () => {
    for (const label of ['Show more', '显示更多', 'さらに表示', '더 보기', 'Показать ещё']) {
      const { doc, clicks } = makeDoc([{ id: '1', text: 'x', showMoreLabel: label }]);
      run(script(), doc);
      expect(clicks, `「${label}」没认出来`).toHaveLength(1);
    }
  });

  it('⭐⭐⭐ **绝不点 <a>** —— 那是外链,点了会离开页面', () => {
    /**
     * ⚠️⚠️ 旧实现专门记着这条。点错了的后果不是「少采一条」,
     * 而是**整个页面导航走**,这一轮采集全废。
     */
    const { doc, clicks } = makeDoc([{ id: '1', text: 'x', linkLabel: 'Show more' }]);
    run(script(), doc);
    expect(clicks, '点了 <a> —— 页面会导航走,整轮采集作废').not.toContain('LINK!');
    expect(clicks).toHaveLength(0);
  });

  it('⭐ 本来就是全的 → expanded 0,不乱点', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: '短推' }]);
    expect(run(script(), doc).expanded).toBe(0);
    expect(clicks).toHaveLength(0);
  });

  it('⭐ 有 testid 时**不再走兜底** —— 否则同一条点两次', () => {
    const { doc, clicks } = makeDoc([
      { id: '1', text: 'x', showMoreTestId: true, showMoreLabel: 'Show more' },
    ]);
    run(script(), doc);
    expect(clicks, '点了两次 —— 兜底没被跳过').toEqual(['testid']);
  });
});

describe('⭐⭐ 回读正文', () => {
  it('⭐⭐ 回读**全部**推文,不只展开的那些', () => {
    /**
     * ⚠️ 点击是异步的,点完立刻读未必拿到新文本。
     * ⭐ 回读全部 + 调用方按「只许变长」合并,就不依赖时序了。
     */
    const { doc } = makeDoc([
      { id: '1', text: '甲', showMoreTestId: true },
      { id: '2', text: '乙' },
      { id: '3', text: '丙' },
    ]);
    const r = run(script(), doc);
    expect(r.tweets, '只回读了展开的那条 —— 合并时会依赖点击时序').toHaveLength(3);
    expect(r.tweets.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('⭐ id 从 /status/ 链接取', () => {
    const { doc } = makeDoc([{ id: '2106207038376181933', text: '正文' }]);
    expect(run(script(), doc).tweets[0].id).toBe('2106207038376181933');
  });

  it('⚠️ 没 id 或没正文的条目**不进结果** —— 空壳没有用', () => {
    const { doc } = makeDoc([
      { text: '有正文没 id' },
      { id: '9' },
      { id: '10', text: '两样都有' },
    ]);
    const r = run(script(), doc);
    expect(r.tweets, '空壳进了结果').toHaveLength(1);
    expect(r.tweets[0].id).toBe('10');
  });

  it('⚠️ 单条出错不影响其余 —— 一条坏不许整页作废', () => {
    const { doc } = makeDoc([{ id: '1', text: 'a' }, { id: '2', text: 'b' }]);
    // 让第一条的 querySelector 抛
    const arts = (doc.querySelectorAll('article') as Array<Record<string, unknown>>);
    void arts;
    const broken = {
      querySelectorAll: (sel: string) => {
        if (!sel.includes('article')) return [];
        return [
          { querySelectorAll: () => { throw new Error('boom'); }, querySelector: () => null },
          ...(doc.querySelectorAll('article') as unknown[]),
        ];
      },
    };
    const r = run(script(), broken);
    expect(r.tweets.length, '一条坏就整页作废了').toBeGreaterThanOrEqual(2);
  });
});
