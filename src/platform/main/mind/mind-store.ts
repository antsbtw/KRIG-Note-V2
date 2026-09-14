/**
 * mind-store — diglot mind 文档存储(方案 B1,用户拍板 2026-09-10)
 *
 * ⭐ **为什么不复用 canvas-store**:
 * 那个 store 是「画板形状」的 —— 它把 doc_content **拆成 instance 原子 + inCanvas 边**,
 * 读回来再从 `{schema_version, view, instances}` 重新拼。
 * mind 的内容是**两段纯文本**,塞进去会被静默丢弃
 * (真机实测:存 `{format, semantic, graphic}`,读回来 `format=undefined`)。
 *
 * ⭐ 对齐数据模型总纲原则 1(实体优先):
 * 「把这个实体单独取出来,它的描述是否还完整?」
 * mind 文档 = 标题 + 两段文本,**单独存在就是完整的**,
 * 不该为了复用别人的表而被拆散。
 *
 * ⚠️ **共用 `graph_folder`**(B1 的定义):文件夹是「组织方式」不是「画板私有物」。
 * 本 store **只读不写** folder 表 —— 文件夹的 CRUD 仍归 graph 那边,避免两处写同一张表。
 *
 * ⚠️ **零边**:mind 文档本体不产生任何关系边(Decision 028 的教训)。
 * 联系线(Edge)是 S 层内容的一部分,存在 semantic 文本里,不落边表。
 *
 * ⚠️ **业务 id(ULID),不用内建 record id** —— 铁律:绝不 DEFINE FIELD id
 * (1.8.6 踩过:声明成 TYPE string 后 CREATE + 同事务 UPSERT 触发 readonly,
 *  表现是新建/保存**静默失败**)。对齐 mail-repo / search-recipe-repo。
 */

import { getDB } from '@storage/surreal/client';
import { generateUlid } from '@shared/ulid';

const TABLE = 'mind_doc';

export interface MindDocRecord {
  id: string;
  title: string;
  /** ⭐ S 层:mermaid mindmap 语法(用户书写,机器不改写) */
  semantic: string;
  /** ⭐ G 层:规范形,稀疏(空串 = 一个条目都没有,全自动布局) */
  graphic: string;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MindDocListItem {
  id: string;
  title: string;
  folder_id: string | null;
  updated_at: number;
}

/** SurrealDB 返回行 → 业务记录(id 剥表前缀)。 */
function toRecord(row: Record<string, unknown>): MindDocRecord {
  return {
    id: typeof row.mind_id === 'string' ? row.mind_id : '',
    title: typeof row.title === 'string' ? row.title : '未命名导图',
    semantic: typeof row.semantic === 'string' ? row.semantic : '',
    graphic: typeof row.graphic === 'string' ? row.graphic : '',
    // ⚠️ option<string> 缺席时 SDK 给 undefined/null,业务层统一成 null
    folder_id: typeof row.folder_id === 'string' ? row.folder_id : null,
    created_at: typeof row.created_at === 'number' ? row.created_at : 0,
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : 0,
  };
}

class MindStore {
  async list(): Promise<MindDocListItem[]> {
    const db = await getDB();
    const res = await db.query<[Record<string, unknown>[]]>(
      `SELECT mind_id, title, folder_id, updated_at FROM ${TABLE} ORDER BY updated_at DESC`,
    );
    return (res[0] ?? []).map((r) => {
      const rec = toRecord(r);
      return {
        id: rec.id,
        title: rec.title,
        folder_id: rec.folder_id,
        updated_at: rec.updated_at,
      };
    });
  }

  async load(id: string): Promise<MindDocRecord | null> {
    const db = await getDB();
    const res = await db.query<[Record<string, unknown>[]]>(
      `SELECT * FROM ${TABLE} WHERE mind_id = $id LIMIT 1`,
      { id },
    );
    const row = res[0]?.[0];
    return row ? toRecord(row) : null;
  }

  /**
   * 新建。
   * ⚠️ `folder_id` 为空时传 **undefined 不传 null** ——
   * SurrealDB 的 NONE ≠ NULL,`option<T>` 只认 NONE(SDK 绑定 undefined→NONE)。
   * 见 memory `project-surreal-none-vs-null`:见 `?? null` 就是 bug。
   */
  async create(
    title: string,
    semantic: string,
    graphic: string,
    folderId?: string | null,
  ): Promise<MindDocRecord> {
    const db = await getDB();
    const now = Date.now();
    const res = await db.query<[Record<string, unknown>[]]>(
      `CREATE ${TABLE} SET mind_id = $mind_id, title = $title, semantic = $semantic,
        graphic = $graphic, folder_id = $folder_id, created_at = $now, updated_at = $now
        RETURN AFTER`,
      {
        mind_id: generateUlid(),
        title,
        semantic,
        graphic,
        folder_id: folderId ?? undefined,
        now,
      },
    );
    const row = res[0]?.[0];
    // ⚠️ fail loud:创建失败不返回半个对象让调用侧误以为成功
    if (!row) throw new Error('[mind-store] create 未返回记录');
    return toRecord(row);
  }

  /** 保存两段文本 + 标题。⭐ 原样存,不解析不改写(S 层机器不改写)。 */
  async save(id: string, semantic: string, graphic: string, title: string): Promise<void> {
    const db = await getDB();
    await db.query(
      `UPDATE ${TABLE} SET semantic = $semantic, graphic = $graphic,
        title = $title, updated_at = $now WHERE mind_id = $id`,
      { id, semantic, graphic, title, now: Date.now() },
    );
  }

  async rename(id: string, title: string): Promise<void> {
    const db = await getDB();
    await db.query(
      `UPDATE ${TABLE} SET title = $title, updated_at = $now WHERE mind_id = $id`,
      { id, title, now: Date.now() },
    );
  }

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const db = await getDB();
    await db.query(
      `UPDATE ${TABLE} SET folder_id = $folder_id, updated_at = $now WHERE mind_id = $id`,
      {
        id,
        // ⚠️ 同上:清空归属要传 undefined(→NONE),不是 null
        folder_id: folderId ?? undefined,
        now: Date.now(),
      },
    );
  }

  /** ⭐ 删除很简单 —— 零边,没有级联要处理(这正是「文档本体零边」的好处)。 */
  async remove(id: string): Promise<void> {
    const db = await getDB();
    await db.query(`DELETE ${TABLE} WHERE mind_id = $id`, { id });
  }

  async duplicate(id: string): Promise<MindDocRecord | null> {
    const src = await this.load(id);
    if (!src) return null;
    return this.create(`${src.title} 副本`, src.semantic, src.graphic, src.folder_id);
  }

  /**
   * 文件夹被删时,把其中的导图移到顶层。
   * ⚠️ 由 graph 侧删文件夹时调用 —— 否则会留下指向不存在文件夹的孤儿。
   */
  async orphanFolder(folderId: string): Promise<void> {
    const db = await getDB();
    await db.query(`UPDATE ${TABLE} SET folder_id = NONE WHERE folder_id = $fid`, {
      fid: folderId,
    });
  }
}

export const mindStore = new MindStore();
