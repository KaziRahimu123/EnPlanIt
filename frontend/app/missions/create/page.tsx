"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createMission, uploadDocument } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import StagedDocumentUpload from "@/components/StagedDocumentUpload";

const EXAMPLE_PROMPTS = [
  "A crewed Mars surface mission lasting 18 months, relying on in-situ resource utilization for water and oxygen, with a crew of 4 specialists departing in 2031.",
  "Lunar polar base establishment using a series of robotic precursor missions followed by a 6-month crewed phase to install a permanent habitat module.",
  "Low Earth orbit debris removal demonstration using a solar-sail equipped nano-satellite swarm targeting 5 derelict rocket stages.",
];

function CreateMissionContent() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [missionName, setMissionName] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const charLimit = 5000;

  const isSubmitting = loading || uploadingDocs;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasDescription = description.trim().length >= 10;
    const hasFiles = stagedFiles.length > 0;

    if (!hasDescription && !hasFiles) {
      setError("Please describe your mission in at least 10 characters or upload a supporting document (PDF, TXT, DOCX, MD).");
      return;
    }
    setLoading(true);
    setError(null);

    const effectiveDescription = hasDescription
      ? description.trim()
      : `Mission profile initialized from attached document (${stagedFiles[0].name}).`;

    const defaultName = stagedFiles[0]?.name
      ? stagedFiles[0].name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")
      : undefined;

    let mission;
    try {
      mission = await createMission({
        description: effectiveDescription,
        name: missionName.trim() || defaultName || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Is the backend running?");
      setLoading(false);
      return;
    }
    setLoading(false);

    // Upload any staged documents sequentially
    if (stagedFiles.length > 0) {
      setUploadingDocs(true);
      const uploadErrors: string[] = [];
      for (let i = 0; i < stagedFiles.length; i++) {
        const file = stagedFiles[i];
        setUploadProgress(`Uploading and processing document ${i + 1} of ${stagedFiles.length}: ${file.name}`);
        try {
          await uploadDocument(mission.id, file);
        } catch (err) {
          uploadErrors.push(
            `"${file.name}": ${err instanceof Error ? err.message : "upload failed"}`,
          );
        }
      }
      setUploadingDocs(false);
      setUploadProgress(null);

      if (uploadErrors.length) {
        // Mission was created — navigate anyway but surface the upload warning
        setError(`Mission created, but some documents failed to upload: ${uploadErrors.join(" · ")}`);
        // Still navigate after a short pause so the user sees the warning
        setTimeout(() => router.push(`/analysis?missionId=${mission.id}`), 3000);
        return;
      }
    }

    router.push(`/analysis?missionId=${mission.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-3 uppercase tracking-widest">
          <span className="w-4 h-px bg-[var(--accent)]" />
          Mission Planning
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Create Mission</h1>
        <p className="text-[var(--text-muted)] text-sm">
          Describe your space mission concept in natural language or upload a mission dossier document (PDF, TXT, DOCX, MD).
          Our AI engine will extract flight parameters and synthesize the mission operations plan.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Mission name */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Mission Name <span className="text-[var(--text-muted)] normal-case">(optional — auto-generated from dossier if omitted)</span>
          </label>
          <input
            type="text"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder="e.g. Artemis Base Alpha Polar Survey"
            maxLength={100}
            disabled={isSubmitting}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-60"
          />
        </div>

        {/* Supporting documents */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Supporting Mission Dossier Documents{" "}
            <span className="text-[var(--text-muted)] normal-case">(up to 3 files)</span>
          </label>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Attach PDF, TXT, DOCX, or Markdown (MD) specifications. You can create a mission solely by uploading a dossier document.
          </p>
          <StagedDocumentUpload
            files={stagedFiles}
            onChange={setStagedFiles}
            disabled={isSubmitting}
          />
        </div>

        {/* Mission description */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Mission Description{" "}
            {stagedFiles.length > 0 ? (
              <span className="text-[var(--text-muted)] normal-case font-normal">(optional when documents are attached)</span>
            ) : (
              <span className="text-red-400">*</span>
            )}
          </label>
          <div className="relative">
            <textarea
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= charLimit) setDescription(e.target.value);
              }}
              placeholder={
                stagedFiles.length > 0
                  ? "Optional: Add additional mission directives, notes, or override parameters here (or leave blank to generate from document)…"
                  : "Describe your mission… Include destination, objectives, crew, duration, propulsion, key constraints, and any assumptions."
              }
              rows={9}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-y font-mono leading-relaxed disabled:opacity-60"
            />
            <div
              className={`absolute bottom-3 right-3 text-xs tabular-nums ${
                description.length > charLimit * 0.9
                  ? "text-[var(--amber)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {description.length} / {charLimit}
            </div>
          </div>
        </div>

        {/* Example prompts */}
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wider">
            Example prompts
          </p>
          <div className="space-y-2">
            {EXAMPLE_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                disabled={isSubmitting}
                onClick={() => setDescription(prompt)}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)] hover:bg-[var(--bg-card)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50"
              >
                <span className="text-[var(--accent)] mr-2">→</span>
                {prompt.slice(0, 120)}…
              </button>
            ))}
          </div>
        </div>

        {/* Upload progress */}
        {uploadProgress && (
          <div className="flex items-center gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3 text-sm text-[var(--text-primary)]">
            <svg className="animate-spin h-4 w-4 text-[var(--accent-glow)] shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-xs">{uploadProgress}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-4 py-3 text-sm text-red-300">
            ⚠ {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => { setDescription(""); setMissionName(""); setStagedFiles([]); setError(null); }}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={isSubmitting || (description.trim().length < 10 && stagedFiles.length === 0)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
              boxShadow: isSubmitting ? "none" : "0 0 16px rgba(59,130,246,0.3)",
            }}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Creating Mission…
              </>
            ) : uploadingDocs ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Uploading Documents…
              </>
            ) : (
              <>
                {stagedFiles.length > 0
                  ? `Create Mission & Upload ${stagedFiles.length} File${stagedFiles.length !== 1 ? "s" : ""}`
                  : "Create Mission"}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CreateMissionPage() {
  return (
    <RequireAuth>
      <CreateMissionContent />
    </RequireAuth>
  );
}
