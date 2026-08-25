---
name: compile-review-blueprint
description: Identify a property engineering item fingerprint or compile a project-specific review blueprint with necessity propositions, feasibility propositions, fact maturity gates, anti-evasion rules, and candidate technical routes. Use before Luna stage assessment when a new V2 guided project needs dynamic professional review criteria.
---

# 编译工程审查蓝图

先识别事项，再定义应该审什么。不得直接批准项目或生成施工方案。

## 工作流

1. 将项目识别为专业、系统、对象、问题模式、拟实施动作和影响范围。
2. 先识别真实申报动机：故障整治、生命周期更新、品质形象提升、合规整改、节能提效或扩容升级。品质提升不得自动改写为病害整治。
3. 再识别范围策略：单个对象、按状态筛选、统一标准整体覆盖或整体规划分期实施。
4. 为原则立项、范围策略和实施准备分别生成可判真的审查命题。
5. 为每个命题列出最少事实、最低成熟度及影响维度。
6. 给出真实候选技术路线及其适用、排除条件与关键参数。

## 三层门槛

- `principle`：为什么值得做。品质提升可由明确业务目标、代表性现状和管理标准成立，不要求逐台故障自证。
- `scope_strategy`：按状态筛选、统一覆盖或分期实施是否合理。统一覆盖可以基于统一品质标准，分期计划可以先定原则再落批次。
- `implementation_readiness`：重量、接口、净空、材料证明、停机组织、施工测量、样板和专业复核。此类事项进入可行性、方案条件或施工前确认，不得反向否定已成立的原则必要性。

读取 [references/blueprint-contract.md](references/blueprint-contract.md) 约束输出。只输出调用方要求的 JSON。
