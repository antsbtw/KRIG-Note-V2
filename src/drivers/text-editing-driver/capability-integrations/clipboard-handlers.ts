/**
 * clipboard 集成 — 模块级单例(应用启动注册一次,永不卸)
 *
 * 见 DESIGN.md v0.2.1 § 5.2(P1.2 修复:单例 handler + 实例路由)。
 *
 * L5-A:注册 PM JSON serializer + 'clipboard.copy' command(focus-aware 路由)。
 */

import { clipboard } from '@capabilities/clipboard';
import { selection } from '@capabilities/selection';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { instanceRegistry } from '../instance-registry';

const SOURCE_PREFIX = 'text-editing-driver:';

/**
 * 模块级单例注册(driver 模块加载时调一次)
 *
 * - serializer 通用(不绑实例)
 * - 'clipboard.copy' handler 单例(focus-aware 路由)
 */
export function setupClipboardIntegration(): void {
  // ── Serializer:PM doc → JSON 字符串(通用)──
  clipboard.registerSerializer({
    contentType: 'text-editing-driver.pm-doc',
    format: 'pm-json',
    serialize: (data: unknown) => {
      // data 是 PMNode toJSON() 的结果(driver 内部传)
      return JSON.stringify(data);
    },
  });

  // ── 'clipboard.copy' 模块级 handler(focus-aware)──
  commandRegistry.register('clipboard.copy', () => {
    const current = selection.api.getCurrent();
    if (!current?.source.startsWith(SOURCE_PREFIX)) {
      // 焦点不在本 driver,让位
      return;
    }

    // 解析实例 ID
    const instanceId = instanceRegistry.parseSource(current.source);
    if (!instanceId) return;

    const instance = instanceRegistry.get(instanceId);
    if (!instance) return; // 实例已 unmount

    // L5-A:走 PM 默认 copy(走 navigator.clipboard 写 plain + html)
    document.execCommand('copy');

    // emit copied 事件
    clipboard.emit('clipboard.copied', {
      source: current.source,
      envelopes: ['plain', 'html'],
      selectionKind: current.kind,
    });
  });

  // L5-B+ 加:'clipboard.paste' / 'clipboard.cut' 同款单例 handler
}
