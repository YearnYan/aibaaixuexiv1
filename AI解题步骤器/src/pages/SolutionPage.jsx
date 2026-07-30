import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  FileQuestion,
  FileText,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FinalAnswerPanel from '../components/FinalAnswerPanel.jsx';
import FileDropzone from '../components/FileDropzone.jsx';
import ReportDocument from '../components/ReportDocument.jsx';
import ScientificText from '../components/ScientificText.jsx';
import StepPanel from '../components/StepPanel.jsx';
import { isCurrentContentSession } from '../content-version.js';
import { exportReportToPdf, exportReportToWord } from '../export/report-export.js';

const SUBJECTS = ['自动识别', '数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];
const GRADES = [
  '自动识别',
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三',
];

export default function SolutionPage() {
  const [subject, setSubject] = useState('自动识别');
  const [grade, setGrade] = useState('自动识别');
  const [file, setFile] = useState(null);
  const [session, setSession] = useState(null);
  const [expandedStep, setExpandedStep] = useState(0);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState(null);
  const workspaceRef = useRef(null);
  const reportRef = useRef(null);

  useEffect(() => {
    let active = true;
    const previousSessionId = window.sessionStorage.getItem('solutionSessionId');
    if (previousSessionId) {
      api.getSession(previousSessionId)
        .then((data) => {
          if (active) {
            if (isCurrentContentSession(data)) {
              setSession(data);
              setExpandedStep(0);
            } else {
              window.sessionStorage.removeItem('solutionSessionId');
              setNotice({ type: 'error', text: '历史结果使用旧公式格式，请重新上传题目生成。' });
            }
          }
        })
        .catch(() => window.sessionStorage.removeItem('solutionSessionId'));
    }
    return () => { active = false; };
  }, []);

  function showError(error) {
    setNotice({ type: 'error', text: error.message || '操作失败，请稍后重试。' });
  }

  function handleFile(nextFile) {
    if (nextFile && nextFile.size > 10 * 1024 * 1024) {
      setNotice({ type: 'error', text: '文件不能超过 10 MB。' });
      return;
    }
    setNotice(null);
    setFile(nextFile);
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    if (!file) {
      setNotice({ type: 'error', text: '请先上传需要分析的题目文件。' });
      return;
    }
    setBusyAction('analyze');
    setNotice(null);
    try {
      const data = await api.analyze({ subject, grade, file });
      if (!isCurrentContentSession(data)) {
        throw new Error('当前服务仍是旧版本，请使用最新服务重新生成。');
      }
      setSession(data);
      setExpandedStep(0);
      window.sessionStorage.setItem('solutionSessionId', data.sessionId);
      setNotice({ type: 'success', text: '四步解题指导和完整答案已生成，点击模块即可查看。' });
      requestAnimationFrame(() => {
        if (window.innerWidth <= 820) workspaceRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusyAction('');
    }
  }

  async function handleExport(format) {
    if (!session || !reportRef.current) return;
    setBusyAction(format);
    setNotice(null);
    try {
      if (format === 'pdf') {
        await exportReportToPdf(reportRef.current, session);
      } else {
        await exportReportToWord(session);
      }
      setNotice({
        type: 'success',
        text: `${format === 'pdf' ? 'PDF' : 'Word'} 完整报告已开始下载。`,
      });
    } catch (error) {
      console.error('报告导出失败', error);
      setNotice({ type: 'error', text: '报告生成失败，请刷新页面后重试。' });
    } finally {
      setBusyAction('');
    }
  }

  return (
    <main className="app-shell">
      <aside className="input-sidebar">
        <div className="brand-row">
          <div>
            <h1>AI解题步骤</h1>
            <p>从分步理解到完整规范作答</p>
          </div>
        </div>

        <form className="analysis-form" onSubmit={handleAnalyze}>
          <label className="field-label" htmlFor="subject">学科</label>
          <select id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={Boolean(busyAction)}>
            {SUBJECTS.map((item) => <option key={item}>{item}</option>)}
          </select>

          <label className="field-label" htmlFor="grade">年级</label>
          <select id="grade" value={grade} onChange={(event) => setGrade(event.target.value)} disabled={Boolean(busyAction)}>
            {GRADES.map((item) => <option key={item}>{item}</option>)}
          </select>

          <span className="field-label">上传题目</span>
          <FileDropzone file={file} onChange={handleFile} disabled={Boolean(busyAction)} />

          {notice && (
            <div className={`inline-notice is-${notice.type}`} role="status">
              {notice.type === 'success'
                ? <CheckCircle2 size={20} aria-hidden="true" />
                : <AlertCircle size={20} aria-hidden="true" />}
              <span>{notice.text}</span>
            </div>
          )}

          <button className="generate-button" type="submit" disabled={Boolean(busyAction)}>
            {busyAction === 'analyze'
              ? <LoaderCircle className="spin" size={28} aria-hidden="true" />
              : <Sparkles size={27} aria-hidden="true" />}
            <span>{busyAction === 'analyze' ? '正在分析题目...' : '生成分步引导'}</span>
          </button>
        </form>
      </aside>

      <section className="solution-workspace" ref={workspaceRef}>
        <header className="workspace-header">
          <h2>分步解题路径</h2>
        </header>

        {!session ? (
          <div className="workspace-empty">
            <FileQuestion size={64} strokeWidth={1.3} aria-hidden="true" />
            <h3>等待生成解题路径</h3>
            <p>上传一道题目，AI 将生成四步解题路径和完整答案。</p>
          </div>
        ) : (
          <>
            <div className="problem-summary">
              <strong>题目摘要：</strong>
              <ScientificText>{session.problemSummary}</ScientificText>
            </div>

            <div className="step-list">
              {session.steps.map((step) => (
                <StepPanel
                  key={step.index}
                  step={step}
                  total={session.steps.length}
                  isActive={step.index === expandedStep}
                  onToggle={() => setExpandedStep(step.index)}
                />
              ))}
              <FinalAnswerPanel
                answer={session.finalAnswer}
                isActive={expandedStep === 4}
                onToggle={() => setExpandedStep(4)}
              />
            </div>

            <section className="report-downloads" aria-label="下载完整报告">
              <div>
                <h3>下载完整报告</h3>
                <p>包含题目摘要、知识点、四步指导、完整答案与规范公式排版</p>
              </div>
              <div className="report-download-actions">
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  disabled={Boolean(busyAction)}
                >
                  {busyAction === 'pdf'
                    ? <LoaderCircle className="spin" size={22} aria-hidden="true" />
                    : <FileDown size={22} aria-hidden="true" />}
                  <span>{busyAction === 'pdf' ? '正在生成 PDF...' : '下载 PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('word')}
                  disabled={Boolean(busyAction)}
                >
                  {busyAction === 'word'
                    ? <LoaderCircle className="spin" size={22} aria-hidden="true" />
                    : <FileText size={22} aria-hidden="true" />}
                  <span>{busyAction === 'word' ? '正在生成 Word...' : '下载 Word'}</span>
                </button>
              </div>
            </section>

            <ReportDocument ref={reportRef} session={session} />
          </>
        )}
      </section>
    </main>
  );
}
