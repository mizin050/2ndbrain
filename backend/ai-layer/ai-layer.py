import os
import requests
from bs4 import BeautifulSoup
import pypdf
import docx
from datetime import datetime
import re
from dateutil import parser as date_parser

# Optional imports - graceful fallback if not installed
try:
    import chromadb
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False
    print("⚠️ Warning: chromadb not installed. Vector database features unavailable.")

try:
    from llama_index.core import VectorStoreIndex, StorageContext, Settings
    from llama_index.vector_stores.chroma import ChromaVectorStore
    from llama_index.llms.groq import Groq
    from llama_index.core.chat_engine import CondensePlusContextChatEngine
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    from llama_index.core.node_parser import TokenTextSplitter
    from llama_index.core.schema import Document
    HAS_LLAMA_INDEX = True
except ImportError:
    HAS_LLAMA_INDEX = False
    print("⚠️ Warning: llama_index not installed. AI chat features unavailable.")

try:
    from google.cloud import speech
    HAS_GOOGLE_CLOUD = True
except ImportError:
    HAS_GOOGLE_CLOUD = False
    print("⚠️ Warning: google-cloud-speech not installed. Speech-to-text unavailable.")

# =====================================================================
# 1. INITIALIZATION & STORAGE ENGINE SETUP
# =====================================================================
DB_PATH = os.getenv("DATABASE_PATH", "./chroma_db") 
os.makedirs(DB_PATH, exist_ok=True)

# Only initialize llama_index if available
if HAS_LLAMA_INDEX:
    Settings.llm = Groq(
        model="llama-3.3-70b-versatile",
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0.2
    )

    Settings.embed_model = HuggingFaceEmbedding(model_name="all-MiniLM-L6-v2")

# Only initialize chromadb if available
if HAS_CHROMADB:
    chroma_client = chromadb.PersistentClient(path=DB_PATH)
else:
    chroma_client = None


GCP_KEY_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "gcp_key.json")
if not os.path.exists(GCP_KEY_PATH):
    print(f"⚠️ Warning: GCP credentials file missing at '{GCP_KEY_PATH}'.")

# =====================================================================
# 2. FILE INGESTION PARSERS (Multi-Modal Data Layer)
# =====================================================================
def extract_text_from_pdf(file_path: str) -> str:
    """Extracts raw text content from a local PDF file."""
    try:
        text = ""
        with open(file_path, "rb") as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        return text.strip()
    except Exception as e:
        raise RuntimeError(f"Failed to parse PDF file: {str(e)}")

def extract_text_from_docx(file_path: str) -> str:
    """Extracts raw text content from a local Word document (.docx)."""
    try:
        doc = docx.Document(file_path)
        full_text = [paragraph.text for paragraph in doc.paragraphs]
        return "\n".join(full_text).strip()
    except Exception as e:
        raise RuntimeError(f"Failed to parse DOCX file: {str(e)}")

