"""Documents router — secure multi-file upload for mission documents.

Supports PDF, TXT, and DOCX uploads.
Files are stored in Supabase Storage under:
  mission-documents/users/{safe_user_id}/missions/{mission_id}/{doc_id}/{safe_filename}

The raw Auth0 sub (e.g. "google-oauth2|116...") is never placed directly in the
storage path -- it is sanitized to remove characters that Supabase Storage rejects
(pipe, spaces, and anything outside [A-Za-z0-9_-]).

All endpoints enforce mission ownership via Auth0 JWT.
File validation is performed before any storage or DB write.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from auth0 import get_current_user
from supabase_client import get_supabase
import document_extractor
import doc_facts

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_TYPES = {"pdf", "txt", "docx", "md"}
MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB per file
MAX_FILES_PER_MISSION = 3
STORAGE_BUCKET = "mission-documents"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class DocumentResponse(BaseModel):
    id: str
    mission_id: str
    filename: str
    file_type: str
    file_size: int
    status: str
    page_count: Optional[int] = None
    word_count: Optional[int] = None
    error_message: Optional[str] = None
    uploaded_at: str
    processed_at: Optional[str] = None


class DocumentFactResponse(BaseModel):
    id: str
    category: str
    field_key: str
    label: str
    value: Optional[str] = None
    numeric_value: Optional[float] = None
    unit: Optional[str] = None
    state: str
    source_text: Optional[str] = None
    page_number: Optional[int] = None
    document_id: Optional[str] = None
    extracted_at: str


class MissionFactsResponse(BaseModel):
    mission_id: str
    facts: list[DocumentFactResponse]
    document_count: int
    has_documents: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_user_id(auth0_sub: str) -> str:
    """
    Produce a storage-safe segment from an Auth0 sub.

    Auth0 subs look like "auth0|abc123", "google-oauth2|116...",
    "windowslive|abc", etc.  The pipe character and any other characters
    outside [A-Za-z0-9_-] are replaced with underscores so Supabase
    Storage never receives an InvalidKey error.

    The result is capped at 64 characters to keep paths readable.
    """
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", auth0_sub)
    # Collapse consecutive underscores for readability
    safe = re.sub(r"_+", "_", safe).strip("_")
    return safe[:64] or "user"


def _safe_filename(name: str) -> str:
    """
    Sanitize an uploaded filename while preserving its extension.

    Only characters in [A-Za-z0-9_-.] are kept; everything else becomes '_'.
    The extension (pdf/txt/docx) is preserved exactly.  Max 80 chars for the
    stem so the full name stays well under 100 characters.
    """
    if "." in name:
        *parts, ext = name.rsplit(".", 1)
        stem = ".".join(parts)
        ext = ext.lower()
    else:
        stem = name
        ext = ""

    stem = re.sub(r"[^A-Za-z0-9_\-]", "_", stem)
    stem = re.sub(r"_+", "_", stem).strip("_")
    stem = stem[:80] or "document"

    return f"{stem}.{ext}" if ext else stem


def _get_file_type(filename: str) -> Optional[str]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext if ext in ALLOWED_TYPES else None


def _verify_mission_ownership(mission_id: str, auth0_sub: str) -> None:
    """Raise 404/403 if the mission doesn't exist or isn't owned by this user."""
    sb = get_supabase()
    result = (
        sb.table("missions")
        .select("id, auth0_sub")
        .eq("id", mission_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    if result.data[0]["auth0_sub"] != auth0_sub:
        raise HTTPException(status_code=403, detail="Access denied")


def _row_to_doc(row: dict) -> DocumentResponse:
    return DocumentResponse(
        id=row["id"],
        mission_id=row["mission_id"],
        filename=row["filename"],
        file_type=row["file_type"],
        file_size=row["file_size"],
        status=row["status"],
        page_count=row.get("page_count"),
        word_count=row.get("word_count"),
        error_message=row.get("error_message"),
        uploaded_at=row["uploaded_at"],
        processed_at=row.get("processed_at"),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{mission_id}/documents", response_model=DocumentResponse, status_code=201)
async def upload_document(
    mission_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> DocumentResponse:
    """
    Upload a mission document (PDF, TXT, DOCX).
    Validates ownership, file type, and size before storing.
    Extracts text synchronously and persists chunks + facts to Supabase.
    """
    auth0_sub = current_user["sub"]

    # 1. Ownership check
    _verify_mission_ownership(mission_id, auth0_sub)

    # 2. Count existing documents
    sb = get_supabase()
    count_res = (
        sb.table("mission_documents")
        .select("id")
        .eq("mission_id", mission_id)
        .execute()
    )
    if len(count_res.data or []) >= MAX_FILES_PER_MISSION:
        raise HTTPException(
            status_code=422,
            detail=f"Maximum limit of {MAX_FILES_PER_MISSION} documents per mission reached. Please delete an existing document first.",
        )

    # 3. Validate file type
    original_name = file.filename or "upload"
    file_type = _get_file_type(original_name)
    if not file_type:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_TYPES))}",
        )

    # 4. Read content and enforce size limit
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE_BYTES // (1024*1024)} MB.",
        )
    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    # 5. Build safe storage path
    #    Structure: users/{safe_user_id}/missions/{mission_id}/{doc_id}/{safe_filename}
    #    - safe_user_id  : Auth0 sub sanitized — no pipe, spaces, or special chars
    #    - doc_id        : generated now so path is unique and tied to the DB row
    #    - safe_filename : sanitized name with extension preserved for content-type sniffing
    safe_user = _safe_user_id(auth0_sub)
    safe_name = _safe_filename(original_name)
    doc_id_for_path = uuid.uuid4().hex  # also used as the DB row id below
    storage_path = f"users/{safe_user}/missions/{mission_id}/{doc_id_for_path}/{safe_name}"

    # 6. Upload to Supabase Storage
    try:
        sb.storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": _content_type(file_type)},
        )
    except Exception as exc:
        logger.error("Storage upload failed for %s: %s", storage_path, exc)
        # Surface a clean message — never expose raw Supabase internals
        detail = str(exc)
        if "InvalidKey" in detail or "invalid" in detail.lower() and "key" in detail.lower():
            detail = "Storage path contains invalid characters. This is a server configuration issue."
        elif "Bucket not found" in detail or "not found" in detail.lower():
            detail = f"Storage bucket '{STORAGE_BUCKET}' not found. Check Supabase Storage configuration."
        elif "row-level security" in detail.lower() or "rls" in detail.lower():
            detail = "Storage permission denied. Check Supabase Storage bucket policies."
        else:
            detail = "Document storage failed. Please try again."
        raise HTTPException(status_code=500, detail=detail)

    # 7. Insert document metadata row
    #    filename stores the original name for display; storage_path holds the sanitized key.
    now = datetime.now(timezone.utc).isoformat()
    doc_row = {
        "id": doc_id_for_path,          # reuse the uuid we put in the storage path
        "mission_id": mission_id,
        "auth0_sub": auth0_sub,
        "filename": original_name,      # original name kept for UI display
        "storage_path": storage_path,
        "file_type": file_type,
        "file_size": len(content),
        "status": "processing",
        "uploaded_at": now,
    }
    insert_res = sb.table("mission_documents").insert(doc_row).execute()
    doc_id = insert_res.data[0]["id"]

    # 8. Extract text, chunk, and persist
    try:
        chunks, page_count, word_count = document_extractor.extract_and_chunk(content, file_type)
        _persist_chunks(sb, doc_id, mission_id, auth0_sub, chunks)

        # 9. Extract facts via AI (non-blocking if AI unavailable)
        if chunks:
            doc_facts.extract_and_persist_facts(
                sb=sb,
                mission_id=mission_id,
                document_id=doc_id,
                auth0_sub=auth0_sub,
                chunks=chunks,
                file_type=file_type,
                filename=original_name,
            )

            # If the mission was initialized with a document placeholder description,
            # enrich the mission record with the actual extracted document text (up to 5,000 characters).
            try:
                m_res = sb.table("missions").select("id, name, description").eq("id", mission_id).limit(1).execute()
                if m_res.data:
                    curr_desc = m_res.data[0].get("description", "")
                    if (
                        curr_desc.startswith("Mission profile initialized from attached document")
                        or len(curr_desc) < 30
                        or curr_desc.startswith("[DOCUMENT:")
                    ):
                        # Query all chunks across all uploaded documents for this mission
                        all_chunks_res = (
                            sb.table("document_chunks")
                            .select("document_id, chunk_index, page_number, text")
                            .eq("mission_id", mission_id)
                            .order("chunk_index", desc=False)
                            .execute()
                        )
                        all_chunks = all_chunks_res.data or chunks
                        doc_snippet = " ".join(c["text"] for c in all_chunks).strip()
                        if len(doc_snippet) > 20:
                            clean_desc = doc_snippet[:5000].strip()
                            sb.table("missions").update({
                                "description": clean_desc,
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            }).eq("id", mission_id).execute()
            except Exception as enrich_err:
                logger.warning("Could not auto-enrich mission from document: %s", enrich_err)

        # 10. Mark document as ready
        processed_at = datetime.now(timezone.utc).isoformat()
        sb.table("mission_documents").update({
            "status": "ready",
            "page_count": page_count or None,
            "word_count": word_count,
            "processed_at": processed_at,
        }).eq("id", doc_id).execute()

        return DocumentResponse(
            id=doc_id,
            mission_id=mission_id,
            filename=original_name,
            file_type=file_type,
            file_size=len(content),
            status="ready",
            page_count=page_count or None,
            word_count=word_count,
            uploaded_at=now,
            processed_at=processed_at,
        )

    except Exception as exc:
        logger.error("Document processing failed for %s: %s", doc_id, exc)
        sb.table("mission_documents").update({
            "status": "error",
            "error_message": str(exc)[:500],
        }).eq("id", doc_id).execute()
        return DocumentResponse(
            id=doc_id,
            mission_id=mission_id,
            filename=original_name,
            file_type=file_type,
            file_size=len(content),
            status="error",
            error_message=str(exc)[:200],
            uploaded_at=now,
        )


@router.get("/{mission_id}/documents", response_model=list[DocumentResponse])
async def list_documents(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> list[DocumentResponse]:
    """List all documents for a mission. Enforces ownership."""
    _verify_mission_ownership(mission_id, current_user["sub"])
    sb = get_supabase()
    result = (
        sb.table("mission_documents")
        .select("*")
        .eq("mission_id", mission_id)
        .order("uploaded_at", desc=False)
        .execute()
    )
    return [_row_to_doc(r) for r in (result.data or [])]


@router.delete("/{mission_id}/documents/{document_id}", status_code=204)
async def delete_document(
    mission_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Delete a document (storage + DB). Enforces ownership."""
    auth0_sub = current_user["sub"]
    _verify_mission_ownership(mission_id, auth0_sub)

    sb = get_supabase()
    doc = (
        sb.table("mission_documents")
        .select("*")
        .eq("id", document_id)
        .eq("mission_id", mission_id)
        .eq("auth0_sub", auth0_sub)
        .limit(1)
        .execute()
    )
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")

    storage_path = doc.data[0]["storage_path"]

    # Delete from storage (best-effort)
    try:
        sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
    except Exception as exc:
        logger.warning("Storage delete failed for %s: %s", storage_path, exc)

    # Delete DB rows (cascades to chunks and facts via FK)
    sb.table("mission_documents").delete().eq("id", document_id).execute()

    # Resynthesize facts across remaining documents
    try:
        doc_facts.synthesize_all_mission_facts(sb, mission_id, auth0_sub)
    except Exception as synth_err:
        logger.warning("Resynthesis after document delete failed: %s", synth_err)


