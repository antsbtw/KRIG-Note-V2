/**
 * lang-dropdown — codeBlock 语言下拉菜单
 *
 * 自建 absolute DOM(参考 V1 src/plugins/note/blocks/code-block.ts:149-220),
 * 不走 popup-registry(过设计,V1 也是裸 DOM)。
 *
 * 列表来源:`requireCapabilityApi('code-editing').getLanguages()` 过滤掉 mermaid
 * (mermaid 是独立 NodeView,generic dropdown 不让切到),再 unshift Plain Text 置顶。
 *
 * 注意:
 * - dropdown 容器 mount 到 document.body(避免被 PM contentDOM 裁切 / z-index 抢)
 * - ignoreMutation 在 NodeView 侧已守门;dropdown DOM 不在 view.dom 内,不受影响
 * - 关闭路径:点击 dropdown 外、Esc、选项点击后,统一调 close()
 */
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi, LanguageItem } from '@capabilities/code-editing/types';

export interface LangChoice {
  /** PM attrs.language 写入值,'' 表示 plain text */
  id: string;
  /** 显示文案 */
  label: string;
}

const PLAIN_CHOICE: LangChoice = { id: '', label: 'Plain Text' };

/** 拉 generic codeBlock 可选语言列表:Plain Text 置顶 + capability 注册顺序(过滤 mermaid) */
export function getGenericLanguageChoices(): LangChoice[] {
  const langs: LanguageItem[] = requireCapabilityApi<CodeEditingApi>('code-editing').getLanguages();
  const choices: LangChoice[] = [PLAIN_CHOICE];
  for (const l of langs) {
    if (l.id === 'mermaid') continue; // generic NodeView 看不到 mermaid
    choices.push({ id: l.id, label: l.label });
  }
  return choices;
}

/** 当前 language id 在 choices 内的显示 label;不在则按 'language-X' 兜底 */
export function getLanguageLabel(language: string): string {
  if (!language) return PLAIN_CHOICE.label;
  const found = getGenericLanguageChoices().find((c) => c.id === language);
  return found?.label ?? language;
}

export interface LangDropdownOptions {
  /** 锚点元素 — dropdown 相对此元素定位(放在它右下角) */
  anchor: HTMLElement;
  /** 当前选中的 language id */
  currentId: string;
  /** 选中某项时回调,选完自动 close */
  onPick: (id: string) => void;
}

export interface LangDropdownHandle {
  close: () => void;
}

/**
 * 打开 lang dropdown — 返回 handle(close 显式关闭)
 *
 * 同一时刻全局只一个 dropdown:再次 open 前先 close 上一个(模块级单变量守门)。
 */
let currentDropdown: LangDropdownHandle | null = null;

export function openLangDropdown(opts: LangDropdownOptions): LangDropdownHandle {
  // 关上一个(防同时多开 / 重复点击)
  if (currentDropdown) {
    currentDropdown.close();
    currentDropdown = null;
  }

  const choices = getGenericLanguageChoices();

  const root = document.createElement('div');
  root.className = 'krig-code-lang-dropdown';
  root.setAttribute('contenteditable', 'false');
  // 定位:锚点 bottom-left 起点
  const r = opts.anchor.getBoundingClientRect();
  root.style.position = 'fixed';
  root.style.left = `${r.left}px`;
  root.style.top = `${r.bottom + 4}px`;
  root.style.zIndex = '9999';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'krig-code-lang-dropdown__search';
  search.placeholder = 'Search…';
  root.appendChild(search);

  const list = document.createElement('div');
  list.className = 'krig-code-lang-dropdown__list';
  root.appendChild(list);

  const renderList = (filter: string): void => {
    list.innerHTML = '';
    const q = filter.trim().toLowerCase();
    const visible = q
      ? choices.filter((c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      : choices;
    for (const c of visible) {
      const item = document.createElement('div');
      item.className = 'krig-code-lang-dropdown__item';
      if (c.id === opts.currentId) item.classList.add('krig-code-lang-dropdown__item--current');

      const check = document.createElement('span');
      check.className = 'krig-code-lang-dropdown__check';
      check.textContent = c.id === opts.currentId ? '✓' : '';
      item.appendChild(check);

      const label = document.createElement('span');
      label.className = 'krig-code-lang-dropdown__label';
      label.textContent = c.label;
      item.appendChild(label);

      // 用 mousedown(对齐 V1 / mermaid toolbar)避免 PM 抢 focus 让 dropdown 提前关
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onPick(c.id);
        handle.close();
      });
      list.appendChild(item);
    }
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'krig-code-lang-dropdown__empty';
      empty.textContent = 'No match';
      list.appendChild(empty);
    }
  };

  renderList('');

  search.addEventListener('input', () => renderList(search.value));

  // 点 dropdown 外关闭
  const onDocMouseDown = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) {
      handle.close();
    }
  };
  // Esc 关闭
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handle.close();
    }
  };

  // mousedown 比 click 早 — 用 mousedown,防止 dropdown 内 mousedown 触发 doc-level 监听过早关掉
  // 解法:用 mousedown 但延后挂一帧(避免本轮 open 的 mousedown 被 doc 监听到自己)
  //
  // **capture 阶段**(第三参 true):dropdown mount 在 body,但宿主可能在 stopPropagation
  // 的容器内(如画板编辑浮层 popup onMouseDown stopPropagation 防 InteractionController)——
  // bubble 阶段 doc 监听会被吞、菜单关不掉。capture 阶段 document 先收到,绕过 bubble 吞噬。
  // root.contains 守门保证点 dropdown 内不误关(note 无 stopPropagation,capture/bubble 行为一致)。
  document.body.appendChild(root);
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    search.focus();
  });

  const handle: LangDropdownHandle = {
    close: () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (currentDropdown === handle) currentDropdown = null;
    },
  };
  currentDropdown = handle;
  return handle;
}