def scrape_url_to_markdown(url: str) -> str:
    """Fetches a webpage, cleans non-content tags, and structures pure text."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, "html.parser")
        for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
            element.decompose()
            
        lines = (line.strip() for line in soup.get_text().splitlines())
        chunks = (phrase for line in lines for phrase in line.split("  "))
        clean_text = "\n".join(chunk for chunk in chunks if chunk)
        
        return f"# Source: {url}\n\n{clean_text}"
    except Exception as e:
        raise RuntimeError(f"BeautifulSoup scraping failed: {str(e)}")

def transcribe_audio_gcp(audio_file_path: str) -> str:
    """Transcribes an input audio file via Google Cloud Speech-to-Text API."""
    try:
        client = speech.SpeechClient()
        with open(audio_file_path, "rb") as audio_file:
            content = audio_file.read()

        audio = speech.RecognitionAudio(content=content)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.MP3,
            sample_rate_hertz=16000,
            language_code="en-US",
        )

        response = client.recognize(config=config, audio=audio)
        transcript = " ".join([result.alternatives[0].transcript for result in response.results])
        return transcript if transcript else "[Empty Transcription]"
    except Exception as e:
        raise RuntimeError(f"GCP Speech-to-Text transcription failed: {str(e)}")

def extract_dates_from_text(text: str) -> list:
    """
    Extracts all date references from text with support for:
    - Absolute dates: "2024-12-15", "12/15/2024", "December 15, 2024"
    - Relative dates: "last Tuesday", "next month", "this quarter"
    - Quarter notation: "Q1 2026", "Q2 2025"
    - Month/year only: "March 2026", "Jan '25"
    - Relative references: "3 days ago", "2 weeks from now"
    
    Returns: Sorted list of unique datetime objects
    """
    from datetime import datetime, timedelta
    import calendar
    
    dates = []
    current_date = datetime.now()
    
    # Define weekday names and month names for regex
    weekdays = r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)'
    months = r'(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
    
    # Pattern 1: Absolute dates (YYYY-MM-DD, MM/DD/YYYY, etc)
    absolute_patterns = [
        r'\d{4}-\d{1,2}-\d{1,2}',  # YYYY-MM-DD
        r'\d{1,2}/\d{1,2}/\d{4}',  # MM/DD/YYYY
        r'(?:' + months + r') \d{1,2},? \d{4}',  # "January 5, 2026"
        r'\d{1,2} (?:' + months + r') \d{4}',  # "5 January 2026"
    ]
    
    for pattern in absolute_patterns:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for match in matches:
            try:
                parsed_date = date_parser.parse(match.group())
                dates.append(parsed_date)
            except:
                pass
    
    # Pattern 2: Quarter notation (Q1 2026, Q2 2025, etc)
    quarter_pattern = r'Q([1-4])\s*(?:of\s+)?(\d{4}|\d{2})'
    for match in re.finditer(quarter_pattern, text, re.IGNORECASE):
        quarter = int(match.group(1))
        year_str = match.group(2)
        year = int(year_str) if len(year_str) == 4 else 2000 + int(year_str)
        
        # Start of quarter (Q1 = Jan 1, Q2 = Apr 1, etc)
        month = (quarter - 1) * 3 + 1
        dates.append(datetime(year, month, 1))
    
    # Pattern 3: Month/Year notation ("March 2026", "Jan '25")
    month_year_pattern = r'(?:' + months + r')\s*[\']*(\d{4}|\d{2})'
    for match in re.finditer(month_year_pattern, text, re.IGNORECASE):
        try:
            year_str = match.group(1)
            year = int(year_str) if len(year_str) == 4 else 2000 + int(year_str)
            parsed = date_parser.parse(match.group())
            dates.append(datetime(year, parsed.month, 1))
        except:
            pass
    
    # Pattern 4: Relative dates with offsets ("3 days ago", "2 weeks from now")
    relative_pattern = r'(\d+)\s+(day|week|month|year)s?\s+(ago|from\s+now|in\s+the\s+future)'
    for match in re.finditer(relative_pattern, text, re.IGNORECASE):
        amount = int(match.group(1))
        unit = match.group(2).lower()
        direction = match.group(3).lower()
        
        if 'ago' in direction:
            amount = -amount
        
        try:
            if unit == 'day':
                delta_date = current_date + timedelta(days=amount)
            elif unit == 'week':
                delta_date = current_date + timedelta(weeks=amount)
            elif unit == 'month':
                # Add months by calculating target year/month
                target_month = current_date.month + amount
                target_year = current_date.year + (target_month - 1) // 12
                target_month = ((target_month - 1) % 12) + 1
                delta_date = current_date.replace(year=target_year, month=target_month)
            elif unit == 'year':
                delta_date = current_date.replace(year=current_date.year + amount)
            
            dates.append(delta_date)
        except:
            pass
    
    # Pattern 5: Last/Next specific days ("last Tuesday", "next Monday")
    # weekdays is a non-capturing group (?:...) so group(2) doesn't exist.
    # Rebuild as a capturing group so group(2) works correctly.
    weekdays_capturing = r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)'
    last_next_pattern = r'(last|next|this)\s+' + weekdays_capturing
    for match in re.finditer(last_next_pattern, text, re.IGNORECASE):
        direction = match.group(1).lower()
        day_name = match.group(2).lower()
        
        # Map day name to weekday number (0=Monday, 6=Sunday)
        day_map = {
            'monday': 0, 'mon': 0,
            'tuesday': 1, 'tue': 1,
            'wednesday': 2, 'wed': 2,
            'thursday': 3, 'thu': 3,
            'friday': 4, 'fri': 4,
            'saturday': 5, 'sat': 5,
            'sunday': 6, 'sun': 6,
        }
        
        target_weekday = day_map.get(day_name.lower())
        if target_weekday is not None:
            try:
                current_weekday = current_date.weekday()
                days_ahead = target_weekday - current_weekday
                
                if direction == 'last':
                    if days_ahead >= 0:
                        days_ahead -= 7
                    delta_date = current_date + timedelta(days=days_ahead)
                elif direction == 'next':
                    if days_ahead <= 0:
                        days_ahead += 7
                    delta_date = current_date + timedelta(days=days_ahead)
                else:  # 'this'
                    if days_ahead < 0:
                        days_ahead += 7
                    delta_date = current_date + timedelta(days=days_ahead)
                
                dates.append(delta_date)
            except:
                pass
    
    # Pattern 6: Season notation (Spring 2026, Summer 2025)
    season_pattern = r'(Spring|Summer|Fall|Autumn|Winter)\s+(\d{4}|\d{2})'
    season_months = {
        'spring': 3,  # March
        'summer': 6,  # June
        'fall': 9,    # September
        'autumn': 9,  # September
        'winter': 12, # December
    }
    for match in re.finditer(season_pattern, text, re.IGNORECASE):
        season = match.group(1).lower()
        year_str = match.group(2)
        year = int(year_str) if len(year_str) == 4 else 2000 + int(year_str)
        
        if season in season_months:
            dates.append(datetime(year, season_months[season], 1))
    
    # Remove duplicates, sort, and return
    unique_dates = list(set(dates))
    return sorted(unique_dates)


# =====================================================================
# 3. CHUNKING & INDEXING LAYER (LlamaIndex & ChromaDB)
# =====================================================================
def index_data(workspace_id: str, raw_text: str, source_id: str, source_type: str):
    """
    Tokenizes raw text strings into structured metadata nodes, generates
    embeddings automatically, and saves them to the chosen workspace's vector collection.
    """
    if not raw_text.strip():
        return

   
    chroma_collection = chroma_client.get_or_create_collection(name=workspace_id)
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    # Extract temporal metadata
    extracted_dates = extract_dates_from_text(raw_text)
    first_date = extracted_dates[0].isoformat() if extracted_dates else None
    
    # Create document with enriched metadata
    document = Document(
        text=raw_text,
        metadata={
            "source_id": source_id, 
            "source_type": source_type,
            "ingestion_timestamp": datetime.now().isoformat(),  # When it was added
            "first_mentioned_date": first_date,  # Earliest date mentioned in content
            "mentioned_dates_count": len(extracted_dates)
        }
    )

    # Token-based semantic chunk splitter (600 tokens chunk size, 60 tokens overlap)
    text_splitter = TokenTextSplitter(chunk_size=600, chunk_overlap=60)
    nodes = text_splitter.get_nodes_from_documents([document])

    
    VectorStoreIndex.from_documents(
        documents=[document],
        storage_context=storage_context,
        transformations=[text_splitter]
    )

# =====================================================================
# 3.5 TIMELINE SYNTHESIS LAYER
# =====================================================================
def generate_timeline(workspace_id: str, start_date: str = None, end_date: str = None) -> str:
    """
    Synthesizes a chronological timeline from indexed documents.
    Returns a markdown-formatted timeline of events mentioned in the workspace.
    
    Args:
        workspace_id: The workspace to query
        start_date: ISO format date string (YYYY-MM-DD) to filter from
        end_date: ISO format date string (YYYY-MM-DD) to filter until
    """
    try:
        chroma_collection = chroma_client.get_or_create_collection(name=workspace_id)
        
        # Retrieve all documents/metadata from collection
        all_results = chroma_collection.get(include=["documents", "metadatas"])
        
        if not all_results["metadatas"]:
            return "No timeline data available. No documents have been indexed yet."
        
        # Filter and sort by mentioned dates
        timeline_events = []
        for metadata, doc_text in zip(all_results["metadatas"], all_results["documents"]):
            first_date_str = metadata.get("first_mentioned_date")
            if first_date_str:
                try:
                    event_date = datetime.fromisoformat(first_date_str)
                    
                    # Apply date range filter if provided
                    if start_date:
                        start = datetime.fromisoformat(start_date)
                        if event_date < start:
                            continue
                    if end_date:
                        end = datetime.fromisoformat(end_date)
                        if event_date > end:
                            continue
                    
                    timeline_events.append({
                        "date": event_date,
                        "source_id": metadata.get("source_id", "Unknown"),
                        "source_type": metadata.get("source_type", "Unknown"),
                        "ingestion_time": metadata.get("ingestion_timestamp", "Unknown"),
                        "excerpt": doc_text[:150] + "..." if len(doc_text) > 150 else doc_text
                    })
                except:
                    pass
        
        if not timeline_events:
            return f"No events found in timeline (range: {start_date} to {end_date})"
        
        # Sort chronologically
        timeline_events.sort(key=lambda x: x["date"])
        
        # Format as markdown
        timeline_md = "# Timeline\n\n"
        for event in timeline_events:
            timeline_md += f"## {event['date'].strftime('%B %d, %Y')}\n"
            timeline_md += f"**Source:** `{event['source_type']}` ({event['source_id']})\n"
            timeline_md += f"**Indexed:** {event['ingestion_time']}\n"
            timeline_md += f"\n> {event['excerpt']}\n\n"
        
        return timeline_md
        
    except Exception as e:
        return f"Error generating timeline: {str(e)}"

# =====================================================================
# 4. CHATBOT INTEGRATION & SYNTHESIS LAYER
# =====================================================================
def query_workspace(workspace_id: str, message: str, app_identity: str, custom_rules: str) -> str:
    """
    Retrieve top-k chunks from ChromaDB via embedding similarity,
    then call the Groq SDK *directly* — bypassing LlamaIndex's HTTP
    wrapper which was returning gzip-compressed bytes as raw text.
    """
    import groq as groq_sdk

    # ── 1. Embed the query and retrieve relevant chunks ──────────────
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    embed_model = HuggingFaceEmbedding(model_name="all-MiniLM-L6-v2")
    query_embedding = embed_model.get_text_embedding(message)

    chroma_collection = chroma_client.get_or_create_collection(name=workspace_id)
    results = chroma_collection.query(
        query_embeddings=[query_embedding],
        n_results=4,
        include=["documents", "metadatas"]
    )
    chunks = results.get("documents", [[]])[0]
    context = "\n\n---\n\n".join(chunks) if chunks else ""

    # ── 2. Build prompt ───────────────────────────────────────────────
    system_msg = (
        f"You are the AI assistant for the '{app_identity}' personal knowledge base. "
        f"{custom_rules} "
        f"Answer the user's question using ONLY the context provided. "
        f"If the answer is not in the context, say: "
        f"'I could not find that in your indexed documents.'"
    )
    user_msg = f"Context from indexed documents:\n{context}\n\nQuestion: {message}"

    # ── 3. Call Groq SDK directly — clean text response guaranteed ────
    client = groq_sdk.Groq(api_key=os.getenv("GROQ_API_KEY"))
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.2,
        max_tokens=1024,
    )
    answer = completion.choices[0].message.content or ""
    return answer.strip() or "I could not find that in your indexed documents."


# Kept for import compatibility — delegates to query_workspace
def get_dynamic_chat_engine(workspace_id: str, app_identity: str, custom_rules: str):
    raise NotImplementedError("Replaced by query_workspace(). Update api.py.")

def detect_and_handle_timeline_request(query: str, workspace_id: str) -> tuple:
    """
    Detects if a query is asking for a timeline and returns (is_timeline_request, response).
    If it is, generates and returns the timeline directly.
    """
    EXPLICIT_TIMELINE_PHRASES = [
        "show timeline", "show me the timeline", "generate timeline",
        "give me a timeline", "display timeline", "build a timeline",
        "create a timeline", "chronological list", "chronological view",
        "show all events", "list all events", "show milestones",
        "project timeline", "full timeline", "complete timeline",
    ]
    query_lower = query.lower().strip()
    is_timeline = any(phrase in query_lower for phrase in EXPLICIT_TIMELINE_PHRASES)
    
    if not is_timeline:
        return False, None
    
    # Try to extract date range if specified
    start_date = None
    end_date = None
    
    # Simple extraction - could be more sophisticated
    if "from" in query_lower and "to" in query_lower:
        # Very basic parsing - in production use more robust date extraction
        parts = query_lower.split("from")[1].split("to")
        try:
            start_date = date_parser.parse(parts[0].strip()).date().isoformat()
            end_date = date_parser.parse(parts[1].strip()).date().isoformat()
        except:
            pass
    
    timeline = generate_timeline(workspace_id, start_date, end_date)
    return True, timeline

if __name__ == "__main__":
    print("--- Second Memory AI Engine Core: Operational and Clean ---")