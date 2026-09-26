/**
 * ⭐⭐ **产品事实清单** —— 模型唯一能引用的信源,用户可随时改。
 *
 * ── 用户 2026-09-26 拍板 ──
 * > 「这个需要增加，而且产品描述给好格式，我要及时更新的。」
 *
 * ⚠️ 原来写死在 `@shared/types/x-reply-facts` 的 `PRODUCT_FACTS`,
 * 改一次要重新编译打包 —— 产品调整了用户自己改不了。
 *
 * ## ⚠️ 为什么代码里那份常量**要留着**
 *
 * 它现在是**默认值**,不是死数据:库里没有行时回落到它。
 * 空清单比写死更危险 —— 模型会**无约束自由发挥**,
 * 而本清单存在的全部意义就是「只能用这里的内容」。
 *
 * ## ⚠️ 单行表,不按 ws 分
 *
 * 这是**一份**对外口径,与 workspace 无关
 * (同 `x_author` 不带 ws_id 的道理:人和产品都是全局的,关系才按 ws 分)。
 */

import { getXDB } from '@storage/surreal/client';
import { PRODUCT_FACTS, type ProductFacts } from '@shared/types/x-reply-facts';

/** 单行表的固定 id —— 只有一份口径 */
const ROW = 'x_product_facts:current';

export interface StoredProductFacts extends ProductFacts {
  /** 上次改动时间 —— 「这口径是什么时候定的」要查得到 */
  updatedAt?: string;
  /** ⭐ 是库里的还是代码默认值 —— UI 要区分「还没设过」与「设成了这样」 */
  source: 'db' | 'default';
}

/**
 * 读当前口径。
 *
 * ⚠️ **读失败回落默认值,不抛** —— 拟回复是主流程,
 * 不能因为读不到配置就整条断掉;但要 warn,别静默。
 * ⭐ 回落时 `source: 'default'`,调用方能看出来是回落的。
 */
export async function getProductFacts(): Promise<StoredProductFacts> {
  try {
    const res = await getXDB().query<[Array<Record<string, unknown>>]>(
      `SELECT product_name, direction, trial, platforms, account_sharing,
              payment_note, forbidden, updated_at
         FROM x_product_facts LIMIT 1`,
    );
    const r = res?.[0]?.[0];
    if (!r || !r.product_name) return { ...PRODUCT_FACTS, source: 'default' };
    return {
      productName: String(r.product_name),
      direction: String(r.direction ?? ''),
      trial: String(r.trial ?? ''),
      platforms: String(r.platforms ?? ''),
      accountSharing: String(r.account_sharing ?? ''),
      paymentNote: String(r.payment_note ?? ''),
      forbidden: Array.isArray(r.forbidden) ? r.forbidden.map(String) : [],
      updatedAt: r.updated_at ? String(r.updated_at) : undefined,
      source: 'db',
    };
  } catch (err) {
    /** ⚠️ 不静默:读不到配置是要知道的,但不能因此拦住拟回复 */
    console.warn('[x-product-facts] 读取失败,回落代码默认值:', String(err));
    return { ...PRODUCT_FACTS, source: 'default' };
  }
}

/**
 * 写入新口径。
 *
 * ⚠️ **整份覆盖不做合并**:清单是「一眼能核对全部对外承诺」的东西,
 * 部分更新会让人以为改全了而实际只改了一半。
 *
 * ⚠️ 这里**会抛** —— 与读相反:用户明确点了保存,存不进去必须让他知道,
 * 否则他会以为改好了,而模型还在用旧口径(「看着成功实际没有」那一类)。
 */
export async function saveProductFacts(facts: ProductFacts): Promise<void> {
  const name = (facts.productName ?? '').trim();
  /**
   * ⚠️ 产品名不许空:它进 prompt 的第一行,空了会变成
   * 「你是  的社区回复助手」—— 模型会自己脑补一个名字。
   */
  if (!name) throw new Error('产品名不能为空 —— 它会直接进 prompt');

  await getXDB().query(
    `UPSERT ${ROW} SET
       product_name = $productName, direction = $direction, trial = $trial,
       platforms = $platforms, account_sharing = $accountSharing,
       payment_note = $paymentNote, forbidden = $forbidden,
       updated_at = time::now()`,
    {
      productName: name,
      direction: (facts.direction ?? '').trim(),
      trial: (facts.trial ?? '').trim(),
      platforms: (facts.platforms ?? '').trim(),
      accountSharing: (facts.accountSharing ?? '').trim(),
      paymentNote: (facts.paymentNote ?? '').trim(),
      /** ⚠️ 去空白项:空字符串进 forbidden 会渲染出「严禁编造、、」 */
      forbidden: (facts.forbidden ?? []).map((x) => String(x).trim()).filter(Boolean),
    },
  );
}

/** 恢复成代码里的默认值 —— 改坏了要有退路 */
export async function resetProductFacts(): Promise<void> {
  await saveProductFacts(PRODUCT_FACTS);
}
