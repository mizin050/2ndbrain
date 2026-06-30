"""
FastAPI REST server for Second Brain AI Engine
Exposes timeline, chat, and search endpoints for frontend consumption
"""

import sys
import os
import tempfile
import shutil

# Load .env before anything else so GROQ_API_KEY and other vars are available
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import json

# Chat log storage — one .jsonl file per workspace
if os.getenv("VERCEL"):
    LOGS_DIR = "/tmp/chat_logs"
else:
    LOGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_logs")
os.makedirs(LOGS_DIR, exist_ok=True)

def get_log_path(workspace_id: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in workspace_id)
    return os.path.join(LOGS_DIR, f"{safe}.jsonl")

def append_chat_log(workspace_id: str, role: str, message: str):
    entry = {"timestamp": datetime.now().isoformat(), "role": role, "message": message}
    try:
        with open(get_log_path(workspace_id), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"⚠️ Failed to write chat log: {e}")

# Add current directory to path so we can import ai_layer
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Import the AI layer functions statically so Vercel bundles it correctly
try:
    import ai_layer
    
    get_dynamic_chat_engine = ai_layer.get_dynamic_chat_engine
    generate_timeline = ai_layer.generate_timeline
    detect_and_handle_timeline_request = ai_layer.detect_and_handle_timeline_request
    index_data = ai_layer.index_data
    extract_dates_from_text = ai_layer.extract_dates_from_text
    query_workspace    = ai_layer.query_workspace
    qdrant_client_instance = ai_layer.qdrant_client_instance
except ImportError as e:
    print(f"❌ Error importing ai_layer: {e}")
    print(f"📍 Current directory: {os.getcwd()}")
    print(f"📍 Script directory: {current_dir}")
    raise

# =====================================================================
# 1. FASTAPI SETUP & MIDDLEWARE
# =====================================================================

app = FastAPI(title="Second Brain API", version="1.0.0")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================================
# 2. REQUEST/RESPONSE MODELS
# =====================================================================

class TimelineRequest(BaseModel):
    """Request to generate a timeline"""
    workspace_id: str
    start_date: Optional[str] = None  # ISO format: "2026-01-15"
    end_date: Optional[str] = None

class TimelineResponse(BaseModel):
    """Response containing timeline markdown"""
    timeline_markdown: str
    event_count: int
    date_range: dict

class ChatRequest(BaseModel):
    """Request to chat with the AI"""
    workspace_id: str
    message: str
    app_identity: str = "Second Brain"
    custom_rules: str = "Provide concise, factual responses."

class ChatResponse(BaseModel):
    """Response from chat engine"""
    response: str
    is_timeline_request: bool
    timeline_data: Optional[str] = None

class CalendarEvent(BaseModel):
    """Single event in calendar"""
    date: str  # ISO format
    title: str
    source_id: str
    source_type: str
    document_count: int

class CalendarResponse(BaseModel):
    """Calendar view response"""
    month: int
    year: int
    events: List[CalendarEvent]

class IndexRequest(BaseModel):
    """Request to index new data"""
    workspace_id: str
    text: str
    source_id: str
    source_type: str  # "PDF", "DOCX", "WEB", "AUDIO", "NOTE"

# =====================================================================
# 3. TIMELINE ENDPOINTS
# =====================================================================

