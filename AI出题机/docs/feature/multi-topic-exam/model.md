# 多知识点组卷契约与数据模型

## POST `/api/exam/generate`

### 请求字段

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| `version` | string | 否 | 默认全版本融合课程体系 | 教材体系 |
| `grade` | string | 是 | 非空 | 年级 |
| `subject` | string | 是 | 非空 | 语文、数学、物理等 |
| `examType` | string | 否 | quiz/unit/midterm/final/mock | 试卷类型 |
| `topicConfigs` | array | 新版必需 | 1–20 项 | 多知识点配置 |
| `topic` | string | 兼容 | 旧版单知识点 | 与 `topicConfigs` 二选一 |
| `examPoint` | string | 兼容 | 旧版单考点 | 旧版兼容字段 |
| `questionCount` | integer | 兼容 | 1–30 | 旧版总题量 |
| `difficulty` | integer | 兼容 | 1–10 | 旧版难度 |
| `questionTypes` | string[] | 兼容 | 非空时为题型名称 | 旧版题型 |
| `imageUrls` | string[] | 否 | URL 数组 | 题目参考图 |

### `topicConfigs` 项

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| `topic` | string | 是 | 1–120 字符 | 知识点名称 |
| `examPoints` | array | 是 | 1–20 项 | 该知识点下的考点 |

### `examPoints` 项

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| `name` | string | 是 | 1–160 字符 | 考点名称 |
| `questionCount` | integer | 是 | 1–30 | 该考点总题量 |
| `difficulty` | integer | 是 | 1–10 | 该考点难度 |
| `questionTypeCounts` | object | 是 | 至少一个正整数 | 题型到题量映射 |

支持的内部题型键：`choice`、`fill`、`calculation`。前端可显示学科接口返回的中文题型名，服务端负责别名归一化。

### 请求示例

```json
{
  "grade": "高中一年级",
  "subject": "数学",
  "examType": "unit",
  "topicConfigs": [
    {
      "topic": "函数的概念与性质",
      "examPoints": [
        {
          "name": "定义域与值域",
          "questionCount": 3,
          "difficulty": 5,
          "questionTypeCounts": { "choice": 2, "fill": 1 }
        },
        {
          "name": "单调性与奇偶性",
          "questionCount": 2,
          "difficulty": 7,
          "questionTypeCounts": { "choice": 1, "calculation": 1 }
        }
      ]
    }
  ]
}
```

## 响应字段

响应沿用 `questions`、`answers`、`title`，并新增：

| 字段 | 类型 | 约束 | 备注 |
|---|---|---|---|
| `metadata.topicConfigs` | array | 与规范化请求一致 | 组卷配置回显 |
| `questions[].source` | object | 必须存在 | `topic`、`examPoint`、`difficulty`、`questionType` |
| `questions[].items[].source` | object | 必须存在 | 题目来源追踪 |
| `questions[].items[].stem/options/answer/explanation` | string/string[]/string/string | 公式使用 LaTeX | 由 KaTeX 渲染 |
| `questions[].items[].figure` | object/null | 带图题必须为对象 | 生成图形描述 |
| `continuationToken` | string | `cg1.<exp>.<nonce>.<signature>` | 续题能力凭证，长度 32–128 |

## POST `/api/exam/continue`

为一个已经生成的“知识点-考点-题型”结果组继续生成固定 3 题。该接口继续调用现有严格生成核心，不使用简化生成器，不改变模型、提示词、温度、审核或质量门。

### 请求字段

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| `grade` | string | 是 | 单个年级 |
| `subject` | string | 是 | 单个学科 |
| `examType` | string | 否 | 默认 `final` |
| `topic` | string | 是 | 只能一个知识点 |
| `examPoint` | string | 是 | 只能一个考点 |
| `questionType` | string | 是 | `choice`、`fill`、`calculation` 之一 |
| `difficulty` | integer | 是 | 1–10 |
| `count` | integer | 是 | 必须严格等于 3，不接受字符串或其他题量 |
| `imageUrls` | string[] | 否 | 参考图数组 |
| `continuationToken` | string | 是 | `cg1` 签名凭证，长度 32–128 |

