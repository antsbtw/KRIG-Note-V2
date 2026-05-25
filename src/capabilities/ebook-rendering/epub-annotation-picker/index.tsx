/**
 * EpubAnnotationPicker — 已废除(PR-α-3b followup,2026-05-25 用户拍板)
 *
 * EPUB 选区操作全面改走 L4 注册式右键菜单(对齐 PDF α-2 体系),
 * 自动弹 picker 不再存在。本文件保留空 export 防止其他模块的 import 报错。
 *
 * 实际入口:
 *   - 右键 → contextMenuController.show 'ebook-view' viewId
 *   - 菜单注册:src/views/ebook/epub-context-menu-content.ts
 *   - 命令实现:同上文件的 ebook-view.* commands
 */

export {};
