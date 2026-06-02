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
    last_next_pattern = r'(last|next|this)\s+' + weekdays
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
def get_dynamic_chat_engine(workspace_id: str, app_identity: str, custom_rules: str) -> CondensePlusContextChatEngine:
    """
    Constructs an interactive chatbot instance on the fly. Isolates context tracking 
    to the current workspace, attaches conversational memory, and sets system behavioral profiles 
    dynamically without any hardcoding.
    """

    chroma_collection = chroma_client.get_or_create_collection(name=workspace_id)
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    
    
    index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
    
  
    

    dynamic_system_prompt = (
        f"You are the advanced, core AI conversational assistant powering the '{app_identity}' platform.\n"
        f"Your absolute mandate is to solve requests by synthesizing clear, professional responses "
        f"utilizing exclusively the background vector blocks retrieved from the user's Second Memory store.\n\n"
        f"Operational Guardrails:\n"
        f"1. Ground every single assertion inside the provided context blocks.\n"
        f"2. Specific instructions for this active session: {custom_rules}\n"
        f"3. If the background knowledge-base context blocks do not possess the necessary raw information "
        f"to satisfy the query, cleanly state that the secure workspace indices do not currently contain "
        f"records corresponding to that topic.\n"
        f"4. Timeline Synthesis: When asked about timelines, project milestones, or chronological events, "
        f"use the temporal metadata available in the indexed documents to construct coherent narratives "
        f"organized by date. Include source citations (file names, types) for traceability.\n"
        f"5. If the user asks to filter memory by date range or time period, acknowledge those constraints "
        f"and respond only with information that falls within the specified timeframe."
    )
    
   
    chat_engine = CondensePlusContextChatEngine.from_defaults(
        retriever=index.as_retriever(similarity_top_k=4),
        system_prompt=dynamic_system_prompt,
        verbose=False
    )
    
    return chat_engine

def detect_and_handle_timeline_request(query: str, workspace_id: str) -> tuple:
    """
    Detects if a query is asking for a timeline and returns (is_timeline_request, response).
    If it is, generates and returns the timeline directly.
    """
    timeline_keywords = ["timeline", "chronological", "when did", "date", "schedule", "milestones", 
                        "launch goals", "project progression", "events", "history"]
    
    query_lower = query.lower()
    is_timeline = any(keyword in query_lower for keyword in timeline_keywords)
    
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