初始 `/generate` 成功后签发带有效期的 `continuationToken`，一次组卷只消耗一次体验额度。令牌格式为 `cg1.<base36过期时间>.<随机数>.<HMAC-SHA256签名>`，签名输入使用固定域 `paper-continuation:`，Node 与 Worker 使用相同结构契约。令牌是服务端签名的持有者能力，不保存到进程会话内存；服务进程或 Worker 实例重建后仍可验证。伪造、篡改、格式错误或过期凭证返回 `CONTINUATION_GRANT_INVALID`；合法追加不重复扣额度，现有请求令牌和速率限制继续生效。

响应沿用单题组的 `questions`、`answers`、`metadata`，并必须返回续签后的 `continuationToken`。前端只在响应属于当前试卷且新凭证格式有效时更新本地凭证。题组与每道题的 `source` 必须和请求中的知识点、考点、难度、题型完全一致，题目与答案都必须恰好 3 项。每个题组拥有独立进行中状态，同组重复点击被拒绝，不同题组可并发；多个同时签发的令牌在各自有效期内互不失效。前端在操作级局部事务中完成来源、数量、答案、公式和题图校验；全部成功后才读取最新全局题数并同步提交 DOM、题目、答案与题图缓存，失败时原状态不变。

## AI 强制工具调用契约

生成与审核都必须且只能调用一次 `submit_exam`。服务端只读取
`tool_calls[0].function.arguments`，不读取普通 `message.content`，也不从任何文本中提取或修复 JSON。

### `submit_exam` 参数

```json
{
  "items": [
    {
      "stem": "已知 \\(f(x)=\\frac{1}{2}x\\)，求函数值。",
      "options": null,
      "answer": "\\(1\\)",
      "explanation": "代入条件并复核，得到 \\(f(2)=1\\)。",
      "figure": null
    }
  ]
}
```

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| `items` | array | 是 | 数量等于当前批次题量 | 根对象唯一字段 |
| `items[].stem` | string | 是 | 非空、公式可编译 | 最终用户可见字符串 |
| `items[].options` | string[]/null | 是 | 选择题恰好 4 项，其他题型为 null | 不允许省略 |
| `items[].answer` | string | 是 | 非空、公式可编译 | 审核后的答案 |
| `items[].explanation` | string | 是 | 非空、公式可编译 | 完整解析 |
| `items[].figure` | object/null | 是 | 对象只含 `type`、`description` | 无图时显式为 null |

- 根对象禁止 `title`、`type`、`index`、`questions`、`answers` 等服务器已知字段。
- 题号、题型、题组标题和试卷标题由服务端确定性构建。
- 当前批次 schema 动态固定题量与题型；供应商 schema 结果仍由服务端再次完整验证。
- 任一字段、批次或审核结果失败时，原任务整体重新生成；不得修复 JSON、删除公式或返回部分试卷。

## 严格生成与原子纠错契约

- 每个命题批次先调用 `submit_exam` 生成结构化初稿。未知字段、缺失字段、错误题型、错误题量和非法根结构属于不可复核结构错误，直接进入任务级严格重试。
- 裸 LaTeX、公式定界符、KaTeX 编译、Unicode 伪公式、裸化学式、缺图和题图描述等内容错误属于可复核初稿错误；系统保留原始坏稿，不修改字符串，把精确字段路径、错误码和固定纠偏规则交给独立审题模型。
- 独立审题最多执行 2 次批次级纠正。第一次仍失败时，第二次必须基于最新审核坏稿和最新错误清单继续纠正；其他批次不受影响。
- 批次级纠正仍使用同一模型、`submit_exam` schema、审核温度和全部质量门。不得自动补定界符、替换命令、删除公式、返回部分题目或降低题图标准。
- 局部纠正仍不合格时，才触发原有最多 3 次任务级严格生成；最终仍失败则拒绝输出，原试卷不变。

## AI 用户可见字符串公式契约

- 字段值直接使用最终标准 LaTeX：行内 `\\(...\\)`，独立 `\\[...\\]`。
- 工具参数必须可被 `JSON.parse` 直接解析；JSON 负责反斜杠转义，不使用 `LATEXSLASH`、`@@BS@@`、`[[LATEX]]` 等私有中间格式。
- 禁止 `$...$`、`$$...$$`、裸 LaTeX、Unicode 伪公式、嵌套/错序/不闭合/双重转义定界符和不存在的 `\\eq`。
- 公式中的中文说明使用 `\\text{...}`，或先在普通文字中定义 ASCII/数字下标变量。
- `answers` 不由 AI 重复生成，统一从审核通过的 `answer` 与 `explanation` 构建并再次验证。

## 图形渲染契约

