import { nativeTheme, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

export function themeBgColor(dark: boolean): string {
  return dark ? '#1e1e1e' : '#f8fafc';
}

function broadcast(dark: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.NATIVE_THEME_CHANGED, { dark });
      win.setBackgroundColor(themeBgColor(dark));
    }
  }
}

export function registerNativeThemeHandler(): void {
  nativeTheme.on('updated', () => {
    broadcast(nativeTheme.shouldUseDarkColors);
  });
  ipcMain.handle(IPC_CHANNELS.NATIVE_THEME_GET, () => ({ dark: nativeTheme.shouldUseDarkColors }));
}

export function getNativeThemeDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}
