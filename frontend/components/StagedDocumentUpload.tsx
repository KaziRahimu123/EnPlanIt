"use client";

/**
 * StagedDocumentUpload — local file staging before a mission exists.
 *
 * Files are validated and held in component state. No upload happens here.
 * The parent (Create Mission page) reads `stagedFiles` after the mission is
 * created and calls uploadDocument() for each one.
 *
 * Supports PDF, TXT, DOCX. Max 20 MB per file, max 10 files total.
 */

import { useRef, useState } from "react";

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".docx", ".md"];
const MAX_SIZE_MB = 20;
const MAX_FILES = 3;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? "." + parts.pop()!.toLowerCase() : "";
}

function FileTypeTag({ name }: { name: string }) {
  const ext = fileExt(name).replace(".", "").toUpperCase() || "?";
  return (
    <div className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] flex items-center justify-center shrink-0 text-[10px] font-bold text-[var(--text-muted)] uppercase mt-0.5">
      {ext}
    </div>
  );
}

export interface StagedDocumentUploadProps {
  /** Controlled — parent owns the file list */
  files: File[];
  onChange: (files: File[]) => void;
  /** When true, disable all interactions (during mission submission) */
  disabled?: boolean;
}

export default function StagedDocumentUpload({
  files,
  onChange,
  disabled = false,
}: StagedDocumentUploadProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function validate(incoming: File[]): string | null {
    for (const f of incoming) {
      const ext = fileExt(f.name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return `"${f.name}" — unsupported type. Allowed: PDF, TXT, DOCX, MD.`;
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        return `"${f.name}" exceeds ${MAX_SIZE_MB} MB limit.`;
      }
      if (f.size === 0) {
        return `"${f.name}" is empty.`;
      }
    }
    if (files.length + incoming.length > MAX_FILES) {
      return `Maximum ${MAX_FILES} documents per mission.`;
    }
    return null;
  }

  function handleFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    if (!arr.length) return;
    setValidationError(null);

    // Deduplicate by name+size
    const existing = new Set(files.map((f) => `${f.name}:${f.size}`));
    const novel = arr.filter((f) => !existing.has(`${f.name}:${f.size}`));

    const err = validate(novel);
    if (err) {
      setValidationError(err);
      return;
    }

    onChange([...files, ...novel]);
  }

  function removeFile(index: number) {
    setValidationError(null);
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="8" height="11" rx="1" stroke="var(--text-muted)" strokeWidth="1.2" />
            <path d="M4 4h5M4 6.5h5M4 9h3" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" />
            <path d="M8 1v3h3" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            Supporting Documents
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">
            {files.length}/{MAX_FILES}
          </span>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || files.length >= MAX_FILES}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
        >
          + Add Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.docx,.md"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Drop zone — shown when no files staged yet */}
      {files.length === 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!disabled) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`m-4 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center py-8 px-6 text-center ${
            disabled
              ? "border-[var(--border)] opacity-50 cursor-not-allowed"
              : dragOver
              ? "border-[var(--accent)] bg-[var(--accent)]/5 cursor-pointer"
              : "border-[var(--border-bright)] hover:border-[var(--accent)]/50 cursor-pointer"
          }`}
        >
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="mb-3 opacity-40">
            <rect x="4" y="6" width="16" height="20" rx="2" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M16 6v5h5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M22 22h4M24 20v4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
            Drop files here or click to select
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            PDF, TXT, DOCX, MD — max {MAX_SIZE_MB} MB each · optional
          </p>
        </div>
      )}

      {/* Staged file list */}
      {files.length > 0 && (
        <div className="divide-y divide-[var(--border)]">
          {files.map((file, i) => (
            <div
              key={`${file.name}:${file.size}:${i}`}
              className="px-5 py-3.5 flex items-start gap-3"
            >
              <FileTypeTag name={file.name} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[240px]">
                  {file.name}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] mt-0.5">
                  <span>{formatBytes(file.size)}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--border)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Staged
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={disabled}
                className="shrink-0 text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}

          {/* Add more */}
          {files.length < MAX_FILES && !disabled && (
            <div className="px-5 py-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-[var(--accent-glow)] hover:underline"
              >
                + Add more files
              </button>
            </div>
          )}
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-red-300">
          ⚠ {validationError}
        </div>
      )}
    </div>
  );
}
