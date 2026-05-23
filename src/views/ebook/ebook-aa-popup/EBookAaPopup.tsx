/**
 * EBookAaPopup — view 内 toolbar Aa 按钮触发的 popup wrapper
 *
 * 包 capability 的 EpubAaPopup 组件,负责:
 * - 字号 / 主题 state 持有(初值从 localStorage 加载)
 * - 变化时:写 localStorage,save* 内部 notify 模块级订阅者(EBookView 监听后推 host)
 *
 * 注:fullscreen panel 内的 popup 不走此 wrapper(panel 自管 state 直接调 host)。
 */

import { useState, useCallback, useMemo } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookRenderingApi, EpubTheme, EpubAppearance } from '@capabilities/ebook-rendering/types';

export function EBookAaPopup(_props: PopupCloseProps) {
  const api = useMemo(
    () => requireCapabilityApi<EBookRenderingApi>('ebook-rendering'),
    [],
  );
  const InnerPopup = api.EpubAaPopup;
  const [{ fontSize, theme, appearance }, setSettings] = useState(
    () => api.loadEpubReadingSettings(),
  );

  const onFontSizeChange = useCallback((size: number) => {
    setSettings((s) => ({ ...s, fontSize: size }));
    api.saveEpubFontSize(size); // capability 内 notify → EBookView 监听后推 host
  }, [api]);

  const onThemeChange = useCallback((t: EpubTheme) => {
    setSettings((s) => ({ ...s, theme: t }));
    api.saveEpubTheme(t);
  }, [api]);

  const onAppearanceChange = useCallback((a: EpubAppearance) => {
    setSettings((s) => ({ ...s, appearance: a }));
    api.saveEpubAppearance(a);
  }, [api]);

  return (
    <InnerPopup
      fontSize={fontSize}
      theme={theme}
      appearance={appearance}
      onFontSizeChange={onFontSizeChange}
      onThemeChange={onThemeChange}
      onAppearanceChange={onAppearanceChange}
    />
  );
}
