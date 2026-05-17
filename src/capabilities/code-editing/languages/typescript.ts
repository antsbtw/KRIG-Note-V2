import type { LanguageItem } from '../types';

export const typescriptLanguage: LanguageItem = {
  id: 'typescript',
  label: 'TypeScript',
  loader: async () => {
    // 走 @codemirror/lang-javascript 的 typescript:true 模式(官方推荐路径)
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: false, typescript: true });
  },
};
