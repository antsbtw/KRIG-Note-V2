import type { LanguageItem } from '../types';

export const javascriptLanguage: LanguageItem = {
  id: 'javascript',
  label: 'JavaScript',
  loader: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: false, typescript: false });
  },
};
