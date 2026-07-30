import { FileText, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

const ACCEPTED = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md';

export default function FileDropzone({ file, onChange, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function selectFile(nextFile) {
    if (nextFile) onChange(nextFile);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) selectFile(event.dataTransfer.files?.[0]);
  }

  if (file) {
    return (
      <div className="file-selected" aria-live="polite">
        <FileText size={34} strokeWidth={1.8} aria-hidden="true" />
        <div className="file-selected-copy">
          <strong title={file.name}>{file.name}</strong>
          <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="移除文件"
          title="移除文件"
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`file-dropzone${dragging ? ' is-dragging' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={ACCEPTED}
        onChange={(event) => selectFile(event.target.files?.[0])}
        disabled={disabled}
      />
      <button
        type="button"
        className="dropzone-trigger"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <span className="upload-icon" aria-hidden="true"><Upload size={38} strokeWidth={1.9} /></span>
        <span>点击或拖拽文件到此处</span>
        <small>PDF / DOCX / PNG / JPG</small>
      </button>
    </div>
  );
}
