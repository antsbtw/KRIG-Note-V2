/**
 * TocToolbarButton — toolbar 上的「目录」开关按钮(custom-render)
 *
 * 为什么是 custom-render 而非普通 icon 字符串:toolbar 的 icon 字段只吃 string,
 * 塞 emoji(📑)与同排的 lucide 线性图标(‹ › 箭头、≡ 汉堡)风格割裂、不美观。
 * 这里复用 krig-toolbar-button--plain 同款类(24×24 透明、currentColor),内嵌
 * lucide <List>,与导航箭头一致的细线单色观感。
 *
 * 点击 → 派发 note-view.toggle-toc(toggle tocToggleStore),与原 icon 按钮等价。
 */

import { List } from 'lucide-react';
import { commandRegistry } from '@slot/command-registry/command-registry';

export function TocToolbarButton() {
  return (
    <button
      type="button"
      data-toolbar-item="note-view.toggle-toc"
      className="krig-toolbar-button krig-toolbar-button--plain"
      onMouseDown={(e) => e.preventDefault()} // 不抢编辑器焦点
      onClick={() => commandRegistry.execute('note-view.toggle-toc')}
      title="目录"
      aria-label="目录"
    >
      {/* display:block 去掉 inline SVG 的 baseline 间隙,让图标在 flex 按钮里真正居中 */}
      <List size={16} style={{ display: 'block' }} />
    </button>
  );
}
