import { useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  File,
  FileSearch,
  GraduationCap,
  UploadCloud,
  X,
} from "lucide-react";

interface AnalyzeRequest {
  subject: string;
  grade: string;
  notes: string;
  files: File[];
}

interface InputPanelProps {
  analyzing: boolean;
  onAnalyze: (request: AnalyzeRequest) => void;
}

const subjects = ["数学", "语文", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治", "通用"];
const grades = [
  "小学一年级",
  "小学二年级",
  "小学三年级",
  "小学四年级",
  "小学五年级",
  "小学六年级",
  "初中一年级",
  "初中二年级",
  "初中三年级",
  "高中一年级",
  "高中二年级",
  "高中三年级",
];

const MAX_FILES = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

export function InputPanel({ analyzing, onAnalyze }: InputPanelProps) {
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("初中二年级");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const replaceFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;

    const oversized = incoming.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      setFiles([]);
      setFileError(`“${oversized.name}”超过 15 MB`);
      return;
    }
    if (incoming.length > MAX_FILES) {
      setFiles([]);
      setFileError("一次最多上传 5 个文件");
      return;
    }

    setFileError("");
    setFiles(incoming);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    replaceFiles(Array.from(event.dataTransfer.files));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (files.length === 0) {
      setFileError("请先上传题目、试卷或作业文件");
      inputRef.current?.focus();
      return;
    }
    onAnalyze({ subject, grade, notes, files });
  };

  return (
    <aside className="input-panel" aria-label="题目资料">
      <form onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="subject">
          学科
        </label>
        <div className="select-shell">
          <BookOpen aria-hidden="true" />
          <select id="subject" value={subject} onChange={(event) => setSubject(event.target.value)}>
            {subjects.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <ChevronDown className="select-arrow" aria-hidden="true" />
        </div>

        <label className="field-label" htmlFor="grade">
          年级
        </label>
        <div className="select-shell">
          <GraduationCap aria-hidden="true" />
          <select id="grade" value={grade} onChange={(event) => setGrade(event.target.value)}>
            {grades.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <ChevronDown className="select-arrow" aria-hidden="true" />
        </div>

        <label className="field-label upload-label" htmlFor="question-files">
          上传题目、试卷或作业
        </label>
        <div
          className={`upload-zone${dragging ? " is-dragging" : ""}${files.length ? " has-files" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            id="question-files"
            className="visually-hidden"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.md"
            onChange={(event) => {
              replaceFiles(Array.from(event.target.files || []));
              event.target.value = "";
            }}
          />
          <UploadCloud className="upload-icon" size={76} strokeWidth={1.45} aria-hidden="true" />
          <strong>{files.length ? `已选择 ${files.length} 个文件` : "点击或拖拽文件到此处上传"}</strong>
          <span>PDF / Word / PNG / JPG</span>
        </div>

        {files.length > 0 ? (
          <div className="selected-files" aria-label="已选择文件">
            {files.map((file, index) => (
              <div className="selected-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
                <File size={16} aria-hidden="true" />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {fileError ? <p className="field-error">{fileError}</p> : null}

        <div className="notes-heading">
          <label className="field-label" htmlFor="notes">
            补充说明
          </label>
          <span>（可选）</span>
        </div>
        <div className="textarea-shell">
          <textarea
            id="notes"
            value={notes}
            maxLength={200}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={"例如：来源、章节、题目背景、\n已知条件补充说明等…"}
          />
          <span>{notes.length} / 200</span>
        </div>

        <button className="analyze-button" type="submit" disabled={analyzing}>
          {analyzing ? <span className="button-spinner" aria-hidden="true" /> : <FileSearch size={29} />}
          {analyzing ? "正在审题分析" : "开始审题分析"}
        </button>
      </form>
    </aside>
  );
}
