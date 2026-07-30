# 全学科可编辑 Word 公式导出契约

## 下载契约

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| 文件扩展名 | string | 是 | `.docx` | 不再生成伪 `.doc` |
| MIME | string | 是 | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 标准 OOXML |
| 公式对象 | OMML XML | 有公式时是 | 每个公式对应一个 `m:oMath` 或 `m:oMathPara` | Word 原生可编辑公式 |
| 正文对象 | Word 文本运行 | 是 | 使用 `w:t`，必要时使用原生上下标格式 | 可编辑文本 |
| 题图对象 | PNG 媒体 | 有题图时是 | 只允许题目自身图形 | 不得承载公式正文 |

## 学术内容令牌

| 类型 | 输入 | DOCX 表示 | 验证规则 |
|------|------|-----------|----------|
| 普通文本 | 中文、英文、学科符号 | `w:r/w:t` | XML 转义后文本一致 |
| 文本上标 | `x^2` 等未定界简写 | `w:vertAlign w:val="superscript"` | 仍是文本运行 |
| 文本下标 | `H2O`、`CO2` 等未定界简写 | `w:vertAlign w:val="subscript"` | 仍是文本运行 |
| 行内公式 | `\(...\)`、`$...$` 或识别出的 LaTeX | `m:oMath` | 必须可由 KaTeX 与 OMML 转换器严格处理 |
| 独立公式 | `\[...\]`、`$$...$$` | `m:oMathPara/m:oMath` | 独立居中段落 |
| 化学内容 | 定界符内 `\ce{...}`、`\pu{...}` | `m:oMath` 或 `m:oMathPara` | 由 mhchem 生成 MathML 后转换 |

## DOCX 包结构

| 部件 | 必需 | 约束 |
|------|------|------|
| `[Content_Types].xml` | 是 | 声明主文档、样式、设置和 PNG 类型 |
| `_rels/.rels` | 是 | 指向 `word/document.xml` |
| `word/document.xml` | 是 | 正文、文本运行和全部 OMML 公式 |
| `word/styles.xml` | 是 | 中文正文、标题、题目和答案样式 |
| `word/settings.xml` | 是 | 启用公式与兼容设置 |
| `word/_rels/document.xml.rels` | 是 | 样式、设置及实际题图关系 |
| `word/media/*` | 否 | 只能存储题图 PNG，不得存储公式图片 |

## 不变量

- 公式数量必须等于导出内容中成功识别的公式令牌数量。
- 每个公式必须包含 `m:oMath`；独立公式额外使用 `m:oMathPara`。
- 公式转换失败时不得生成或下载 DOCX。
- 文档内不得出现公式 Canvas、公式 SVG、公式 PNG 或公式截图关系。
- 题干、选项、答案和解析中的公式执行相同转换规则，不允许只修复正文。
- HTTP 接口、页面预览数据和题图数据结构保持不变。

## 最小示例

输入：

```text
由 \(v=v_0+at\) 得 \(v=8\,\mathrm{m/s}\)，反应为 \(\ce{2H2 + O2 -> 2H2O}\)。
```

主文档中的结构必须等价于：

```xml
<w:p>
  <w:r><w:t>由 </w:t></w:r>
  <m:oMath>...</m:oMath>
  <w:r><w:t> 得 </w:t></w:r>
  <m:oMath>...</m:oMath>
  <w:r><w:t>，反应为 </w:t></w:r>
  <m:oMath>...</m:oMath>
  <w:r><w:t>。</w:t></w:r>
</w:p>
```

## 兼容性说明

- 用户操作入口不变，下载扩展名由 `.doc` 变为 `.docx`。
- Word/WPS 中公式由导入型 MathML 升级为原生 OMML，可直接进入公式编辑状态。
- PDF 导出和网页展示行为不变。
