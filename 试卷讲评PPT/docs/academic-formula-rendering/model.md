# 跨学科学术文本契约

## 课件字段

| 字段 | 类型 | 公式支持 | 约束 |
| --- | --- | --- | --- |
| `subject` | string | 否 | 数学、物理、化学、生物、地理、语文、英语、政治、历史或综合 |
| `question` | string | 是 | 行内与独立公式均可出现 |
| `options[].text` | string | 是 | 以行内公式为主 |
| `answer` | string | 是 | 允许独立公式 |
| `analysis` | string | 是 | 步骤文本与公式可混排 |
| `knowledge[]` | string[] | 是 | 最多 4 项，保持短语化 |

## 规范公式标记

| 类型 | 标记 | 示例 |
| --- | --- | --- |
| 行内公式 | `\(...\)` | `\(\frac{\sqrt{3}}{2}\)` |
| 独立公式 | `\[...\]` | `\[E=mc^2\]` |
| 化学表达 | `\ce{...}`，置于公式标记内 | `\(\ce{2H2 + O2 -> 2H2O}\)` |
| 单位 | `\mathrm{}` | `\(9.8\,\mathrm{m\,s^{-2}}\)` |
| 向量 | `\vec{}` 或 `\overrightarrow{}` | `\(\vec{F}=m\vec{a}\)` |
| 角度 | `^\circ` | `\(30^\circ\mathrm{N}\)` |

## 学科规则

- 数学：使用 `\frac`、`\sqrt`、上下标、标准函数名、集合、概率、极限、微积分、矩阵和几何命令。
- 物理：物理量斜体，单位使用 `\mathrm{}`，矢量使用 `\vec{}`，科学计数法使用 `\times 10^{n}`。
- 化学：分子式、离子、电荷、状态和反应式统一使用 `\ce{}`，不得用普通数字模拟下标。
- 生物：遗传与统计公式使用标准数学语法，基因型或序列使用 `\mathrm{}` 保持正体。
- 地理：经纬度、角度、比例尺、太阳高度、时区与单位使用标准上标和正体单位。

## AcademicMath 接口

| 方法 | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- |
| `normalizeText(text, subject)` | 原始文本、学科 | 规范公式标记文本 | 已有 LaTeX 不重复转换 |
| `render(text, subject)` | 规范或历史文本、学科 | 安全 HTML | 普通文本完成 HTML 转义 |
| `typeset(root)` | DOM 根节点 | Promise | 只排版指定根节点 |
| `findUnresolvedLegacy(text)` | 文本 | string[] | 返回可见遗留程序表达式 |

## 不变量

- 数据模型中不保存 MathJax 生成的 HTML 或 SVG，只保存规范文本。
- 相同规范文本在预览和导出时使用同一套渲染结果。
- 公式排版完成后才进行内容密度测量和 PPT 截图。
- 公式模块不执行用户文本中的 HTML、脚本或事件属性。

## 公式诊断接口

| 方法 | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- |
| `findFormulaIssues(text)` | 任意学术文本 | `FormulaIssue[]` | 同时检查显式公式内部结构和公式外遗留表达式 |
| `AcademicRepair.collectViolations(slides, AcademicMath)` | 规范化题目数组、公式模块 | `FormulaViolation[]` | 每个问题包含题目索引、题号、字段路径和问题列表 |
| `AcademicRepair.buildRepairPrompt(context)` | 当前题目、问题列表、修复轮次 | string | 只要求返回被诊断字段，不要求重写整批题目 |
| `AcademicRepair.applyRepairResponse(slides, violations, response, normalizer)` | 当前题目、问题列表、AI 补丁 JSON、规范化函数 | 题目数组 | 只能修改白名单字段路径，且每个问题字段必须被覆盖 |

## FormulaIssue

| 字段 | 类型 | 必需 | 约束 |
| --- | --- | --- | --- |
| `code` | string | 是 | 稳定错误码，如 `BARE_LATEX_COMMAND`、`MISSING_ARGUMENT` |
| `fragment` | string | 是 | 最短可定位错误片段，不包含整份试卷 |
| `message` | string | 是 | 面向修复模型的明确中文诊断 |

## FormulaViolation

| 字段 | 类型 | 必需 | 约束 |
| --- | --- | --- | --- |
| `slideIndex` | number | 是 | 当前批次内从 0 开始的题目索引 |
| `slideId` | number/string | 是 | 原题号，仅用于交叉校验 |
| `fieldPath` | string | 是 | `question`、`answer`、`analysis`、`options.N.text` 或 `knowledge.N` |
| `fieldLabel` | string | 是 | 用于状态和诊断的中文字段名 |
| `issues` | `FormulaIssue[]` | 是 | 至少一项 |

## AI 字段补丁响应

```json
{
  "repairs": [
    {
      "slideIndex": 0,
      "slideId": 10,
      "fields": {
        "answer": "\\(\\frac{1}{2}\\)"
      }
    }
  ]
}
```

### 补丁不变量

- `repairs` 必须覆盖当前轮全部 `fieldPath`，不得包含未请求路径。
- `slideIndex` 与 `slideId` 必须同时匹配当前题目。
- 合并前后除请求字段外的结构化值必须保持不变。
- 合并结果必须重新执行全量公式校验，未通过时不得进入课件数据。
