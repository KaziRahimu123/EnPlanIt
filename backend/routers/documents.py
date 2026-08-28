"""Documents router — secure direct-to-storage upload and processing for mission documents.

Architecture (Vercel Serverless 4.5 MB Bypass):
1. Browser requests a signed Supabase Storage upload URL from POST /{mission_id}/documents/upload-url.
2. Browser uploads directly to Supabase Storage using the signed URL.
3. Backend receives confirmation via POST /{mission_id}/documents/{doc_id}/process.
4. Backend downloads file from Supabase Storage, validates MIME type & magic bytes signature,
   chunks text, and extracts verified mission facts via IBM Granite / OpenAI.
5. Processing states tracked: uploaded -> processing -> completed / failed.
6. Abandoned/cancelled uploads are cleaned up via DELETE /{mission_id}/documents/{doc_id}/abort.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

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

class RequestUploadUrlRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0, le=MAX_FILE_SIZE_BYTES)
    file_type: str = Field(..., min_length=2, max_length=10)


class RequestUploadUrlResponse(BaseModel):
    document_id: str
    storage_path: str
    signed_url: str
    token: str
    expires_in: int = 3600


class DocumentResponse(BaseModel):
    id: str
    mission_id: str
    filename: str
    file_type: str
    file_size: int
    status: str  # "uploaded" | "processing" | "completed" | "failed"
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
    Replaces pipe, spaces, and invalid characters outside [A-Za-z0-9_-].
    """
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", auth0_sub)
    safe = re.sub(r"_+", "_", safe).strip("_")
    return safe[:64] or "user"


def _safe_filename(name: str) -> str:
    """
    Sanitize an uploaded filename while preserving its extension.
    Strips directory traversal sequences (../), spaces, and illegal characters.
    """
    # Remove directory paths if present
    name = os.path.basename(name)
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


