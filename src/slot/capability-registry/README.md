# capability-registry — 能力注册中心

按 charter § 1.4:能力是 V2 业务模块的真正所在。view 通过 install 列表引用。

L4 阶段实施最小集(register / get / has,Q5=B 避免过度设计)。
createInstancesForView 等高级 API 留 L5 真用时实施。

注册时自动把能力的 commands 字段注册到 commandRegistry。