@app.post("/api/timeline", response_model=TimelineResponse)
async def get_timeline(request: TimelineRequest):
    """
    Generate a chronological timeline for a workspace.
    
    Query Parameters:
    - workspace_id: Workspace to query
    - start_date: Optional ISO date filter
    - end_date: Optional ISO date filter
    
    Returns: Markdown timeline with metadata
    """
    try:
        timeline_md = generate_timeline(
            request.workspace_id, 
            request.start_date, 
            request.end_date
        )
        
        # Count events in response
        event_count = timeline_md.count("## ")
        
        return TimelineResponse(
            timeline_markdown=timeline_md,
            event_count=event_count,
            date_range={
                "start": request.start_date or "earliest",
                "end": request.end_date or "latest"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Timeline generation failed: {str(e)}")

# =====================================================================
# 4. CALENDAR ENDPOINTS
# =====================================================================

@app.get("/api/calendar/{workspace_id}")
async def get_calendar(workspace_id: str, month: int, year: int):
    """
    Fetch calendar view of indexed documents from Qdrant.
    Shows which dates have content indexed.
    """
    try:
        if qdrant_client_instance is None or not qdrant_client_instance.collection_exists(collection_name=workspace_id):
            return CalendarResponse(month=month, year=year, events=[])
            
        scroll_results = qdrant_client_instance.scroll(
            collection_name=workspace_id,
            with_payload=True,
            with_vectors=False,
            limit=10000
        )
        points = scroll_results[0]
        
        # Group events by date
        events_by_date = {}
        for p in points:
            metadata = p.payload.get("metadata", p.payload) or {}
            first_date_str = metadata.get("first_mentioned_date")
            if first_date_str:
                try:
                    event_date = datetime.fromisoformat(first_date_str)
                    if event_date.month == month and event_date.year == year:
                        date_key = event_date.strftime("%Y-%m-%d")
                        if date_key not in events_by_date:
                            events_by_date[date_key] = {
                                "sources": [],
                                "source_types": set()
                            }
                        events_by_date[date_key]["sources"].append(metadata.get("source_id"))
                        events_by_date[date_key]["source_types"].add(metadata.get("source_type"))
                except:
                    pass
        
        # Build response
        events = [
            CalendarEvent(
                date=date,
                title=f"{len(data['sources'])} document(s)",
                source_id=", ".join(data["sources"][:3]),
                source_type=", ".join(list(data["source_types"])[:2]),
                document_count=len(data["sources"])
            )
            for date, data in sorted(events_by_date.items())
        ]
        
        return CalendarResponse(month=month, year=year, events=events)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calendar error: {str(e)}")

# =====================================================================
# 5. CHAT ENDPOINTS
# =====================================================================

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Send a message to the AI assistant.
    Automatically detects timeline requests.
    
    Body:
    - workspace_id: Workspace context
    - message: User query
    - app_identity: System identity (default: "Second Brain")
    - custom_rules: Behavioral rules
    
    Returns: AI response with optional timeline data
    """
    try:
        # Check if this is a timeline request
        is_timeline, timeline_data = detect_and_handle_timeline_request(
            request.message,
            request.workspace_id
        )
        
        if is_timeline:
            return ChatResponse(
                response=timeline_data if timeline_data else "Timeline generated.",
                is_timeline_request=True,
                timeline_data=timeline_data
            )
        
        # Direct Groq SDK via query_workspace — no LlamaIndex HTTP wrapper
        answer = query_workspace(
            request.workspace_id,
            request.message,
            request.app_identity,
            request.custom_rules
        )
        # Persist exchange to chat log
        append_chat_log(request.workspace_id, "user", request.message)
        append_chat_log(request.workspace_id, "assistant", answer)
        try:
            log_path = get_log_path(request.workspace_id)
            with open(log_path, "r", encoding="utf-8") as f:
                log_text = f.read()
            ai_layer.index_data(request.workspace_id, log_text, "chat_log.jsonl", "LOG")
        except Exception:
            pass

        return ChatResponse(
            response=answer,
            is_timeline_request=False,
            timeline_data=None
        )
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

# =====================================================================
# 6. DATA INGESTION ENDPOINT (pre-extracted text)
# =====================================================================

@app.post("/api/index")
async def index_document(request: IndexRequest):
    """
    Index pre-extracted text into the workspace.
    For file uploads (PDF/DOCX) use POST /api/upload instead.
    """
    try:
        extracted_dates = extract_dates_from_text(request.text)
        index_data(request.workspace_id, request.text, request.source_id, request.source_type)
        return {
            "status": "success",
            "message": f"Indexed {len(request.text.split())} words from {request.source_id}",
            "workspace": request.workspace_id,
            "dates_found": [d.isoformat() for d in extracted_dates],
            "source_type": request.source_type
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")

# =====================================================================
# 6a. NODES ENDPOINT — restore graph nodes on frontend reload
# =====================================================================

@app.get("/api/nodes/{workspace_id}")
async def get_nodes(workspace_id: str):
    """
    Returns all unique source_ids indexed in a workspace.
    Frontend calls this on page load to rebuild the knowledge graph.
    Now includes priority (1=HIGH/red, 2=MEDIUM/yellow, 3=LOW/green)
    and dynamically re-scores based on query_count (Option 3).
    Also runs automatic semantic clustering to keep memory storage clustered.
    """
    try:
        if qdrant_client_instance is None:
            return {"workspace_id": workspace_id, "nodes": []}
            
        # Ensure database is clustered
        try:
            ai_layer.ensure_database_clustering(workspace_id)
        except Exception as ce:
            print(f"Error in database auto-clustering: {ce}")
            
        if not qdrant_client_instance.collection_exists(collection_name=workspace_id):
            return {"workspace_id": workspace_id, "nodes": [{"source_id": "chat_log.jsonl", "source_type": "LOG", "priority": 2, "priority_score": 0.0, "query_count": 0, "ingestion_timestamp": "", "cluster_id": "cluster_chat", "cluster_name": "Chat Logs"}]}

        scroll_results = qdrant_client_instance.scroll(
            collection_name=workspace_id,
            with_payload=True,
            with_vectors=False,
            limit=10000
        )
        points = scroll_results[0]
        
        seen = {}
        for p in points:
            metadata = p.payload.get("metadata", p.payload) or {}
            sid = metadata.get("source_id")
            if sid and sid not in seen:
                seen[sid] = metadata
        nodes = []
        for sid, meta in seen.items():
            qc = int(meta.get("query_count", 0))
            base_priority = int(meta.get("priority", 3))
            dynamic_priority = ai_layer.recompute_priority(meta, qc)
            nodes.append({
                "source_id": sid,
                "source_type": meta.get("source_type", "NOTE"),
                "priority": dynamic_priority,
                "priority_score": float(meta.get("priority_score", 0.0)),
                "query_count": qc,
                "ingestion_timestamp": meta.get("ingestion_timestamp", ""),
                "cluster_id": meta.get("cluster_id", "cluster_default"),
                "cluster_name": meta.get("cluster_name", "General Knowledge"),
            })
        if not any(n["source_id"] == "chat_log.jsonl" for n in nodes):
            nodes.insert(0, {
                "source_id": "chat_log.jsonl",
                "source_type": "LOG",
                "priority": 2,
                "priority_score": 0.0,
                "query_count": 0,
                "ingestion_timestamp": "",
                "cluster_id": "cluster_chat",
                "cluster_name": "Chat Logs"
            })
        return {"workspace_id": workspace_id, "nodes": nodes}
    except Exception:
        return {"workspace_id": workspace_id, "nodes": [{"source_id": "chat_log.jsonl", "source_type": "LOG", "priority": 2, "priority_score": 0.0, "query_count": 0, "ingestion_timestamp": "", "cluster_id": "cluster_chat", "cluster_name": "Chat Logs"}]}

# =====================================================================
# 6a2. CONNECTIONS ENDPOINT — AI-detected node similarity edges
# =====================================================================

@app.get("/api/connections/{workspace_id}")
async def get_connections(workspace_id: str, threshold: float = 0.60):
    """
    Computes cosine similarity between nodes using their stored document text in Qdrant.
    Re-embeds one chunk per source using the same HuggingFace model, then
    computes pairwise cosine similarity. Returns edges above threshold.
    Lower threshold (0.60) catches more connections than 0.72.
    """
    try:
        if qdrant_client_instance is None or not qdrant_client_instance.collection_exists(collection_name=workspace_id):
            return {"connections": []}
            
        scroll_results = qdrant_client_instance.scroll(
            collection_name=workspace_id,
            with_payload=True,
            with_vectors=False,
            limit=10000
        )
        points = scroll_results[0]

        if not points:
            return {"connections": []}

        import numpy as np
        embed_model = ai_layer.get_embed_model()

        # Collect first chunk per source_id
        source_texts = {}
        for p in points:
            metadata = p.payload.get("metadata", p.payload) or {}
            sid = metadata.get("source_id")
            doc = p.payload.get("text", "")
            if sid and sid not in source_texts and doc:
                source_texts[sid] = doc[:500]  # use first 500 chars of first chunk

        if len(source_texts) < 2:
            return {"connections": []}

        # Embed each source
        ids = list(source_texts.keys())
        texts = [source_texts[sid] for sid in ids]
        embeddings = embed_model.get_text_embedding_batch(texts)

        def norm(v):
            arr = np.array(v, dtype=np.float32)
            n = np.linalg.norm(arr)
            return arr / n if n > 0 else arr

        normed = [norm(e) for e in embeddings]

        connections = []
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                sim = float(np.dot(normed[i], normed[j]))
                if sim >= threshold:
                    connections.append({
                        "source": ids[i],
                        "target": ids[j],
                        "similarity": round(sim, 3)
                    })

        connections.sort(key=lambda x: x["similarity"], reverse=True)
        return {"connections": connections[:30]}

    except Exception as e:
        return {"connections": [], "error": str(e)}

# =====================================================================
# 6a3. QUERY COUNT INCREMENT — tracks how often each node is queried
# =====================================================================

@app.post("/api/nodes/{workspace_id}/increment")
async def increment_query_count(workspace_id: str, source_id: str):
    """Increments query_count on all chunks of a source_id in Qdrant. Used for dynamic priority."""
    try:
        if qdrant_client_instance is None or not qdrant_client_instance.collection_exists(collection_name=workspace_id):
            return {"status": "error", "detail": "Collection does not exist"}
            
        scroll_results = qdrant_client_instance.scroll(
            collection_name=workspace_id,
            with_payload=True,
            with_vectors=False,
            limit=10000
        )
        points = scroll_results[0]
        
        updated_count = 0
        for p in points:
            payload = p.payload or {}
            meta = dict(payload.get("metadata", payload))
            if meta.get("source_id") == source_id:
                meta["query_count"] = int(meta.get("query_count", 0)) + 1
                qdrant_client_instance.set_payload(
                    collection_name=workspace_id,
                    payload={"metadata": meta},
                    points=[p.id]
                )
                updated_count += 1
        return {"status": "ok", "updated_chunks": updated_count}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# =====================================================================
# 6b. FILE UPLOAD ENDPOINT — multipart, server-side text extraction
# =====================================================================

@app.post("/api/upload")
async def upload_file(
    workspace_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Accept a raw file, extract text server-side, then index into ChromaDB.
    Supports PDF (pypdf), DOCX (python-docx), and plain text (txt/md/csv).

    Form fields:
    - workspace_id: Target workspace
    - file: The uploaded file (multipart/form-data)
    """
    ext = (file.filename.split(".")[-1] if "." in file.filename else "txt").lower()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        if ext == "pdf":
            text = ai_layer.extract_text_from_pdf(tmp_path)
            source_type = "PDF"
        elif ext in ("docx", "doc"):
            text = ai_layer.extract_text_from_docx(tmp_path)
            source_type = "DOCX"
        else:
            with open(tmp_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
            source_type = "NOTE"

        if not text.strip():
            raise HTTPException(status_code=422, detail="No text could be extracted from the file.")

        extracted_dates = ai_layer.extract_dates_from_text(text)
        ai_layer.index_data(workspace_id, text, file.filename, source_type)

        return {
            "status": "success",
            "message": f"Indexed {len(text.split())} words from {file.filename}",
            "workspace": workspace_id,
            "source_id": file.filename,
            "source_type": source_type,
            "dates_found": [d.isoformat() for d in extracted_dates],
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload/indexing failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# =====================================================================
# 6c. CHAT LOG ENDPOINT
# =====================================================================

@app.get("/api/chatlog/{workspace_id}")
async def get_chat_log(workspace_id: str, limit: int = 200):
    """Returns last N chat log entries for the log viewer."""
    log_path = get_log_path(workspace_id)
    if not os.path.exists(log_path):
        return {"workspace_id": workspace_id, "entries": []}
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
        entries = [json.loads(l) for l in lines[-limit:]]
        return {"workspace_id": workspace_id, "entries": entries}
    except Exception as e:
        return {"workspace_id": workspace_id, "entries": [], "error": str(e)}

# =====================================================================
# 6d. DELETE ENDPOINTS
# =====================================================================

@app.delete("/api/node/{workspace_id}")
async def delete_node(workspace_id: str, source_id: str):
    """
    Delete a single document node from Qdrant.
    If source_id is 'chat_log.jsonl', clears the chat log file only (keeps the node).
    """
    try:
        from qdrant_client.http import models
        
        # Special case: LOG node — clear log file but keep node in graph
        if source_id == "chat_log.jsonl":
            log_path = get_log_path(workspace_id)
            if os.path.exists(log_path):
                open(log_path, "w").close()  # truncate
            
            if qdrant_client_instance is not None and qdrant_client_instance.collection_exists(collection_name=workspace_id):
                qdrant_client_instance.delete(
                    collection_name=workspace_id,
                    points_selector=models.Filter(
                        should=[
                            models.FieldCondition(
                                key="metadata.source_id",
                                match=models.MatchValue(value="chat_log.jsonl")
                            ),
                            models.FieldCondition(
                                key="source_id",
                                match=models.MatchValue(value="chat_log.jsonl")
                            )
                        ]
                    )
                )
            return {"status": "cleared", "source_id": source_id, "message": "Chat log cleared"}

        # Normal node — delete all chunks with matching source_id
        if qdrant_client_instance is not None and qdrant_client_instance.collection_exists(collection_name=workspace_id):
            qdrant_client_instance.delete(
                collection_name=workspace_id,
                points_selector=models.Filter(
                    should=[
                        models.FieldCondition(
                            key="metadata.source_id",
                            match=models.MatchValue(value=source_id)
                        ),
                        models.FieldCondition(
                            key="source_id",
                            match=models.MatchValue(value=source_id)
                        )
                    ]
                )
            )
        return {"status": "deleted", "source_id": source_id}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

@app.delete("/api/workspace/{workspace_id}")
async def delete_workspace(workspace_id: str):
    """
    Nuke the entire workspace — deletes Qdrant collection + chat log.
    Triggered when user deletes the YOU core node.
    """
    try:
        if qdrant_client_instance is not None:
            try:
                qdrant_client_instance.delete_collection(collection_name=workspace_id)
            except Exception:
                pass  # collection may not exist yet
        log_path = get_log_path(workspace_id)
        if os.path.exists(log_path):
            os.remove(log_path)
        return {"status": "deleted", "workspace_id": workspace_id, "message": "Workspace cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Workspace delete failed: {str(e)}")

# =====================================================================
# 6d. URL INGESTION — scrape a webpage and index it
# =====================================================================

class UrlIngestRequest(BaseModel):
    workspace_id: str
    url: str

@app.post("/api/ingest-url")
async def ingest_url(request: UrlIngestRequest):
    """
    Scrape a URL, extract its text, and index it into ChromaDB.
    Uses BeautifulSoup scraper already in ai_layer.
    """
    try:
        text = ai_layer.scrape_url_to_markdown(request.url)
        if not text.strip():
            raise HTTPException(status_code=422, detail="No text could be extracted from the URL.")
        extracted_dates = ai_layer.extract_dates_from_text(text)
        ai_layer.index_data(request.workspace_id, text, request.url, "WEB")
        return {
            "status": "success",
            "message": f"Indexed {len(text.split())} words from {request.url}",
            "workspace": request.workspace_id,
            "source_id": request.url,
            "source_type": "WEB",
            "dates_found": [d.isoformat() for d in extracted_dates],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL ingestion failed: {str(e)}")


# =====================================================================
# 6e. AUDIO INGESTION — upload audio file, transcribe, index
# =====================================================================

@app.post("/api/ingest-audio")
async def ingest_audio(
    workspace_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Accept an audio file (mp3/wav/ogg/webm), transcribe via GCP Speech-to-Text,
    then index the transcript into ChromaDB.
    Falls back to a stub message if GCP is unavailable.
    """
    ext = (file.filename.split(".")[-1] if "." in file.filename else "webm").lower()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        # Attempt GCP transcription; fall back gracefully
        try:
            transcript = ai_layer.transcribe_audio_gcp(tmp_path)
        except Exception as transcribe_err:
            raise HTTPException(
                status_code=503,
                detail=f"Transcription unavailable: {str(transcribe_err)}. "
                       f"Install google-cloud-speech and provide gcp_key.json to enable audio."
            )

        if not transcript.strip() or transcript == "[Empty Transcription]":
            raise HTTPException(status_code=422, detail="Transcription returned empty result.")

        extracted_dates = ai_layer.extract_dates_from_text(transcript)
        source_id = file.filename
        ai_layer.index_data(workspace_id, transcript, source_id, "AUDIO")

        return {
            "status": "success",
            "message": f"Transcribed and indexed {len(transcript.split())} words from {file.filename}",
            "workspace": workspace_id,
            "source_id": source_id,
            "source_type": "AUDIO",
            "transcript_preview": transcript[:200],
            "dates_found": [d.isoformat() for d in extracted_dates],
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Audio ingestion failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

# =====================================================================
# 7. HEALTH CHECK & INFO
# =====================================================================

@app.get("/api/health")
async def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy", "service": "Second Brain AI"}

@app.get("/api/info")
async def get_info():
    """Get API information"""
    return {
        "name": "Second Brain AI Engine",
        "version": "1.0.0",
        "endpoints": [
            "POST /api/timeline - Generate timeline",
            "GET /api/calendar/{workspace_id} - Get calendar view",
            "POST /api/chat - Chat with AI",
            "POST /api/index - Index pre-extracted text",
            "POST /api/upload - Upload raw file (PDF/DOCX/txt)",
            "GET /api/nodes/{workspace_id} - List indexed documents",
            "GET /api/health - Health check"
        ]
    }

# =====================================================================
# 8. RUN SERVER
# =====================================================================

if __name__ == "__main__":
    import uvicorn
    
    # Get configuration from environment variables
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    
    print("🚀 Starting Second Brain API Server...")
    print(f"📍 Running on http://{host}:{port}")
    print(f"📚 API Docs available at http://{host}:{port}/docs")
    print(f"💾 ChromaDB path: {os.getenv('DATABASE_PATH', './chroma_db')} (set DATABASE_PATH in .env to override)")
    
    try:
        uvicorn.run(app, host=host, port=port)
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        raise