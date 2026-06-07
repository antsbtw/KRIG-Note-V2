import type { LanguageItem } from '../types';

export const yamlLanguage: LanguageItem = {
  id: 'yaml',
  label: 'YAML',
  loader: async () => {
    const { yaml } = await import('@codemirror/lang-yaml');
    return yaml();
  },
};

/**
 * yml 别名 — markdown / 用户常写 ` ```yml `(而非 yaml)。registry 是精确 id 匹配无别名,
 * 故额外注册一个 id='yml' 指向同一 loader,两种 fence 写法都能高亮。
 */
export const ymlLanguage: LanguageItem = {
  id: 'yml',
  label: 'YAML (yml)',
  loader: async () => {
    const { yaml } = await import('@codemirror/lang-yaml');
    return yaml();
  },
};