- `POST /api/render/figures-batch` 接收 `{ figures: [{ id, description, figureType, stem, subject, forceRegenerate? }] }`。
- `forceRegenerate: true` 只用于浏览器拒绝服务端缓存结果后的精确重试；它绕过相同题图缓存，但不改变模型、提示词或生成参数。
- 成功结果包含 `id`、`svg`、`cached` 和 `attempts`；`attempts=0` 表示命中已复检缓存，其余值表示本次服务端模型调用次数。
- 失败结果包含 `id`、`svg: null`、`error`、`code`、`retryable` 和 `attempts`，不生成占位 SVG。
- `/api/render/figure` 仍支持单图请求，但不接受错误的 `figures` 字段替代。
- Node、Worker 与前端共用同一 SVG 质量分析器；服务端还执行缓存复检，前端再使用浏览器 XML 解析器复检根节点、几何图元和 path 数据。
- 服务端拒绝截断或畸形 XML、非 XML 命名实体、危险元素与属性、外部资源、非法命名空间、无效 viewBox、非法 path 参数、隐藏或定义区伪图形以及只有白色背景的 SVG。
- 机器可读质量失败码包括 `EMPTY_RESPONSE`、`MISSING_SVG`、`TRUNCATED_SVG`、`XML_MALFORMED`、`XML_INVALID_ENTITY`、`DANGEROUS_ELEMENT`、`DANGEROUS_ATTRIBUTE`、`EXTERNAL_RESOURCE`、`INVALID_NAMESPACE`、`INVALID_VIEWBOX`、`INVALID_VISIBLE_NOTATION`、`INVALID_PATH_DATA`、`NO_GEOMETRY`。
- 批量接口逐题串行调用模型；单题服务端最多尝试三次。前端只重试失败题，不重新请求已成功题目；确定性输入错误不重试。
- `figure.description` 是内部绘图指令，允许 `A(0,4)`、`y=x^2` 等 ASCII 精确关系，禁止 LaTeX、私有标记、公式定界符和 Markdown。
- SVG 可见内容不得包含 `LATEXSLASH`、`@@BS@@`、`[[LATEX]]`、裸 LaTeX 命令、公式定界符或美元公式；上下标由 SVG `tspan` 或路径正确排版。

## 公式契约

- 最终接口字符串只使用 `\\(...\\)` 行内公式或 `\\[...\\]` 独立公式；公式内部为标准 LaTeX。
- 化学式允许使用 KaTeX mhchem 扩展的 `\\ce{...}`，前端已打包 mhchem 扩展；不支持的复杂语法必须在服务端审核阶段拒绝。
- 服务端不得把 LaTeX 转成 Unicode，不得删除反斜杠命令。
- 前端使用 KaTeX `throwOnError: true` 渲染；无法解析的公式使页面显示可识别的错误状态并阻止导出。
- 普通文本换行在进入 KaTeX 前处理，禁止对 KaTeX 生成的 HTML/SVG 再做全局换行替换。
- Word 导出生成标准 `.docx` OOXML 包；每个 KaTeX 公式读取规范 MathML，删除 annotation 后转换为 `<m:oMath>` 原生公式，题图 SVG 单独转为已验证的 2 倍像素 PNG。
- mhchem 为贴合上下标生成的零宽 `mpadded/mphantom` 节点必须先结构化还原为真实 `msub/msup/msubsup` 基元素；空箭头上下限被移除，禁止把幻影 `X` 写入成品。
- 转换结果删除无效的 `m:sty m:val="undefined"`，并拒绝 MathML、KaTeX DOM、LaTeX 定界符、裸命令、私有传输标记和非法 OMML 样式。
- Word 下载前执行完整性断言：`<m:oMath>` 数量与预览公式数量完全一致，DrawingML 题图数量与预览题图一致，`word/media/` 只能出现 `figure-*.png`，不得存在公式图片。
- OMML 中所有 `<m:t>` 文本必须转义 XML 保留字符；未经转义的 `<`、`>`、裸 `&` 直接阻止导出。KaTeX `cases` 产生的普通花括号与矩阵必须规范化为可拉伸 `<m:d>` 定界符。
- Word 最终质量门按 OOXML 结构、正文可见文本、OMML 可见文本分别检查；不得用全 XML 宽泛正则替代节点语义，也不得把构建器内部属性误判为用户公式源码。
- Word 选项每项独立成段，避免长公式在四栏 Tab 布局中与 A-D 标签分离；公式对象仍保持 OMML 可编辑性。
- PDF 导出使用 `210mm` A4 边框盒、左右各 `16mm` 对称内边距和每页 `10mm` 上下页边距；只把 `.q-figure svg` 题图转换为 Canvas，禁止转换 KaTeX 内部 SVG。
- PDF 截图分页读取渲染后的实际像素范围。高度不超过一页的 `.question-item` 与 `.answer-item` 整块换页；父块超过一页时改用其直接语义子块，题组/答案标题至少与首个子块同行。切点不得穿过任何选定原子范围，单个语义子块超过整页则阻止导出。
- PDF 分页输入必须同时包含物理 `canvasHeight` 与最后可见语义内容的 `contentHeight`。A4 `min-height`、底部内边距、折叠区域和其他结构性白区只能存在于物理画布，不得延长分页终点或生成尾页。
- PDF 每个切片继续执行非白像素质量门：先缩略采样，样本不足时读取原始画布条带复核。真正的空白中间页仍阻止导出，禁止删除质量门或静默丢弃任意空白切片。
- PDF 画布以白底 RGB 逐像素无损合成，使用 PNG Predictor 11 与浏览器原生 Deflate 生成单一 Flate 图像流；所有页面通过别名复用该图像，不允许逐页重新 PNG 编码或降低 scale。
- PDF 裁剪矩形必须以 `style=null` 保留路径，再执行 `clip/discardPath`；默认描边会消费路径并使安全切片失效，造成相邻页内容重复。

