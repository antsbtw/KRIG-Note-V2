import type { LanguageItem } from '../types';

export const pythonLanguage: LanguageItem = {
  id: 'python',
  label: 'Python',
  loader: async () => {
    const { python } = await import('@codemirror/lang-python');
    return python();
  },
};
