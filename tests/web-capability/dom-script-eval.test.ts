/**
 * ⭐⭐ 求值守卫 —— 全部预注册脚本求值后必须是合法 JS(`07` §2.3 #1)
 *
 * ── 要治的病(`project-x-inject-template-escape`,采集停摆一整天)──
 *
 * 模板字面量里写 `/^\/([A-Za-z0-9_]{1,15})$/`,求值时 `\/` 被吃掉,
 * 浏览器实际收到 `/^/(...)$/` —— 正则在 `/^/` 就结束,后面是语法错误,
 * **整段脚本解析失败**,`executeJavaScript` 每次都抛,`fetched` 恒为 0。
 *
 * ⚠️ 特征:**tsc 通过、单测通过、看源码也没问题** ——
 * 源码里那个正则是对的,错的是**求值之后**的样子。
 * 所以必须**真的求值一次再 parse**,这是 tsc 覆盖不到的盲区(`07` §0.2 陷阱 2)。
 *
 * ⭐ 与现有 `tests/x/inject-script-evaluates.test.ts` 的区别:
 * 那条只覆盖**出过事的那一处**;本文件遍历 `registry.list()`,
 * **新注册的脚本自动纳入** —— 不需要谁记得来加一条。
 */
import { describe, it, expect } from 'vitest';
import { ScriptRegistry } from '@platform/main/web-capability/dom';
import { registerAIScripts, AI_SCRIPTS, AI_SCRIPT_DEFINITIONS } from '@platform/main/web-capability/dom';

/** 每个脚本的代表性参数(带参的必须给,否则 build 会抛) */
const SAMPLE_PARAMS: Record<string, Record<string, unknown>> = {
  [AI_SCRIPTS.sseCapture]: { serviceId: 'claude', endpointPattern: '/api/organizations' },
  [AI_SCRIPTS.chatgptFetchConversation]: { conversationId: '0191aaaa-bbbb-cccc-dddd-eeeeffff0000' },
  [AI_SCRIPTS.chatgptReadCache]: { urlSubstring: '/backend-api/conversation', mode: 'latest' },
};

function registry(): ScriptRegistry {
  const r = new ScriptRegistry();
  registerAIScripts(r);
  return r;
}

describe('⭐⭐ 全部预注册脚本:求值后是合法 JS', () => {
  const r = registry();
  const all = r.list();

  it('注册表非空(否则下面的遍历是空转的)', () => {
    // ⚠️ 自检:若注册表空了,下面的 it.each 一条都不跑却"全绿"
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBe(AI_SCRIPT_DEFINITIONS.length);
  });

  for (const script of all) {
    it(`⭐ ${script.id} 求值后能被 JS 引擎解析`, () => {
      const built = r.build(script.id, SAMPLE_PARAMS[script.id] ?? {});
      expect(built.status, `构建失败: ${built.status === 'failed' ? built.reason : ''}`).toBe('ok');
      if (built.status !== 'ok') throw new Error('unreachable');

      // ⭐ 真 parse —— 这是 tsc 覆盖不到的那一步
      expect(
        () => new Function(`return (${built.value});`),
        `${script.id} 求值后不是合法 JS(转义被吃掉?)`,
      ).not.toThrow();
    });

    it(`${script.id} 有非空 purpose(出问题时的第一条线索)`, () => {
      expect(script.purpose.trim().length).toBeGreaterThan(0);
    });
  }
});

describe('⭐ 参数必须走 JSON.stringify —— 不许拼进脚本文本', () => {
  it('⭐⭐ 含引号/反斜杠/换行的参数不会破坏脚本结构', () => {
    // 这是转义事故的同族攻击面:参数里带特殊字符,若直接拼进文本就会截断脚本。
    // JSON.stringify 后作为绑定值则安全。
    const r = registry();
    const nasty = `'; alert(1); var x='` + '\\' + '\n"quoted"';
    const built = r.build(AI_SCRIPTS.chatgptReadCache, { urlSubstring: nasty, mode: 'latest' });
    expect(built.status).toBe('ok');
    if (built.status !== 'ok') throw new Error('unreachable');

    // 仍然是合法 JS —— 没被参数截断
    expect(() => new Function(`return (${built.value});`)).not.toThrow();
    // 且参数是以**字面量**形式出现的(JSON.stringify 的结果),不是裸拼
    expect(built.value).toContain(JSON.stringify(nasty));
  });

  it('⭐ conversationId 同样安全', () => {
    const r = registry();
    const nasty = `abc'); fetch('//evil'); ('`;
    const built = r.build(AI_SCRIPTS.chatgptFetchConversation, { conversationId: nasty });
    if (built.status !== 'ok') throw new Error('构建应成功');
    expect(() => new Function(`return (${built.value});`)).not.toThrow();
    expect(built.value).toContain(JSON.stringify(nasty));
  });

  it('⭐ 源码里的参数插值一律 JSON.stringify(扫 inject-scripts)', () => {
    // 行为测试只能覆盖我想到的参数;这条扫源码,守住「将来新加的插值也得这么写」
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dir = path.join(process.cwd(), 'src/platform/main/ai/inject-scripts');
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n: string) => n.endsWith('.ts'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // 找模板字面量里的 ${...},要求内容含 JSON.stringify
      for (const m of code.matchAll(/\$\{([^}]*)\}/g)) {
        const expr = m[1];
        if (!expr.includes('JSON.stringify')) offenders.push(`${f}: \${${expr}}`);
      }
    }
    expect(offenders, '注入脚本的参数插值必须走 JSON.stringify(防转义事故)').toEqual([]);
  });
});

describe('⭐ run 只认 id,不认脚本字符串', () => {
  it('未注册的 id 返回 Failed,**不返回空串**', () => {
    // 空串会被 executeJavaScript 当合法脚本执行(返回 undefined),
    // 于是「脚本没注册」表现为「执行了但没效果」—— 又一次静默失聪
    const r = registry();
    const res = r.build('ai.does-not-exist' as never);
    expect(res.status).toBe('failed');
    if (res.status !== 'failed') throw new Error('unreachable');
    // 失败信息要能自救:列出可用 id
    expect(res.reason).toContain('未注册');
    expect(res.reason).toContain('ai.sse-capture');
  });

  it('缺必填参数时返回 Failed(不静默用默认值)', () => {
    const r = registry();
    const res = r.build(AI_SCRIPTS.chatgptFetchConversation, {});
    expect(res.status).toBe('failed');
    if (res.status !== 'failed') throw new Error('unreachable');
    expect(res.reason).toContain('conversationId');
  });

  it('非法 mode 被拒(枚举值不许漏网)', () => {
    const r = registry();
    const res = r.build(AI_SCRIPTS.chatgptReadCache, { urlSubstring: '/x', mode: 'newest' });
    expect(res.status).toBe('failed');
  });

  it('重复注册直接抛(静默覆盖会让「脚本怎么变了」无从排查)', () => {
    const r = registry();
    expect(() => registerAIScripts(r)).toThrow(/重复注册/);
  });

  it('purpose 为空拒绝注册', () => {
    const r = new ScriptRegistry();
    expect(() => r.register({
      id: 'x' as never, purpose: '  ', build: () => 'void 0',
    })).toThrow(/purpose/);
  });
});
