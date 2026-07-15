# 🧠 Second Brain: Unified Neural Interface

> A state-of-the-art, multimodal AI memory assistant that processes unstructured data into an intelligent, queryable knowledge network. Originally built as a web-only local project by our team, Second Brain has been fully re-engineered into a high-performance, cross-platform **Progressive Web App (PWA) with native Android/iOS support** and cross-device database synchronization, custom-tailored for personal mobile use!

---

## 📌 Abstract & Team History

**Second Brain** was initially conceived by our development team as a localized, web-only, desktop-bound AI agent. It utilized Python, ChromaDB, and local scripts to parse papers, scrape URLs, and store personal research. 

To take this shared research on the go for personal mobile use, we expanded the platform into a high-performance **Android/iOS Progressive Web App (PWA)**. By migrating to an **offline-first, serverless architecture** backed by browser sandboxing and **Supabase** cloud syncing, the assistant is now custom-tailored to run as a native-feeling standalone app directly from any personal phone or home screen!

---

## 📱 Desktop-to-Android PWA Architecture

Second Brain is now a fully certified **Progressive Web App (PWA)**. 

### 🌟 Key Android & Mobile Upgrades:
- 📲 **Native Installation:** Installs as a standalone application on Android (via Chrome / Samsung Internet) and iOS (via Safari), complete with a futuristic customized home screen icon and splash screen.
- ⚡ **Offline-First Resilience:** Backed by a custom Service Worker (`service-worker.js`), the entire application shell is cached on your device. It loads **instantly** (even completely offline) with zero network latency.
- 🎤 **Cross-Browser AI Voice Ingestion:** Standard speech-recognition APIs fail on mobile and browsers like Brave or Firefox. We replaced this with a native hardware **`MediaRecorder` stream capture** that streams raw audio directly to **Groq Whisper AI (`whisper-large-v3`)** for ultra-precise, instant voice-to-text indexing on any mobile device.
- 🎨 **Responsive Matrix Interface:** The UI adapts seamlessly between an expansive desktop workstation view and a compact, high-performance mobile layout.

---

## 🏗️ System Architecture & Data Flow

```
+────────────────────────────────────────────────────────────+
│                 Devices (Desktop / Android)                │
│   [Local IndexedDB/localStorage Workspaces] <--- Fast      │
+─────────────────────────────┬──────────────────────────────+
                              │
              ↑ SYNC          │          ↓ PULL
        (Cloud Backup)        │     (Cross-Device Restore)
                              ▼
+────────────────────────────────────────────────────────────+
│                Secure Cloud DB (Supabase)                  │
│       [Profiles]  [Saved Workspaces]  [Memory Nodes]       │
+─────────────────────────────┬──────────────────────────────+
                              │
                              ▼  (On-Demand Stream)
+────────────────────────────────────────────────────────────+
│                       AI Layer (Groq)                      │
│     [Llama 3.1 Chat Stream]  <--->  [Whisper Transcription]│
+────────────────────────────────────────────────────────────+
```

---

## ⚙️ Upgraded Tech Stack

| Layer | Technology | Status / Role |
| :--- | :--- | :--- |
| **Frontend Shell** | Pure HTML5, CSS3, ES6 Vanilla JS | Lightweight, lightning-fast rendering |
| **PWA Service** | Cache Shell `v3` / Web Manifest | Native Android integration & Offline support |
| **Database Cloud** | Supabase | Multi-tenant auth, profile config, & memory backup |
| **LLM Inference** | Groq (**Llama 3.1 8B Instant**) | Low-latency stream reasoning |
| **Speech-to-Text** | Groq (**Whisper Large v3**) | Hardware-native cross-browser voice transcription |

---

## 🚀 Key Features

### 🔐 Neural Security Portal & Custom Usernames
- Create a private, encrypted account using your Email and a secure Password.
- Support for **Custom Usernames/Codenames** which personalize the interface, terminal welcomes, and initials.
- Hides backend database setups automatically once configured, featuring a collapsible manual config drawer.

### 🔌 Zero-Paste Cross-Device Syncing
- **Default Fallback System:** Hardcode your Supabase URL and public Anon Key once inside the code. Once set, you can log in on **any phone or device using only your Email and Password**!
- **`↑ SYNC`**: Instantly backup your local workspace memories to the secure cloud.
- **`↓ PULL`**: Instantly download and merge your cloud backup onto a new phone, desktop, or tablet.

### 🎙️ AI Voice Recorder
- Simple `⏺ START` and `⏹ STOP` controls.
- Captures physical microphone streams and processes them into raw audio blobs.
- Transcribes speech instantly using Groq Whisper AI, inserting it as an editable document draft ready to index!

---

## 🧱 Project Structure

```text
Second-Brain/
│
├── frontend/                # Full Client-Side PWA Code
│   ├── index.html           # Main entry point (Netlify root server landing)
│   ├── second-brain.html    # Secondary entry point
│   ├── manifest.json        # Android PWA Installation Manifest
│   ├── service-worker.js    # Offline caching shell (v3)
│   ├── icon-192.png         # Standalone launcher icon (192px)
│   └── icon-512.png         # Standalone launcher icon (512px)
│
├── backend/                 # Optional Python backend API services
│   ├── Dockerfile           
│   └── requirements.txt     
│
├── chroma_db/               # Legacy local persistent vector storage
└── README.md                # This documentation
```

---

## 🔐 Installation & Environment Deployment

### 1️⃣ Deploying the PWA (Netlify / Vercel / GitHub Pages)
Because Second Brain is serverless, you can deploy the `frontend/` folder to **any free static host**!

1. Commit this repository to your GitHub account.
2. Link the repository to your hosting service (e.g. **Netlify**).
3. Set the build Publish Directory to **`frontend`** (or let it build the root folder).
4. Deploy! Your site will be live at a custom secure URL (e.g. `https://your-site.netlify.app`).

### 2️⃣ Setting Up the Database (Supabase)
To enable cloud synchronization:
1. Sign up for a free project at [Supabase](https://supabase.com).
2. Run the SQL script found in the Setup Guide in your Supabase SQL Editor to provision the profile tables.
3. Open **`frontend/index.html`** in your code editor.
4. Set your default credentials on lines **3203-3205**:
   ```javascript
   const DEFAULT_SUPABASE_URL = "https://your-project-id.supabase.co";
   const DEFAULT_SUPABASE_ANON_KEY = "your-public-anon-key";
   ```
5. Save, commit, and push! Now your database is auto-configured for every device.

### 3️⃣ Installing on Android:
1. Open your secure HTTPS deployment URL in **Google Chrome** on your Android phone.
2. Tap the **three-dot menu** in Chrome's top-right corner.
3. Tap **Add to Home screen** (or **Install app**).
4. The application will install as a native standalone app in your launcher!

---

## 📈 Future Neural Enhancements
- 🔊 **TTS Integration:** Let the LLM read back responses in a synthesized physical system voice.
- ⛓️ **Graph Visualizations:** Render vector memory connections as an interactive, draggable interactive 3D nodes node.