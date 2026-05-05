# nav-side-registry — NavSide 内容 Registry

V1 navside/registry.ts 沿用核心思路,改为按 view 注册(V2 取消 WorkMode 概念)。
view active 时,NavSideFrame 显示对应内容(由 frame-bindings/nav-side-binding.tsx 渲染)。
