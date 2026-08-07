/**
 * Toolbar 调用上下文 — "这条命令是被哪个槽的 toolbar 触发的"
 *
 * 起因(fix/slot-toolbar-command-targets-own-slot):
 * 同一 view 左右双开时,两条 toolbar 渲染的是**同一批**注册项,点击都走
 * `commandRegistry.execute(item.command, item.commandArg)` —— 命令拿不到任何
 * 槽信息,只能按老习惯操作 left 槽。表现:点右栏的「+新建」,新笔记却在左栏打开。
 *
 * 为什么不把 slot 塞进 commandArg:
 * commandArg 是注册项自带的业务载荷(如 create-note 的 folderId),塞进去会
 * 污染既有契约,且每个命令都要改解析。调用上下文是**横切**信息,与载荷正交。
 *
 * 为什么是同步读而不是参数透传:
 * 命令 handler 签名 `(ctx, arg)` 由 commandRegistry 固定,view 层无法扩展。
 * 同款做法在本仓已有先例 —— handleMenuController.getState().instanceId 也是
 * "命令执行时同步读取触发者上下文"。
 *
 * 用法(命令 handler 内):
 *   const slot = getInvokingSlot() ?? 'left';   // 无上下文 = 非 toolbar 触发,按 left
 *
 * 生命周期:execute 前 set,execute 返回后立即清 —— 只在同步调用栈内有效。
 * 命令 handler 里的**异步续段读不到**(见 runWithInvokingSlot 注释),
 * 需要的话必须在同步段先取出来存局部变量。
 */

export type InvokingSlot = 'left' | 'right';

let invokingSlot: InvokingSlot | null = null;

/** 读当前触发命令的槽;null = 非 toolbar 路径触发(快捷键 / 程序调用 / 菜单) */
export function getInvokingSlot(): InvokingSlot | null {
  return invokingSlot;
}

/**
 * 在"当前槽 = slot"的上下文里同步执行 fn。
 *
 * 注意:只覆盖 fn 的**同步**执行段。fn 内部 `void (async () => {...})()` 的
 * 异步续段跑在本函数返回之后,那时 invokingSlot 已被清空 —— 这是刻意的,
 * 避免异步回调读到别处点击时设的值(比同步栈内串台更难查)。
 * 异步命令请在同步段先 `const slot = getInvokingSlot()` 存好再进 async。
 */
export function runWithInvokingSlot<T>(slot: InvokingSlot | undefined, fn: () => T): T {
  const prev = invokingSlot;
  invokingSlot = slot ?? null;
  try {
    return fn();
  } finally {
    invokingSlot = prev;
  }
}

/**
 * 最近一次由 toolbar 打开的浮层所属的槽。
 *
 * popup-trigger 项(如 Note 的 Open 弹窗、⊞ SlotPicker)点击后浮层是**异步**
 * 呈现的,用户在浮层里选完再触发命令 —— 那时同步调用栈早已结束,
 * getInvokingSlot() 读不到。故 toolbar 在打开浮层时把槽记在这里,
 * 浮层内容读取它决定操作哪一栏。
 *
 * 与 invokingSlot 分开存:后者是严格的同步栈上下文(用完即清),
 * 这个是"最近一次浮层归属",生命周期跨到浮层关闭,语义不同不可混用。
 */
let popupOwnerSlot: InvokingSlot | null = null;

/** toolbar 打开浮层时调 */
export function setPopupOwnerSlot(slot: InvokingSlot | undefined): void {
  popupOwnerSlot = slot ?? null;
}

/** 浮层内容读取:自己属于哪一栏(null = 非 toolbar 打开) */
export function getPopupOwnerSlot(): InvokingSlot | null {
  return popupOwnerSlot;
}
