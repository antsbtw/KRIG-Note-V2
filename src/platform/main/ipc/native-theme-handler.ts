import { nativeTheme, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

function broadcast(dark: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.NATIVE_THEME_CHANGED, { dark });
    }
  }
}

export function registerNativeThemeHandler(): void {
  nativeTheme.on('updated', () => {
    broadcast(nativeTheme.shouldUseDarkColors);
  });
}

export function getNativeThemeDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}
