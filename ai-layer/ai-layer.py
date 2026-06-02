import os
import requests
from bs4 import BeautifulSoup
import pypdf
import docx
import chromadb


from llama_index.core import VectorStoreIndex, StorageContext, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.groq import Groq
from llama_index.core.chat_engine import CondensePlusContextChatEngine
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.node_parser import TokenTextSplitter

from llama_index.core.schema import Document
from google.cloud import speech

# =====================================================================
# 1. INITIALIZATION & STORAGE ENGINE SETUP
# =====================================================================
DB_PATH = os.getenv("DATABASE_PATH", "./chroma_db") 
os.makedirs(DB_PATH, exist_ok=True)


Settings.llm = Groq(
    model="llama-3.3-70b-versatile",
    api_key=os.getenv("GROQ_API_KEY"),
    temperature=0.2
)

Settings.embed_model = HuggingFaceEmbedding(model_name="all-MiniLM-L6-v2")

chroma_client = chromadb.PersistentClient(path=DB_PATH)


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

   
    document = Document(
        text=raw_text,
        metadata={"source_id": source_id, "source_type": source_type}
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
        f"records corresponding to that topic."
    )
    
   
    chat_engine = CondensePlusContextChatEngine.from_defaults(
        retriever=index.as_retriever(similarity_top_k=4),
        system_prompt=dynamic_system_prompt,
        verbose=False
    )
    
    return chat_engine

if __name__ == "__main__":
    print("--- Second Memory AI Engine Core: Operational and Clean ---")