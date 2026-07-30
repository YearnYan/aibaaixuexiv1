# 公式互操作契约

## 公式片段

| 字段 | 类型 | 必需 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `latex` | string | 是 | 不含公式定界符 | 经过可移植规范化的公式源码 |
| `display` | boolean | 是 | `true` 或 `false` | 块级或行内展示 |
| `token` | string | 是 | 文档内唯一 | DOCX 生成阶段的临时占位标识 |

## 共享函数契约

| 函数 | 输入 | 输出 | 不变量 |
| --- | --- | --- | --- |
| `normalizePortableLatex` | 公式源码 | 可移植 LaTeX | 统一 Unicode、常见别名和环境写法，不含定界符 |
| `normalizeFormulaImageMarkdown` | 题目文本 | 题目文本 | 可信在线公式图片解码为公式片段；普通图片保持原样 |
| `toReadableFormulaText` | 公式源码 | 用户可读文本 | 不返回原始 LaTeX 命令；保留数学和学科符号语义 |
| `mathTextForMarkdown` | 题目文本 | Markdown 文本 | 可解析公式保留数学标记；不可解析公式降级为可读文本 |
| `markdownTextForWord` | 普通正文 | Word 可读文本 | 不返回裸露图片、链接、代码或表格分隔语法 |

## Word 公式替换结果

| 结果 | 触发条件 | DOCX 内容 | 用户可见行为 |
| --- | --- | --- | --- |
| 结构化 OMML | MathJax 与 MathML→OMML 转换成功 | `m:oMath`，含分式、矩阵、上下标等结构 | Word 公式编辑器可直接编辑 |
| 可读 OMML | 单条公式转换异常或输出异常 | `m:oMath`，内含 Unicode 可读公式文本 | 可下载、可在 Word 公式对象中编辑，不显示原始 LaTeX |

## 不变量

- 所有 `@@MATH_n@@` 占位符在 DOCX 返回前均被替换。
- 单条公式失败不得抛出导致整份导出失败的异常。
- 文档 XML 不含未转义的公式源码或嵌入 `m:oMath` 的文字节点。
- 文档 XML 不含公式图片 URL、Markdown 图片语法或跨渲染器命令名。
- 粗体向量等数学样式不得被全局文字样式归一化抹除。
- 网页和 Word 使用同一公式规范化与可读降级转换。

## 示例

输入：`\\begin{cases}\\frac{x-2}{2}=1\\\\\\frac{y+1}{3}=5\\end{cases}`

优先输出：包含矩阵和分式节点的 `m:oMath`。

降级输出：`{ (x−2)/(2) = 1；(y+1)/(3) = 5 }`，位于 `m:oMath` 中。
