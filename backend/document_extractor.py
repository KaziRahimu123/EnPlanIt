"""Document text extraction utilities for EnPlanIt Scenario Lab.

Supports PDF, TXT, and DOCX. Returns (chunks, page_count, word_count).
Each chunk carries a page_number for citation traceability.
Text is treated as untrusted input — never trusted as mission facts
until validated by the AI extraction step.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Target chunk size in characters (~600–800 words) — keeps AI context manageable
_CHUNK_CHARS = 3000
# Overlap between consecutive chunks (character count)
_CHUNK_OVERLAP = 300


def validate_file_signature(content: bytes, file_type: str) -> tuple[bool, Optional[str]]:
    """
    Validate MIME type and file magic bytes/signature against declared file_type.
    Prevents disguised binaries, corrupted payloads, or arbitrary file execution.
    """
    if not content:
        return False, "File is empty (0 bytes)."

    ft = file_type.lower().strip().lstrip(".")

    # Disallow known executable magic headers regardless of declared extension
    if content.startswith(b"\x7fELF"):
        return False, "Executable binaries (ELF) are not permitted."
    if content.startswith(b"MZ"):
        return False, "Executable binaries (DOS/PE) are not permitted."
    if content.startswith((b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe")):
        return False, "Executable binaries (Mach-O / Java bytecode) are not permitted."

    if ft == "pdf":
        # PDF magic bytes: %PDF-
        if not content.startswith(b"%PDF"):
            # Check if there's minor preamble (up to 1024 bytes)
            if b"%PDF" not in content[:1024]:
                return False, "Invalid PDF: missing '%PDF' header signature."
        return True, None

    elif ft == "docx":
        # DOCX is an OpenXML ZIP container starting with PK\x03\x04
        if not content.startswith(b"PK\x03\x04"):
            return False, "Invalid DOCX: missing ZIP container signature."
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                namelist = zf.namelist()
                if not any("word/" in name or "[Content_Types].xml" in name for name in namelist):
                    return False, "Invalid DOCX: missing WordprocessingML document structure."
        except Exception as exc:
            return False, f"Invalid DOCX archive: {exc}"
        return True, None

    elif ft in ("txt", "md"):
        # Text / Markdown files: ensure no binary null bytes in initial chunk
        null_count = content[:2048].count(b"\x00")
        if null_count > 0:
            return False, "Binary file detected with text file extension."
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content.decode("latin-1")
            except Exception as exc:
                return False, f"Invalid text encoding: {exc}"
        return True, None

    return False, f"Unsupported file format '{file_type}'."


def extract_text_from_pdf(content: bytes) -> list[dict[str, Any]]:
    """
    Extract text from a PDF. Returns a list of page dicts:
      [{"page": 1, "text": "..."}, ...]
    """
    from pypdf import PdfReader  # deferred — only import when needed
    reader = PdfReader(io.BytesIO(content))
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = _clean_text(text)
        if text.strip():
            pages.append({"page": i + 1, "text": text})
    return pages


def extract_text_from_docx(content: bytes) -> list[dict[str, Any]]:
    """
    Extract text from a DOCX. DOCX files have no intrinsic page numbers —
    returns a single page dict with page=None.
    """
    from docx import Document  # deferred
    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    full_text = "\n".join(paragraphs)
    full_text = _clean_text(full_text)
    if not full_text.strip():
        return []
    return [{"page": None, "text": full_text}]


def extract_text_from_txt(content: bytes) -> list[dict[str, Any]]:
    """
    Extract text from a plain-text file.
    Tries UTF-8 first, then Latin-1 as fallback.
    """
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1", errors="replace")
    text = _clean_text(text)
    if not text.strip():
        return []
    return [{"page": None, "text": text}]


def _clean_text(text: str) -> str:
    """Normalize whitespace, unwrap broken PDF line breaks, and remove control characters."""
    if not text:
        return ""
    text = text.replace("\x00", "")
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Fix PDF extraction where every single word or short token is on its own line:
    lines = [line.strip() for line in text.split("\n")]
    cleaned_paragraphs: list[str] = []
    current_para: list[str] = []

    for line in lines:
        if not line:
            if current_para:
                cleaned_paragraphs.append(" ".join(current_para))
                current_para = []
            continue

        # Detect headers, list bullets, or section dividers that SHOULD be on their own line
        is_header_or_bullet = (
            line.startswith(("=", "-", "•", "*", "#", "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.", "Phase"))
            or (line.endswith(":") and len(line) < 60)
            or (line.isupper() and len(line) < 40)
        )

        if is_header_or_bullet:
            if current_para:
                cleaned_paragraphs.append(" ".join(current_para))
                current_para = []
            cleaned_paragraphs.append(line)
        elif len(line.split()) <= 3 and len(line) < 30:
            # Line with 1-3 words from vertical PDF formatting — accumulate into paragraph
            current_para.append(line)
        else:
            if current_para:
                current_para.append(line)
                cleaned_paragraphs.append(" ".join(current_para))
                current_para = []
            else:
                cleaned_paragraphs.append(line)

    if current_para:
        cleaned_paragraphs.append(" ".join(current_para))

    result = "\n".join(cleaned_paragraphs)
    # Collapse excess spaces and newlines
    result = re.sub(r"[ \t]+", " ", result)
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


def chunk_pages(
    pages: list[dict[str, Any]],
    chunk_chars: int = _CHUNK_CHARS,
    overlap: int = _CHUNK_OVERLAP,
) -> list[dict[str, Any]]:
    """
    Split page texts into overlapping chunks. Returns:
      [{"chunk_index": 0, "page_number": 1, "text": "...", "word_count": N}, ...]

    For multi-page documents, chunks do not span page boundaries
    (simpler and better for citation accuracy).
    For single-page / no-page docs, sliding-window chunking is applied.
    """
    chunks: list[dict[str, Any]] = []
    chunk_index = 0

    for page_info in pages:
        page_num = page_info["page"]
        text = page_info["text"]

        if not text.strip():
            continue

        # For short pages, emit as a single chunk
        if len(text) <= chunk_chars:
            chunks.append({
                "chunk_index": chunk_index,
                "page_number": page_num,
                "text": text,
                "word_count": len(text.split()),
            })
            chunk_index += 1
        else:
            # Sliding window within this page/section
            start = 0
            while start < len(text):
                end = min(start + chunk_chars, len(text))
                chunk_text = text[start:end].strip()
                if chunk_text:
                    chunks.append({
                        "chunk_index": chunk_index,
                        "page_number": page_num,
                        "text": chunk_text,
                        "word_count": len(chunk_text.split()),
                    })
                    chunk_index += 1
                if end == len(text):
                    break
                start = end - overlap

    return chunks


def extract_and_chunk(
    content: bytes,
    file_type: str,
) -> tuple[list[dict[str, Any]], int, int]:
    """
    Top-level entry point. Extracts text and returns:
      (chunks, page_count, total_word_count)

    file_type: 'pdf' | 'txt' | 'docx'
    """
    try:
        ft = file_type.lower().strip(".")
        if ft == "pdf":
            pages = extract_text_from_pdf(content)
        elif ft == "docx":
            pages = extract_text_from_docx(content)
        elif ft in ("txt", "md"):
            pages = extract_text_from_txt(content)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")

        chunks = chunk_pages(pages)
        page_count = max((p["page"] for p in pages if p.get("page")), default=0)
        word_count = sum(c["word_count"] for c in chunks)
        return chunks, page_count, word_count

    except Exception as exc:
        logger.warning("Text extraction failed for %s: %s", file_type, exc)
        raise
