# 报告导出、公式与 AI 优化契约

## 学科公式文本契约

| 内容 | 格式 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| 行内公式 | `\\(...\\)` | 含公式时 | JSON 中反斜杠必须双写 | KaTeX 渲染 |
| 独立公式 | `\\[...\\]` | 独立推导时 | 不得使用图片或伪文本公式 | KaTeX display 模式 |
| 化学式/方程式 | `\\(\\ce{...}\\)` | 化学内容时 | 使用 mhchem 语法 | 支持状态、条件和电荷 |
| 普通学科符号 | Unicode 或 LaTeX | 含符号时 | 符合教材常用规范 | 不得输出无法解释的乱码 |
| SVG 图示 | 自包含 `<svg>...</svg>` | 需要图示时 | 禁止脚本、外链和事件属性 | 安全白名单渲染 |

### SVG 教学文字契约

- SVG 的 `text`、`tspan` 只能包含浏览器可直接显示的普通文本或 Unicode 学科符号，不得包含 LaTeX 定界符和控制命令。
- 数学、物理、化学、生物、地理等学科共用语法级转换：根式、分式、关系符号、箭头、集合、希腊字母、上下标、化学式、电荷、角度和方向均转换为可读文本。
- SVG 普通中文保持原样；小于号、大于号和连接符必须保持有效 XML 转义。
- 复杂且无法用 SVG 文本准确表达的公式放入相邻 `paragraph`，使用标准 LaTeX 交由 KaTeX 或 Office Math 渲染。

### 板书布局契约

- `layout: "blackboard"` 的 `.dynamic-blocks` 是唯一黑板背景和边框。
- 板书 SVG 必须透明，不绘制全画布背景矩形、整幅外框、重复黑板或灰色底框，`viewBox` 应紧贴教学内容。
- 兼容层会删除覆盖画布的背景矩形和包围整幅内容的透明装饰框，但保留局部分栏、坐标轴、几何图和关系线。
- 网页、PDF 和 Word 先使用相同的板书 SVG 内容规范化结果；Word 因没有网页黑板容器，会在栅格化副本中补充统一深绿色背景，避免透明 PNG 在 WPS 白色页面上失去对比度。

## `POST /api/optimize`

### 请求

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| form | object | 是 | 与生成接口一致 | 当前备课表单 |
| plan | object | 是 | 旧版教案或动态教案 V3 | 当前完整教案 |
| messages | Message[] | 是 | 1-20 条 | 本轮页面内对话 |
| config | object | 否 | 与生成接口一致 | 模型配置 |

### 动态教案 V3

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| documentVersion | number | 是 | 固定为 `3` | 动态文档版本 |
| title | string | 是 | 非空 | 文档主标题 |
| cover | Cover | 是 | 受控字段 | 封面内容 |
| appearance | Appearance | 是 | 使用白名单值 | 全局主题与密度 |
| sections | Section[] | 是 | 允许空数组 | 模块可增删、重排 |
| footer | Footer | 否 | 受控字段 | 页尾说明 |

### Cover

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| kicker | string | 否 | 富文本字符串 |
| title | string | 是 | 与根标题默认同步 |
| subtitle | string | 否 | 富文本字符串 |
| meta | `{label,value}[]` | 否 | 最多 12 项 |

### Appearance

| 字段 | 类型 | 必需 | 允许值 |
|---|---|---:|---|
| theme | string | 否 | `classic`、`academic`、`modern`、`minimal`、`blue` |
| density | string | 否 | `compact`、`comfortable`、`spacious` |
| pageLayout | string | 否 | `single`、`two-column` |

### Section

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| id | string | 是 | 文档内唯一 |
| title | string | 是 | 可以由教师改名 |
| layout | string | 否 | `stack`、`two-column`、`three-column`、`grid`、`timeline`、`blackboard`、`table`、`gallery` |
| blocks | Block[] | 是 | 允许空数组 |

### Block

| type | 主要字段 | 用途 |
|---|---|---|
| paragraph | `text, variant, align` | 正文、导语、提示、引用 |
| list | `items, style, columns` | 有序、无序或检查清单 |
| keyValue | `items[{label,value}], columns` | 课标、元信息和成对说明 |
| cards | `items[{title,subtitle,meta,body,fields}], columns` | 目标、练习、作业、评价等卡片 |
| timeline | `items[{title,time,body,fields}]` | 教学流程或步骤 |
| table | `headers, rows` | 任意结构化表格 |
| image | `src, alt, caption` | HTTPS 或图片 Data URL |
| svg | `content, caption` | 安全自包含 SVG 图示 |
| divider | 无 | 视觉分隔 |

模型可以修改、增加、删除和重排任意模块或内容块。服务端只做安全归一化，不按旧版 13 模块补齐字段。

### 响应

```json
{
  "source": "ai",
  "message": "已删除原模块并新增实验记录模块，同时改为双栏排版。",
  "plan": {
    "documentVersion": 3,
    "title": "浮力实验探究教案",
    "cover": { "title": "浮力实验探究教案", "meta": [] },
    "appearance": { "theme": "blue", "density": "comfortable", "pageLayout": "single" },
    "sections": [],
    "footer": { "brand": "教师备课器", "note": "请结合真实课堂调整" }
  }
}
```

### 不变量

- 显式返回的 `sections` 是最终模块清单，允许为空，不得自动补回旧模块。
- 未显式返回 `sections` 时才使用当前动态文档的模块作为容错回退。
- 所有文本继续满足统一公式文本契约，SVG 继续经过安全白名单。
- SVG 可见文字必须满足 SVG 教学文字契约；板书 SVG 同时满足单层板书布局契约。
- 教师使用“图、图片、图示、示意图、结构图、流程图、关系图、概念图、思维导图、板书图、配图”等词且未指定媒介时，模型必须返回安全自包含的 `svg` 内容块；明确要求照片、真实图片、插画、PNG、JPG、位图、网络图片或图片地址时按明确要求执行。
- 对话记录只保存在当前页面内存中；刷新网页或成功生成新教案时重置。
- 没有可用模型配置时返回明确错误。

## PDF 导出契约

| 项目 | 值 |
|---|---|
| 页面 | A4 纵向 |
| 内容来源 | 当前 `.lesson-document` 的网页克隆 |
| 公式与图示 | 使用网页已渲染的 KaTeX、SVG 和图片结果 |
| 颜色兼容 | 导出克隆中 CSS Color 4 的 `color(srgb ...)` 计算值转换为 `rgba(...)`；页面样式不使用 `color-mix()` |
| 分页 | 优先在动态模块、时间线项目、卡片和表格边界切分 |
| 文件名 | `<课题>-<课时>.pdf` |

## Word 导出契约

| 项目 | 值 |
|---|---|
| 页面内容 | 与当前动态模块标题、顺序和正文一致 |
| 普通正文 | 可编辑 Word 文本 |
| 学科公式 | 原生 Office Math，可继续编辑 |
| 表格 | 原生 Word 表格 |
| 图片 | 支持的位图直接嵌入；安全 SVG 先统一转换可见学科文字，板书 SVG 再移除重复背景与外框，并在 Word 专用副本补统一深绿色背景，随后按原宽高比高清栅格化为 PNG 嵌入，WPS 可见，失败时保留可访问说明和图注 |
| 文件名 | `<课题>-<课时>.docx` |
