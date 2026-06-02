# 🧠 Second Brain

> A unified, multimodal AI memory assistant that transforms unstructured data into an intelligent, queryable knowledge system.

---

## 📌 Abstract

**Second Brain** is a personalized AI-powered knowledge system designed to ingest, process, and retrieve information from diverse data sources such as web pages, documents, and voice inputs.

By leveraging **Retrieval-Augmented Generation (RAG)**, vector databases, and real-time transcription, the system enables users to interact with their stored knowledge through natural language queries—effectively acting as a long-term memory layer.

---


## 🏗️ System Architecture

![System Architecture Diagram](./assets/architecture.png)

### 🔄 Pipeline Overview

```
User Input (Text / Audio / URL / Docs)
        ↓
Data Ingestion Layer
        ↓
Processing & Cleaning
        ↓
Chunking & Embedding
        ↓
Vector Database (ChromaDB)
        ↓
Retriever
        ↓
LLM (Groq - Llama 3)
        ↓
Context-Aware Response
```

---

## ⚙️ Tech Stack

| Layer          | Technology                        |
| -------------- | --------------------------------- |
| Backend        | Python                            |
| LLM            | Groq (Llama 3)                    |
| Embeddings     | HuggingFace (MiniLM)              |
| Vector DB      | ChromaDB                          |
| Framework      | LlamaIndex                        |
| Speech-to-Text | Google Cloud Speech API           |
| Parsing        | BeautifulSoup, PyPDF, python-docx |

---

## 🚀 Features

### 🧩 Multi-Modal Data Ingestion

* 🌐 Web scraping (BeautifulSoup)
* 📄 PDF parsing (PyPDF)
* 📝 DOCX extraction
* 🎙️ Audio transcription (GCP Speech-to-Text)

---

### 🧠 Intelligent Memory Layer

* Semantic chunking with token overlap
* Dense vector embeddings
* Persistent storage using ChromaDB

---

### 🔍 Contextual Retrieval (RAG)

* Top-K similarity search
* Workspace-based isolation (multi-tenant design)
* Context grounding for accurate responses

---

### 💬 Conversational AI Interface

* Dynamic prompt engineering
* Context-aware responses using Groq LLM
* Chat engine with memory tracking

---

### 🧪 Testing Pipeline

* End-to-end ingestion validation
* Audio + text indexing
* Retrieval + response synthesis

---

## 🧱 Project Structure

```
Second-Brain/
│
├── ai-layer/
│   ├── ai-layer.py
│   ├── .env.example
│
├── chroma_db/              # Persistent vector storage
├── assets/                 # Images (architecture, UI, etc.)
│   ├── architecture.png
│
├── README.md
└── requirements.txt
```

---

## 🖼️ Demo & Screenshots

### 🔹 Architecture

![Architecture](./assets/architecture.png)

### 🔹 Chat Interface (Placeholder)

![Chat UI](./assets/chat-ui.png)

### 🔹 Data Ingestion Flow (Placeholder)

![Ingestion](./assets/ingestion.png)

---

## 🔐 Environment Setup

Create a `.env` file:

```
GROQ_API_KEY=your_groq_api_key
GOOGLE_APPLICATION_CREDENTIALS=path_to_gcp_key.json
DATABASE_PATH=./chroma_db
```

---

## ⚡ Installation

```bash
git clone https://github.com/your-username/Second-Brain.git
cd Second-Brain

pip install -r requirements.txt
```

---

## ▶️ Running the Project

```bash
python ai-layer/ai-layer.py
```

---

## 🧪 Running Tests

```bash
python test_pipeline.py
```

---

## 📈 Future Enhancements

* 🔊 Text-to-Speech (Full voice assistant loop)
* 🌐 Frontend UI (React / Flutter)
* ☁️ GCP Deployment (Cloud Run / App Engine)
* 🧾 Source citations in responses
* 🧠 Memory summarization & compression

---

