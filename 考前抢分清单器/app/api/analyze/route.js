export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.AI_BASE_URL || "https://cccapi.top/v1";
const MODEL = process.env.AI_MODEL || "gemini-3.5-flash";
const API_KEY = process.env.AI_API_KEY;

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_TEXT_CHARS = 26000;

function trimText(text, max = MAX_TEXT_CHARS) {
  if (!text) return "";
  const cleaned = text.replace(/\u0000/g, " ").replace(/\s{3,}/g, "\n\n").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}\n\n【内容已截断，仅保留前 ${max} 字用于分析】` : cleaned;
}

function pickMime(fileName, fileType) {
  if (fileType) return fileType;
  if (/\.(jpg|jpeg)$/i.test(fileName)) return "image/jpeg";
  if (/\.png$/i.test(fileName)) return "image/png";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  return "application/octet-stream";
}

async function parsePdf(buffer) {
  const mod = await import("pdf-parse");
  const pdfParse = mod.default || mod;
  const parsed = await pdfParse(buffer);
  return parsed.text || "";
}

async function parseDocx(buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractFileSignal(file) {
  const name = file.name || "未命名资料";
  const type = file.type || "";
  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.byteLength > MAX_FILE_BYTES) {
    return {
      summary: `资料《${name}》超过 50MB，已跳过。`,
      text: "",
      imagePart: null
    };
  }

  const lowerName = name.toLowerCase();
  const isImage = type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(lowerName);
  const isPdf = type === "application/pdf" || lowerName.endsWith(".pdf");
  const isDocx =
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx");
  const isText = type.startsWith("text/") || /\.(txt|md|csv)$/i.test(lowerName);

  if (isImage) {
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return {
        summary: `图片《${name}》较大，已记录文件名，但未传入视觉模型。`,
        text: `图片资料：${name}，文件较大，建议用户压缩后重新上传以获得图像细节分析。`,
        imagePart: null
      };
    }

    const mime = pickMime(name, type);
    return {
      summary: `图片资料《${name}》已作为视觉输入。`,
      text: `图片资料：${name}`,
      imagePart: {
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${buffer.toString("base64")}`
        }
      }
    };
  }

  try {
    if (isPdf) {
      const text = await parsePdf(buffer);
      return {
        summary: `PDF资料《${name}》已提取 ${text.length} 字。`,
        text: `【PDF：${name}】\n${trimText(text)}`,
        imagePart: null
      };
    }

    if (isDocx) {
      const text = await parseDocx(buffer);
      return {
        summary: `Word资料《${name}》已提取 ${text.length} 字。`,
        text: `【Word：${name}】\n${trimText(text)}`,
        imagePart: null
      };
    }

    if (isText) {
      const text = buffer.toString("utf8");
      return {
        summary: `文本资料《${name}》已提取 ${text.length} 字。`,
        text: `【文本：${name}】\n${trimText(text)}`,
        imagePart: null
      };
    }
  } catch (error) {
    return {
      summary: `资料《${name}》解析失败：${error.message}`,
      text: `资料《${name}》解析失败，模型只能基于文件名和表单信息判断。`,
      imagePart: null
    };
  }

  return {
    summary: `资料《${name}》格式暂未解析，仅记录文件名。`,
    text: `未解析资料：${name}`,
    imagePart: null
  };
}

