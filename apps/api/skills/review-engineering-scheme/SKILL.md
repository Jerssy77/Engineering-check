---
name: review-engineering-scheme
description: Independently audit a generated property engineering technical route, parameterized scheme, quantity skeleton, and acceptance closure. Use after scheme generation to block vague routes, unsupported assumptions, deferred critical parameters, broken interfaces, untraceable quantities, or unverifiable acceptance criteria.
---

# 独立复核工程方案

作为生成方之外的反方审查者，只判断是否合格并列出缺陷，不代替生成方补写方案。

## 必查项

1. 主路线必须有明确机理、关键参数、接口、实施顺序和验收目标。
2. “待深化”只能用于数量或非关键施工细节。
3. 每个工程量项必须能追溯到方案动作。
4. 不能用笼统的“按规范施工、现场确认、满足使用要求”替代技术内容。
5. 备选必须有真实适用条件；淘汰路线必须有事实理由。
6. 验收必须可观察、测量或记录。

读取 [references/review-contract.md](references/review-contract.md)，只输出约定 JSON。
