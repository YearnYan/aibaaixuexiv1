"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ClipboardList,
  FileText,
  FileSearch,
  Flag,
  Gauge,
  Layers3,
  ListChecks,
  Loader2,
  Lock,
  Radar,
  ShieldAlert,
  Target,
  TrendingUp,
  Upload,
  X
} from "lucide-react";

const gradeOptions = ["小学高年级", "初一", "初二", "初三", "高一", "高二", "高三", "成人考试"];
const subjectOptions = ["数学", "语文", "英语", "物理", "化学", "历史/道法", "多科综合"];
const examDateOptions = ["3天内", "1周内", "2周内", "1个月内", "待定"];
const goalOptions = ["及格突破", "稳住基础分", "冲刺高分", "压轴题突破", "查漏补缺"];

const previewReport = {
  summary: "当前主要失分来自概念混淆、题型转化慢和考前计划不聚焦，建议按优先级集中突破。",
  studentProfile: {
    grade: "初三",
    subject: "多科综合",
    examDate: "3天内",
    goal: "冲刺高分"
  },
  weakPoints: [
    { name: "函数与导数综合应用", subject: "数学", reason: "概念混淆，题型转化不到位", lostScore: 16 },
    { name: "阅读理解主旨题", subject: "语文", reason: "抓不住中心思想，细节判断失误", lostScore: 12 },
    { name: "物理力学综合题", subject: "物理", reason: "受力分析不完整，公式应用不当", lostScore: 11 },
    { name: "化学实验探究题", subject: "化学", reason: "实验现象与结论对应不清", lostScore: 9 },
    { name: "英语完形填空", subject: "英语", reason: "语境理解不足，固定搭配掌握弱", lostScore: 8 }
  ],
  priorities: [
    { level: "P1", title: "函数与导数综合应用", subject: "数学", description: "高频考点 | 提分空间大 | 易短期突破", stars: 5 },
    { level: "P2", title: "阅读理解主旨题", subject: "语文", description: "高频考点 | 提分空间大 | 易短期突破", stars: 4 },
    { level: "P3", title: "物理力学综合题", subject: "物理", description: "中高频考点 | 提分空间大 | 需强化训练", stars: 4 },
    { level: "P4", title: "化学实验探究题", subject: "化学", description: "中频考点 | 提分空间中等 | 稳扎稳打", stars: 2 },
    { level: "P5", title: "英语完形填空", subject: "英语", description: "中频考点 | 提分空间中等 | 积累为主", stars: 2 }
  ],
  schedule: [
    { day: "Day 1", title: "突破高优先级（P1）", actions: ["函数与导数核心题型集中训练", "整理错题本，归纳解题模板"] },
    { day: "Day 2", title: "攻克次高优先级（P2）", actions: ["阅读理解主旨题技巧强化", "真题专项训练，错题复盘"] },
    { day: "Day 3", title: "巩固提升 + 全真演练", actions: ["P3-P5 重点题型巩固", "全真模拟测试，查漏补缺"] }
  ],
  mustMaster: {
    core: ["函数单调性与极值求解步骤", "导数应用的常见题型结论", "阅读理解主旨句识别方法", "物理受力分析基本思路", "化学常见实验现象与结论"],
    drill: ["函数与导数中档题 × 10 题", "阅读理解主旨题 × 10 篇", "力学综合题 × 6 题", "化学实验探究题 × 6 题", "完形填空 × 10 篇"]
  },
  risks: [
    { title: "时间分配风险", detail: "注意大题时间控制，避免因小题丢分过多。" },
    { title: "粗心失分风险", detail: "计算、单位、符号等细节需反复检查。" },
    { title: "知识盲区风险", detail: "回顾错题本，确保相似题型不再失分。" },
    { title: "状态波动风险", detail: "考前保持规律作息，避免熬夜影响发挥。" },
    { title: "考试物品风险", detail: "提前准备好准考证、文具，避免临场慌乱。" }
  ],
  fullReport: {
    executiveConclusion: "样本显示当前提分瓶颈集中在“概念识别、题型迁移、限时取舍”三处。短期策略应从扩大学习范围转向高权重失分点压缩，用三天完成一次从诊断到复盘的闭环。",
    diagnosis: "从现有表现看，短期提分的关键不是扩大学习范围，而是把高频、易错、可模板化的题型集中打穿。",
    kpis: [
      { label: "预计可抢分", value: "18-26分", level: "高", caption: "来自P1-P3高权重失分点" },
      { label: "资料可信度", value: "86%", level: "稳", caption: "错题、练习痕迹与目标一致" },
      { label: "冲刺优先级", value: "P1-P3", level: "急", caption: "三天内必须先处理" },
      { label: "执行负荷", value: "中高", level: "可控", caption: "需限时训练和复盘同步" }
    ],
    dataQuality: {
      sampleSize: "5份学习资料 / 近阶段错题与练习样本",
      confidence: "中高可信",
      coverage: "覆盖基础题、中档题、综合题与限时训练线索",
      sourceSummary: "资料能反映主要失分题型，但仍建议补充最近一次整卷限时测试用于校准时间分配。"
    },
    evidenceMatrix: [
      { dimension: "知识掌握", finding: "核心概念能识别，但遇到综合表述时边界模糊。", evidence: "多处错误集中在题干条件转换和公式适用范围。", impact: "中档题失分放大", action: "建立概念触发词清单，逐题标出适用条件。" },
      { dimension: "题型迁移", finding: "熟悉母题，变式题稳定性下降。", evidence: "同一知识点在新情境下出现重复犹豫。", impact: "P1/P2可抢分空间最大", action: "按“母题-变式-压轴拆解”三段训练。" },
      { dimension: "过程规范", finding: "步骤表达和检查意识不足。", evidence: "部分答案有思路但缺少关键推导或单位。", impact: "容易丢过程分", action: "把易漏步骤做成考前勾选项。" },
      { dimension: "时间策略", finding: "后段题耗时过长，挤压检查时间。", evidence: "难题停留时间超过收益阈值。", impact: "基础分回收不足", action: "设置8分钟止损线，先保稳定分。" }
    ],
    lossModel: [
      { factor: "概念辨析误差", score: 32, weight: "35%", interpretation: "是当前最大失分来源，优先处理。" },
      { factor: "题型迁移失败", score: 27, weight: "30%", interpretation: "通过同源变式训练可快速改善。" },
      { factor: "步骤规范缺口", score: 18, weight: "20%", interpretation: "用模板化答题能回收过程分。" },
      { factor: "时间分配波动", score: 13, weight: "15%", interpretation: "需要通过限时整卷演练压稳。" }
    ],
    abilityRadar: [
      { name: "概念准确度", value: 62, benchmark: 80 },
      { name: "题型识别", value: 58, benchmark: 78 },
      { name: "计算稳定性", value: 70, benchmark: 82 },
      { name: "步骤规范", value: 55, benchmark: 76 },
      { name: "限时策略", value: 60, benchmark: 75 }
    ],
    topicClusters: [
      { name: "函数与导数", lossRate: "高", priority: "P1", signal: "概念和变式迁移同时失分" },
      { name: "阅读主旨题", lossRate: "中高", priority: "P2", signal: "定位信息后未能抽象中心" },
      { name: "力学综合", lossRate: "中", priority: "P3", signal: "受力图与公式链条不完整" },
      { name: "实验探究", lossRate: "中", priority: "P4", signal: "现象到结论的映射不稳" }
    ],
    scorePlan: ["先守住基础题和中档题，避免稳定分流失。", "P1-P3 每天做限时训练，形成解题节奏。", "错题复盘只写触发条件、关键步骤和下次提醒。"],
    dailyPlan: ["上午处理数学/物理等计算型内容，保持专注。", "下午安排语文/英语理解题，训练信息定位。", "晚上只复盘错题和模板，不再大量开新题。"],
    interventionPlan: [
      { phase: "Day 1", title: "高权重漏洞封堵", focus: "P1失分点", actions: ["重做同源错题", "提炼公式触发条件", "整理3条易错提醒"], kpi: "P1同类题正确率提升到80%" },
      { phase: "Day 2", title: "变式迁移训练", focus: "P2-P3题型", actions: ["限时完成变式题", "标注题干关键词", "复盘错误路径"], kpi: "变式题平均耗时下降20%" },
      { phase: "Day 3", title: "整卷节奏校准", focus: "时间与检查", actions: ["120分钟全真模拟", "执行止损线", "最后10分钟查高频错误"], kpi: "基础题失分控制在可接受范围" }
    ],
    timeAllocation: [
      { task: "P1专项突破", minutes: 70, reason: "最高权重失分点，短期收益最大" },
      { task: "P2/P3变式训练", minutes: 55, reason: "训练题型识别和迁移能力" },
      { task: "错题复盘压缩", minutes: 35, reason: "把错误原因转成考前可执行清单" },
      { task: "整卷限时演练", minutes: 120, reason: "校准时间分配和取舍策略" }
    ],
    examChecklist: ["开考前先浏览全卷，标记熟题和高分题。", "每完成一个大题检查单位、符号、条件是否漏写。", "最后 10 分钟优先查计算题和答题卡填涂。"],
    materialReview: ["资料显示题型转换速度偏慢，需减少无目标刷题。", "错题原因集中在审题和关键步骤遗漏。", "建议把易错点压缩成一页考前速查清单。"],
    riskControls: [
      { risk: "过度刷题", trigger: "连续做新题但错因没有变化", control: "停止开新题，回到错因归类和母题复盘" },
      { risk: "压轴题沉没成本", trigger: "单题超过8分钟仍无路径", control: "先写可得步骤，转向可回收分题目" },
      { risk: "考前焦虑加码", trigger: "临时增加大量新资料", control: "只使用已诊断清单和必背必练清单" }
    ],
    parentNotes: ["不临时加码新资料，避免增加焦虑。", "提醒孩子按计划休息和进食。", "只关注执行完成度，不反复追问分数。"]
  }
};

function asArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function normalizeReport(input) {
  const base = previewReport;
  const report = input && typeof input === "object" ? input : {};
  const fullReport = report.fullReport || {};
  return {
    ...base,
    ...report,
    weakPoints: asArray(report.weakPoints, base.weakPoints).slice(0, 5),
    priorities: asArray(report.priorities, base.priorities).slice(0, 5),
    schedule: asArray(report.schedule, base.schedule).slice(0, 3),
    mustMaster: {
      core: asArray(report.mustMaster?.core, base.mustMaster.core).slice(0, 5),
      drill: asArray(report.mustMaster?.drill, base.mustMaster.drill).slice(0, 5)
    },
    risks: asArray(report.risks, base.risks).slice(0, 5),
    fullReport: {
      ...base.fullReport,
      ...fullReport,
      kpis: asArray(fullReport.kpis, base.fullReport.kpis).slice(0, 4),
      evidenceMatrix: asArray(fullReport.evidenceMatrix, base.fullReport.evidenceMatrix).slice(0, 6),
      lossModel: asArray(fullReport.lossModel, base.fullReport.lossModel).slice(0, 5),
      abilityRadar: asArray(fullReport.abilityRadar, base.fullReport.abilityRadar).slice(0, 6),
      topicClusters: asArray(fullReport.topicClusters, base.fullReport.topicClusters).slice(0, 6),
      interventionPlan: asArray(fullReport.interventionPlan, base.fullReport.interventionPlan).slice(0, 4),
      timeAllocation: asArray(fullReport.timeAllocation, base.fullReport.timeAllocation).slice(0, 6),
      riskControls: asArray(fullReport.riskControls, base.fullReport.riskControls).slice(0, 5)
    }
  };
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function starLine(count = 0, muted = false) {
  const full = Math.max(0, Math.min(5, Number(count) || 0));
  return (
    <span className={muted ? "stars stars-muted" : "stars"}>
      {"★".repeat(full)}
      {"☆".repeat(5 - full)}
    </span>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span>
        <b>*</b> {label}
      </span>
      <div className="select-shell">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">请选择{label}</option>
          {options.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={18} />
      </div>
    </label>
  );
}

function SectionTitle({ icon: Icon, title, aside }) {
  return (
    <div className="section-title">
      <div>
        <Icon size={26} />
        <h3>{title}</h3>
      </div>
      {aside ? <span>{aside}</span> : null}
    </div>
  );
}

export default function Home() {
  const inputRef = useRef(null);
  const [form, setForm] = useState({ grade: "", subject: "", examDate: "", goal: "" });
  const [files, setFiles] = useState([]);
  const [report, setReport] = useState(previewReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showFullReport, setShowFullReport] = useState(false);

  const totalFileSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addFiles(nextFiles) {
    const accepted = Array.from(nextFiles || []).filter((file) => file.size <= 50 * 1024 * 1024);
    setFiles((current) => {
      const map = new Map(current.map((file) => [`${file.name}-${file.size}`, file]));
      accepted.forEach((file) => map.set(`${file.name}-${file.size}`, file));
      return Array.from(map.values()).slice(0, 8);
    });
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function generateReport() {
    if (!form.grade || !form.subject || !form.examDate || !form.goal) {
      setError("请先补全学段、科目、考试时间和当前目标。");
      return;
    }

    setLoading(true);
    setError("");

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.append(key, value));
    files.forEach((file) => body.append("files", file));

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ? `${data.error} ${data.detail}` : data.error || "AI 分析失败");
      }

      setReport(normalizeReport(data.report));
      setTimeout(() => {
        document.getElementById("report-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err) {
      setError(err.message || "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <h1>
            AI考前<span>抢分清单</span>
          </h1>
          <p>上传学习资料，AI生成个性化考前抢分清单，精准提分</p>
        </div>
      </header>

      <div className="workspace">
        <aside className="input-panel">
          <div className="panel-title">
            <h2>任务输入区</h2>
          </div>
          <div className="input-body">
            <SelectField label="学段/年级" value={form.grade} options={gradeOptions} onChange={(value) => updateForm("grade", value)} />
            <SelectField label="科目" value={form.subject} options={subjectOptions} onChange={(value) => updateForm("subject", value)} />
            <SelectField label="考试时间" value={form.examDate} options={examDateOptions} onChange={(value) => updateForm("examDate", value)} />
            <SelectField label="当前目标" value={form.goal} options={goalOptions} onChange={(value) => updateForm("goal", value)} />

            <section className="upload-field">
              <h3>
                <b>*</b> 上传学习资料（可多选）
              </h3>
              <button
                className={dragActive ? "dropzone is-dragging" : "dropzone"}
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  addFiles(event.dataTransfer.files);
                }}
              >
                <Upload size={54} strokeWidth={2.2} />
                <strong>点击或拖拽文件到此处上传</strong>
                <span>支持 PDF / Word / PNG / JPG</span>
                <em>单个文件 ≤50MB</em>
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.md"
                onChange={(event) => addFiles(event.target.files)}
              />
              {files.length ? (
                <div className="file-list">
                  <div className="file-list-head">
                    <span>{files.length} 个文件</span>
                    <span>{formatFileSize(totalFileSize)}</span>
                  </div>
                  {files.map((file, index) => (
                    <div className="file-chip" key={`${file.name}-${file.size}`}>
                      <FileText size={16} />
                      <span>{file.name}</span>
                      <small>{formatFileSize(file.size)}</small>
                      <button type="button" onClick={() => removeFile(index)} aria-label={`移除 ${file.name}`}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {error ? <div className="error-box">{error}</div> : null}

            <button className="generate-btn" type="button" disabled={loading} onClick={generateReport}>
              {loading ? <Loader2 className="spin" size={26} /> : <ClipboardList size={28} />}
              {loading ? "AI分析中..." : "生成抢分清单"}
            </button>
            <p className="security-note">
              <Lock size={16} /> 资料仅用于生成报告，安全加密处理
            </p>
          </div>
        </aside>

        <section className="report-panel" id="report-panel">
          <div className="panel-title report-title">
            <Target size={31} />
            <h2>抢分作战地图</h2>
          </div>

          <div className="report-body">
            <div className="steps-strip">
              {[
                { icon: Target, no: "1", title: "失分点", text: "找出关键失分原因" },
                { icon: ListChecks, no: "2", title: "优先级", text: "确定抢分优先顺序" },
                { icon: CalendarDays, no: "3", title: "三天行动", text: "制定三天冲刺计划" },
                { icon: ShieldAlert, no: "4", title: "风险排查", text: "考前风险全面排查" }
              ].map((step, index, items) => {
                const Icon = step.icon;
                return (
                  <div className="step-item" key={step.no}>
                    <div className="step-content">
                      <Icon size={39} />
                      <div>
                        <strong>
                          <span>{step.no}</span> {step.title}
                        </strong>
                        <p>{step.text}</p>
                      </div>
                    </div>
                    {index < items.length - 1 ? <b className="step-arrow">→</b> : null}
                  </div>
                );
              })}
            </div>

            <div className="top-grid">
              <section className="report-card weak-card">
                <SectionTitle icon={AlertTriangle} title="关键失分点" aside="Top 5" />
                <div className="weak-list">
                  {report.weakPoints.map((item, index) => (
                    <article className="weak-item" key={`${item.name}-${index}`}>
                      <div className="rank">{index + 1}</div>
                      <div className="weak-copy">
                        <h4 title={item.name}>
                          <span className="one-line-title">{item.name}</span>
                          <small>{item.subject}</small>
                        </h4>
                        <p>{item.reason}</p>
                      </div>
                      <div className="lost-score">
                        失分 <b>{Number(item.lostScore) || 0}</b> 分
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="report-card priority-card">
                <SectionTitle icon={Flag} title="抢分优先级" aside="按优先级从高到低" />
                <div className="priority-list">
                  {report.priorities.map((item, index) => (
                    <article className="priority-item" key={`${item.level}-${item.title}`}>
                      <div className={`priority-badge p${Math.min(index + 1, 5)}`}>{item.level || `P${index + 1}`}</div>
                      <div className="priority-copy">
                        <h4 title={`${item.title}（${item.subject || "综合"}）`}>
                          <span className="one-line-title">{item.title}</span>
                          <em>（{item.subject || "综合"}）</em>
                        </h4>
                        <p>{item.description}</p>
                      </div>
                      {starLine(item.stars, index > 2)}
                    </article>
                  ))}
                </div>
              </section>

              <section className="report-card schedule-card">
                <SectionTitle icon={CalendarDays} title="三天冲刺安排" />
                <div className="schedule-list">
                  {report.schedule.map((item, index) => (
                    <article className="day-row" key={`${item.day}-${index}`}>
                      <div className="day-badge">{item.day || `Day ${index + 1}`}</div>
                      <div className="day-copy">
                        <h4 title={item.title}>
                          <span className="one-line-title">{item.title}</span>
                        </h4>
                        <ul>
                          {asArray(item.actions, []).slice(0, 3).map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ul>
                      </div>
                      {index < report.schedule.length - 1 ? <span className="day-arrow">↓</span> : null}
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="bottom-grid">
              <section className="report-card checklist-card">
                <SectionTitle icon={ClipboardList} title="必背必练清单" />
                <div className="check-columns">
                  <div>
                    <h4>必背清单（核心知识点）</h4>
                    {report.mustMaster.core.map((item) => (
                      <p key={item}>
                        <CheckCircle2 size={18} /> {item}
                      </p>
                    ))}
                  </div>
                  <div>
                    <h4>必练清单（高频题型）</h4>
                    {report.mustMaster.drill.map((item) => (
                      <p key={item}>
                        <CheckCircle2 size={18} /> {item}
                      </p>
                    ))}
                  </div>
                </div>
              </section>

              <section className="report-card risk-card">
                <SectionTitle icon={AlertTriangle} title="考前风险提醒" />
                <div className="risk-list">
                  {report.risks.map((item) => (
                    <p key={`${item.title}-${item.detail}`}>
                      <CheckCircle2 size={18} />
                      <span>
                        <b>{item.title}：</b>
                        {item.detail}
                      </span>
                    </p>
                  ))}
                </div>
              </section>
            </div>

            <div className="report-actions">
              <button type="button" onClick={() => setShowFullReport(true)}>
                <ClipboardList size={24} /> 查看完整内容
              </button>
              <p>
                <Lock size={16} /> 报告内容仅供学生个人学习使用，请勿外传
              </p>
            </div>
          </div>
        </section>
      </div>

      {showFullReport ? <FullReportModal report={report} onClose={() => setShowFullReport(false)} /> : null}
    </main>
  );
}

function FullReportModal({ report, onClose }) {
  const full = report.fullReport || previewReport.fullReport;
  const kpis = asArray(full.kpis, previewReport.fullReport.kpis);
  const evidenceMatrix = asArray(full.evidenceMatrix, previewReport.fullReport.evidenceMatrix);
  const lossModel = asArray(full.lossModel, previewReport.fullReport.lossModel);
  const abilityRadar = asArray(full.abilityRadar, previewReport.fullReport.abilityRadar);
  const topicClusters = asArray(full.topicClusters, previewReport.fullReport.topicClusters);
  const interventionPlan = asArray(full.interventionPlan, previewReport.fullReport.interventionPlan);
  const timeAllocation = asArray(full.timeAllocation, previewReport.fullReport.timeAllocation);
  const riskControls = asArray(full.riskControls, previewReport.fullReport.riskControls);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="full-modal" role="dialog" aria-modal="true" aria-label="完整报告" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head report-head">
          <div>
            <span>AI SCORE BOOST INTELLIGENCE REPORT</span>
            <h2>AI考前抢分清单详情报告</h2>
            <p>基于上传资料、错题信号、目标窗口与冲刺周期生成的专业提分分析</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭完整报告">
            <X size={24} />
          </button>
        </div>

        <div className="report-scroll-body">
          <section className="executive-band">
            <div className="executive-copy">
              <span>EXECUTIVE SUMMARY</span>
              <h3>综合诊断结论</h3>
              <p>{full.executiveConclusion || full.diagnosis}</p>
            </div>
            <div className="quality-card">
              <FileSearch size={24} />
              <b>{full.dataQuality?.confidence || "中高可信"}</b>
              <p>{full.dataQuality?.coverage || "覆盖核心失分信号与冲刺执行线索"}</p>
            </div>
          </section>

          <section className="kpi-grid">
            {kpis.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.level}</em>
                <p>{item.caption}</p>
              </article>
            ))}
          </section>

          <section className="analysis-layout">
            <article className="analysis-card wide">
              <ReportBlockTitle icon={BarChart3} title="失分归因模型" subtitle="按失分贡献权重拆解短期提分抓手" />
              <div className="loss-model">
                {lossModel.map((item) => (
                  <div className="loss-row" key={item.factor}>
                    <div>
                      <b>{item.factor}</b>
                      <span>{item.interpretation}</span>
                    </div>
                    <div className="bar-track">
                      <i style={{ width: `${Math.min(100, Number(item.score) || 0)}%` }} />
                    </div>
                    <strong>{item.weight}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="analysis-card">
              <ReportBlockTitle icon={Radar} title="能力雷达" subtitle="当前表现与目标线差距" />
              <div className="radar-list">
                {abilityRadar.map((item) => {
                  const value = Math.min(100, Number(item.value) || 0);
                  const benchmark = Math.min(100, Number(item.benchmark) || 0);
                  return (
                    <div key={item.name}>
                      <div>
                        <span>{item.name}</span>
                        <b>{value}</b>
                      </div>
                      <div className="radar-track">
                        <i className="benchmark" style={{ left: `${benchmark}%` }} />
                        <em style={{ width: `${value}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="analysis-card">
              <ReportBlockTitle icon={Layers3} title="题型簇扫描" subtitle="按优先级聚类定位突破口" />
              <div className="cluster-list">
                {topicClusters.map((item) => (
                  <div key={`${item.priority}-${item.name}`}>
                    <b>{item.priority}</b>
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.signal}</p>
                    </div>
                    <span>{item.lossRate}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="evidence-section">
            <ReportBlockTitle icon={BrainCircuit} title="资料证据矩阵" subtitle="从上传资料中抽取可解释的失分证据与行动建议" />
            <div className="evidence-table">
              {evidenceMatrix.map((item) => (
                <article key={item.dimension}>
                  <div className="evidence-dimension">{item.dimension}</div>
                  <div>
                    <b>发现</b>
                    <p>{item.finding}</p>
                  </div>
                  <div>
                    <b>证据</b>
                    <p>{item.evidence}</p>
                  </div>
                  <div>
                    <b>影响</b>
                    <p>{item.impact}</p>
                  </div>
                  <div>
                    <b>动作</b>
                    <p>{item.action}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="plan-section">
            <ReportBlockTitle icon={TrendingUp} title="三阶段抢分干预方案" subtitle="把诊断结论转成可执行、可验收的冲刺动作" />
            <div className="intervention-grid">
              {interventionPlan.map((item) => (
                <article key={`${item.phase}-${item.title}`}>
                  <span>{item.phase}</span>
                  <h3>{item.title}</h3>
                  <b>{item.focus}</b>
                  {asArray(item.actions, []).map((action) => (
                    <p key={action}>
                      <CheckCircle2 size={17} /> {action}
                    </p>
                  ))}
                  <em>{item.kpi}</em>
                </article>
              ))}
            </div>
          </section>

          <section className="analysis-layout compact">
            <article className="analysis-card">
              <ReportBlockTitle icon={Clock3} title="时间投入配比" subtitle="按边际收益分配训练时间" />
              <div className="time-list">
                {timeAllocation.map((item) => (
                  <div key={item.task}>
                    <strong>{item.minutes}min</strong>
                    <span>{item.task}</span>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="analysis-card">
              <ReportBlockTitle icon={Gauge} title="考前风控机制" subtitle="提前定义触发条件与止损动作" />
              <div className="control-list">
                {riskControls.map((item) => (
                  <div key={item.risk}>
                    <b>{item.risk}</b>
                    <p>触发：{item.trigger}</p>
                    <span>控制：{item.control}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="classic-grid">
            <MiniList title="提分路径" items={asArray(full.scorePlan, previewReport.fullReport.scorePlan)} />
            <MiniList title="每日执行" items={asArray(full.dailyPlan, previewReport.fullReport.dailyPlan)} />
            <MiniList title="考前检查" items={asArray(full.examChecklist, previewReport.fullReport.examChecklist)} />
            <MiniList title="资料诊断" items={asArray(full.materialReview, previewReport.fullReport.materialReview)} />
            <MiniList title="家长协同" items={asArray(full.parentNotes, previewReport.fullReport.parentNotes)} />
          </section>
        </div>
      </section>
    </div>
  );
}

function ReportBlockTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="report-block-title">
      <Icon size={22} />
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function MiniList({ title, items }) {
  return (
    <article>
      <h3>{title}</h3>
      {items.map((item) => (
        <p key={item}>
          <CheckCircle2 size={17} /> {item}
        </p>
      ))}
    </article>
  );
}