@router.get("/{mission_id}/facts", response_model=MissionFactsResponse)
async def get_mission_facts(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> MissionFactsResponse:
    """Return extracted mission facts from all documents and mission description for a mission."""
    _verify_mission_ownership(mission_id, current_user["sub"])
    sb = get_supabase()

    # Count docs
    docs_res = (
        sb.table("mission_documents")
        .select("id")
        .eq("mission_id", mission_id)
        .execute()
    )
    doc_count = len(docs_res.data or [])

    # Fetch mission metadata & description
    mission_res = (
        sb.table("missions")
        .select("id, description, duration, destination, mission_type, power_source, known_resources")
        .eq("id", mission_id)
        .limit(1)
        .execute()
    )
    m = mission_res.data[0] if mission_res.data else {}

    # Fetch existing facts from DB
    facts_res = (
        sb.table("document_facts")
        .select("*")
        .eq("mission_id", mission_id)
        .order("extracted_at", desc=False)
        .execute()
    )
    raw_facts = facts_res.data or []

    # If no facts in DB and documents exist, run multi-document synthesis
    if not raw_facts and doc_count > 0:
        try:
            raw_facts = doc_facts.synthesize_all_mission_facts(sb, mission_id, current_user["sub"])
        except Exception as exc:
            logger.warning("Could not auto-synthesize facts in get_mission_facts: %s", exc)

    facts_by_key = {r["field_key"]: r for r in raw_facts if r.get("state") != "not_specified" and r.get("value")}

    # Also parse pattern facts from mission description
    desc_text = f"{m.get('description') or ''} {m.get('duration') or ''} {m.get('power_source') or ''} {m.get('known_resources') or ''}"
    prompt_facts = doc_facts._extract_pattern_facts(desc_text) if desc_text.strip() else {}

    final_facts: list[DocumentFactResponse] = []
    now = datetime.now(timezone.utc).isoformat()

    for field in doc_facts.FACT_FIELDS:
        fkey = field["field_key"]
        if fkey in facts_by_key:
            r = facts_by_key[fkey]
            final_facts.append(
                DocumentFactResponse(
                    id=r["id"],
                    category=r["category"],
                    field_key=r["field_key"],
                    label=r["label"],
                    value=r.get("value"),
                    numeric_value=r.get("numeric_value"),
                    unit=r.get("unit"),
                    state=r["state"],
                    source_text=r.get("source_text"),
                    page_number=r.get("page_number"),
                    document_id=r.get("document_id"),
                    extracted_at=r["extracted_at"],
                )
            )
        elif fkey in prompt_facts:
            pf = prompt_facts[fkey]
            final_facts.append(
                DocumentFactResponse(
                    id=f"prompt-{fkey}-{mission_id[:8]}",
                    category=field["category"],
                    field_key=fkey,
                    label=field["label"],
                    value=pf["value"],
                    numeric_value=pf.get("numeric_value"),
                    unit=pf.get("unit") or field["unit"],
                    state=pf.get("state", "extracted"),
                    source_text=pf.get("source_text") or m.get("description"),
                    page_number=None,
                    document_id=None,
                    extracted_at=now,
                )
            )
        elif fkey == "mission_duration_days" and doc_facts.is_aerospace_mission_text(desc_text) and (m.get("duration") or m.get("description")):
            from routers.scenarios import parse_duration_to_days
            days = parse_duration_to_days(m.get("duration")) or parse_duration_to_days(m.get("description"))
            if days:
                final_facts.append(
                    DocumentFactResponse(
                        id=f"meta-{fkey}-{mission_id[:8]}",
                        category=field["category"],
                        field_key=fkey,
                        label=field["label"],
                        value=m.get("duration") or f"{days} days",
                        numeric_value=days,
                        unit="days",
                        state="extracted",
                        source_text=m.get("duration") or m.get("description"),
                        page_number=None,
                        document_id=None,
                        extracted_at=now,
                    )
                )
            else:
                final_facts.append(
                    DocumentFactResponse(
                        id=f"empty-{fkey}-{mission_id[:8]}",
                        category=field["category"],
                        field_key=fkey,
                        label=field["label"],
                        value=None,
                        numeric_value=None,
                        unit=field["unit"],
                        state="not_specified",
                        source_text=None,
                        page_number=None,
                        document_id=None,
                        extracted_at=now,
                    )
                )
        elif fkey == "resource_availability_pct" and doc_facts.is_aerospace_mission_text(desc_text) and (m.get("known_resources") or "water" in desc_text.lower() or "oxygen" in desc_text.lower() or "isru" in desc_text.lower()):
            final_facts.append(
                DocumentFactResponse(
                    id=f"meta-{fkey}-{mission_id[:8]}",
                    category=field["category"],
                    field_key=fkey,
                    label=field["label"],
                    value="100%",
                    numeric_value=100.0,
                    unit="%",
                    state="extracted",
                    source_text=m.get("known_resources") or "ISRU / Consumables defined in prompt",
                    page_number=None,
                    document_id=None,
                    extracted_at=now,
                )
            )
        elif fkey == "solar_power_pct" and doc_facts.is_aerospace_mission_text(desc_text) and ("solar" in desc_text.lower() or "pv" in desc_text.lower()):
            final_facts.append(
                DocumentFactResponse(
                    id=f"meta-{fkey}-{mission_id[:8]}",
                    category=field["category"],
                    field_key=fkey,
                    label=field["label"],
                    value="100%",
                    numeric_value=100.0,
                    unit="%",
                    state="extracted",
                    source_text=m.get("power_source") or "Solar power generation defined in prompt",
                    page_number=None,
                    document_id=None,
                    extracted_at=now,
                )
            )
        else:
            # Fallback: check if raw_facts had a not_specified entry
            raw_match = next((r for r in raw_facts if r.get("field_key") == fkey), None)
            if raw_match:
                final_facts.append(
                    DocumentFactResponse(
                        id=raw_match["id"],
                        category=raw_match["category"],
                        field_key=raw_match["field_key"],
                        label=raw_match["label"],
                        value=raw_match.get("value"),
                        numeric_value=raw_match.get("numeric_value"),
                        unit=raw_match.get("unit"),
                        state=raw_match["state"],
                        source_text=raw_match.get("source_text"),
                        page_number=raw_match.get("page_number"),
                        document_id=raw_match.get("document_id"),
                        extracted_at=raw_match["extracted_at"],
                    )
                )
            else:
                final_facts.append(
                    DocumentFactResponse(
                        id=f"empty-{fkey}-{mission_id[:8]}",
                        category=field["category"],
                        field_key=fkey,
                        label=field["label"],
                        value=None,
                        numeric_value=None,
                        unit=field["unit"],
                        state="not_specified",
                        source_text=None,
                        page_number=None,
                        document_id=None,
                        extracted_at=now,
                    )
                )

    return MissionFactsResponse(
        mission_id=mission_id,
        facts=final_facts,
        document_count=doc_count,
        has_documents=doc_count > 0,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _persist_chunks(sb, doc_id: str, mission_id: str, auth0_sub: str, chunks: list[dict]) -> None:
    """Bulk-insert document chunks."""
    if not chunks:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "document_id": doc_id,
            "mission_id": mission_id,
            "auth0_sub": auth0_sub,
            "chunk_index": c["chunk_index"],
            "page_number": c.get("page_number"),
            "text": c["text"],
            "word_count": c.get("word_count"),
            "created_at": now,
        }
        for c in chunks
    ]
    # Insert in batches of 50
    for i in range(0, len(rows), 50):
        sb.table("document_chunks").insert(rows[i:i+50]).execute()


def _content_type(ext: str) -> str:
    return {
        "pdf": "application/pdf",
        "txt": "text/plain",
        "md": "text/markdown",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(ext, "application/octet-stream")
