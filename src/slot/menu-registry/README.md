# menu-registry — Application Menu 注册中心(主进程)

V1 main/menu/registry.ts(85 行)沿用思路 + V2 改进:
- V1 含 handler 函数(运行时决议)
- V2 改为 command 字符串引用(charter § 1.2 注册原则)

## V2 改进:Application Menu 不再硬编码

V1:`src/main/app.ts` 内 60+ 行硬编码 menu 项(View 菜单 / DevTools / 等)。
V2:Application Menu 也走 menuRegistry,各 view / 框架注册自己的菜单项,app 入口不知道菜单内容。

## L4 阶段框架级菜单

按 § 8 Q2=A(最小集):
- File / Edit(Electron role)/ View / Window / Help 5 个顶级菜单
- 只填能立即生效的(View → Toggle DevTools 等)
- view / 能力的菜单项留 L5 注册时加
