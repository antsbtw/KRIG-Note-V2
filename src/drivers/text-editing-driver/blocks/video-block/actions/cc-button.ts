/**
 * cc-button — CC 字幕开关按钮 + 语言 dropdown(L5-B3.19.a)
 *
 * 本段:dropdown 仅含 transcript / OFF 两项。
 * B3.19.b 加翻译语言后,通过 setLanguages 动态扩展(node-view 协调)。
 *
 * 触发 onStateChange 时,node-view 决定 subtitle-overlay 显隐 + 当前 cues 用哪份
 * (transcriptText 解析的 / 翻译解析的)。
 */

export interface CCState {
  enabled: boolean;
  /** 'transcript' | <translation lang code> */
  lang: string;
}

export interface CCButton {
  /** 整体挂点(包含 button + dropdown 浮层)— 挂到 actionBar */
  el: HTMLElement;
  /** 设置 dropdown 中可选的语言列表(transcript 永远第一项)*/
  setLanguages(langs: string[]): void;
  /** CC 状态变化(用户切语言 / OFF)*/
  onStateChange(cb: (state: CCState) => void): () => void;
  /** 主动设置状态(初次加载 / 程序控制)*/
  setState(state: CCState): void;
  destroy(): void;
}

export function createCCButton(initial: CCState = { enabled: false, lang: 'transcript' }): CCButton {
  const wrap = document.createElement('div');
  wrap.className = 'krig-video-block__cc-wrap';
  wrap.style.position = 'relative';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__action-btn';
  btn.title = 'Subtitles';
  wrap.appendChild(btn);

  const dropdown = document.createElement('div');
  dropdown.className = 'krig-video-block__dropdown';
  dropdown.style.display = 'none';
  wrap.appendChild(dropdown);

  let state: CCState = { ...initial };
  let languages: string[] = ['transcript'];
  const listeners = new Set<(s: CCState) => void>();

  function paintBtn(): void {
    btn.textContent = state.enabled ? 'CC✓' : 'CC';
  }

  function rebuildDropdown(): void {
    dropdown.innerHTML = '';
    for (const lang of languages) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'krig-video-block__dropdown-item';
      if (state.enabled && state.lang === lang) {
        item.classList.add('krig-video-block__dropdown-item--active');
      }
      item.textContent = lang === 'transcript' ? 'EN' : lang.toUpperCase();
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state = { enabled: true, lang };
        paintBtn();
        dropdown.style.display = 'none';
        listeners.forEach((cb) => cb(state));
      });
      dropdown.appendChild(item);
    }
    // OFF
    const offItem = document.createElement('button');
    offItem.type = 'button';
    offItem.className = 'krig-video-block__dropdown-item';
    if (!state.enabled) offItem.classList.add('krig-video-block__dropdown-item--active');
    offItem.textContent = 'OFF';
    offItem.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state = { ...state, enabled: false };
      paintBtn();
      dropdown.style.display = 'none';
      listeners.forEach((cb) => cb(state));
    });
    dropdown.appendChild(offItem);
  }

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    rebuildDropdown();
    dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
  });

  // 点 dropdown 外部关 dropdown
  const docMouseDown = (e: MouseEvent) => {
    if (dropdown.style.display === 'none') return;
    const target = e.target as Node;
    if (!wrap.contains(target)) {
      dropdown.style.display = 'none';
    }
  };
  document.addEventListener('mousedown', docMouseDown);

  paintBtn();

  return {
    el: wrap,
    setLanguages(langs) {
      languages = ['transcript', ...langs.filter((l) => l !== 'transcript')];
      // 若当前 lang 已不在列表,退到 transcript
      if (!languages.includes(state.lang)) {
        state = { ...state, lang: 'transcript' };
      }
      // dropdown 下次打开时重建
    },
    onStateChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    setState(s) {
      state = { ...s };
      paintBtn();
    },
    destroy() {
      document.removeEventListener('mousedown', docMouseDown);
      listeners.clear();
      wrap.remove();
    },
  };
}
