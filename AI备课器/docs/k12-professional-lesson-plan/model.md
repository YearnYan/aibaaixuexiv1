# K12 专业教案 V2 数据模型

## 接口

`POST /api/generate`

请求结构保持不变：

```json
{
  "form": {},
  "files": [],
  "config": {}
}
```

响应中的 `plan` 扩展为 V2 教案模型。

## Plan 字段

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| title | string | 是 | 非空 | 教案标题 |
| standardsAlignment | object | 是 | 子字段均为非空字符串 | 课标、核心素养、单元定位、课时价值 |
| learnerProfile | object | 是 | 子字段为字符串或字符串数组 | 已知基础、学习障碍、常见误区、差异点 |
| learningAnalysis | string | 是 | 非空 | 综合学情判断 |
| goals | string[] | 是 | 2-5 项 | 可观察的学习目标 |
| goalEvidence | object[] | 是 | 与目标逐项对应 | 目标、学习证据、成功标准 |
| focus | string | 是 | 分行写重点与难点 | 教学重难点 |
| breakthroughStrategies | string[] | 是 | 至少 2 项 | 重难点突破策略 |
| preparation | string[] | 是 | 包含教师、学生、资源 | 教学准备 |
| flow | FlowStep[] | 是 | 时间总和等于课时长度 | 教学过程 |
| questionChain | QuestionItem[] | 是 | 至少 3 项 | 问题链 |
| questions | string[] | 是 | 至少 3 项 | 兼容字段 |
| practice | PracticeItem[] | 是 | 至少 3 层 | 随堂分层练习 |
| homeworkDesign | HomeworkItem[] | 是 | 至少 2 层 | 作业设计 |
| homework | string[] | 是 | 至少 2 项 | 兼容字段 |
| blackboard | string | 是 | 使用换行呈现层级 | 板书设计 |
| assessmentRubric | RubricItem[] | 是 | 至少 3 项 | 评价量规 |
| evaluation | string[] | 是 | 至少 3 项 | 兼容字段 |
| contingencies | string[] | 是 | 至少 2 项 | 课堂预案 |
| observationPoints | string[] | 是 | 至少 3 项 | 课堂观察点 |
| reflection | string[] | 是 | 至少 4 项 | 课后反思栏目 |

## FlowStep

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| index | number | 是 | 从 1 连续递增 | 环节序号 |
| name | string | 是 | 非空 | 环节名称 |
| taskGoal | string | 是 | 非空 | 本环节目标 |
| context | string | 是 | 非空 | 情境或任务 |
| teacherAction | string | 是 | 可执行 | 教师动作 |
| studentAction | string | 是 | 可执行 | 学生动作 |
| learningProduct | string | 是 | 可观察 | 学习产出 |
| scaffold | string | 是 | 非空 | 支架与分层支持 |
| design | string | 是 | 非空 | 设计意图 |
| evaluation | string | 是 | 可观察 | 评价证据和反馈 |
| time | number | 是 | 正整数 | 分钟 |
| tone | string | 是 | blue/green/yellow/orange/purple/teal | 展示色 |

## QuestionItem

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| question | string | 是 | 非空 |
| intent | string | 是 | 说明对应目标或认知层次 |
| expectedResponse | string | 是 | 给出关键要点，不替代完整答案 |
| followUp | string | 是 | 给出追问或纠偏问题 |

## PracticeItem

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| level | string | 是 | 基础/提升/拓展等 |
| text | string | 是 | 非空 |
| purpose | string | 是 | 对应目标或误区 |
| successCriteria | string | 是 | 可核验 |
| referenceAnswer | string | 是 | 简明答案或要点 |

## HomeworkItem

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| level | string | 是 | 必做/选做/挑战等 |
| task | string | 是 | 非空 |
| purpose | string | 是 | 非空 |
| estimatedMinutes | number | 是 | 正整数，符合学段总量要求 |
| feedback | string | 是 | 明确批改或反馈方式 |

## RubricItem

| 字段 | 类型 | 必需 | 约束 |
|---|---|---:|---|
| dimension | string | 是 | 非空 |
| achieved | string | 是 | 可观察 |
| developing | string | 是 | 可观察 |
| evidence | string | 是 | 课堂或作业证据 |

## 不变量与兼容性

- `flow.time` 总和必须等于 `form.duration`。
- V2 新字段缺失时，由服务端补充默认值，不影响旧字段渲染。
- `questions` 从 `questionChain.question` 派生或保持原值。
- `homework` 从 `homeworkDesign.task` 派生或保持原值。
- `evaluation` 从 `assessmentRubric.achieved` 派生或保持原值。
- 不允许生成超出课程标准难度、机械重复或惩罚性作业。

## 最小响应示例

```json
{
  "plan": {
    "title": "《春》第一课时备课方案",
    "standardsAlignment": {
      "courseStandard": "依据本学段课程标准中的阅读与鉴赏要求组织学习。",
      "coreLiteracy": "语言运用、思维能力、审美创造",
      "unitPosition": "本课承担单元写景散文阅读方法建构任务。",
      "lessonValue": "建立从语言证据体会景物特点与作者情感的方法。"
    },
    "flow": [
      {
        "index": 1,
        "name": "情境导入",
        "taskGoal": "激活观察经验",
        "context": "校园春景观察",
        "teacherAction": "展示图片并提出观察问题",
        "studentAction": "描述观察结果并说明依据",
        "learningProduct": "一条含感官依据的口头表达",
        "scaffold": "提供颜色、声音、气息三个观察角度",
        "design": "连接生活经验与文本学习",
        "evaluation": "依据表达是否具体进行即时反馈",
        "time": 5,
        "tone": "blue"
      }
    ]
  }
}
```
