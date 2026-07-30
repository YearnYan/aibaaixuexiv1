import assert from "node:assert/strict";
import { containsMarkdownTableBlock, stripMarkdownTableBlocks } from "../shared/tableText.js";

const questionWithTwoTables = String.raw`为研究训练达标与参与情况的关系，列联表如下：
| 参与情况 | 达标 | 不达标 | 合计 |
| :---: | :---: | :---: | :---: |
| 参与 | 90 | | 100 |
| 未参与 | | 10 | |
| 合计 | | | 140 |

（1）完成列联表并估计概率；

| \alpha | 0.1 | 0.05 | 0.025 |
| --- | --- | --- | --- |
| \chi_\alpha | 2.706 | 3.841 | 5.024 |

（2）根据临界值表进行独立性检验。`;

assert.equal(containsMarkdownTableBlock(questionWithTwoTables), true, "未识别标准 Markdown 表格块");
const stripped = stripMarkdownTableBlocks(questionWithTwoTables);
assert.doesNotMatch(stripped, /:---|\|\s*参与情况|\|\s*\\alpha/);
assert.match(stripped, /为研究训练达标与参与情况的关系/);
assert.match(stripped, /（1）完成列联表并估计概率/);
assert.match(stripped, /（2）根据临界值表进行独立性检验/);

const mathWithAbsoluteValue = String.raw`若 \(|x-1|\le 2\)，求 \(x\) 的范围。`;
assert.equal(containsMarkdownTableBlock(mathWithAbsoluteValue), false, "绝对值公式被误判为表格");
assert.equal(stripMarkdownTableBlocks(mathWithAbsoluteValue), mathWithAbsoluteValue);

const incompleteTable = String.raw`模型只返回了表头：
| 甲 | 乙 |
| 1 | 2 |`;
assert.equal(containsMarkdownTableBlock(incompleteTable), false, "缺少分隔行的普通管道文本不应被删除");
assert.equal(stripMarkdownTableBlocks(incompleteTable), incompleteTable);

console.log("表格图形回归通过：多表去重、正文保留和公式防误判均正常。");
