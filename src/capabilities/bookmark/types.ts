/**
 * bookmark capability — 对外类型 (web view 书签树, 书签步骤1 数据层)
 *
 * web view 通过 requireCapabilityApi<BookmarkApi>('bookmark') 取 api。
 *
 * 数据模型 (照 ebook-library 瘦身克隆):
 * - bookmark atom    domain='bookmark'   payload { url, title, createdAt }
 * - inFolder 边      bookmark → folder   (folder atom viewType='web')
 *
 * 文件夹分类复用 folder capability (viewType='web'),书签本体只存 url + title。
 */

/** 一条书签业务视图 (atom + 派生 folderId) */
export interface BookmarkInfo {
  id: string;
  /** 书签 URL (必填) */
  url: string;
  /** 书签标题 (可空兜底用 url) */
  title: string;
  /** 派生:user:krig:inFolder 边的 object;null = 根级 */
  folderId: string | null;
  createdAt: number;
}

export interface BookmarkApi {
  /** 添加书签;给 folderId 则挂到该 folder (viewType='web' 的 folder atom) */
  add(url: string, title: string, folderId?: string | null): Promise<BookmarkInfo>;
  /** 全部书签 (扁平,UI 按 folderId 组树);按 createdAt 倒序 */
  list(): Promise<BookmarkInfo[]>;
  /** 改标题 */
  rename(id: string, title: string): Promise<void>;
  /** 删书签 (含 inFolder 边自动级联) */
  remove(id: string): Promise<void>;
  /** 移动到 folder;folderId=null 移到根 */
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  /** 订阅书签列表变更 (IPC 广播);返 unsubscribe */
  onListChanged(callback: () => void): () => void;
}
