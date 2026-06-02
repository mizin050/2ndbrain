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

# Add current directory to path so we can import ai_layer
# api.py and ai-layer.py are in the same directory (backend/ai-layer/)
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Import the AI layer functions
try:
    # Import from same directory
    import importlib.util
    spec = importlib.util.spec_from_file_location("ai_layer", os.path.join(current_dir, "ai-layer.py"))
    if spec and spec.loader:
        ai_layer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ai_layer)
        
        get_dynamic_chat_engine = ai_layer.get_dynamic_chat_engine
        generate_timeline = ai_layer.generate_timeline
        detect_and_handle_timeline_request = ai_layer.detect_and_handle_timeline_request
        index_data = ai_layer.index_data
        extract_dates_from_text = ai_layer.extract_dates_from_text
        query_workspace    = ai_layer.query_workspace
        chroma_client      = ai_layer.chroma_client
    else:
        raise ImportError("Could not load ai-layer.py")
except ImportError as e:
    print(f"❌ Error importing ai_layer: {e}")
    print(f"📍 Current directory: {os.getcwd()}")
    print(f"📍 Script directory: {current_dir}")
    print(f"📍 Looking for: {os.path.join(parent_dir, 'ai-layer', 'ai-layer.py')}")
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
    Fetch calendar view of indexed documents.
    Shows which dates have content indexed.
    
    Path Parameters:
    - workspace_id: Workspace to query
    - month: Month (1-12)
    - year: Year
    
    Returns: Calendar structure with events per date
    """
    try:
        if chroma_client is None:
            return CalendarResponse(month=month, year=year, events=[])
        chroma_collection = chroma_client.get_or_create_collection(name=workspace_id)
        
        all_results = chroma_collection.get(include=["metadatas", "documents"])
        
        # Group events by date
        events_by_date = {}
        for metadata, doc in zip(all_results["metadatas"], all_results["documents"]):
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
        return ChatResponse(
            response=answer,
            is_timeline_request=False,
            timeline_data=None
        )
        
    except Exception as e:
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
    """
    try:
        if chroma_client is None:
            return {"workspace_id": workspace_id, "nodes": []}
        collection = chroma_client.get_or_create_collection(name=workspace_id)
        results = collection.get(include=["metadatas"])
        seen = {}
        for meta in results["metadatas"]:
            sid = meta.get("source_id")
            if sid and sid not in seen:
                seen[sid] = meta.get("source_type", "NOTE")
        nodes = [{"source_id": k, "source_type": v} for k, v in seen.items()]
        return {"workspace_id": workspace_id, "nodes": nodes}
    except Exception:
        return {"workspace_id": workspace_id, "nodes": []}

# =====================================================================
# 6c. DELETE ENDPOINTS — clear workspace or single node
# =====================================================================

@app.delete("/api/workspace/{workspace_id}")
async def clear_workspace(workspace_id: str):
    """
    Delete ALL indexed data for a workspace (drops the entire ChromaDB collection).
    Called from the UI's 'CLEAR DB' button.
    """
    try:
        if chroma_client is None:
            raise HTTPException(status_code=503, detail="ChromaDB not available")
        chroma_client.delete_collection(name=workspace_id)
        return {"status": "success", "message": f"Workspace '{workspace_id}' cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clear workspace failed: {str(e)}")


@app.delete("/api/node/{workspace_id}/{source_id:path}")
async def delete_node(workspace_id: str, source_id: str):
    """
    Delete all chunks belonging to a single source_id from the workspace collection.
    Called when the user clicks a node in the graph and chooses 'Delete'.
    """
    try:
        if chroma_client is None:
            raise HTTPException(status_code=503, detail="ChromaDB not available")
        collection = chroma_client.get_or_create_collection(name=workspace_id)

        # Find all chunk IDs whose metadata source_id matches
        results = collection.get(include=["metadatas"])
        ids_to_delete = [
            doc_id
            for doc_id, meta in zip(results["ids"], results["metadatas"])
            if meta.get("source_id") == source_id
        ]

        if not ids_to_delete:
            raise HTTPException(status_code=404, detail=f"No chunks found for source_id '{source_id}'")

        collection.delete(ids=ids_to_delete)
        return {
            "status": "success",
            "message": f"Deleted {len(ids_to_delete)} chunk(s) for '{source_id}'",
            "deleted_chunks": len(ids_to_delete)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Node deletion failed: {str(e)}")


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