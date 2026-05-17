import type { LanguageItem } from '../types';

export const markdownLanguage: LanguageItem = {
  id: 'markdown',
  label: 'Markdown',
  loader: async () => {
    const { markdown } = await import('@codemirror/lang-markdown');
    return markdown();
  },
};
