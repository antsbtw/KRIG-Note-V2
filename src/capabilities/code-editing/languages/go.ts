import type { LanguageItem } from '../types';

export const goLanguage: LanguageItem = {
  id: 'go',
  label: 'Go',
  loader: async () => {
    const { go } = await import('@codemirror/lang-go');
    return go();
  },
};
