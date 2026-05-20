/**
 * mathInline NodeView — KaTeX 行内渲染 + 绝对定位编辑弹窗
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-inline.ts
 *
 * 渲染缓存:lastLatex 跳过未变化重新渲染
 * 编辑弹窗:input + live preview;Enter 保存 / Esc 取消 / 点外保存
 * LaTeX 速查面板:弹窗内 ? 按钮 → setLatexHelpContext + helpPanelController.toggle
 * (Insert 时插到 input 当前光标位 + 触发 preview 更新;切换 active 块时 context 自动覆盖)
 *
 * 砍 V1:syncThoughtMark(V2 没 thought mark 系统)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { helpPanelController } from '@slot/triggers/help-panel-controller';
import {
  setLatexHelpContext,
  clearLatexHelpContext,
  LATEX_HELP_PANEL_ID,
} from '../math-block/help-panel';

export const mathInlineNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  const dom = document.createElement('span');
  dom.classList.add('krig-math-inline');
  let lastLatex: string | null = null;

  function render(): void {
    const latex = (node.attrs.latex as string).trim();
    if (latex === lastLatex) return;
    lastLatex = latex;
    if (!latex) {
      dom.innerHTML = '';
      dom.classList.add('krig-math-inline--empty');
      dom.textContent = 'New equation';
    } else {
      dom.classList.remove('krig-math-inline--empty');
      try {
        dom.innerHTML = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          strict: false,
        });
      } catch {
        dom.textContent = latex;
      }
    }
  }

  render();

  // 双击编辑
  dom.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openEditor(node.attrs.latex as string);
  });

  // 空 latex 单击也可编辑(否则 atom 单击只选中)
  dom.addEventListener('click', (e) => {
    if (!(node.attrs.latex as string).trim()) {
      e.preventDefault();
      e.stopPropagation();
      openEditor(node.attrs.latex as string);
    }
  });

  function openEditor(currentLatex: string): void {
    // 移除已存在的编辑器(确保只一个 mathInline 在编辑)
    document.querySelector('.krig-math-inline-editor')?.remove();

    const editor = document.createElement('div');
    editor.classList.add('krig-math-inline-editor');

    // input 行:LaTeX 输入框 + ? 帮助按钮
    const inputRow = document.createElement('div');
    inputRow.classList.add('krig-math-inline-editor__input-row');

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('krig-math-inline-editor__input');
    input.value = currentLatex;
    input.placeholder = 'LaTeX: e.g. x^2 + y^2 = z^2';
    inputRow.appendChild(input);

    const helpBtn = document.createElement('button');
    helpBtn.classList.add('krig-math-inline-editor__help-btn');
    helpBtn.type = 'button';
    helpBtn.textContent = '?';
    helpBtn.title = 'LaTeX 参考';
    let helpPanelOpen = false;
    helpBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (helpPanelOpen) {
        helpPanelController.hide();
        helpPanelOpen = false;
        helpBtn.classList.remove('is-active');
      } else {
        setLatexHelpContext({ insertFn: insertAtCursor });
        helpPanelController.show(LATEX_HELP_PANEL_ID);
        helpPanelOpen = true;
        helpBtn.classList.add('is-active');
      }
    });
    inputRow.appendChild(helpBtn);
    editor.appendChild(inputRow);

    const previewEl = document.createElement('div');
    previewEl.classList.add('krig-math-inline-editor__preview');
    editor.appendChild(previewEl);

    /** help 面板 Insert → 把 LaTeX 插到 input 当前光标位并更新 preview */
    function insertAtCursor(latex: string): void {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      input.value = before + latex + after;
      const caret = start + latex.length;
      input.setSelectionRange(caret, caret);
      input.focus();
      updatePreview(input.value);
    }

    // 绝对定位在行内元素下方
    const rect = dom.getBoundingClientRect();
    editor.style.top = `${rect.bottom + 4}px`;
    editor.style.left = `${Math.max(8, rect.left - 40)}px`;
    document.body.appendChild(editor);

    function updatePreview(latex: string): void {
      const t = latex.trim();
      if (!t) {
        previewEl.innerHTML =
          '<span class="krig-math-inline-editor__hint">Preview will appear here</span>';
        return;
      }
      try {
        katex.render(t, previewEl, {
          throwOnError: false,
          displayMode: true,
          strict: false,
        });
      } catch {
        previewEl.innerHTML =
          '<span class="krig-math-inline-editor__hint">Invalid LaTeX</span>';
      }
    }

    updatePreview(currentLatex);

    input.addEventListener('input', () => {
      updatePreview(input.value);
    });

    /** 收尾:关 help panel + 清 context(无论 save / cancel / 点外) */
    function cleanupHelp(): void {
      if (helpPanelOpen) {
        helpPanelController.hide();
        helpPanelOpen = false;
      }
      clearLatexHelpContext();
    }

    function save(): void {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, { latex: input.value }),
        );
      }
      cleanupHelp();
      editor.remove();
      view.focus();
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        save();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cleanupHelp();
        editor.remove();
        view.focus();
      }
    });

    // 点外部保存(点 help panel 内不算外部 — 否则点 Insert 立即触发保存)
    const closeOnClick = (ev: MouseEvent): void => {
      const target = ev.target as Node;
      if (editor.contains(target) || target === dom) return;
      if (
        target instanceof HTMLElement &&
        target.closest('.krig-help-panel')
      ) return;
      save();
      document.removeEventListener('mousedown', closeOnClick);
    };
    setTimeout(() => {
      document.addEventListener('mousedown', closeOnClick);
    }, 10);

    input.focus();
    input.select();
  }

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathInline') return false;
      node = updatedNode;
      render();
      return true;
    },
    stopEvent() {
      return false;
    },
    ignoreMutation() {
      return true;
    },
  };
};