def _content_type(ext: str) -> str:
    return {
        "pdf": "application/pdf",
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(ext, "application/octet-stream")


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
    
    sub = (auth0_sub or "").strip()
    clean = sub.split("|")[-1] if "|" in sub else sub
    row_sub = (result.data[0].get("auth0_sub") or "").strip()
    clean_row = row_sub.split("|")[-1] if "|" in row_sub else row_sub

    if row_sub and sub and row_sub != sub and clean_row != clean and clean_row != sub and row_sub != clean:
        raise HTTPException(status_code=403, detail="Access denied")


def _row_to_doc(row: dict) -> DocumentResponse:
    # Normalize legacy status values ("ready" -> "completed", "error" -> "failed")
    raw_status = row.get("status") or "uploaded"
    if raw_status == "ready":
        status = "completed"
    elif raw_status == "error":
        status = "failed"
    else:
        status = raw_status

    return DocumentResponse(
        id=row["id"],
        mission_id=row["mission_id"],
        filename=row["filename"],
        file_type=row["file_type"],
        file_size=row["file_size"],
        status=status,
        page_count=row.get("page_count"),
        word_count=row.get("word_count"),
        error_message=row.get("error_message"),
        uploaded_at=row["uploaded_at"],
        processed_at=row.get("processed_at"),
    )


def _process_document_bytes(
    sb: Any,
    doc_id: str,
    mission_id: str,
    auth0_sub: str,
    filename: str,
    file_type: str,
    content: bytes,
    storage_path: str,
) -> DocumentResponse:
    """
    Core validation, chunking, and fact extraction pipeline.
    Transitions document state: uploaded -> processing -> completed / failed.
    """
    now = datetime.now(timezone.utc).isoformat()

    # 1. Enforce size limit
    if len(content) > MAX_FILE_SIZE_BYTES:
        err = f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024*1024)} MB."
        logger.error("Processing failed for doc %s: %s", doc_id, err)
        sb.table("mission_documents").update({
            "status": "failed",
            "error_message": err,
            "processed_at": now,
        }).eq("id", doc_id).execute()
        try:
            sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=err)

    if len(content) == 0:
        err = "Uploaded file is empty (0 bytes)."
        logger.error("Processing failed for doc %s: %s", doc_id, err)
        sb.table("mission_documents").update({
            "status": "failed",
            "error_message": err,
            "processed_at": now,
        }).eq("id", doc_id).execute()
        try:
            sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=err)

    # 2. Enforce MIME type & magic bytes signature
    is_valid, sig_err = document_extractor.validate_file_signature(content, file_type)
    if not is_valid:
        err = sig_err or "File signature validation failed."
        logger.error("Signature validation failed for doc %s (%s): %s", doc_id, filename, err)
        sb.table("mission_documents").update({
            "status": "failed",
            "error_message": err,
            "processed_at": now,
        }).eq("id", doc_id).execute()
        try:
            sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=f"Invalid file: {err}")

    # 3. Mark as processing
    sb.table("mission_documents").update({
        "status": "processing",
        "file_size": len(content),
    }).eq("id", doc_id).execute()

    # 4. Extract text & chunk
    try:
        chunks, page_count, word_count = document_extractor.extract_and_chunk(content, file_type)
        _persist_chunks(sb, doc_id, mission_id, auth0_sub, chunks)

        # 5. Extract facts via AI
        if chunks:
            doc_facts.extract_and_persist_facts(
                sb=sb,
                mission_id=mission_id,
                document_id=doc_id,
                auth0_sub=auth0_sub,
                chunks=chunks,
                file_type=file_type,
                filename=filename,
            )

            # Auto-enrich mission description if placeholder
            try:
                m_res = sb.table("missions").select("id, name, description").eq("id", mission_id).limit(1).execute()
                if m_res.data:
                    curr_desc = m_res.data[0].get("description", "")
                    if (
                        curr_desc.startswith("Mission profile initialized from attached document")
                        or len(curr_desc) < 30
                        or curr_desc.startswith("[DOCUMENT:")
                    ):
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

        # 6. Mark document as completed
        processed_at = datetime.now(timezone.utc).isoformat()
        sb.table("mission_documents").update({
            "status": "completed",
            "page_count": page_count or None,
            "word_count": word_count,
            "processed_at": processed_at,
            "error_message": None,
        }).eq("id", doc_id).execute()

        logger.info("Successfully processed document %s for mission %s", doc_id, mission_id)
        return DocumentResponse(
            id=doc_id,
            mission_id=mission_id,
            filename=filename,
            file_type=file_type,
            file_size=len(content),
            status="completed",
            page_count=page_count or None,
            word_count=word_count,
            uploaded_at=now,
            processed_at=processed_at,
        )

    except Exception as exc:
        logger.error("Document processing failed for %s: %s", doc_id, exc, exc_info=True)
        sb.table("mission_documents").update({
            "status": "failed",
            "error_message": str(exc)[:500],
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()
        return DocumentResponse(
            id=doc_id,
            mission_id=mission_id,
            filename=filename,
            file_type=file_type,
            file_size=len(content),
            status="failed",
            error_message=str(exc)[:200],
            uploaded_at=now,
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{mission_id}/documents/upload-url", response_model=RequestUploadUrlResponse, status_code=201)
async def request_upload_url(
    mission_id: str,
    payload: RequestUploadUrlRequest,
    current_user: dict = Depends(get_current_user),
) -> RequestUploadUrlResponse:
    """
    Generate a signed Supabase Storage upload URL for direct browser uploads.
    Bypasses Vercel's 4.5 MB request body limit for large dossiers (up to 20 MB).
    Enforces mission ownership, 3-file maximum, 20 MB size limit, and supported extensions.
    """
    auth0_sub = current_user["sub"]
    _verify_mission_ownership(mission_id, auth0_sub)

    # 1. Enforce 3-file maximum per mission (ignoring permanently failed docs)
    sb = get_supabase()
    count_res = (
        sb.table("mission_documents")
        .select("id, status")
        .eq("mission_id", mission_id)
        .neq("status", "failed")
        .execute()
    )
    if len(count_res.data or []) >= MAX_FILES_PER_MISSION:
        raise HTTPException(
            status_code=422,
            detail=f"Maximum limit of {MAX_FILES_PER_MISSION} documents per mission reached. Please delete an existing document first.",
        )

    # 2. Validate file type
    file_type = _get_file_type(payload.filename)
    if not file_type:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_TYPES))}",
        )

    # 3. Enforce size limit
    if payload.file_size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE_BYTES // (1024*1024)} MB.",
        )
    if payload.file_size <= 0:
        raise HTTPException(status_code=422, detail="File size must be greater than 0 bytes.")

    # 4. Generate safe storage key & unique doc_id
    safe_user = _safe_user_id(auth0_sub)
    safe_name = _safe_filename(payload.filename)
    doc_id = uuid.uuid4().hex
    storage_path = f"users/{safe_user}/missions/{mission_id}/{doc_id}/{safe_name}"

    # 5. Create signed upload URL in Supabase Storage
    try:
        signed_url_info = sb.storage.from_(STORAGE_BUCKET).create_signed_upload_url(storage_path)
    except Exception as exc:
        logger.error("Failed to create signed upload URL for %s: %s", storage_path, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate signed upload URL: {exc}")

    # Extract URL and token
    if isinstance(signed_url_info, dict):
        signed_url = signed_url_info.get("signed_url") or signed_url_info.get("signedUrl") or ""
        token = signed_url_info.get("token") or ""
    else:
        signed_url = getattr(signed_url_info, "signed_url", None) or getattr(signed_url_info, "signedUrl", "") or str(signed_url_info)
        token = getattr(signed_url_info, "token", "")

    # 6. Insert record in mission_documents with initial state 'uploaded'
    now = datetime.now(timezone.utc).isoformat()
    doc_row = {
        "id": doc_id,
        "mission_id": mission_id,
        "auth0_sub": auth0_sub,
        "filename": payload.filename,
        "storage_path": storage_path,
        "file_type": file_type,
        "file_size": payload.file_size,
        "status": "uploaded",
        "uploaded_at": now,
    }
    sb.table("mission_documents").insert(doc_row).execute()

    return RequestUploadUrlResponse(
        document_id=doc_id,
        storage_path=storage_path,
        signed_url=signed_url,
        token=token,
        expires_in=3600,
    )


@router.post("/{mission_id}/documents/{document_id}/process", response_model=DocumentResponse)
async def process_document(
    mission_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> DocumentResponse:
    """
    Download uploaded file directly from Supabase Storage, validate magic bytes,
    chunk text, and extract mission facts. Records status (uploaded -> processing -> completed/failed).
    """
    auth0_sub = current_user["sub"]
    _verify_mission_ownership(mission_id, auth0_sub)
    sb = get_supabase()

    doc_res = (
        sb.table("mission_documents")
        .select("*")
        .eq("id", document_id)
        .eq("mission_id", mission_id)
        .eq("auth0_sub", auth0_sub)
        .limit(1)
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document record not found")

    doc_row = doc_res.data[0]
    storage_path = doc_row["storage_path"]
    filename = doc_row["filename"]
    file_type = doc_row["file_type"]

    # Download bytes from Supabase Storage
    try:
        content = sb.storage.from_(STORAGE_BUCKET).download(storage_path)
    except Exception as exc:
        logger.error("Failed to download storage object %s: %s", storage_path, exc, exc_info=True)
        sb.table("mission_documents").update({
            "status": "failed",
            "error_message": f"Storage download failed: {exc}",
        }).eq("id", document_id).execute()
        raise HTTPException(status_code=500, detail="Could not retrieve stored file from storage bucket")

    return _process_document_bytes(
        sb=sb,
        doc_id=document_id,
        mission_id=mission_id,
        auth0_sub=auth0_sub,
        filename=filename,
        file_type=file_type,
        content=content,
        storage_path=storage_path,
    )


@router.delete("/{mission_id}/documents/{document_id}/abort", status_code=204)
async def abort_document_upload(
    mission_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Clean up an abandoned or cancelled upload attempt."""
    auth0_sub = current_user["sub"]
    _verify_mission_ownership(mission_id, auth0_sub)
    sb = get_supabase()

    doc = (
        sb.table("mission_documents")
        .select("id, storage_path, status")
        .eq("id", document_id)
        .eq("mission_id", mission_id)
        .eq("auth0_sub", auth0_sub)
        .limit(1)
        .execute()
    )
    if doc.data:
        storage_path = doc.data[0]["storage_path"]
        try:
            sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        except Exception as exc:
            logger.warning("Cleanup remove from storage failed for %s: %s", storage_path, exc)
        sb.table("mission_documents").delete().eq("id", document_id).execute()


@router.post("/{mission_id}/documents", response_model=DocumentResponse, status_code=201)
async def upload_document_fallback(
    mission_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
) -> DocumentResponse:
    """
    Fallback upload endpoint for local development or non-proxied requests.
    Validates ownership, file type, size, and magic bytes.
    """
    auth0_sub = current_user["sub"]
    _verify_mission_ownership(mission_id, auth0_sub)

    sb = get_supabase()
    count_res = (
        sb.table("mission_documents")
        .select("id")
        .eq("mission_id", mission_id)
        .neq("status", "failed")
        .execute()
    )
    if len(count_res.data or []) >= MAX_FILES_PER_MISSION:
        raise HTTPException(
            status_code=422,
            detail=f"Maximum limit of {MAX_FILES_PER_MISSION} documents per mission reached. Please delete an existing document first.",
        )

    original_name = file.filename or "upload"
    file_type = _get_file_type(original_name)
    if not file_type:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_TYPES))}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE_BYTES // (1024*1024)} MB.",
        )
    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    safe_user = _safe_user_id(auth0_sub)
    safe_name = _safe_filename(original_name)
    doc_id = uuid.uuid4().hex
    storage_path = f"users/{safe_user}/missions/{mission_id}/{doc_id}/{safe_name}"

    try:
        sb.storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": _content_type(file_type)},
        )
    except Exception as exc:
        logger.error("Storage upload failed for %s: %s", storage_path, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Document storage failed.")

    now = datetime.now(timezone.utc).isoformat()
    doc_row = {
        "id": doc_id,
        "mission_id": mission_id,
        "auth0_sub": auth0_sub,
        "filename": original_name,
        "storage_path": storage_path,
        "file_type": file_type,
        "file_size": len(content),
        "status": "uploaded",
        "uploaded_at": now,
    }
    sb.table("mission_documents").insert(doc_row).execute()

    return _process_document_bytes(
        sb=sb,
        doc_id=doc_id,
        mission_id=mission_id,
        auth0_sub=auth0_sub,
        filename=original_name,
        file_type=file_type,
        content=content,
        storage_path=storage_path,
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
    for i in range(0, len(rows), 50):
        sb.table("document_chunks").insert(rows[i:i+50]).execute()
