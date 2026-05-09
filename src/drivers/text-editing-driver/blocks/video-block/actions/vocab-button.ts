/**
 * vocab-button — 📖 Vocab Panel toggle 按钮(L5-B3.19.d)
 *
 * active 时显 📖✓,inactive 时显 📖。
 * 状态变化推 onToggle 回调,node-view 调 vocabPanel.show() / hide()。
 */

export interface VocabButton {
  el: HTMLButtonElement;
  setActive(active: boolean): void;
  destroy(): void;
}

export function createVocabButton(
  initialActive: boolean,
  onToggle: (active: boolean) => void,
): VocabButton {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'krig-video-block__action-btn';
  btn.title = 'Vocab panel';

  let active = initialActive;
  function paint(): void {
    btn.textContent = active ? '📖✓' : '📖';
  }
  paint();

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    active = !active;
    paint();
    onToggle(active);
  });

  return {
    el: btn,
    setActive(a) {
      if (active === a) return;
      active = a;
      paint();
    },
    destroy() {
      btn.remove();
    },
  };
}
