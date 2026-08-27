"use client";

/**
 * DocumentsPanel — upload, list, and manage mission documents.
 * Used on the Analysis page as a collapsible panel.
 *
 * Supports PDF, TXT, DOCX. Max 20MB, max 10 files per mission.
 * Shows extraction status and word/page counts.
 */

import { useRef, useState, useCallback } from "react";
import {
  uploadDocument,
  listDocuments,
  deleteDocument,
  type MissionDocument,
} from "@/lib/api";

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".docx", ".md"];
const MAX_SIZE_MB = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusPill({ status }: { status: MissionDocument["status"] }) {
  const cfg = {
    uploaded:   { label: "Uploaded",   cls: "border-[var(--border)] text-[var(--text-muted)]" },
    processing: { label: "Processing", cls: "border-[var(--accent)]/40 text-[var(--accent-glow)] animate-pulse" },
    ready:      { label: "Ready",      cls: "border-[var(--green)]/40 text-[var(--green)]" },
    error:      { label: "Error",      cls: "border-[var(--red)]/40 text-red-400" },
  }[status] ?? { label: status, cls: "border-[var(--border)] text-[var(--text-muted)]" };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

interface DocumentsPanelProps {
  missionId: string;
  initialDocuments: MissionDocument[];
  onDocumentsChange?: (docs: MissionDocument[]) => void;
}

export default function DocumentsPanel({
  missionId,
  initialDocuments,
  onDocumentsChange,
}: DocumentsPanelProps) {
  const [docs, setDocs] = useState<MissionDocument[]>(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateDocs = useCallback(
    (updated: MissionDocument[]) => {
      setDocs(updated);
      onDocumentsChange?.(updated);
    },
    [onDocumentsChange],
  );

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    if (!fileArr.length) return;

    setUploadError(null);

    // Client-side validation
    for (const f of fileArr) {
      const ext = f.name.includes(".")
        ? "." + f.name.split(".").pop()!.toLowerCase()
        : "";
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setUploadError(`"${f.name}" — unsupported type. Allowed: PDF, TXT, DOCX, MD.`);
        return;
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        setUploadError(`"${f.name}" exceeds ${MAX_SIZE_MB} MB limit.`);
        return;
      }
      if (f.size === 0) {
        setUploadError(`"${f.name}" is empty.`);
        return;
      }
    }

    if (docs.length + fileArr.length > 3) {
      setUploadError("Maximum limit of 3 documents per mission reached. Please delete an existing document first.");
      return;
    }

    setUploading(true);
    const newDocs: MissionDocument[] = [];
    const errors: string[] = [];

    for (const f of fileArr) {
      try {
        const doc = await uploadDocument(missionId, f);
        newDocs.push(doc);
      } catch (err) {
        errors.push(
          `"${f.name}": ${err instanceof Error ? err.message : "upload failed"}`,
        );
      }
    }

    // Refresh the full list from state
    updateDocs([...docs, ...newDocs]);
    setUploading(false);

    if (errors.length) {
      setUploadError(errors.join(" · "));
    }
  }

  async function handleDelete(docId: string) {
    if (confirmDeleteId !== docId) {
      setConfirmDeleteId(docId);
      return;
    }
    setDeletingId(docId);
    setConfirmDeleteId(null);
    try {
      await deleteDocument(missionId, docId);
      updateDocs(docs.filter((d) => d.id !== docId));
    } catch {
      setUploadError("Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
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
            Mission Documents
          </h2>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">{docs.length}/3</span>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || docs.length >= 3}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
        >
          {uploading ? (
            <>
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Uploading…
            </>
          ) : (
            <>+ Upload</>
          )}
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

      {/* Drop zone (shown when no docs) */}
      {docs.length === 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`m-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center py-10 px-6 text-center ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent)]/5"
              : "border-[var(--border-bright)] hover:border-[var(--accent)]/50"
          }`}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="mb-3 opacity-40">
            <rect x="4" y="6" width="16" height="20" rx="2" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M16 6v5h5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M22 22h4M24 20v4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
            Drop files here or click to upload
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            PDF, TXT, DOCX, MD — max {MAX_SIZE_MB} MB each
          </p>
        </div>
      )}

      {/* Document list */}
      {docs.length > 0 && (
        <div className="divide-y divide-[var(--border)]">
          {docs.map((doc) => (
            <div key={doc.id} className="px-5 py-3.5 flex items-start gap-3">
              {/* File type icon */}
              <div className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] flex items-center justify-center shrink-0 text-[10px] font-bold text-[var(--text-muted)] uppercase mt-0.5">
                {doc.file_type}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                    {doc.filename}
                  </span>
                  <StatusPill status={doc.status} />
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                  <span>{formatBytes(doc.file_size)}</span>
                  {doc.page_count ? <span>{doc.page_count} pages</span> : null}
                  {doc.word_count ? <span>{doc.word_count.toLocaleString()} words</span> : null}
                  {doc.status === "error" && doc.error_message && (
                    <span className="text-red-400" title={doc.error_message}>
                      ⚠ {doc.error_message.slice(0, 60)}
                    </span>
                  )}
                </div>
              </div>
              {/* Delete */}
              <div className="shrink-0">
                {confirmDeleteId === doc.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="text-xs text-red-400 hover:underline font-semibold"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-[var(--text-muted)] hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    {deletingId === doc.id ? "…" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add more button */}
          {docs.length < 10 && (
            <div className="px-5 py-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs text-[var(--accent-glow)] hover:underline disabled:opacity-50"
              >
                + Add more files
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {uploadError && (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-red-300">
          ⚠ {uploadError}
        </div>
      )}
    </div>
  );
}
