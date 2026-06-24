/**
 * code-syntax-inject — 画板 code 块语法高亮 token 预注入(L5 一致性 2026-06-23)
 *
 * W5:atom-serializers(SVG 渲染层)纯净、不依赖 code-editing。语法高亮要 Lezer tokenize,
 * 只能在能用 capability 的层(canvas-rendering)做 → 本模块在渲染前调
 * `code-editing.tokenizeSync` 把 token 算好,塞进 `atom.attrs._syntaxTokens`(纯数据),
 * renderCodeBlock 只消费数据,不 import code-editing。
 *
 * 首渲语言未 load(对齐 note 插件策略):tokenizeSync 返空 → 本次纯色;同时
 * ensureLanguageLoaded,resolve 后回调 onLanguageReady(由 NodeRenderer 触发该节点重渲)→
 * 重渲时语言已 load → 高亮补上。
 */
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi } from '@capabilities/code-editing/types';
import type { Atom as SerializerAtom } from '../../../lib/atom-serializers/svg';

let codeApi: CodeEditingApi | null = null;
function getCodeApi(): CodeEditingApi | null {
  if (codeApi) return codeApi;
  try {
    codeApi = requireCapabilityApi<CodeEditingApi>('code-editing');
  } catch {
    codeApi = null; // code-editing 未注册(某些精简 view)→ 降级纯色,不崩
  }
  return codeApi;
}

/** 拼接 codeBlock 的源码(content text* 子节点)。 */
function codeText(atom: SerializerAtom): string {
  const kids = atom.content;
  if (!Array.isArray(kids)) return '';
  return kids
    .map((c) => (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
}

/**
 * 深拷贝 atoms,给每个 codeBlock 注入 _syntaxTokens(已 load 语言)。
 * 未 load 的语言:触发 ensureLanguageLoaded + onLanguageReady(去重 per lang)。
 *
 * @param onLanguageReady 某语言首次 load 完成回调(NodeRenderer 用它重渲本节点)
 */
export function injectCodeSyntaxTokens(
  atoms: SerializerAtom[],
  onLanguageReady: () => void,
): SerializerAtom[] {
  const api = getCodeApi();
  if (!api) return atoms;

  const pendingLangs = new Set<string>();

  const walk = (atom: SerializerAtom): SerializerAtom => {
    let next = atom;
    if (atom.type === 'codeBlock') {
      const lang = typeof atom.attrs?.language === 'string' ? atom.attrs.language : '';
      // mermaid 不走文本高亮(它有自己的图渲染);无 lang 也不高亮
      if (lang && lang !== 'mermaid') {
        if (api.isLanguageLoaded(lang)) {
          const source = codeText(atom);
          const tokens = api.tokenizeSync(lang, source);
          if (tokens.length > 0) {
            next = { ...atom, attrs: { ...atom.attrs, _syntaxTokens: tokens } };
          }
        } else {
          pendingLangs.add(lang);
        }
      }
    }
    // 递归子块(callout/blockquote/list/toggle 里可能嵌 codeBlock)
    if (Array.isArray(next.content) && next.content.length > 0) {
      const newContent = next.content.map((c) =>
        c && typeof c === 'object' && typeof (c as SerializerAtom).type === 'string'
          ? walk(c as SerializerAtom)
          : c,
      );
      next = { ...next, content: newContent };
    }
    return next;
  };

  const out = atoms.map(walk);

  // 未 load 的语言:异步预热,完成后回调重渲(每 lang 一次)
  for (const lang of pendingLangs) {
    void api.ensureLanguageLoaded(lang).finally(() => onLanguageReady());
  }

  return out;
}