## 前端选择与题图尺寸契约

- `selectedQuestions` 仍是唯一选择状态源；全选状态由“已选数量是否等于生成题目数量”派生，不保存第二份布尔状态。
- 点击“全选”把全部有效题目索引写入集合；再次点击“取消全选”清空集合；单题切换后按钮文案、`aria-pressed` 与选中数必须立即同步。
- 无题目时全选按钮禁用；图形生成期间仍可选题，但组卷按钮继续受图形完整性质量门控制。
- 所有生成 SVG 采用 `400:300` 内容画布，页面显示框统一为 `280px × 210px`，移动端按容器等比缩小。

## 不变量

1. 所有考点题量之和等于题型计数之和。
2. 生成题目总数等于所有考点配置题量之和。
3. 每道题只能属于一个知识点、一个考点和一个题型。
4. 带图题未获得有效 SVG 时不得进入组卷预览。
5. 公式失败、图形失败、AI 审核失败均不得静默降级输出低质量内容。
6. 用户可见内容和 SVG 中不得残留内部传输标记或裸公式源码。
7. 单个任务内生成批次串行，整卷最多并行两个命题任务。
8. Word 公式必须是可编辑 OMML，不得使用公式图片、裸 MathML、裸 LaTeX 或普通文本伪公式。
9. 继续生成必须固定追加 3 题，携带当前组卷续题凭证，题组和逐题来源完全一致；任一校验或新题题图失败时原题不变。
10. PDF 页边界不得穿过题目或答案原子范围；Word 题图缓存只复用已经通过像素非空校验的结果。
11. 一个题组最多存在一个继续生成事务；不同题组事务互不取消、互不覆盖，最终提交时题号和内部索引必须唯一。
12. 当前导出完整性不得依赖任何会在导出过程中执行容量淘汰的全局缓存。
13. 内容错误允许进入独立审题纠正，但结构错误不得借纠正流程绕过 `submit_exam` 唯一结构；任何最终结果都必须重新通过完整质量门。
14. PDF 性能优化不得降低画布 scale、改用有损编码或放宽分页保护；Word 序列化优化不得改变公式语义或退回图片公式。
15. PDF 最后一页必须与至少一个可见语义内容范围相交；物理画布尾部留白不得单独成为页面，稀疏公式和短答案不得被缩略采样误判为空白。

## 前端本地连接契约

| 场景 | API 基地址 | 凭据策略 |
|---|---|---|
| 页面由 `localhost:5100` 或 `127.0.0.1:5100` 提供 | 同源 `/api` | `include` |
| 本地页面由其他端口提供 | 当前主机的 `5100/api` | `include` |
| 直接打开本地文件 | `http://127.0.0.1:5100/api` | `include` |
| 非本地部署 | 同源 `/api` | `include` |

- 请求封装将相对 `/api/...` 规范化为上述实际地址。
- 网络不可达时抛出带 `API_NETWORK_UNAVAILABLE` 代码的中文错误，不返回裸浏览器异常。
