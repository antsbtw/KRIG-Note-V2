/**
 * tab-bar — videoBlock Tab 切换栏(L5-B3.19.a)
 *
 * 职责:渲染 Tab 按钮 + 切换 active 状态 + 暴露 actionBar 区供 actions/* 挂按钮。
 * **不管 panel 内容显示** — 由 node-view.ts 协调(订阅 onChange 切对应 panel 的 display)。
 *
 * 布局:
 *   <tab-bar>
 *     <tab buttons ...>
 *     <action-bar>            ← actions/* 挂这里
 *   </tab-bar>
 */

export interface TabDef {
  id: string;
  label: string;
}

export interface TabBar {
  el: HTMLElement;
  /** action 按钮挂载点(actions/* 子模块往这里 appendChild)*/
  actionBarEl: HTMLElement;
  addTabButton(tab: TabDef): void;
  removeTabButton(id: string): void;
  setActive(id: string): void;
  getActive(): string;
  /** 当前 active 变化时触发(用户点 / 程序调用)*/
  onChange(cb: (newId: string) => void): () => void;
  destroy(): void;
}

export function createTabBar(initialActive: string, initialTabs: TabDef[]): TabBar {
  const el = document.createElement('div');
  el.className = 'krig-video-block__tab-bar';

  // tabs 区(左)+ action 区(右)— 用 flex 排版
  const tabsZone = document.createElement('div');
  tabsZone.className = 'krig-video-block__tabs';
  el.appendChild(tabsZone);

  const actionBarEl = document.createElement('div');
  actionBarEl.className = 'krig-video-block__actions';
  el.appendChild(actionBarEl);

  let active = initialActive;
  const listeners = new Set<(id: string) => void>();
  const tabButtons = new Map<string, HTMLButtonElement>();

  function paintActive(): void {
    for (const [id, btn] of tabButtons) {
      btn.classList.toggle('krig-video-block__tab--active', id === active);
    }
  }

  function addTabButton(tab: TabDef): void {
    if (tabButtons.has(tab.id)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'krig-video-block__tab';
    btn.dataset.tabId = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (active === tab.id) return;
      active = tab.id;
      paintActive();
      listeners.forEach((cb) => cb(active));
    });
    tabButtons.set(tab.id, btn);
    tabsZone.appendChild(btn);
    paintActive();
  }

  function removeTabButton(id: string): void {
    const btn = tabButtons.get(id);
    if (!btn) return;
    btn.remove();
    tabButtons.delete(id);
    if (active === id) {
      // active 被删 → 退到第一个剩余 tab
      const first = tabButtons.keys().next();
      if (!first.done) {
        active = first.value;
        paintActive();
        listeners.forEach((cb) => cb(active));
      }
    }
  }

  for (const tab of initialTabs) addTabButton(tab);

  return {
    el,
    actionBarEl,
    addTabButton,
    removeTabButton,
    setActive(id) {
      if (!tabButtons.has(id) || active === id) return;
      active = id;
      paintActive();
      listeners.forEach((cb) => cb(active));
    },
    getActive() {
      return active;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      listeners.clear();
      tabButtons.clear();
      el.remove();
    },
  };
}