function parseJsonFromModel(raw) {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function buildPrompt({ grade, subject, examDate, goal, fileSummaries, fileText }) {
  return `你是一名资深中高考提分规划师和教研负责人。请基于用户填写的信息与上传资料，生成一份可直接用于考前冲刺的“AI考前抢分清单”。

用户信息：
- 学段/年级：${grade || "未填写"}
- 科目：${subject || "未填写"}
- 考试时间：${examDate || "未填写"}
- 当前目标：${goal || "未填写"}

资料解析情况：
${fileSummaries.length ? fileSummaries.map((item) => `- ${item}`).join("\n") : "- 未上传资料"}

资料正文：
${fileText || "暂无可解析资料正文，请基于表单信息生成保守、可执行的冲刺方案。"}

请只返回合法 JSON，不要 Markdown，不要解释性前后缀。JSON 字段必须完整，结构如下：
{
  "summary": "80字以内总诊断",
  "studentProfile": {
    "grade": "学段/年级",
    "subject": "科目",
    "examDate": "考试时间",
    "goal": "当前目标"
  },
  "weakPoints": [
    {"name": "关键失分点名称，10字以内", "subject": "标签", "reason": "失分原因", "lostScore": 16}
  ],
  "priorities": [
    {"level": "P1", "title": "抢分主题，12字以内", "subject": "标签", "description": "考点层级 | 提分空间 | 训练策略", "stars": 5}
  ],
  "schedule": [
    {"day": "Day 1", "title": "当天目标，14字以内", "actions": ["行动1", "行动2"]}
  ],
  "mustMaster": {
    "core": ["核心知识点1", "核心知识点2"],
    "drill": ["训练任务1", "训练任务2"]
  },
  "risks": [
    {"title": "风险名称", "detail": "具体提醒"}
  ],
  "fullReport": {
    "executiveConclusion": "专业机构风格的执行摘要，160-220字，要引用上传资料呈现出的趋势，不要空泛",
    "diagnosis": "完整诊断，120字以内",
    "kpis": [
      {"label": "指标名称", "value": "指标值", "level": "等级", "caption": "一句话解释"}
    ],
    "dataQuality": {
      "sampleSize": "样本规模描述",
      "confidence": "可信度等级",
      "coverage": "覆盖范围",
      "sourceSummary": "上传资料质量与局限性说明"
    },
    "evidenceMatrix": [
      {"dimension": "分析维度", "finding": "核心发现", "evidence": "来自资料的证据或题型信号", "impact": "对得分的影响", "action": "对应行动"}
    ],
    "lossModel": [
      {"factor": "失分因素", "score": 32, "weight": "35%", "interpretation": "解释"}
    ],
    "abilityRadar": [
      {"name": "能力项", "value": 62, "benchmark": 80}
    ],
    "topicClusters": [
      {"name": "题型/知识簇", "lossRate": "高/中/低", "priority": "P1", "signal": "资料中体现的信号"}
    ],
    "scorePlan": ["提分路径1", "提分路径2"],
    "dailyPlan": ["每日安排1", "每日安排2"],
    "interventionPlan": [
      {"phase": "Day 1", "title": "阶段标题", "focus": "训练重点", "actions": ["动作1", "动作2"], "kpi": "验收指标"}
    ],
    "timeAllocation": [
      {"task": "训练任务", "minutes": 60, "reason": "分配理由"}
    ],
    "examChecklist": ["考试前检查项1", "考试前检查项2"],
    "materialReview": ["资料反映的问题1", "资料反映的问题2"],
    "riskControls": [
      {"risk": "风险", "trigger": "触发条件", "control": "控制动作"}
    ],
    "parentNotes": ["家长协作建议1", "家长协作建议2"]
  }
}

生成要求：
1. weakPoints 必须 5 条，按失分分值从高到低排列。
2. priorities 必须 5 条，level 固定为 P1-P5，stars 为 1-5。
3. schedule 必须 3 天，每天 2-3 个行动。
4. core 和 drill 各 5 条。
5. risks 必须 5 条。
6. 面板字段 weakPoints.name、priorities.title、schedule.title 必须短标题化，不能超过上述字数，避免前端换行。
7. fullReport 必须按专业数据分析报告写法生成：包含样本质量、失分贡献、题型聚类、证据矩阵、能力差距、时间配比、风控策略。
8. fullReport.kpis 必须 4 条；evidenceMatrix 至少 4 条；lossModel 至少 4 条且 score 为 0-100 数字；abilityRadar 至少 5 条且 value/benchmark 为 0-100 数字；topicClusters 至少 4 条；interventionPlan 必须 3 条；timeAllocation 至少 4 条；riskControls 至少 3 条。
9. 如果上传资料不足以支撑某个结论，要明确标注为“基于样本推断”，不要伪造不存在的原文。
10. 内容要具体、短句、可执行，避免空泛鼓励。`;
}

export async function POST(request) {
  if (!API_KEY) {
    return Response.json({ error: "服务端未配置 AI_API_KEY。" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const grade = String(formData.get("grade") || "");
    const subject = String(formData.get("subject") || "");
    const examDate = String(formData.get("examDate") || "");
    const goal = String(formData.get("goal") || "");
    const files = formData.getAll("files").filter((item) => typeof item?.arrayBuffer === "function");

    const signals = [];
    for (const file of files) {
      signals.push(await extractFileSignal(file));
    }

    const fileSummaries = signals.map((item) => item.summary);
    const imageParts = signals.map((item) => item.imagePart).filter(Boolean);
    const fileText = trimText(signals.map((item) => item.text).filter(Boolean).join("\n\n"), 32000);
    const prompt = buildPrompt({ grade, subject, examDate, goal, fileSummaries, fileText });

    const messageContent = [{ type: "text", text: prompt }, ...imageParts];
    const upstream = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content:
              "你是严谨的中文教研数据分析师，擅长把学习资料、错题样本和考试目标转化为专业提分诊断报告。只输出符合用户 JSON Schema 的 JSON，不要 Markdown。不要编造资料中不存在的原文引用；证据不足时明确写基于样本推断。"
          },
          {
            role: "user",
            content: messageContent
          }
        ]
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        {
          error: "AI 接口调用失败。",
          detail: detail.slice(0, 800)
        },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const report = parseJsonFromModel(raw);

    if (!report) {
      return Response.json(
        {
          error: "AI 返回内容不是合法 JSON，请稍后重试。",
          raw: raw.slice(0, 1200)
        },
        { status: 502 }
      );
    }

    return Response.json({
      report,
      meta: {
        model: MODEL,
        files: fileSummaries
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: "生成报告失败。",
        detail: error.message
      },
      { status: 500 }
    );
  }
}
