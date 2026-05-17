import type { LanguageItem } from '../types';

export const jsonLanguage: LanguageItem = {
  id: 'json',
  label: 'JSON',
  loader: async () => {
    const { json } = await import('@codemirror/lang-json');
    return json();
  },
};
