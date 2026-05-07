/**
 * mathInline NodeView — KaTeX 行内渲染 + 绝对定位编辑弹窗
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-inline.ts
 *
 * 渲染缓存:lastLatex 跳过未变化重新渲染
 * 编辑弹窗:input + live preview;Enter 保存 / Esc 取消 / 点外保存
 *
 * 砍 V1:syncThoughtMark(V2 没 thought mark 系统)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import katex from 'katex';
import 'katex/dist/katex.min.css';

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

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('krig-math-inline-editor__input');
    input.value = currentLatex;
    input.placeholder = 'LaTeX: e.g. x^2 + y^2 = z^2';
    editor.appendChild(input);

    const previewEl = document.createElement('div');
    previewEl.classList.add('krig-math-inline-editor__preview');
    editor.appendChild(previewEl);

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

    function save(): void {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, { latex: input.value }),
        );
      }
      editor.remove();
      view.focus();
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        save();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        editor.remove();
        view.focus();
      }
    });

    // 点外部保存
    const closeOnClick = (ev: MouseEvent): void => {
      const target = ev.target as Node;
      if (editor.contains(target) || target === dom) return;
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
