/**
 * `web.input` —— Web 能力层的「输入」能力(`01-contract.md` 第三部分)。
 *
 * ⭐ 核心不变量:
 *  1. **管动作,不管内容** —— 底座不认识 markdown,只收最终形态
 *  2. **没有落地确认就不算成功** —— `check:{kind:'none'}` 必须显式,且绝不谎称 landed
 *  3. ⭐ **作用域命中多个 → 报错,不挑第一个**(与 `web.page` 的 `find` 同源)
 *  4. 🚦 **`tap` 中立** —— 不分等级、不设危险词表、不拒绝任何目标;
 *     发布闸门是**业务层**的事(§7.1)
 */
export * from './types';
export * from './web-input';
export {
  SCOPE_AMBIGUOUS,
  SCOPE_NOT_FOUND,
  buildAnchorExistsScript,
  buildContainsScript,
  buildDirectWriteScript,
  buildExactScript,
  buildFocusScript,
  buildHoverScript,
  buildPressScript,
  buildSyntheticPasteScript,
  buildTapScript,
  landingNeedle,
} from './input-scripts';
