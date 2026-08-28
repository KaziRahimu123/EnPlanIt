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
from typing import Any

logger = logging.getLogger(__name__)

# Target chunk size in characters (~600–800 words) — keeps AI context manageable
_CHUNK_CHARS = 3000
# Overlap between consecutive chunks (character count)
_CHUNK_OVERLAP = 300


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
