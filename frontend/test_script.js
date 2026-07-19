
  document.addEventListener('DOMContentLoaded', async function() {
  
  /* ══════════════════════════════════════════════════════════════════
     LOCAL VECTOR DATABASE & CONFIG (COMPLETELY LOCAL PWA MODE)
  ══════════════════════════════════════════════════════════════════ */
  
  // Custom Local Persistent Vector Database using IndexedDB
  class LocalVectorDB {
    constructor() {
      this.dbName = 'second_brain_db';
      this.storeName = 'nodes';
      this.db = null;
      this.nodesCache = [];
    }

    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: ['workspace_id', 'source_id'] });
          }
        };
        request.onsuccess = (e) => {
          this.db = e.target.result;
          this.loadAllNodes().then(resolve).catch(reject);
        };
        request.onerror = (e) => reject(e.target.error);
      });
    }

    async loadAllNodes() {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();
        request.onsuccess = () => {
          this.nodesCache = request.result || [];
          resolve(this.nodesCache);
        };
        request.onerror = () => reject(request.error);
      });
    }

    getNodes(workspaceId) {
      return this.nodesCache.filter(n => n.workspace_id === workspaceId);
    }

    async saveNode(node) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(node);
        request.onsuccess = () => {
          const index = this.nodesCache.findIndex(n => n.workspace_id === node.workspace_id && n.source_id === node.source_id);
          if (index > -1) {
            this.nodesCache[index] = node;
          } else {
            this.nodesCache.push(node);
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    async deleteNode(workspaceId, sourceId) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete([workspaceId, sourceId]);
        request.onsuccess = () => {
          this.nodesCache = this.nodesCache.filter(n => !(n.workspace_id === workspaceId && n.source_id === sourceId));
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    async deleteWorkspace(workspaceId) {
      const wsNodes = this.getNodes(workspaceId);
      for (const node of wsNodes) {
        await this.deleteNode(workspaceId, node.source_id);
      }
    }
  }

  // Local Chat Logs Storage
  const ChatLogs = {
    getChatLog: async (workspaceId) => {
      const logKey = `chat_log_${workspaceId}`;
      const logStr = localStorage.getItem(logKey);
      return { entries: logStr ? JSON.parse(logStr) : [] };
    },
    saveChatLogEntry: async (workspaceId, role, message) => {
      const logKey = `chat_log_${workspaceId}`;
      const log = await ChatLogs.getChatLog(workspaceId);
      log.entries.push({ role, message, timestamp: new Date().toISOString() });
      localStorage.setItem(logKey, JSON.stringify(log.entries));
    },
    clearChatLog: async (workspaceId) => {
      const logKey = `chat_log_${workspaceId}`;
      localStorage.removeItem(logKey);
    }
  };

  // Math Helper for Vector Cosine Similarity
  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      mA += a[i] * a[i];
      mB += b[i] * b[i];
    }
    if (mA === 0 || mB === 0) return 0;
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
  }

  // Initialize Local DB
  window.localDatabase = new LocalVectorDB();
  try {
    await window.localDatabase.init();
    console.log("💾 Local IndexedDB database initialized successfully!");
  } catch (err) {
    console.error("❌ Failed to initialize IndexedDB:", err);
  }

  // Embeddings Loader Helper
  let embedder = null;
  async function getEmbedder() {
    if (embedder) return embedder;
    if (!window.transformers) {
      throw new Error("Local embedding libraries are still loading. Please wait a moment.");
    }
    showToast("LOADING ON-DEVICE EMBEDDING MODEL... (ONLY ONCE)");
    embedder = await window.transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    showToast("ON-DEVICE EMBEDDINGS READY!");
    return embedder;
  }

  async function getEmbedding(text) {
    const pipe = await getEmbedder();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  // Batch Embeddings with UI responsiveness and fallback safety
  async function getEmbeddingsBatch(texts, progressCallback) {
    const pipe = await getEmbedder();
    const batchSize = 8; // Process 8 chunks at a time for WebAssembly safety and responsiveness
    const results = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      if (progressCallback) {
        progressCallback(i, texts.length);
      }
      // Let the browser paint the UI update and process events
      await new Promise(resolve => setTimeout(resolve, 25));
      
      try {
        const output = await pipe(batch, { pooling: 'mean', normalize: true });
        const numEmbeddings = batch.length;
        const embDim = output.dims[1] || (output.data.length / numEmbeddings);
        
        for (let j = 0; j < numEmbeddings; j++) {
          const start = j * embDim;
          const sub = output.data.subarray ? output.data.subarray(start, start + embDim) : output.data.slice(start, start + embDim);
          results.push(Array.from(sub));
        }
      } catch (err) {
        console.warn("Batch embedding failed, falling back to sequential for this batch:", err);
        // Fallback: process the current batch sequentially
        for (const t of batch) {
          const output = await pipe(t, { pooling: 'mean', normalize: true });
          results.push(Array.from(output.data));
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
    
    if (progressCallback) {
      progressCallback(texts.length, texts.length);
    }
    return results;
  }

  // Chunker Helper (MiniLM operates best on 256-512 token sized chunks)
  function chunkText(text, chunkSize = 250, chunkOverlap = 50) {
    const words = text.split(/\s+/);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
      const chunkWords = words.slice(i, i + chunkSize);
      chunks.push(chunkWords.join(' '));
      if (words.length <= chunkSize) break;
      i += (chunkSize - chunkOverlap);
    }
    return chunks;
  }

  // Date Extractor Regex
  function extractDatesFromText(text) {
    const dates = [];
    const ymdRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    let match;
    while ((match = ymdRegex.exec(text)) !== null) {
      dates.push(match[0]);
    }
    const slashRegex = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
    while ((match = slashRegex.exec(text)) !== null) {
      const m = match[1].padStart(2, '0');
      const d = match[2].padStart(2, '0');
      const y = match[3];
      dates.push(`${y}-${m}-${d}`);
    }
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
                    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthRegexStr = `(?:${months.join('|')})`;
    const wordDateRegex = new RegExp(`\\b(\\d{1,2})?\\s*(${monthRegexStr})\\s*,?\\s*(\\d{1,2})?\\s*,?\\s*(\\d{4})\\b`, 'gi');
    while ((match = wordDateRegex.exec(text)) !== null) {
      const monthWord = match[2].toLowerCase();
      let monthIndex = months.indexOf(monthWord);
      if (monthIndex >= 12) monthIndex -= 12;
      const monthNum = String(monthIndex + 1).padStart(2, '0');
      const day = match[1] || match[3] || '01';
      const dayNum = String(day).padStart(2, '0');
      const year = match[4];
      dates.push(`${year}-${monthNum}-${dayNum}`);
    }
    return [...new Set(dates)].sort();
  }

  // Local RAG Context Retrieval with Source Balancing & Higher recall
  async function retrieveLocalContext(workspaceId, queryText, topK = 6) {
    const queryEmbedding = await getEmbedding(queryText);
    const nodes = window.localDatabase.getNodes(workspaceId);
    const candidates = [];
    nodes.forEach(node => {
      if (!node.chunks || !node.embeddings) return;
      for (let i = 0; i < node.chunks.length; i++) {
        const chunkText = node.chunks[i];
        const chunkEmbed = node.embeddings[i];
        if (!chunkEmbed) continue;
        const sim = cosineSimilarity(queryEmbedding, chunkEmbed);
        candidates.push({
          text: chunkText,
          source_id: node.source_id,
          source_type: node.source_type,
          similarity: sim
        });
      }
    });

    // Sort all candidate chunks by similarity descending
    candidates.sort((a, b) => b.similarity - a.similarity);

    // Dynamic Source Balancing: Prevent any single file (like chat logs) from dominating the entire context
    const selected = [];
    const sourceCounts = {};

    for (const cand of candidates) {
      if (selected.length >= topK) break;

      const src = cand.source_id;
      sourceCounts[src] = sourceCounts[src] || 0;

      // Limit to at most 2 chunks from the same file, unless we don't have enough total candidates
      if (sourceCounts[src] < 2) {
        selected.push(cand);
        sourceCounts[src]++;
      }
    }

    // Fallback: If we didn't fill topK due to limits, add more from the sorted candidates
    if (selected.length < topK) {
      for (const cand of candidates) {
        if (selected.length >= topK) break;
        if (!selected.includes(cand)) {
          selected.push(cand);
        }
      }
    }

    return selected;
  }

  // Local Timeline Markdown Generator
  function generateTimelineMarkdown(workspaceId, startDate = null, endDate = null) {
    const nodes = window.localDatabase.getNodes(workspaceId);
    const allEvents = [];
    nodes.forEach(node => {
      const nodeDates = node.dates && node.dates.length ? node.dates : [node.timestamp.split('T')[0]];
      nodeDates.forEach(dStr => {
        if (startDate && dStr < startDate) return;
        if (endDate && dStr > endDate) return;
        allEvents.push({
          date: dStr,
          source_id: node.source_id,
          source_type: node.source_type,
          text: node.text,
          timestamp: node.timestamp
        });
      });
    });
    allEvents.sort((a, b) => a.date.localeCompare(b.date));
    
    if (allEvents.length === 0) {
      return {
        timeline_markdown: 'No events found inside memory database.',
        event_count: 0,
        date_range: { start: 'N/A', end: 'N/A' }
      };
    }
    
    let markdown = '# Timeline\\n\\n';
    allEvents.forEach(ev => {
      markdown += `## ${ev.date}\\n`;
      markdown += `**Source:** \`${ev.source_type.toUpperCase()}\` (${ev.source_id})\\n`;
      markdown += `**Indexed:** ${new Date(ev.timestamp).toLocaleString()}\\n\\n`;
      markdown += `> ${ev.text.substring(0, 150).replace(/\\n/g, ' ')}...\\n\\n`;
    });
    return {
      timeline_markdown: markdown,
      event_count: allEvents.length,
      date_range: { start: allEvents[0].date, end: allEvents[allEvents.length - 1].date }
    };
  }

  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : window.location.origin;

  /* ══════════════════════════════════════════════════════════════════
     WORKSPACE ID
     Every endpoint needs a workspace_id. We read from the input and
     fall back to 'default'. The value is remembered in sessionStorage
     so page refreshes don't lose it.
  ══════════════════════════════════════════════════════════════════ */
  const wsInput = document.getElementById('workspace-input');
  wsInput.value = localStorage.getItem('sb_workspace') || 'default';
  wsInput.addEventListener('input', () => {
    localStorage.setItem('sb_workspace', wsInput.value.trim() || 'default');
    // Reload graph nodes for new workspace
    if (typeof restoreGraphNodes === 'function') {
      docNodes.length = 0;
      document.getElementById('node-count').textContent = '0';
      restoreGraphNodes();
    }
  });
  function getWorkspace() {
    return wsInput.value.trim() || 'default';
  }

  /* ══════════════════════════════════════════════════════════════════
     API HEALTH CHECK
     Pings GET /api/health every 10s and updates the dot in the header.
     Green = API is reachable. Red = offline.
     This replaces the purely cosmetic status display from the original.
  ══════════════════════════════════════════════════════════════════ */
  const apiDot = document.getElementById('api-status-dot');
  async function checkHealth() {
    apiDot.className = 'online'; // On-device local mode is always online & ready!
  }
  checkHealth();
  setInterval(checkHealth, 10000);

  /* ══════════════════════════════════════════════════════════════════
     BG SHAPES
  ══════════════════════════════════════════════════════════════════ */
  const bgCanvas = document.getElementById('bg-canvas');
  [['bs-rect',80,4,'15%','8%','20s'],['bs-rect',4,120,'25%','92%','16s'],
   ['bs-rect',50,3,'70%','5%','24s'],['bs-ring',200,200,'10%','60%','25s'],
   ['bs-ring',120,120,'55%','20%','22s'],['bs-line',180,1,'40%','55%','14s'],
   ['bs-rect',12,12,'30%','35%','21s']
  ].forEach(([cls,w,h,top,left,dur]) => {
    const el = document.createElement('div');
    el.className = `bg-shape ${cls}`;
    el.style.cssText = `width:${w}px;height:${h}px;top:${top};left:${left};--dur:${dur};`;
    bgCanvas.appendChild(el);
  });

  /* ══════════════════════════════════════════════════════════════════
     TOAST HELPER
  ══════════════════════════════════════════════════════════════════ */
  function showToast(msg, isError = false) {
    const tc = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    tc.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 2600);
  }

  /* ══════════════════════════════════════════════════════════════════
     CHAT
     FIX: Original used a static array of fake responses cycled in order.
     Now we call POST /api/chat with the user's message and workspace_id.
     If the backend flags is_timeline_request=true we render the markdown
     response as a structured timeline inside the bubble.
     On network failure we fall back gracefully with an error message.
  ══════════════════════════════════════════════════════════════════ */
  document.getElementById('init-time').textContent = fmtTime();

  const msgInput  = document.getElementById('msg-input');
  const sendBtn   = document.getElementById('send-btn');
  const chatMsgs  = document.getElementById('chat-messages');
  const typingInd = document.getElementById('typing-indicator');

  msgInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  sendBtn.addEventListener('click', sendChatMessage);

  function fmtTime() {
    const n = new Date();
    return [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
  }

  function appendMsg(html, type, isHTML = false) {
    const el = document.createElement('div');
    el.className = `msg ${type}`;
    const bubble = isHTML
      ? `<div class="msg-bubble">${html}</div>`
      : `<div class="msg-bubble">${html}</div>`;
    el.innerHTML = `<div class="msg-avatar">${type==='ai'?'SB':'ME'}</div><div>${bubble}<div class="msg-time">${fmtTime()}</div></div>`;
    chatMsgs.insertBefore(el, typingInd);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  /* Converts the markdown timeline from the API into HTML for the chat bubble */
  function renderTimelineMarkdown(md) {
    let html = '<div class="timeline-bubble">';
    md.split('\n').forEach(line => {
      if (line.startsWith('# '))       html += `<h1>${line.slice(2)}</h1>`;
      else if (line.startsWith('## ')) html += `<h2>${line.slice(3)}</h2>`;
      else if (line.startsWith('> '))  html += `<blockquote>${line.slice(2)}</blockquote>`;
      else if (line.startsWith('**'))  html += `<p>${line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}</p>`;
      else if (line.trim())            html += `<p style="font-size:11px;color:var(--text-dim)">${line}</p>`;
    });
    return html + '</div>';
  }

  let isChatLoading = false;
  /* Conversation history — persists for the entire page session so the AI
     can reference earlier messages. Each entry: { role: 'user'|'assistant', content: string } */
  let chatHistory = [];

  function formatStreamingText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  async function sendChatMessage() {
    const text = msgInput.value.trim();
    if (!text || isChatLoading) return;

    // Proactively request browser notification permission on direct user send action (enabling Android Chrome & mobile PWA permission popups)
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (e) {
        console.warn("Notification permission request failed:", e);
      }
    }

    isChatLoading = true;

    appendMsg(text, 'user');
    msgInput.value = ''; msgInput.style.height = 'auto';
    typingInd.classList.add('visible');
    chatMsgs.scrollTop = chatMsgs.scrollHeight;

    // Add user turn to history BEFORE sending
    chatHistory.push({ role: 'user', content: text });

    try {
      const ws = getWorkspace();
      const apiKey = localStorage.getItem('sb_groq_key');
      if (!apiKey) {
        throw new Error("Missing Groq API Key in the top header. Please paste your Groq Key first!");
      }

      // Check if it's a timeline request intent
      const textLower = text.toLowerCase();
      const isTimelineIntent = textLower.includes('timeline') || textLower.includes('show events') || textLower.includes('show chronological');
      
      let responseText = '';
      
      if (isTimelineIntent) {
        // Retrieve timeline data and render
        const timelineRes = generateTimelineMarkdown(ws);
        typingInd.classList.remove('visible');
        appendMsg(timelineRes.timeline_markdown, 'ai', true);
        responseText = timelineRes.timeline_markdown;
        chatHistory.push({ role: 'assistant', content: responseText });
      } else {
        // Run local RAG retrieval!
        showToast("RETRIEVING MEMORY CONTEXT FROM PHONE...");
        const contextNodes = await retrieveLocalContext(ws, text, 6);
        let contextBlock = "";
        if (contextNodes.length > 0) {
          contextBlock = "Here is some relevant context from your Second Brain database:\n\n" +
            contextNodes.map((n, idx) => `[Document: ${n.source_id}] (Relevance: ${Math.round(n.similarity * 100)}%)\nContext:\n${n.text}`).join('\n\n');
        } else {
          contextBlock = "No local context found. Please ingest some documents or audio recordings first.";
        }

        let activeUsername = 'YOU';
        try {
          const sessionUserStr = localStorage.getItem('sb_session_user');
          if (sessionUserStr) {
            const user = JSON.parse(sessionUserStr);
            activeUsername = user.user_metadata?.username || localStorage.getItem('sb_username') || user.email?.split('@')[0] || 'YOU';
          } else {
            const cached = localStorage.getItem('sb_username');
            if (cached) activeUsername = cached;
          }
        } catch (e) {}

        // Build the system prompt with context, conversational memory directions, and reminders triggering
        const systemPrompt = `You are Second Brain, a personalized AI-powered knowledge system acting as the user's long-term memory layer.
You reside completely on the user's mobile device.

USER PROFILE:
- Current User: ${activeUsername}

HUMAN CONVERSATIONAL TONE GUIDELINES:
- Speak in a highly natural, warm, friendly, conversational, and genuinely human voice. Imagine talking directly to a close companion or a coworker.
- Strictly avoid rigid formatting, markdown tables, dates, times, or precise logs unless the user explicitly asks you for them. Keep descriptions relaxed and organic.
- Be concise, clean, and helpful.

MANGLISH / ROMANIZED MALAYALAM SUPPORT:
- The user may converse in "Manglish" (Malayalam words written using the English/Latin alphabet, such as "njan ara" [Who am I?], "poda" [go away / buddy], "i told him but avan cheythila" [I told him but he didn't do it]).
- You must demonstrate expert capability in understanding, translating, and replying to Manglish/Malayalam/hybrid inputs fluently. 
- Interpret the user's meaning accurately, maintain conversational context, and respond back in either smooth conversational English, Manglish, or warm Malayalam depending on what feels most natural and helpful in the conversation!

CONVERSATION CONTEXT:
- Maintain a continuous, natural, and helpful conversation with the user.
- Always refer back to and leverage previous messages in the chat history to understand and answer follow-up questions or requests.

REMINDERS TRIGGER SYSTEM:
- If the user asks you to remind them of something at a specific time or after a duration (e.g., "remind me in 5 seconds to stand up" or "remind me to check the oven at 3:00 PM"):
  You MUST append a special hidden tag at the very end of your response in the exact format:
  [[REMINDER: text="Your reminder content" delay="duration_in_seconds_or_time_string"]]
  
  Examples:
  - "remind me in 10 seconds to drink water" -> Append at the end: [[REMINDER: text="Drink water" delay="10"]]
  - "remind me in 5 minutes to buy milk" -> Append at the end: [[REMINDER: text="Buy milk" delay="300"]]
  - "remind me to check oven at 3:00 PM" -> Append at the end: [[REMINDER: text="Check oven" delay="15:00"]]
  - "remind me to call dad at 6:30 PM" -> Append at the end: [[REMINDER: text="Call dad" delay="18:30"]]

MEMORY RETRIEVAL CONTEXT:
Use the following local database context to answer their query accurately when relevant:
${contextBlock}

If the query cannot be answered using the retrieved context or conversation history, use your general knowledge but mention that it is not in the local Second Brain notes.`;

        // Stream from Groq!
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: systemPrompt },
              ...chatHistory.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }))
            ],
            temperature: 0.3,
            stream: true
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP status ${response.status}`);
        }

        typingInd.classList.remove('visible');
        
        // Append an empty message bubble for streaming
        const el = document.createElement('div');
        el.className = 'msg ai';
        el.innerHTML = `<div class="msg-avatar">SB</div><div><div class="msg-bubble"><div class="chat-stream">...</div></div><div class="msg-time">${fmtTime()}</div></div>`;
        chatMsgs.insertBefore(el, typingInd);
        chatMsgs.scrollTop = chatMsgs.scrollHeight;

        const streamContainer = el.querySelector('.chat-stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        let buffer = '';

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          buffer += decoder.decode(value, { stream: !done });
          
          const lines = buffer.split('\n');
          // Keep the last incomplete line in the buffer
          buffer = lines.pop();

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine) continue;
            if (cleanLine === 'data: [DONE]') continue;
            if (cleanLine.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(cleanLine.slice(6));
                const delta = parsed.choices[0]?.delta?.content;
                if (delta) {
                  responseText += delta;
                  // Update content in bubble
                  streamContainer.innerHTML = formatStreamingText(responseText);
                  chatMsgs.scrollTop = chatMsgs.scrollHeight;
                }
              } catch (e) {
                // Ignore partial JSON
              }
            }
          }
        }
        
        // Parse reminders if present in responseText (highly robust parsing tolerant of quote styles, order, and whitespace)
        let cleanedResponseText = responseText;
        const reminderTagRegex = /\[\[REMINDER:\s*([\s\S]+?)\s*\]\]/i;
        const tagMatch = responseText.match(reminderTagRegex);
        if (tagMatch) {
          const rawTag = tagMatch[0];
          const paramsText = tagMatch[1];
          const textMatch = paramsText.match(/text=(?:"|')([^'"]+)(?:"|')/i);
          const delayMatch = paramsText.match(/delay=(?:"|')([^'"]+)(?:"|')/i);
          
          if (textMatch && delayMatch) {
            // Schedule using robust delay string
            scheduleReminderFromTag(rawTag);
            // Strip out the tag from response text
            cleanedResponseText = responseText.replace(reminderTagRegex, '').trim();
            streamContainer.innerHTML = formatStreamingText(cleanedResponseText);
          }
        }

        // Add final streamed response to chat history
        chatHistory.push({ role: 'assistant', content: cleanedResponseText });

        // Update/Sync the central Chat Memory Node in the database
        await saveChatTurnToDatabaseNode(text, cleanedResponseText);
      }

    } catch (err) {
      typingInd.classList.remove('visible');
      appendMsg(`⚠ Error: ${err.message}`, 'ai');
      chatHistory.pop(); // Remove last user msg since failed
    } finally {
      isChatLoading = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     FILE UPLOAD + INDEXING
     FIX: Original handleFiles() only added visual nodes and fake status.
     Now we:
       1. Read the file as text (FileReader)
       2. POST /api/index with { workspace_id, text, source_id, source_type }
       3. Update the file row status to INDEXED or ERROR based on real response
       4. Only add a graph node once indexing succeeds
  ══════════════════════════════════════════════════════════════════ */

  /*
    indexFile — sends raw file to POST /api/upload as multipart/form-data.
    Backend extracts text server-side for PDF/DOCX so binary files work correctly.
    Do NOT set Content-Type header — browser must set it with the boundary token.
  */
  async function indexFile(file, statusEl) {
    const ws = getWorkspace();
    if (!ws) {
      statusEl.textContent = 'NO WS';
      statusEl.className   = 'pfile-status error';
      showToast('SET A WORKSPACE ID FIRST');
      return { success: false };
    }
    
    statusEl.textContent = 'PARSING…';
    statusEl.className   = 'pfile-status indexing';

    try {
      let fileText = '';
      const ext = (file.name.split('.').pop() || 'file').toLowerCase();
      
      // 1. Client-Side parsing of file depending on extension
      if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' || ext === 'jsonl') {
        fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
      } else if (ext === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        // Set worker source
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let textParts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          textParts.push(pageText);
        }
        fileText = textParts.join('\n');
      } else if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        fileText = result.value;
      } else {
        // Fallback to text reading
        fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
      }

      if (!fileText.trim()) {
        throw new Error("Parsed text is empty.");
      }

      statusEl.textContent = 'EMBEDDING…';
      
      // 2. Chunks generation
      const chunks = chunkText(fileText);

      // 3. Compute Embeddings on-device in batches with UI responsiveness
      const embeddings = await getEmbeddingsBatch(chunks, (completed, total) => {
        const percent = Math.round((completed / total) * 100);
        statusEl.textContent = `EMBEDDING (${percent}%)`;
      });

      // 4. Extract dates inside the text for calendar/timeline
      const datesFound = extractDatesFromText(fileText);

      // 5. Create the local node document structure
      const node = {
        workspace_id: ws,
        source_id: file.name,
        source_type: ext,
        text: fileText,
        chunks: chunks,
        embeddings: embeddings,
        priority: 3, // Default priority
        cluster_id: Math.floor(Math.random() * 4) + 1, // Generate a visual cluster grouping
        cluster_name: ext.toUpperCase() + ' Files',
        dates: datesFound,
        timestamp: new Date().toISOString()
      };

      // 6. Save document node locally into browser's IndexedDB
      await window.localDatabase.saveNode(node);

      statusEl.textContent = 'INDEXED';
      statusEl.className   = 'pfile-status done';
      return { success: true, dates_found: datesFound };

    } catch (err) {
      statusEl.textContent = 'ERROR';
      statusEl.className   = 'pfile-status error';
      console.error('[indexFile Error]', err);
      showToast(`FAILED TO INDEX: ${err.message}`, true);
      return { success: false };
    }
  }

  async function handleFiles(files) {
    let indexed = 0;
    for (const f of Array.from(files).slice(0, 10)) {
      const ext      = (f.name.split('.').pop() || 'file').toLowerCase();
      const baseName = f.name.replace(/\.[^.]+$/, '');
      const row      = addPopupFileRow(f.name, ext);
      const statusEl = row.querySelector('.pfile-status');

      /* Kick off indexing; graph node appears on success */
      const result = await indexFile(f, statusEl);
      if (result.success) {
        indexed++;
        if (result.dates && result.dates.length) {
          showToast(`${baseName}: ${result.dates.length} DATE(S) EXTRACTED`);
        }
        // Refresh graph from backend to fetch correct cluster and priority
        setTimeout(async () => {
          await restoreGraphNodes();
        }, 1500);
      }

      /* Fade row out after 4 seconds */
      setTimeout(() => {
        row.style.opacity = '0'; row.style.transform = 'translateX(16px)';
        row.style.transition = 'all .4s';
        setTimeout(() => row.remove(), 400);
      }, 4000);
    }
    if (indexed) showToast(`${indexed} FILE${indexed>1?'S':''} INDEXED`);
  }

  function addPopupFileRow(name, ext) {
    const row = document.createElement('div');
    row.className = 'pfile-item';
    row.innerHTML = `<span class="pfile-ext">${ext.toUpperCase()}</span><span class="pfile-name">${name}</span><span class="pfile-status indexing">INDEXING…</span>`;
    const list = document.getElementById('popup-file-list');
    list.appendChild(row); list.scrollTop = list.scrollHeight;
    return row;
  }

  /* ══════════════════════════════════════════════════════════════════
     KNOWLEDGE GRAPH (visual layer — unchanged from original)
  ══════════════════════════════════════════════════════════════════ */
  const wrap  = document.getElementById('graph-canvas-wrap');
  const bgC   = document.getElementById('graph-bg-canvas');
  const mainC = document.getElementById('graph-main-canvas');
  const bctx  = bgC.getContext('2d');
  const ctx   = mainC.getContext('2d');

  let W, H, cx, cy, dpr;
  let zoom = 1, minZoom = .4, maxZoom = 3.0;
  let panX = 0, panY = 0, isPanning = false;
  let panStartMouseX = 0, panStartMouseY = 0, panStartX = 0, panStartY = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth; H = wrap.clientHeight;
    [bgC, mainC].forEach(c => {
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px';
    });
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2 - 10;
  }
  resize();
  window.addEventListener('resize', () => { resize(); drawStars(); });

  const stars = Array.from({length:80}, () => ({ x:Math.random()*3000, y:Math.random()*900, r:Math.random()*1.1+.2, a:Math.random()*.35+.08 }));
  function drawStars() {
    bctx.clearRect(0, 0, W, H);
    stars.forEach(s => { bctx.beginPath(); bctx.arc(s.x%W, s.y%H, s.r, 0, Math.PI*2); bctx.fillStyle=`rgba(255,255,255,${s.a})`; bctx.fill(); });
  }
  drawStars();

  // All nodes share same base color; priority only controls the ring color
  const NODE_BASE = { fill: 'rgba(255,90,0,0.45)', glow: 'rgba(255,90,0,0.3)' };
  
  const CLUSTER_HUES = [200, 280, 140, 330, 50, 170, 260, 10, 100, 220];
  let backendClusterHues = {};
  let lastHueIdx = 0;

  function getClusterColor(clusterId) {
    if (clusterId === 'cluster_chat') return '#00c8c8'; // Cyan for chat logs
    if (clusterId === 'cluster_default' || !clusterId) return 'rgba(255,90,0,0.38)'; // default orange
    
    if (!(clusterId in backendClusterHues)) {
      backendClusterHues[clusterId] = CLUSTER_HUES[lastHueIdx % CLUSTER_HUES.length];
      lastHueIdx++;
    }
    const hue = backendClusterHues[clusterId];
    return `hsla(${hue}, 35%, 63%, 0.65)`;
  }
  const PRIORITY_RING = {
    1: { color: '#ff3333', glow: 'rgba(255,51,51,0.7)',  label: 'HIGH',   width: 1.5 },
    2: { color: '#ffcc00', glow: 'rgba(255,204,0,0.6)',  label: 'MEDIUM', width: 1.5 },
    3: { color: 'rgba(0,255,136,0.5)', glow: 'rgba(0,255,136,0.2)', label: 'LOW', width: 1 },
  };
  // Keep PRIORITY_COLORS alias for any other references
  const PRIORITY_COLORS = {
    1: { fill: '#FF5A00', glow: 'rgba(255,90,0,0.5)', label: 'HIGH'   },
    2: { fill: '#FF5A00', glow: 'rgba(255,90,0,0.5)', label: 'MEDIUM' },
    3: { fill: '#FF5A00', glow: 'rgba(255,90,0,0.5)', label: 'LOW'    },
  };

  const CORE_R = 10;
  const NODE_COLORS = [
    {fill:'#FF5A00',glow:'rgba(255,90,0,0.5)'},{fill:'#FF5A00',glow:'rgba(255,90,0,0.5)'},
    {fill:'#FF5A00',glow:'rgba(255,90,0,0.5)'},{fill:'#FF5A00',glow:'rgba(255,90,0,0.5)'},
    {fill:'#FF5A00',glow:'rgba(255,90,0,0.5)'}
  ];
  let docNodes = [], animFrame = 0, hovered = null;
  // Connection edges between semantically related nodes
  let nodeConnections = [];   // [{source: sid, target: sid, similarity: float}]

  const coreNode = { id:'core', label:'YOU', x:0, y:0, r:CORE_R, angle:0, orbitR:0, speed:0, color:{fill:'#FF5A00',glow:'rgba(255,90,0,0.7)'}, isCore:true, birth:0, alpha:1 };

  function addDocNode(name, ext, fullId, priority, clusterId, clusterName) {
    const r = 4.5;
    const prio = priority || 3;
    const color = NODE_BASE;

    // Random starting position — scattered in all directions, not overlapping core
    let px, py, attempts = 0;
    do {
      const minDist = 80, maxDist = Math.min(W, H) * 0.42;
      const dist  = minDist + Math.random() * (maxDist - minDist);
      const angle = Math.random() * Math.PI * 2;
      px = cx + Math.cos(angle) * dist;
      py = cy + Math.sin(angle) * dist;
      attempts++;
    } while (
      attempts < 40 &&
      docNodes.some(n => Math.hypot(n.x - px, n.y - py) < (n.r + r + 8))
    );

    // Ultra-slow, cinematic drift velocity
    const speed = 0.03 + Math.random() * 0.04;
    const dir   = Math.random() * Math.PI * 2; // drift in any direction initially

    docNodes.push({
      id: 'n' + Date.now() + docNodes.length,
      label: name.length > 10 ? name.slice(0, 9) + '…' : name,
      sourceId: fullId || name,
      ext: ext.toUpperCase(),
      x: px, y: py,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      r, color, priority: prio,
      clusterId: clusterId || 'cluster_default',
      clusterName: clusterName || 'General Knowledge',
      isCore: false, birth: animFrame, alpha: 0
    });
    document.getElementById('node-count').textContent = docNodes.length;
    document.getElementById('graph-hint').style.opacity = '0';
  }

  /* Physics tick — free drift + soft repulsion + cluster attraction + canvas bounce */
  const REPEL_FORCE   = 0.035; // gentle push-apart
  const CORE_REPEL    = 25;    // keep nodes away from core
  const DAMPING       = 0.992;  // very gentle damping — nodes keep drifting
  const CLUSTER_FORCE = 0.012;  // pull strength along similarity edges
  const CLUSTER_DIST  = 145;     // ideal resting distance between connected nodes

  function tickPhysics() {
    const allNodes = [coreNode, ...docNodes];

    docNodes.forEach(n => {
      if (n.isDragging) return; // Skip physics movement if currently being dragged!

      // Soft repulsion from every other node (including core)
      allNodes.forEach(other => {
        if (other === n) return;
        const dx = n.x - other.x, dy = n.y - other.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        
        let minDist = n.r + (other.isCore ? CORE_REPEL : other.r) + 6;
        let repelMultiplier = 1;

        if (!n.isCore && !other.isCore) {
          if (n.clusterId !== other.clusterId) {
            // Different clusters: keep original separation
            minDist = 120; // original repulsion distance
            repelMultiplier = 2.5; // original push force
          } else {
            // Same cluster: spread them out much further to avoid huddling
            minDist = 95;
            repelMultiplier = 5.0;
          }
        }

        if (dist < minDist) {
          const force = ((minDist - dist) / minDist) * REPEL_FORCE * repelMultiplier;
          n.vx += (dx / dist) * force;
          n.vy += (dy / dist) * force;
        }
      });

      // Very slight centre attraction so nodes don't drift off-screen
      const dxC = cx - n.x, dyC = cy - n.y;
      const distC = Math.hypot(dxC, dyC);
      if (distC > Math.min(W, H) * 0.38) {
        n.vx += (dxC / distC) * 0.004;
        n.vy += (dyC / distC) * 0.004;
      }

      // Damping — bleeds velocity so nodes slow to a near-stop naturally
      n.vx *= DAMPING;
      n.vy *= DAMPING;

      // Slower speed cap
      const spd = Math.hypot(n.vx, n.vy);
      if (spd > 0.15) { n.vx = (n.vx / spd) * 0.15; n.vy = (n.vy / spd) * 0.15; }
      // Slower minimum drift
      if (spd < 0.01) {
        const a = Math.random() * Math.PI * 2;
        n.vx += Math.cos(a) * 0.015;
        n.vy += Math.sin(a) * 0.015;
      }

      // Move
      n.x += n.vx;
      n.y += n.vy;

      // Bounce off canvas edges (with node radius padding)
      const pad = n.r + 18;
      if (n.x < pad)      { n.x = pad;      n.vx =  Math.abs(n.vx) * 0.5; }
      if (n.x > W - pad)  { n.x = W - pad;  n.vx = -Math.abs(n.vx) * 0.5; }
      if (n.y < pad)      { n.y = pad;       n.vy =  Math.abs(n.vy) * 0.5; }
      if (n.y > H - pad)  { n.y = H - pad;  n.vy = -Math.abs(n.vy) * 0.5; }

      // Regular gentle cinematic nudge
      if (Math.random() < 0.015) {
        const a = Math.random() * Math.PI * 2;
        n.vx += Math.cos(a) * 0.01;
        n.vy += Math.sin(a) * 0.01;
      }
    });

    // Cluster attraction — semantically similar nodes pull toward each other
    // along the edges already computed by /api/connections, forming visual clusters
    nodeConnections.forEach(conn => {
      if (conn.similarity < 0.72) return; // match the visible-edge threshold
      const a = docNodes.find(n => n.sourceId === conn.source);
      const b = docNodes.find(n => n.sourceId === conn.target);
      if (!a || !b) return;

      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const strength = (conn.similarity - 0.72) / 0.28; // 0..1 — stronger pull for tighter matches
      const stretch = dist - CLUSTER_DIST;
      const force = stretch * CLUSTER_FORCE * strength;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });
  }

  /* Zoom and pan to fit all nodes in view */
  function zoomToFit() {
    if (docNodes.length === 0) return;
    const allX = docNodes.map(n => n.x);
    const allY = docNodes.map(n => n.y);
    const minX = Math.min(...allX) - 40, maxX = Math.max(...allX) + 40;
    const minY = Math.min(...allY) - 40, maxY = Math.max(...allY) + 40;
    // Include core node
    const bminX = Math.min(minX, coreNode.x - CORE_R - 20);
    const bmaxX = Math.max(maxX, coreNode.x + CORE_R + 20);
    const bminY = Math.min(minY, coreNode.y - CORE_R - 20);
    const bmaxY = Math.max(maxY, coreNode.y + CORE_R + 20);
    const bW = bmaxX - bminX, bH = bmaxY - bminY;
    const scaleX = W / bW, scaleY = H / bH;
    const newZoom = Math.min(scaleX, scaleY, maxZoom) * 0.88;
    zoom = Math.max(minZoom, newZoom);
    panX = W/2 - ((bminX + bmaxX)/2) * zoom;
    panY = H/2 - ((bminY + bmaxY)/2) * zoom;
  }

  /* Restore graph nodes from local IndexedDB on page load without resetting positions */
  async function restoreGraphNodes() {
    try {
      if (!window.localDatabase || !window.localDatabase.db) {
        setTimeout(restoreGraphNodes, 100);
        return;
      }
      const localNodes = window.localDatabase.getNodes(getWorkspace());
      
      const localNodeMap = new Map();
      localNodes.forEach(n => {
        localNodeMap.set(n.source_id, n);
      });

      const initialLength = docNodes.length;
      
      // 1. Filter out visual nodes that are no longer in local DB (deleted)
      docNodes = docNodes.filter(n => localNodeMap.has(n.sourceId));

      // 2. Update existing nodes and collect their source IDs
      const existingSourceIds = new Set();
      docNodes.forEach(n => {
        existingSourceIds.add(n.sourceId);
        const ln = localNodeMap.get(n.sourceId);
        if (ln) {
          n.priority = ln.priority || 3;
          n.clusterId = ln.cluster_id || 0;
          n.clusterName = ln.cluster_name || 'General Knowledge';
        }
      });

      // 3. Add brand new nodes
      let addedAny = false;
      localNodes.forEach(ln => {
        if (!existingSourceIds.has(ln.source_id)) {
          const ext      = ln.source_type.toLowerCase();
          const fullId   = ln.source_id;
          const dispName = fullId.replace(/\.[^.]+$/, '');
          addDocNode(dispName, ext, fullId, ln.priority || 3, ln.cluster_id || 0, ln.cluster_name || 'General Knowledge');
          addedAny = true;
        }
      });

      document.getElementById('node-count').textContent = docNodes.length;
      
      if (initialLength === 0 && localNodes.length > 0) {
        showToast(`RESTORED ${localNodes.length} NODE(S)`);
        fetchConnections();
        setTimeout(zoomToFit, 200);
      } else {
        fetchConnections();
      }
    } catch (err) {
      console.error('[restoreGraphNodes Error]', err);
    }
  }

  /* Fetch AI-detected connections between nodes client-side! */
  async function fetchConnections() {
    try {
      const nodes = window.localDatabase.getNodes(getWorkspace());
      const connections = [];
      // Compare each node with every other node
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const sim = cosineSimilarity(nodes[i].embeddings[0] || [], nodes[j].embeddings[0] || []);
          if (sim >= 0.72) {
            connections.push({
              source: nodes[i].source_id,
              target: nodes[j].source_id,
              similarity: sim
            });
          }
        }
      }
      nodeConnections = connections;
      computeClusters();
    } catch (err) {
      console.error('[fetchConnections Error]', err);
    }
  }

  /* ── CLUSTERING ──────────────────────────────────────────
     Group nodes into clusters using union-find over similarity
     edges (>=0.72, matching the visible-edge threshold), then
     assign each cluster a distinct hue so related nodes read as
     a visual group on the graph. */
  
  /* Draw a beautiful jagged, gently vibrating electrical edge */
  function drawJaggedEdge(ctx, x1, y1, x2, y2, color, opacity, isDotted = false) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    if (isDotted) {
      ctx.setLineDash([2, 5]);
    } else {
      ctx.setLineDash([]);
    }
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len < 10) {
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    
    const segments = Math.max(3, Math.floor(len / 35));
    const px = -dy / len;
    const py = dx / len;
    
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      let cx = x1 + dx * t;
      let cy = y1 + dy * t;
      
      const scale = Math.sin(t * Math.PI);
      const animOffset = Math.sin((animFrame + i * 15) * 0.15) * 2;
      const displacement = (scale * 4) + animOffset;
      
      cx += px * displacement;
      cy += py * displacement;
      
      ctx.lineTo(cx, cy);
    }
    
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /* Draw semantic connection lines between related nodes */
  function drawConnectionEdges() {
    // 1. Draw dynamic connection edges with cluster harmonized colors
    nodeConnections.forEach(conn => {
      if (conn.similarity < 0.72) return; // only draw meaningful connections
      const a = docNodes.find(n => n.sourceId === conn.source);
      const b = docNodes.find(n => n.sourceId === conn.target);
      if (!a || !b) return;
      const fadeA = Math.min(1, (animFrame - a.birth) / 45);
      const fadeB = Math.min(1, (animFrame - b.birth) / 45);
      const fade  = Math.min(fadeA, fadeB);
      if (fade <= 0) return;
      
      const alpha = fade * ((conn.similarity - 0.72) / 0.28) * 0.7;
      
      // Assign custom hue of the whole cluster to the edge if they share a cluster!
      const hueA = nodeClusterMap[a.sourceId];
      const hueB = nodeClusterMap[b.sourceId];
      let edgeColor = '#FF5A00'; // Default orange
      if (hueA !== undefined && hueA === hueB) {
        edgeColor = `hsla(${hueA}, 35%, 63%, 0.65)`;
      }
      
      drawJaggedEdge(ctx, a.x, a.y, b.x, b.y, edgeColor, Math.min(0.65, alpha));
      
      // Midpoint similarity badge
      if (conn.similarity > 0.9) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.save();
        ctx.globalAlpha = fade * 0.45;
        ctx.fillStyle = edgeColor;
        ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });

    // 2. Draw faint random interconnecting background edges to form a rich neural web
    for (let i = 0; i < docNodes.length; i++) {
      for (let j = i + 1; j < docNodes.length; j++) {
        const a = docNodes[i];
        const b = docNodes[j];
        
        // Use a stable, deterministic mathematical key to avoid flickering
        const sumChar = (a.sourceId.charCodeAt(0) || 0) + (b.sourceId.charCodeAt(a.sourceId.length - 1) || 0) + (b.sourceId.charCodeAt(0) || 0);
        if (sumChar % 13 === 0) {
          const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
          if (dist < 160) {
            drawJaggedEdge(ctx, a.x, a.y, b.x, b.y, 'rgba(255,255,255,0.06)', 0.12, true);
          }
        }
      }
    }
  }

  const CLUSTER_HUES_DYNAMIC = [24, 200, 280, 140, 330, 50, 170, 260, 10, 100];
  let nodeClusterMap = {}; // sourceId -> { clusterId, hue }

  function computeClusters() {
    const parent = {};
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    docNodes.forEach(n => { parent[n.sourceId] = n.sourceId; });
    nodeConnections.forEach(conn => {
      if (conn.similarity < 0.72) return;
      if (!(conn.source in parent) || !(conn.target in parent)) return;
      union(conn.source, conn.target);
    });

    // Group sourceIds by root
    const groups = {};
    docNodes.forEach(n => {
      const root = find(n.sourceId);
      (groups[root] = groups[root] || []).push(n.sourceId);
    });

    // Only treat groups of 2+ as clusters — singletons stay neutral
    nodeClusterMap = {};
    let hueIdx = 0;
    Object.values(groups).forEach(members => {
      if (members.length < 2) return;
      const hue = CLUSTER_HUES[hueIdx % CLUSTER_HUES.length];
      hueIdx++;
      members.forEach(sid => { nodeClusterMap[sid] = hue; });
    });
  }

  restoreGraphNodes();

  const particles = [];
  function tickParticles() {
    if (docNodes.length && Math.random()<.25) {
      const n = docNodes[Math.floor(Math.random()*docNodes.length)];
      const fade = Math.min(1,(animFrame-n.birth)/40);
      if (fade>.5) particles.push({nx:n.x,ny:n.y,t:0,dur:55+Math.random()*35,color:n.color.fill});
    }
    particles.forEach(p=>p.t++);
    particles.splice(0, particles.length, ...particles.filter(p=>p.t<p.dur));
  }
  function drawParticles() {
    particles.forEach(p => {
      const prog=p.t/p.dur, x=coreNode.x+(p.nx-coreNode.x)*prog, y=coreNode.y+(p.ny-coreNode.y)*prog;
      ctx.save(); ctx.globalAlpha=(1-Math.abs(prog-.5)*2)*0.95;
      ctx.beginPath(); ctx.arc(x,y,2.4,0,Math.PI*2); ctx.fillStyle=p.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = p.color;
      ctx.fill(); ctx.restore();
    });
  }
  function drawEdge(n) {
    const fade=Math.min(1,(animFrame-n.birth)/45); if(fade<=0) return;
    ctx.save(); ctx.globalAlpha=fade*.65; ctx.beginPath(); ctx.moveTo(coreNode.x,coreNode.y); ctx.lineTo(n.x,n.y);
    ctx.strokeStyle=n.color.fill; ctx.lineWidth=1.2; ctx.setLineDash([]); ctx.stroke(); ctx.restore();
  }

  /* Draw semantic connection lines between related nodes are handled above */
  function drawOneNode(n) {
    const fade=n.isCore?1:Math.min(1,(animFrame-n.birth)/40); if(fade<=0) return;
    ctx.save(); ctx.globalAlpha=fade;
    
    // Soft orange background glow
    const gs = n.isCore ? 28 : 16;
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, gs);
    const gc = n.isCore ? 'rgba(255,90,0,0.5)' : 'rgba(255,90,0,0.35)';
    g.addColorStop(0,gc); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(n.x,n.y,gs,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
    
    if(hovered===n) { ctx.beginPath(); ctx.arc(n.x,n.y,n.r+7,0,Math.PI*2); ctx.strokeStyle='#FF5A00'; ctx.lineWidth=1; ctx.globalAlpha=fade*.55; ctx.setLineDash([]); ctx.stroke(); ctx.globalAlpha=fade; }
    
    // Main node fill — solid vibrant orange with a white border for core, semi-transparent for standard nodes
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
    if (n.isCore) {
      ctx.fillStyle = '#FF5A00';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,90,0,0.38)';
      ctx.fill();
    }
    
    // Priority ring — thin line with gap from node edge
    if (!n.isCore) {
      const ring = PRIORITY_RING[n.priority] || PRIORITY_RING[3];
      const gap = 3;  // space between node edge and ring
      ctx.save();
      ctx.globalAlpha = fade * 0.9;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + gap + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = fade;
    }
    
    // White light glare highlight
    ctx.beginPath(); ctx.arc(n.x,n.y-n.r*.22,n.r*.5,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.13)'; ctx.fill();
    
    // Draw label UNDER the node for both document nodes and core node!
    if (fade > 0.4) {
      ctx.save();
      let labelText = '';
      if (n.isCore) {
        let username = 'YOU';
        try {
          const sessionUserStr = localStorage.getItem('sb_session_user');
          if (sessionUserStr) {
            const user = JSON.parse(sessionUserStr);
            username = user.user_metadata?.username || localStorage.getItem('sb_username') || user.email?.split('@')[0] || 'YOU';
          } else {
            const cached = localStorage.getItem('sb_username');
            if (cached) username = cached;
          }
        } catch (e) {}
        labelText = username.toUpperCase();
        
        // Check if username is an emoji or contains emojis
        const isEmoji = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u.test(labelText);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        if (isEmoji) {
          ctx.fillStyle = 'rgba(240,237,224,0.85)';
          ctx.font = "14px sans-serif";
          ctx.fillText(labelText, n.x, n.y + n.r + 8);
        } else {
          ctx.fillStyle = 'rgba(240,237,224,0.85)';
          ctx.font = "bold 8px 'Space Mono',monospace";
          ctx.fillText(labelText, n.x, n.y + n.r + 10);
        }
      } else {
        labelText = n.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(240,237,224,0.55)';
        ctx.font = "7px 'Space Mono',monospace";
        ctx.fillText(labelText, n.x, n.y + n.r + 10);
      }
      ctx.restore();
    }
    
    ctx.restore();
  }
  let draggedNode = null;
  let hasDragged = false;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let ignoreNextClick = false;

  function graphLoop() {
    animFrame++;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,mainC.width,mainC.height); ctx.restore();
    ctx.setTransform(dpr*zoom,0,0,dpr*zoom,panX*dpr,panY*dpr);
    if (!coreNode.isDragging) {
      coreNode.x=cx; coreNode.y=cy;
    }
    tickPhysics();
    tickParticles(); docNodes.forEach(drawEdge); drawConnectionEdges(); drawParticles(); docNodes.forEach(drawOneNode); drawOneNode(coreNode);
    requestAnimationFrame(graphLoop);
  }
  graphLoop();

  mainC.addEventListener('mousemove', e => {
    const r=mainC.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    if(isPanning){panX=panStartX+(e.clientX-panStartMouseX);panY=panStartY+(e.clientY-panStartMouseY);return;}
    
    // Dragging logic
    if (draggedNode) {
      const dist = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY);
      if (dist > 5) {
        hasDragged = true;
      }
      const wx = (mx - panX) / zoom, wy = (my - panY) / zoom;
      draggedNode.x = wx;
      draggedNode.y = wy;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      mainC.style.cursor = 'grabbing';
      return;
    }

    const wx=(mx-panX)/zoom, wy=(my-panY)/zoom;
    hovered=null;
    if(Math.hypot(wx-coreNode.x,wy-coreNode.y)<coreNode.r+8){hovered=coreNode;mainC.style.cursor='pointer';return;}
    for(const n of docNodes){ if(Math.hypot(wx-n.x,wy-n.y)<n.r+6){hovered=n;mainC.style.cursor='pointer';return;} }
    mainC.style.cursor='crosshair';
  });

  mainC.addEventListener('click', e => {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    const r=mainC.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    const wx=(mx-panX)/zoom, wy=(my-panY)/zoom;
    if(Math.hypot(wx-coreNode.x,wy-coreNode.y)<coreNode.r+8){toggleUploadPopup();return;}
    for(const n of docNodes){ if(Math.hypot(wx-n.x,wy-n.y)<n.r+6){openNodeModal(n);return;} }
  });

  mainC.addEventListener('contextmenu', e => {
    e.preventDefault();
    const r=mainC.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    const wx=(mx-panX)/zoom, wy=(my-panY)/zoom;
    if(Math.hypot(wx-coreNode.x,wy-coreNode.y)<coreNode.r+8){openNodeModal(coreNode);return;}
    for(const n of docNodes){ if(Math.hypot(wx-n.x,wy-n.y)<n.r+6){openNodeModal(n);return;} }
  });

  mainC.addEventListener('wheel', e => {
    e.preventDefault();
    const r=mainC.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    const wx=(mx-panX)/zoom, wy=(my-panY)/zoom;
    const factor=Math.exp(-e.deltaY*.0012), newZoom=Math.min(maxZoom,Math.max(minZoom,zoom*factor));
    panX=mx-wx*newZoom; panY=my-wy*newZoom; zoom=newZoom;
  },{passive:false});

  mainC.addEventListener('mousedown', e => {
    if (e.button === 0) { // Left click: Node drag start
      const r = mainC.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const wx = (mx - panX) / zoom, wy = (my - panY) / zoom;
      
      let foundNode = null;
      if (Math.hypot(wx - coreNode.x, wy - coreNode.y) < coreNode.r + 8) {
        foundNode = coreNode;
      } else {
        for (const n of docNodes) {
          if (Math.hypot(wx - n.x, wy - n.y) < n.r + 6) {
            foundNode = n;
            break;
          }
        }
      }

      if (foundNode) {
        draggedNode = foundNode;
        draggedNode.isDragging = true;
        hasDragged = false;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        mainC.style.cursor = 'grabbing';
        e.preventDefault();
      }
    } else if (e.button === 1) { // Middle click: Panning
      isPanning = true;
      panStartMouseX = e.clientX;
      panStartMouseY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      mainC.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPanning) {
      panX = panStartX + (e.clientX - panStartMouseX);
      panY = panStartY + (e.clientY - panStartMouseY);
    }
  });

  window.addEventListener('mouseup', e => {
    if (draggedNode) {
      draggedNode.isDragging = false;
      draggedNode = null;
      mainC.style.cursor = 'crosshair';
      if (hasDragged) {
        ignoreNextClick = true;
      }
    }
    if (isPanning && e.button === 1) {
      isPanning = false;
      mainC.style.cursor = 'crosshair';
    }
  });

  /* Upload popup wiring */
  const uploadPopup = document.getElementById('upload-popup');
  let popupOpen = false;
  function toggleUploadPopup(){popupOpen?closeUploadPopup():openUploadPopup();}
  function openUploadPopup(){uploadPopup.classList.add('open');popupOpen=true;}
  function closeUploadPopup(){uploadPopup.classList.remove('open');popupOpen=false;}
  document.getElementById('popup-close-btn').addEventListener('click', closeUploadPopup);
  document.getElementById('upload-select-btn').addEventListener('click', e=>{e.stopPropagation();document.getElementById('file-input-hidden').click();});
  document.getElementById('popup-drop-zone').addEventListener('click',()=>document.getElementById('file-input-hidden').click());
  document.getElementById('file-input-hidden').addEventListener('change',e=>handleFiles(e.target.files));
  wrap.addEventListener('dragover',e=>{e.preventDefault();document.getElementById('drop-overlay').classList.add('active');});
  wrap.addEventListener('dragleave',e=>{if(!wrap.contains(e.relatedTarget))document.getElementById('drop-overlay').classList.remove('active');});
  wrap.addEventListener('drop',e=>{e.preventDefault();document.getElementById('drop-overlay').classList.remove('active');handleFiles(e.dataTransfer.files);});

  /* ══════════════════════════════════════════════════════════════════
     SIDE PANEL — TIMELINE + CALENDAR
     Two fixed edge buttons open a slide-in panel on the right.
     - Clicking a button opens the panel to that view.
     - Clicking the active button (or close) hides the panel.
  ══════════════════════════════════════════════════════════════════ */
  const sidePanel  = document.getElementById('side-panel');
  const panelTitle = document.getElementById('side-panel-title');

  function openSidePanel(viewId) {
    // Move right-views into side-panel-body if not already there
    const body = document.getElementById('side-panel-body');
    document.querySelectorAll('.right-view').forEach(v => {
      if (v.parentElement !== body) body.appendChild(v);
    });
    document.querySelectorAll('.right-view').forEach(v => v.classList.toggle('active', v.id === viewId));
    document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
    panelTitle.textContent = viewId === 'timeline-view' ? 'TIMELINE' : 'CALENDAR';
    sidePanel.classList.add('open');
    if (viewId === 'timeline-view' && typeof fetchTimeline === 'function') fetchTimeline();
    if (viewId === 'calendar-view' && typeof fetchCalendar === 'function') fetchCalendar();
  }

  function closeSidePanel() {
    sidePanel.classList.remove('open');
    document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
  }

  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.dataset.view;
      if (sidePanel.classList.contains('open') && btn.classList.contains('active')) {
        closeSidePanel();
      } else {
        openSidePanel(viewId);
      }
    });
  });

  document.getElementById('side-panel-close').addEventListener('click', closeSidePanel);

  // Keep backward compat for any code that calls openDrawer/closeDrawer
  function openDrawer()  { openSidePanel('timeline-view'); }
  function closeDrawer() { closeSidePanel(); }
  function isDrawerOpen(){ return sidePanel.classList.contains('open'); }
  function switchDrawerTab(viewId) { openSidePanel(viewId); }

  /* ══════════════════════════════════════════════════════════════════
     TIMELINE
     Calls POST /api/timeline with optional date range.
     Parses the returned markdown and renders each ## section
     as a styled .tl-event card with date, source badge, and excerpt.
  ══════════════════════════════════════════════════════════════════ */
  const tlFetchBtn  = document.getElementById('tl-fetch-btn');
  const tlLoading   = document.getElementById('tl-loading');
  const tlScroll    = document.getElementById('timeline-scroll');
  const tlStats     = document.getElementById('tl-stats');

  tlFetchBtn.addEventListener('click', fetchTimeline);

  async function fetchTimeline() {
    const ws = getWorkspace();
    if (!ws) {
      tlScroll.innerHTML = '<div class="tl-empty">SET A WORKSPACE ID FIRST<br><span style="opacity:.5;font-size:9px">Enter a workspace name in the header bar, then try again.</span></div>';
      return;
    }
    const startDate = document.getElementById('tl-start').value.trim() || null;
    const endDate   = document.getElementById('tl-end').value.trim()   || null;

    tlScroll.innerHTML = '';
    tlLoading.classList.add('visible');
    tlStats.textContent = '';

    try {
      const data = generateTimelineMarkdown(ws, startDate, endDate);
      tlLoading.classList.remove('visible');
      renderTimeline(data.timeline_markdown);
      tlStats.textContent = `${data.event_count} EVENT(S) · ${data.date_range.start} → ${data.date_range.end}`;
    } catch (err) {
      tlLoading.classList.remove('visible');
      tlScroll.innerHTML = `<div class="tl-empty">ERROR: ${err.message}<br><span style="opacity:.5;font-size:9px">Failed to load local timeline</span></div>`;
    }
  }

  /*
    Parse the markdown timeline from the backend.
    Structure is: "# Timeline\n\n## Date\n**Source:** ...\n**Indexed:** ...\n\n> excerpt\n\n"
    We split on ## to get individual events.
  */
  function renderTimeline(md) {
    if (!md || md.startsWith('No ') || md.startsWith('Error')) {
      tlScroll.innerHTML = `<div class="tl-empty">${md || 'NO DATA'}<br><span style="opacity:.5;font-size:9px">Documents must contain recognisable dates (e.g. Jan 2024, 2023-06-01).<br>Re-upload files after clearing chroma_db/ to rebuild with fixed metadata.</span></div>`;
      return;
    }

    const events = md.split(/\n## /).slice(1); // drop the # Timeline header
    if (!events.length) { tlScroll.innerHTML = '<div class="tl-empty">NO EVENTS FOUND</div>'; return; }

    tlScroll.innerHTML = '';
    events.forEach((block, i) => {
      const lines = block.split('\n').filter(l => l.trim());
      const dateStr = lines[0] || 'Unknown Date';

      // Extract source and indexed fields from **bold** lines
      // Backend format: **Source:** `SOURCE_TYPE` (source_id)
      let sourceRaw = '', sourceId = '', sourceType = '', indexed = '', excerpt = '';
      lines.slice(1).forEach(l => {
        if (l.startsWith('**Source:**')) {
          sourceRaw = l.replace(/\*\*/g,'').replace('Source:','').trim();
          // Extract type from backticks: `AUDIO`
          const typeMatch = sourceRaw.match(/`([^`]+)`/);
          if (typeMatch) sourceType = typeMatch[1];
          // Extract source_id from parentheses: (recording.audio)
          const idMatch = sourceRaw.match(/\(([^)]+)\)/);
          if (idMatch) sourceId = idMatch[1];
          // Fallback: whole string
          if (!sourceId) sourceId = sourceRaw;
        }
        if (l.startsWith('**Indexed:**')) indexed = l.replace(/\*\*/g,'').replace('Indexed:','').trim();
        if (l.startsWith('> '))           excerpt = l.slice(2);
      });
      const displayName = sourceId || sourceRaw;

      const card = document.createElement('div');
      card.className = 'tl-event';
      card.style.animationDelay = (i * 0.06) + 's';
      card.innerHTML = `
        <div class="tl-date">${dateStr}</div>
        <div class="tl-source"><span class="tl-source-link" style="cursor:pointer;text-decoration:underline;text-underline-offset:3px;opacity:.85;" title="Click to preview">${displayName}</span> &nbsp;·&nbsp; <span style="opacity:.5">${sourceType}</span> &nbsp;·&nbsp; indexed ${indexed.slice(0,16)}</div>
        ${excerpt ? `<div class="tl-excerpt">${excerpt}</div>` : ''}
      `;
      card.querySelector('.tl-source-link').addEventListener('click', e => {
        e.stopPropagation();
        openNodeModalById(sourceId, sourceType);
      });
      tlScroll.appendChild(card);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     CALENDAR
     State: { year, month (1-12) }
     Calls GET /api/calendar/{workspace_id}?month=M&year=Y
     Renders a 7-column grid of day cells.
     Days with events get an orange dot and a count badge.
     Clicking a day populates the detail strip at the bottom.
  ══════════════════════════════════════════════════════════════════ */
  const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  let calYear  = new Date().getFullYear();
  let calMonth = new Date().getMonth() + 1; // 1-indexed to match backend
  let calEvents = {};   // keyed by "YYYY-MM-DD"

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if(calMonth<1){calMonth=12;calYear--;}
    updateCalLabel(); fetchCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if(calMonth>12){calMonth=1;calYear++;}
    updateCalLabel(); fetchCalendar();
  });

  function updateCalLabel() {
    document.getElementById('cal-month-label').textContent = `${MONTH_NAMES[calMonth-1]} ${calYear}`;
  }
  updateCalLabel();

  async function fetchCalendar() {
    const ws = getWorkspace();
    if (!ws) {
      const daysEl = document.getElementById('cal-days');
      daysEl.innerHTML = '<div class="tl-empty" style="grid-column:1/-1">SET A WORKSPACE ID FIRST<br><span style="opacity:.5;font-size:9px">Enter a workspace name in the header bar, then try again.</span></div>';
      return;
    }
    const loading = document.getElementById('cal-loading');
    const daysEl  = document.getElementById('cal-days');
    daysEl.innerHTML = '';
    loading.classList.add('visible');
    calEvents = {};

    try {
      const nodes = window.localDatabase.getNodes(ws);
      const eventsByDate = {};
      
      // 1. Accumulate notes/documents from Vector DB
      nodes.forEach(node => {
        const nodeDates = node.dates && node.dates.length ? node.dates : [node.timestamp.split('T')[0]];
        nodeDates.forEach(dStr => {
          const parts = dStr.split('-');
          if (parts.length < 2) return;
          const y = parseInt(parts[0]);
          const m = parseInt(parts[1]);
          if (y === calYear && m === calMonth) {
            if (!eventsByDate[dStr]) {
              eventsByDate[dStr] = {
                date: dStr,
                document_count: 0,
                items: []
              };
            }
            eventsByDate[dStr].document_count++;
            eventsByDate[dStr].items.push({
              source_id: node.source_id,
              source_type: node.source_type,
              text: node.text
            });
          }
        });
      });

      // 2. Accumulate scheduled reminders from localStorage dynamically (no separate txt files created!)
      const reminders = JSON.parse(localStorage.getItem('sb_reminders') || '[]');
      reminders.forEach(rem => {
        if (rem.workspace_id === ws) {
          const dStr = new Date(rem.time).toISOString().split('T')[0];
          const parts = dStr.split('-');
          if (parts.length < 2) return;
          const y = parseInt(parts[0]);
          const m = parseInt(parts[1]);
          if (y === calYear && m === calMonth) {
            if (!eventsByDate[dStr]) {
              eventsByDate[dStr] = {
                date: dStr,
                document_count: 0,
                items: []
              };
            }
            eventsByDate[dStr].document_count++;
            eventsByDate[dStr].items.push({
              source_id: rem.id,
              source_type: 'reminder',
              text: `⏰ [REMINDER] ${rem.text} (${new Date(rem.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`
            });
          }
        }
      });

      calEvents = eventsByDate;
      loading.classList.remove('visible');
      buildCalGrid(calEvents);

    } catch (err) {
      loading.classList.remove('visible');
      daysEl.innerHTML = `<div class="tl-empty" style="grid-column:1/-1">ERROR: ${err.message}</div>`;
    }
  }

  /*
    Build the calendar grid for the current calYear/calMonth.
    We pre-pad with empty cells for the day-of-week offset,
    then create a cell for each day in the month.
    Days with calEvents[dateStr] get the has-events class + dot.
  */
  function buildCalGrid(events) {
    const daysEl = document.getElementById('cal-days');
    daysEl.innerHTML = '';

    const firstDay   = new Date(calYear, calMonth - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    const today       = new Date();

    // Pad with empty cells
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day empty';
      daysEl.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const ev      = events[dateStr];
      const isToday = today.getFullYear()===calYear && today.getMonth()+1===calMonth && today.getDate()===d;

      const cell = document.createElement('div');
      cell.className = 'cal-day' + (isToday?' today':'') + (ev?' has-events':'');
      cell.innerHTML = `<span class="cal-day-num">${d}</span>${ev ? `<div class="cal-event-dot"></div><div class="cal-event-count">${ev.document_count}</div>` : ''}`;

      cell.style.cursor='pointer';
      cell.addEventListener('click', () => {
        document.querySelectorAll('.cal-day.selected').forEach(c=>c.classList.remove('selected'));
        cell.classList.add('selected'); showDayDetail(dateStr, ev||null);
      });
      daysEl.appendChild(cell);
    }
  }

  /*
    Detail strip at bottom of calendar.
    Shows source_id, source_type, document count for the selected day.
  */
  function showDayDetail(dateStr, ev) {
    const d = document.getElementById('cal-day-detail');
    if (ev && ev.items && ev.items.length) {
      let html = `<div class="detail-title">// ${dateStr}</div>`;
      ev.items.forEach((item, idx) => {
        html += `
          <div class="detail-item" style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px; text-align: left;">
            <div style="font-weight: bold; font-size: 11px; line-height: 1.3;">${item.text}</div>
            <div style="font-size: 8px; opacity: 0.6; display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span>TYPE: ${item.source_type.toUpperCase()}</span>
              ${item.source_type !== 'reminder' ? `<span class="preview-btn" data-id="${item.source_id}" data-type="${item.source_type}" style="cursor:pointer; text-decoration:underline; color:var(--orange); font-weight: bold;">VIEW</span>` : ''}
            </div>
          </div>
        `;
      });
      d.innerHTML = html;

      // Add click listeners to preview buttons
      d.querySelectorAll('.preview-btn').forEach(btn => {
        btn.onclick = () => {
          openNodeModalById(btn.dataset.id, btn.dataset.type);
        };
      });
    } else {
      d.innerHTML = `<div class="detail-title">// ${dateStr}</div><div class="detail-item" style="opacity:.5">NO INDEXED DOCUMENTS OR REMINDERS ON THIS DATE</div>`;
    }
  }

  // Build the grid immediately with empty events so the month structure shows
  buildCalGrid({});

  /* ══════════════════════════════════════════════════════════════════
     UPLOAD POPUP TABS
  ══════════════════════════════════════════════════════════════════ */
  document.querySelectorAll('.popup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.popup-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     URL INGESTION
  ══════════════════════════════════════════════════════════════════ */
  const urlInput     = document.getElementById('url-input');
  const urlIngestBtn = document.getElementById('url-ingest-btn');
  const urlStatus    = document.getElementById('url-status');

  async function ingestUrl() {
    const url = urlInput.value.trim();
    if (!url) { urlStatus.textContent = 'ENTER A URL FIRST'; urlStatus.className = 'err'; return; }
    urlIngestBtn.disabled = true;
    urlStatus.textContent = 'SCRAPING…'; urlStatus.className = 'busy';
    
    try {
      const ws = getWorkspace();
      if (!ws) {
        throw new Error("Set a workspace ID first.");
      }

      // Fetch HTML via raw proxy (allorigins)
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const fetchRes = await fetch(proxyUrl);
      if (!fetchRes.ok) throw new Error("CORS Proxy retrieval failed. Please try again or paste text manually.");
      const htmlText = await fetchRes.text();
      
      // Parse HTML to extract text content
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      doc.querySelectorAll('script, style, head, header, footer, nav, iframe, noscript').forEach(el => el.remove());
      const bodyText = doc.body?.innerText || doc.body?.textContent || "";
      const cleanedText = bodyText.replace(/\s+/g, ' ').trim();
      
      if (!cleanedText) {
        throw new Error("Could not extract readable text content from URL.");
      }

      urlStatus.textContent = 'EMBEDDING…';

      // 1. Chunks generation
      const chunks = chunkText(cleanedText);

      // 2. Compute Embeddings on-device in batches with UI responsiveness
      const embeddings = await getEmbeddingsBatch(chunks, (completed, total) => {
        const percent = Math.round((completed / total) * 100);
        urlStatus.textContent = `EMBEDDING (${percent}%)`;
      });

      // 3. Extract dates inside the text for calendar/timeline
      const datesFound = extractDatesFromText(cleanedText);

      // 4. Create source domain name for source_id
      let sourceName = url.replace(/^https?:\/\//, '').split('/')[0];
      if (sourceName.length > 30) sourceName = sourceName.substring(0, 30) + '...';

      // 5. Create the local node document structure
      const node = {
        workspace_id: ws,
        source_id: sourceName,
        source_type: 'url',
        text: cleanedText,
        chunks: chunks,
        embeddings: embeddings,
        priority: 2,
        cluster_id: 3,
        cluster_name: 'Web URLs',
        dates: datesFound,
        timestamp: new Date().toISOString()
      };

      // 6. Save document node locally into browser's IndexedDB
      await window.localDatabase.saveNode(node);

      urlStatus.textContent = `✓ INDEXED FROM URL`;
      urlStatus.className = 'ok';
      urlInput.value = '';
      showToast('URL INDEXED: ' + sourceName);
      
      setTimeout(async () => {
        await restoreGraphNodes();
      }, 1500);

    } catch (err) {
      urlStatus.textContent = 'ERROR: ' + err.message;
      urlStatus.className = 'err';
    } finally {
      urlIngestBtn.disabled = false;
    }
  }

  urlIngestBtn.addEventListener('click', ingestUrl);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') ingestUrl(); });

  /* ══════════════════════════════════════════════════════════════════
     AUDIO — RECORD + UPLOAD
  ══════════════════════════════════════════════════════════════════ */
  const recordBtn       = document.getElementById('record-btn');
  const recordZone      = document.getElementById('audio-record-zone');
  const recordTimer     = document.getElementById('record-timer');
  const recordHint      = document.getElementById('record-hint');
  const audioUploadBtn  = document.getElementById('audio-upload-btn');
  const audioFileInput  = document.getElementById('audio-file-input');
  const audioSelectedName = document.getElementById('audio-selected-name');
  const audioIndexBtn   = document.getElementById('audio-index-btn');
  const audioStatus     = document.getElementById('audio-status');

  let mediaRecorder = null;
  let audioChunks = [];
  let recordInterval = null;
  let recordSeconds = 0;
  let transcribedText = '';
  let isRecording = false;
  let audioStream = null;

  function formatTime(sec) {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  recordBtn.addEventListener('click', async () => {
    if (isRecording) {
      // STOP RECORDING
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
      }
      clearInterval(recordInterval);
      isRecording = false;
      recordBtn.textContent = '⏺ START RECORDING';
      recordBtn.classList.remove('recording');
      recordZone.classList.remove('recording');
      recordTimer.classList.remove('recording');
      recordHint.textContent = 'Processing voice data... transcribing via Groq Whisper AI...';
      audioStatus.textContent = 'TRANSCRIBING AUDIO VIA WHISPER AI... PLEASE WAIT...';
      audioStatus.className = 'busy';
    } else {
      // START RECORDING
      transcribedText = '';
      audioStatus.textContent = '';
      audioStatus.className = '';
      
      const groqKey = localStorage.getItem('sb_groq_key') || '';
      if (!groqKey) {
        audioStatus.textContent = '⚠️ Groq API Key is missing. Please sign in or configure your Groq key in the portal first!';
        audioStatus.className = 'err';
        recordHint.textContent = 'Use the [SIGN IN] portal in the header to save your Groq Key.';
        return;
      }

      if (window.location.protocol === 'file:') {
        audioStatus.textContent = '⚠️ BROWSER SECURITY: Microphone access is blocked when opening local files directly (file:/// protocol). Please deploy to Netlify (HTTPS) or run a local server!';
        audioStatus.className = 'err';
        recordHint.textContent = 'Microphone recording requires a secure web origin (HTTPS or localhost).';
        return;
      }

      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("Microphone access failed:", err);
        audioStatus.textContent = 'MIC ACCESS DENIED: Please enable microphone permission in your browser.';
        audioStatus.className = 'err';
        recordHint.textContent = 'Failed to capture audio from your device.';
        return;
      }

      try {
        audioChunks = [];
        mediaRecorder = new MediaRecorder(audioStream);
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Transcribe using Groq Whisper API
            const formData = new FormData();
            formData.append('file', audioBlob, 'recording.webm');
            formData.append('model', 'whisper-large-v3');

            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('sb_groq_key')}`
              },
              body: formData
            });

            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error?.message || `HTTP ${response.status}`);
            }

            const resData = await response.json();
            transcribedText = resData.text || '';

            if (transcribedText.trim()) {
              audioStatus.textContent = `Live Transcription: "${transcribedText}"`;
              audioStatus.className = 'online';
              audioSelectedName.textContent = `live-voice-recording.txt (${transcribedText.split(/\s+/).length} words)`;
              audioIndexBtn.disabled = false;
              recordHint.textContent = 'Transcription complete! Press INDEX to commit to Second Brain.';
            } else {
              audioStatus.textContent = 'No speech was detected. Please speak clearly into your mic!';
              audioStatus.className = 'err';
              recordHint.textContent = 'Try speaking louder or adjusting your microphone input.';
            }
          } catch (err) {
            console.error("Transcription failed:", err);
            audioStatus.textContent = `Whisper AI error: ${err.message}`;
            audioStatus.className = 'err';
            recordHint.textContent = 'Check your Groq API Key and internet connection.';
          }
        };

        mediaRecorder.start();
        isRecording = true;
        recordSeconds = 0;
        recordTimer.textContent = '00:00';
        recordBtn.textContent = '⏹ STOP RECORDING';
        recordBtn.classList.add('recording');
        recordZone.classList.add('recording');
        recordTimer.classList.add('recording');
        recordHint.textContent = 'Listening to your voice... Speak now!';

        recordInterval = setInterval(() => {
          recordSeconds++;
          recordTimer.textContent = formatTime(recordSeconds);
        }, 1000);

      } catch (recErr) {
        console.error("Failed to initialize MediaRecorder:", recErr);
        audioStatus.textContent = 'RECORDER ERROR: Your browser does not support on-device audio recording.';
        audioStatus.className = 'err';
        recordHint.textContent = 'Try using Chrome, Firefox, or Safari.';
      }
    }
  });

  audioUploadBtn.addEventListener('click', () => audioFileInput.click());
  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files[0]) {
      const f = audioFileInput.files[0];
      audioSelectedName.textContent = f.name;
      audioIndexBtn.disabled = false;
      audioStatus.textContent = 'File selected. Ready to index.';
      audioStatus.className = 'ok';
      transcribedText = `Audio Memo Import: "${f.name}" uploaded on ${new Date().toLocaleDateString()}.`;
    }
  });

  audioIndexBtn.addEventListener('click', async () => {
    const textToCommit = transcribedText || audioStatus.textContent;
    if (!textToCommit) return;
    
    audioIndexBtn.disabled = true;
    audioStatus.textContent = 'GENERATING VECTORS…'; audioStatus.className = 'busy';
    
    try {
      const ws = getWorkspace();
      if (!ws) {
        throw new Error("Set a workspace ID first.");
      }

      // Generate embeddings and index on-device!
      const chunks = chunkText(textToCommit);

      const embeddings = await getEmbeddingsBatch(chunks, (completed, total) => {
        const percent = Math.round((completed / total) * 100);
        audioStatus.textContent = `VECTORS (${percent}%)`;
      });

      const datesFound = extractDatesFromText(textToCommit);
      const fname = `voice-${Date.now()}.txt`;

      const node = {
        workspace_id: ws,
        source_id: fname,
        source_type: 'audio',
        text: textToCommit,
        chunks: chunks,
        embeddings: embeddings,
        priority: 2,
        cluster_id: 2,
        cluster_name: 'Audio Transcripts',
        dates: datesFound,
        timestamp: new Date().toISOString()
      };

      await window.localDatabase.saveNode(node);

      audioStatus.textContent = `✓ COMMITTED TO ON-DEVICE DATABASE`;
      audioStatus.className = 'ok';
      showToast('AUDIO MEMORY INDEXED: ' + fname);
      
      setTimeout(async () => {
        await restoreGraphNodes();
      }, 1500);

      transcribedText = '';
      audioSelectedName.textContent = 'No file selected';
      recordTimer.textContent = '00:00';
    } catch (err) {
      audioStatus.textContent = 'ERROR: ' + err.message;
      audioStatus.className = 'err';
      audioIndexBtn.disabled = false;
    }
  });

  /* ══════════════════════════════════════════════════════════════════
     GLITCH
  ══════════════════════════════════════════════════════════════════ */
  function randomGlitch() {
    document.querySelectorAll('.glitch').forEach(el => {
      el.style.filter = 'blur(.4px)';
      setTimeout(() => el.style.filter = '', 80);
    });
    setTimeout(randomGlitch, 4000 + Math.random() * 5000);
  }
  setTimeout(randomGlitch, 3000);

  /* ═══ NODE PREVIEW MODAL ═══ */
  const nodeModal     = document.getElementById('node-modal');
  const nodePanelIcon = document.getElementById('node-panel-icon');
  const nodePanelTitle= document.getElementById('node-panel-title');
  const nodePanelMeta = document.getElementById('node-panel-meta');
  const nodePreviewTxt= document.getElementById('node-preview-text');
  const nodeDeleteBtn = document.getElementById('node-delete-btn');
  document.getElementById('node-panel-close').addEventListener('click', () => nodeModal.classList.remove('open'));
  nodeModal.addEventListener('click', e => { if (e.target===nodeModal) nodeModal.classList.remove('open'); });

  let _activeNode = null;

  /* Open the node modal from any source_id string (calendar / timeline clicks) */
  function openNodeModalById(sourceId, sourceType) {
    const live = docNodes.find(n => n.sourceId === sourceId);
    if (live) { openNodeModal(live); return; }
    const ext = (sourceType || sourceId.split('.').pop() || 'FILE').toUpperCase().slice(0,4);
    openNodeModal({
      sourceId,
      label: sourceId.replace(/\.[^.]+$/, '').slice(0, 12),
      ext,
      color: { fill: '#FF5A00' },
      isCore: false, isLog: (sourceType || '').toUpperCase() === 'LOG'
    });
  }

  async function openNodeModal(node) {
    _activeNode = node;
    nodeModal.classList.add('open');

    if (node.isCore) {
      // YOU node — nuke workspace
      nodePanelIcon.style.background = '#FF5A00';
      nodePanelIcon.style.color = '#fff';
      nodePanelIcon.textContent = 'YOU';
      nodePanelTitle.textContent = 'YOU — Core Node';
      nodePanelMeta.innerHTML = '<div class="node-meta-row"><span class="node-meta-label">WORKSPACE</span><span class="node-meta-val">' + getWorkspace() + '</span></div>';
      nodePreviewTxt.textContent = 'This is your core node. Deleting it will permanently wipe all indexed documents and chat logs from this workspace. This cannot be undone.';
      nodeDeleteBtn.textContent = '🗑 WIPE ENTIRE WORKSPACE';
      nodeDeleteBtn.className = 'node-delete-btn danger';
    } else if (node.isLog) {
      nodePanelIcon.style.background = '#00c8c8';
      nodePanelIcon.style.color = '#000';
      nodePanelIcon.textContent = 'LOG';
      nodePanelTitle.textContent = 'Chat Log';
      nodePanelMeta.innerHTML = '<div class="node-meta-row"><span class="node-meta-label">TYPE</span><span class="node-meta-val">LOG</span></div>';
      nodePreviewTxt.textContent = 'Loading chat history…';
      nodeDeleteBtn.textContent = '🗑 CLEAR CHAT LOG';
      nodeDeleteBtn.className = 'node-delete-btn';
      // Load log preview from localStorage
      try {
        const data = await ChatLogs.getChatLog(getWorkspace());
        if (data.entries.length) {
          const last5 = data.entries.slice(-5).map(e => '[' + e.role.toUpperCase() + '] ' + e.message).join('\n\n');
          nodePreviewTxt.textContent = data.entries.length + ' messages total. Last 5:\n\n' + last5;
        } else {
          nodePreviewTxt.textContent = 'No chat history yet.';
        }
      } catch { nodePreviewTxt.textContent = 'Could not load log.'; }
    } else {
      const color = node.color.fill || '#FF5A00';
      nodePanelIcon.style.background = color;
      nodePanelIcon.style.color = '#fff';
      nodePanelIcon.textContent = node.ext.slice(0,3);
      nodePanelTitle.textContent = node.sourceId || node.label;
      nodePanelMeta.innerHTML =
        `<div class="node-meta-row"><span class="node-meta-label">TYPE</span><span class="node-meta-val">${node.ext}</span></div>` +
        `<div class="node-meta-row"><span class="node-meta-label">SOURCE ID</span><span class="node-meta-val">${node.sourceId || node.label}</span></div>` +
        `<div class="node-meta-row"><span class="node-meta-label">CLUSTER</span><span class="node-meta-val" style="color:#00ffcc">${node.clusterName || 'General Knowledge'}</span></div>` +
        `<div class="node-meta-row"><span class="node-meta-label">PRIORITY</span><span class="node-meta-val" style="color:${node.priority===1?'#ff3333':node.priority===2?'#ffcc00':'#00ff88'}">${node.priority===1?'🔴 HIGH':node.priority===2?'🟡 MEDIUM':'🟢 LOW'}</span></div>`;
      nodePreviewTxt.textContent = 'Generating summary…';
      nodeDeleteBtn.textContent = '🗑 DELETE NODE';
      nodeDeleteBtn.className = 'node-delete-btn';
      
      // Increment query count locally for dynamic priorities
      try {
        const nodes = window.localDatabase.getNodes(getWorkspace());
        const matched = nodes.find(ln => ln.source_id === (node.sourceId || node.label));
        if (matched) {
          matched.clicks = (matched.clicks || 0) + 1;
          if (matched.clicks >= 10) matched.priority = 1;
          else if (matched.clicks >= 4) matched.priority = 2;
          await window.localDatabase.saveNode(matched);
        }
      } catch (err) { console.error(err); }

      // Ask the local AI for a 10-word summary of this specific document
      async function callGroqAPI(prompt, systemMsg = "You are a precise, helpful AI assistant.") {
        const apiKey = localStorage.getItem('sb_groq_key') || '';
        if (!apiKey) {
          throw new Error("Missing Groq API Key in the header!");
        }
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.choices[0]?.message?.content?.trim() || '';
      }

      try {
        const nodes = window.localDatabase.getNodes(getWorkspace());
        const matched = nodes.find(ln => ln.source_id === (node.sourceId || node.label));
        const documentText = matched ? matched.text : '';
        if (!documentText) {
          nodePreviewTxt.textContent = 'Preview unavailable (empty document).';
        } else {
          const summary = await callGroqAPI(`Summarize this document content in exactly 10 words or fewer: "${documentText.substring(0, 1000)}". Reply with only the summary, no intro or explanation.`);
          nodePreviewTxt.textContent = summary || 'No summary available.';
        }
      } catch { nodePreviewTxt.textContent = 'Preview unavailable. Paste your Groq API Key first!'; }
    }
  }

  nodeDeleteBtn.addEventListener('click', async () => {
    const n = _activeNode;
    if (!n) return;
    const ws = getWorkspace();

    if (n.isCore) {
      if (!confirm('WIPE ENTIRE WORKSPACE "' + ws + '"? This deletes ALL documents and chat logs permanently.')) return;
      try {
        await window.localDatabase.deleteWorkspace(ws);
        await ChatLogs.clearChatLog(ws);
        docNodes.length = 0;
        document.getElementById('node-count').textContent = '0';
        nodeModal.classList.remove('open');
        showToast('WORKSPACE WIPED');
        restoreGraphNodes();
        if (typeof fetchTimeline === 'function') fetchTimeline();
        if (typeof fetchCalendar === 'function') fetchCalendar();
      } catch(err) { showToast('ERROR: ' + err.message, true); }

    } else if (n.isLog) {
      try {
        await ChatLogs.clearChatLog(ws);
        nodeModal.classList.remove('open');
        showToast('CHAT LOG CLEARED');
        if (typeof fetchTimeline === 'function') fetchTimeline();
        if (typeof fetchCalendar === 'function') fetchCalendar();
      } catch(err) { showToast('ERROR: ' + err.message, true); }

    } else {
      if (!confirm('Delete "' + (n.sourceId||n.label) + '" from workspace?')) return;
      try {
        await window.localDatabase.deleteNode(ws, n.sourceId || n.label);
        const i = docNodes.indexOf(n);
        if (i > -1) docNodes.splice(i, 1);
        document.getElementById('node-count').textContent = docNodes.length;
        nodeModal.classList.remove('open');
        showToast('NODE DELETED');
        restoreGraphNodes();
        if (typeof fetchTimeline === 'function') fetchTimeline();
        if (typeof fetchCalendar === 'function') fetchCalendar();
      } catch(err) { showToast('ERROR: ' + err.message, true); }
    }
  });

  /* ═══ CHAT LOG MODAL ═══ */
  const logModal   = document.getElementById('log-modal');
  const logEntries = document.getElementById('log-entries');
  document.getElementById('log-close-btn').addEventListener('click', () => logModal.classList.remove('open'));
  logModal.addEventListener('click', e => { if (e.target===logModal) logModal.classList.remove('open'); });

  async function openLogModal() {
    logModal.classList.add('open');
    logEntries.innerHTML = '<div style="text-align:center;padding:40px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">LOADING…</div>';
    try {
      const data = await ChatLogs.getChatLog(getWorkspace());
      if (!data.entries.length) { logEntries.innerHTML = '<div style="text-align:center;padding:40px;font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">NO CHAT HISTORY YET</div>'; return; }
      logEntries.innerHTML = '';
      data.entries.forEach(entry => {
        const wrap=document.createElement('div'); wrap.className='log-entry';
        const role=document.createElement('div'); role.className=`log-role ${entry.role}`; role.textContent=entry.role==='user'?'YOU':'SB';
        const mw=document.createElement('div'); mw.style.flex='1';
        const txt=document.createElement('div'); txt.className='log-msg'; txt.textContent=entry.message;
        const ts=document.createElement('div'); ts.className='log-ts'; ts.textContent=new Date(entry.timestamp).toLocaleString();
        mw.appendChild(txt); mw.appendChild(ts); wrap.appendChild(role); wrap.appendChild(mw); logEntries.appendChild(wrap);
      });
      logEntries.scrollTop = logEntries.scrollHeight;
    } catch(err) { logEntries.innerHTML = `<div style="text-align:center;padding:40px;font-family:var(--font-mono);font-size:10px;color:var(--red)">ERROR: ${err.message}</div>`; }
  }


  /* ═══ MOBILE CHAT BOTTOM SHEET ═══ */
  (function() {
    const MOBILE = () => window.innerWidth <= 768;

    const chatMessages  = document.getElementById('chat-messages');
    const chatInputArea = document.getElementById('chat-input-area');
    const mobClose      = document.getElementById('mob-chat-close');
    const msgInput      = document.getElementById('msg-input');
    const graphCanvas   = document.getElementById('graph-main-canvas');
    const chatPanel     = document.getElementById('chat-panel');

    let chatOpen = false;

    function openMobChat() {
      if (!MOBILE()) return;
      chatOpen = true;
      chatMessages.classList.add('mob-open');
      mobClose.style.display = 'flex';
      chatInputArea.classList.add('mob-active');
      // scroll messages to bottom
      setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
    }

    function closeMobChat() {
      if (!MOBILE()) return;
      chatOpen = false;
      chatMessages.classList.remove('mob-open');
      mobClose.style.display = 'none';
      chatInputArea.classList.remove('mob-active');
    }

    // Tapping input or send opens the chat
    chatInputArea.addEventListener('touchstart', () => { if (MOBILE()) openMobChat(); }, { passive: true });
    chatInputArea.addEventListener('click',      () => { if (MOBILE()) openMobChat(); });

    // Close button collapses chat
    mobClose.addEventListener('click', closeMobChat);
    mobClose.addEventListener('touchend', e => { e.preventDefault(); closeMobChat(); });

    // Tapping the graph canvas closes chat (passes touch through naturally since pointer-events:none on panel)
    graphCanvas.addEventListener('click',      () => { if (MOBILE() && chatOpen) closeMobChat(); });
    graphCanvas.addEventListener('touchstart', () => { if (MOBILE() && chatOpen) closeMobChat(); }, { passive: true });

    // When a new message is appended, auto-open and scroll
    const observer = new MutationObserver(() => {
      if (MOBILE()) {
        openMobChat();
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    });
    observer.observe(chatMessages, { childList: true });

    // On resize, clean up state
    window.addEventListener('resize', () => {
      if (!MOBILE()) {
        chatMessages.classList.remove('mob-open');
        mobClose.classList.remove('visible');
        chatInputArea.classList.remove('mob-active');
        chatOpen = false;
      }
    });
  })();

  /* ═══ SUPABASE EMAIL & PASSWORD AUTHENTICATION ENGINE ═══ */
  const authModal         = document.getElementById('supabase-auth-modal');
  const authBtn           = document.getElementById('supabase-auth-btn');
  const authClose         = document.getElementById('auth-modal-close');
  const tabLogin          = document.getElementById('tab-login-btn');
  const tabSignup         = document.getElementById('tab-signup-btn');
  const sbUrlInput        = document.getElementById('sb-url-input');
  const keyInput          = document.getElementById('sb-key-input');
  const sbUsernameContainer = document.getElementById('sb-username-container');
  const sbUsernameInput   = document.getElementById('sb-username');
  const emailInput        = document.getElementById('sb-email');
  const passInput         = document.getElementById('sb-pass');
  const sbGroqInput       = document.getElementById('sb-groq');
  const sbGroqLabel       = document.getElementById('sb-groq-label');
  const submitBtn         = document.getElementById('sb-auth-submit-btn');

  const supabaseProfile   = document.getElementById('supabase-profile');
  const userTrigger       = document.getElementById('supabase-user-trigger');
  const userEmailSpan     = document.getElementById('supabase-user-email');
  const supabaseDropdown  = document.getElementById('supabase-dropdown');
  const editUsernameBtn   = document.getElementById('supabase-edit-username-btn');
  const logoutBtn         = document.getElementById('supabase-logout-btn');
  const syncBtn           = document.getElementById('supabase-sync-btn');
  const pullBtn           = document.getElementById('supabase-pull-btn');

  let sbClient = null;
  let isSignUpMode = false;

  const configSection     = document.getElementById('supabase-config-section');
  const toggleConfigBtn   = document.getElementById('toggle-config-btn');

  // Open & Close Modal
  authBtn.addEventListener('click', () => {
    const savedUrl = localStorage.getItem('sb_url');
    const savedKey = localStorage.getItem('sb_anon_key');
    sbUrlInput.value = savedUrl || '';
    keyInput.value = savedKey || '';

    if (savedUrl && savedKey) {
      configSection.style.display = 'none';
    } else {
      configSection.style.display = 'flex';
    }

    authModal.classList.add('open');
  });
  authClose.addEventListener('click', () => authModal.classList.remove('open'));
  authModal.addEventListener('click', e => { if (e.target === authModal) authModal.classList.remove('open'); });

  // Toggle backend configurations manually
  toggleConfigBtn.addEventListener('click', () => {
    if (configSection.style.display === 'none') {
      configSection.style.display = 'flex';
    } else {
      configSection.style.display = 'none';
    }
  });

  // Toggle Tab
  tabLogin.addEventListener('click', () => {
    isSignUpMode = false;
    tabLogin.style.background = 'rgba(255,90,0,.15)';
    tabLogin.style.color = 'var(--text)';
    tabSignup.style.background = 'none';
    tabSignup.style.color = 'rgba(255,255,255,.4)';
    submitBtn.textContent = 'EXECUTE SIGN IN';
    sbGroqLabel.textContent = 'GROQ_API_KEY (OPTIONAL ONCE SAVED)://';
    sbGroqInput.placeholder = 'Leave blank to use saved key';
    sbUsernameContainer.style.display = 'none';
  });
  tabSignup.addEventListener('click', () => {
    isSignUpMode = true;
    tabSignup.style.background = 'rgba(255,90,0,.15)';
    tabSignup.style.color = 'var(--text)';
    tabLogin.style.background = 'none';
    tabLogin.style.color = 'rgba(255,255,255,.4)';
    submitBtn.textContent = 'PROVISION NEW ACCOUNT';
    sbGroqLabel.textContent = 'GROQ_API_KEY (REQUIRED)://';
    sbGroqInput.placeholder = 'gsk_xxxxxxxxxxxxxxxxxxxxxxxx';
    sbUsernameContainer.style.display = 'flex';
  });

  // ─── DEFAULT SUPABASE BACKEND CLOUD SETTINGS (CROSS-DEVICE FALLBACKS) ───
  // Paste your Supabase Anon Key here so you never have to enter your database credentials again on any new device!
  const DEFAULT_SUPABASE_URL = "https://aizfypykmaurxillofge.supabase.co"; 
  const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpemZ5cHlrbWF1cnhpbGxvZmdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzQ5MTYsImV4cCI6MjA5OTcxMDkxNn0.rpLE3Zz-4a4voX-1r-AEqgOiLwr7BuaT9uF7RxnP3kA"; // Paste your anon key here for one-click cross-device login

  // Init Supabase Client
  function getSupabaseClient() {
    if (sbClient) return sbClient;
    let url = sbUrlInput.value.trim() || localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL;
    const anonKey = keyInput.value.trim() || localStorage.getItem('sb_anon_key') || DEFAULT_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;

    // Auto-correct Dashboard URLs to API Endpoint URLs
    if (url.includes('supabase.com/dashboard/project/')) {
      const parts = url.split('/');
      const projectId = parts[parts.length - 1];
      url = `https://${projectId}.supabase.co`;
      sbUrlInput.value = url;
    }

    try {
      sbClient = supabase.createClient(url, anonKey);
      localStorage.setItem('sb_url', url);
      localStorage.setItem('sb_anon_key', anonKey);
      return sbClient;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  // Execute Auth
  submitBtn.addEventListener('click', async () => {
    const client = getSupabaseClient();
    if (!client) {
      showToast("Please provide both Supabase URL and Anon Key first.", true);
      configSection.style.display = 'flex';
      sbUrlInput.focus();
      return;
    }

    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      showToast("Please enter email and password.", true);
      return;
    }

    const usernameVal = sbUsernameInput.value.trim();
    if (isSignUpMode && !usernameVal) {
      showToast("Please enter a username for your account.", true);
      return;
    }

    const groqKeyVal = sbGroqInput.value.trim();
    if (isSignUpMode && !groqKeyVal) {
      showToast("Please enter your Groq API Key to set up your account.", true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    showToast(isSignUpMode ? "PROVISIONING ACCOUNT…" : "VERIFYING SECURITY MATRIX…");

    try {
      if (isSignUpMode) {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: usernameVal
            }
          }
        });
        if (error) throw error;
        
        // Persist Groq key and username to localStorage
        localStorage.setItem('sb_groq_key', groqKeyVal);
        localStorage.setItem('sb_username', usernameVal);
        
        showToast("✓ ACCOUNT PROVISIONED! VERIFICATION EMAIL INITIATED.");
        isSignUpMode = false;
        tabLogin.click();
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // If a new key was entered on login, save it
        if (groqKeyVal) {
          localStorage.setItem('sb_groq_key', groqKeyVal);
        }

        // Cache the cloud username
        const usernameMeta = data.user.user_metadata?.username;
        if (usernameMeta) {
          localStorage.setItem('sb_username', usernameMeta);
        }
        
        showToast("✓ SECURITY MATRIX CLEARED");
        authModal.classList.remove('open');
        updateAuthUI(data.user);
        await syncCloudConfig();
      }
    } catch (e) {
      showToast("AUTH ERROR: " + e.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
    }
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    localStorage.removeItem('sb_session_user');
    updateAuthUI(null);
    showToast("LOGGED OUT SECURELY");
  });

  // UI Updates
  function updateAuthUI(user) {
    if (user) {
      localStorage.setItem('sb_session_user', JSON.stringify(user));
      authBtn.style.display = 'none';
      supabaseProfile.style.display = 'flex';
      
      const displayName = user.user_metadata?.username || localStorage.getItem('sb_username') || user.email.split('@')[0];
      userEmailSpan.textContent = displayName.toUpperCase();
      userTrigger.style.cursor = 'pointer';
      userTrigger.title = 'Click to open Control Panel';
      
      // Update avatar badge initial
      const profileBadge = document.getElementById('supabase-avatar-badge');
      if (profileBadge) {
        profileBadge.textContent = displayName.charAt(0).toUpperCase();
      }
    } else {
      authBtn.style.display = 'block';
      supabaseProfile.style.display = 'none';
      supabaseDropdown.style.display = 'none';
    }
  }

  // Toggle dropdown on trigger click
  userTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (supabaseDropdown.style.display === 'none' || !supabaseDropdown.style.display) {
      supabaseDropdown.style.display = 'flex';
    } else {
      supabaseDropdown.style.display = 'none';
    }
  });

  // Close dropdown when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (!supabaseProfile.contains(e.target)) {
      supabaseDropdown.style.display = 'none';
    }
  });

  // Close dropdown when clicking sync/pull buttons
  syncBtn.addEventListener('click', () => { supabaseDropdown.style.display = 'none'; });
  pullBtn.addEventListener('click', () => { supabaseDropdown.style.display = 'none'; });

  // Edit Username via Dropdown button click
  editUsernameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    supabaseDropdown.style.display = 'none';
    
    const newUsername = prompt("ENTER NEW USERNAME / CODENAME:");
    if (!newUsername) return;
    const cleanUsername = newUsername.trim();
    if (!cleanUsername) return;

    const client = getSupabaseClient();
    if (!client) return;

    showToast("UPDATING CODENAME…");
    try {
      const { data, error } = await client.auth.updateUser({
        data: { username: cleanUsername }
      });
      if (error) throw error;
      
      localStorage.setItem('sb_username', cleanUsername);
      updateAuthUI(data.user);
      showToast("✓ USERNAME UPDATED SECURELY!");
    } catch (e) {
      showToast("UPDATE ERROR: " + e.message, true);
    }
  });

  // Cloud Config Sync
  async function syncCloudConfig() {
    const client = getSupabaseClient();
    if (!client) return;
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      // Update cached session user and username dynamically from fresh backend profile
      localStorage.setItem('sb_session_user', JSON.stringify(user));
      const freshUsername = user.user_metadata?.username;
      if (freshUsername) {
        localStorage.setItem('sb_username', freshUsername);
      }
      updateAuthUI(user);

      const { data, error } = await client
        .from('second_brain_profiles')
        .select('groq_key')
        .eq('id', user.id)
        .maybeSingle();

      const currentGroqKey = localStorage.getItem('sb_groq_key') || '';

      if (data && data.groq_key) {
        if (!currentGroqKey || currentGroqKey !== data.groq_key) {
          localStorage.setItem('sb_groq_key', data.groq_key);
          const groqInput = document.getElementById('groq-key-input');
          if (groqInput) groqInput.value = data.groq_key;
          showToast("✓ GROQ KEY SYNCED FROM CLOUD ACCOUNT");
        }
      } else if (currentGroqKey) {
        // Create user profile row
        await client.from('second_brain_profiles').upsert({
          id: user.id,
          groq_key: currentGroqKey,
          updated_at: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Backup DB
  async function backupDatabaseToCloud() {
    const client = getSupabaseClient();
    if (!client) {
      authBtn.click();
      return;
    }
    showToast("BACKING UP SECOND BRAIN DATA TO CLOUD…");
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Unauthorized");

      const allNodes = window.localDatabase ? (window.localDatabase.nodesCache || []) : [];
      const reminders = JSON.parse(localStorage.getItem('sb_reminders') || '[]');
      const backupContent = JSON.stringify({
        nodes: allNodes,
        reminders: reminders,
        timestamp: new Date().toISOString()
      });

      const { error } = await client.from('second_brain_profiles').upsert({
        id: user.id,
        db_backup: backupContent,
        updated_at: new Date().toISOString()
      });

      if (error) throw error;
      showToast("✓ DATABASE BACKUP SAVED TO CLOUD!");
    } catch (err) {
      console.error(err);
      showToast("Cloud backup failed: " + err.message, true);
    }
  }
  syncBtn.addEventListener('click', backupDatabaseToCloud);

  // Restore DB
  async function restoreDatabaseFromCloud() {
    const client = getSupabaseClient();
    if (!client) {
      authBtn.click();
      return;
    }
    if (!confirm("Wipe local memories and restore your Second Brain database from your secure Cloud Backup? This cannot be undone.")) return;

    showToast("RESTORING DATA FROM CLOUD…");
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Unauthorized");

      const { data, error } = await client
         .from('second_brain_profiles')
         .select('db_backup')
         .eq('id', user.id)
         .maybeSingle();

      if (error) throw error;
      if (!data || !data.db_backup) {
        showToast("No database backup found on Cloud.", true);
        return;
      }

      const backupData = JSON.parse(data.db_backup);
      if (backupData.nodes) {
        window.localDatabase.nodesCache = backupData.nodes;
        const transaction = window.localDatabase.db.transaction(['nodes'], 'readwrite');
        const store = transaction.objectStore('nodes');
        await store.clear();
        for (const n of backupData.nodes) {
          await store.put(n);
        }
        
        // Dynamic reminders cloud synchronization write
        if (backupData.reminders) {
          localStorage.setItem('sb_reminders', JSON.stringify(backupData.reminders));
          if (typeof fetchCalendar === 'function') {
            fetchCalendar();
          }
        }
        
        showToast("✓ RESTORE COMPLETED!");
        restoreGraphNodes();
      }
    } catch (err) {
      console.error(err);
      showToast("Cloud restore failed: " + err.message, true);
    }
  }
  pullBtn.addEventListener('click', restoreDatabaseFromCloud);

  // Auto-Login Session Recovery
  const sessionUserStr = localStorage.getItem('sb_session_user');
  if (sessionUserStr) {
    try {
      const user = JSON.parse(sessionUserStr);
      updateAuthUI(user);
      setTimeout(async () => {
        const client = getSupabaseClient();
        if (client) {
          await syncCloudConfig();
        }
      }, 800);
    } catch (e) {}
  }

  /* ═══ PWA SERVICE WORKER ═══ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js')
        .then(r => console.log('[SW] Registered:', r.scope))
        .catch(e => console.warn('[SW] Failed:', e));
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     CYBERPUNK REMINDERS ENGINE (WITH WEB AUDIO SYNTH & SYSTEM NOTIFICATIONS)
  ══════════════════════════════════════════════════════════════════ */
  
  let globalAudioCtx = null;
  function getUnlockedAudioCtx() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return null;
      if (!globalAudioCtx) {
        globalAudioCtx = new AudioCtxClass();
      }
      if (globalAudioCtx.state === 'suspended') {
        globalAudioCtx.resume().catch(() => {});
      }
      return globalAudioCtx;
    } catch (e) {
      console.warn("AudioContext unlock failed:", e);
      return null;
    }
  }

  // Preemptively unlock AudioContext on any user gesture interaction
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => {
      getUnlockedAudioCtx();
    }, { passive: true });
  });

  function playCyberpunkReminderTone() {
    try {
      const ctx = getUnlockedAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15); // C6 arpeggio glide!
      
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      setTimeout(() => {
        try {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
          osc2.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.13); // E6
          
          gain2.gain.setValueAtTime(0.15, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.58);
          
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(ctx.currentTime);
          osc2.stop(ctx.currentTime + 0.58);
        } catch (err) {}
      }, 120);
    } catch (e) {
      console.error("Audio synth error:", e);
    }
  }

  function triggerBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      // Force service worker notifications everywhere to guarantee high priority lock-screen system alerts on Android
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(title, {
            body: body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            vibrate: [300, 100, 300],
            tag: 'reminder-alert',
            renotify: true,
            requireInteraction: true
          });
        }).catch(() => {
          // Fallback to standard notification if service worker not available
          try {
            new Notification(title, {
              body: body,
              icon: './icon-192.png',
              badge: './icon-192.png',
              vibrate: [300, 100, 300],
              tag: 'reminder-alert',
              renotify: true,
              requireInteraction: true
            });
          } catch (e) {}
        });
      } else {
        try {
          new Notification(title, {
            body: body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            vibrate: [300, 100, 300],
            tag: 'reminder-alert',
            renotify: true,
            requireInteraction: true
          });
        } catch (e) {}
      }
    }
  }



  function parseTimeStringToTimestamp(timeStr) {
    const now = new Date();
    let hours = 0;
    let minutes = 0;

    const ampmMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (ampmMatch) {
      hours = parseInt(ampmMatch[1], 10);
      minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
      const ampm = ampmMatch[3] ? ampmMatch[3].toUpperCase() : null;

      if (ampm === 'PM' && hours < 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
    } else {
      const match24 = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (match24) {
        hours = parseInt(match24[1], 10);
        minutes = parseInt(match24[2], 10);
      } else {
        return null;
      }
    }

    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    return targetDate.getTime();
  }

  window.scheduleReminderFromTag = function(tagText) {
    const textMatch = tagText.match(/text="([^"]+)"/);
    const delayMatch = tagText.match(/delay="([^"]+)"/);
    if (!textMatch || !delayMatch) return;

    const content = textMatch[1];
    const delayVal = delayMatch[1].trim();

    let targetTime = Date.now();

    if (/^\d+$/.test(delayVal)) {
      const seconds = parseInt(delayVal, 10);
      targetTime += seconds * 1000;
    } else {
      // Parse flexible duration formats like "1m", "5 min", "10 minutes", "30s", "1 hour", etc.
      const durationMatch = delayVal.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)$/i);
      if (durationMatch) {
        const value = parseFloat(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();
        if (unit.startsWith('s')) {
          targetTime += value * 1000;
        } else if (unit.startsWith('m')) {
          targetTime += value * 60 * 1000;
        } else if (unit.startsWith('h')) {
          targetTime += value * 60 * 60 * 1000;
        }
      } else {
        // Fall back to wall-clock time format (e.g., "3:00 PM", "15:00")
        const parsedTime = parseTimeStringToTimestamp(delayVal);
        if (parsedTime) {
          targetTime = parsedTime;
        } else {
          targetTime += 60000; // default 1m fallback
        }
      }
    }

    const reminder = {
      id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      workspace_id: getWorkspace(),
      text: content,
      time: targetTime,
      fired: false
    };

    const reminders = JSON.parse(localStorage.getItem('sb_reminders') || '[]');
    reminders.push(reminder);
    localStorage.setItem('sb_reminders', JSON.stringify(reminders));

    // Dispatch reminder to Service Worker for robust operating system background execution (even when PWA is minimized or closed)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'SCHEDULE_NOTIFICATION',
            title: '🧠 SECOND BRAIN',
            body: content.toUpperCase(),
            time: targetTime
          });
        }
      }).catch(err => console.warn("SW postMessage failed:", err));
    }

    showToast(`✓ REMINDER SCHEDULED: "${content.toUpperCase()}"`);
    
    if (typeof fetchCalendar === 'function') {
      fetchCalendar();
    }
  };

  let alarmAudioInterval = null;

  function triggerAlarmRinging(alarmText) {
    // Play tone immediately and schedule looping chime if not already running
    playCyberpunkReminderTone();
    if (!alarmAudioInterval) {
      alarmAudioInterval = setInterval(() => {
        playCyberpunkReminderTone();
      }, 1500); // Ring every 1.5 seconds!
    }

    // Display a beautiful, glowing dismiss overlay that stays on screen until dismissed
    const tc = document.getElementById('toast-container');
    if (!tc) return;

    const alarmContainer = document.createElement('div');
    alarmContainer.id = 'active-alarm-overlay';
    alarmContainer.style.cssText = `
      background: rgba(10, 10, 10, 0.95);
      border: 2px solid var(--orange);
      box-shadow: 0 0 20px rgba(255, 90, 0, 0.4);
      padding: 14px 20px;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: var(--font-mono);
      color: var(--orange);
      text-align: center;
      animation: alarmBlink 1s infinite alternate;
      max-width: 320px;
      margin: 10px auto;
      pointer-events: auto;
    `;

    // Ensure alarm style keyframes are present
    if (!document.getElementById('alarm-style')) {
      const style = document.createElement('style');
      style.id = 'alarm-style';
      style.textContent = `
        @keyframes alarmBlink {
          0% { border-color: rgba(255, 90, 0, 0.4); box-shadow: 0 0 10px rgba(255, 90, 0, 0.2); }
          100% { border-color: rgba(255, 90, 0, 1); box-shadow: 0 0 30px rgba(255, 90, 0, 0.6); }
        }
      `;
      document.head.appendChild(style);
    }

    alarmContainer.innerHTML = `
      <div style="font-weight: bold; font-size: 11px; letter-spacing: 2px;">⚡ ALARM ACTIVE ⚡</div>
      <div style="font-size: 13px; font-weight: bold; color: var(--text); word-break: break-word;">"${alarmText}"</div>
      <button class="cyber-btn" id="dismiss-alarm-btn" style="
        background: rgba(255, 90, 0, 0.15);
        border: 1px solid var(--orange);
        color: var(--orange);
        padding: 6px 16px;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 1px;
        transition: all 0.2s;
        border-radius: 2px;
        margin-top: 4px;
      ">// DISMISS ALARM</button>
    `;

    // Remove any existing alarm overlay to avoid duplicates
    const oldAlarm = document.getElementById('active-alarm-overlay');
    if (oldAlarm) oldAlarm.remove();

    tc.appendChild(alarmContainer);

    // Dismiss click handler
    const dismissBtn = alarmContainer.querySelector('#dismiss-alarm-btn');
    dismissBtn.addEventListener('click', () => {
      if (alarmAudioInterval) {
        clearInterval(alarmAudioInterval);
        alarmAudioInterval = null;
      }
      alarmContainer.remove();
      showToast("✓ ALARM DISMISSED");
    });
  }

  function startRemindersLoop() {
    setInterval(() => {
      const reminders = JSON.parse(localStorage.getItem('sb_reminders') || '[]');
      let updated = false;
      const now = Date.now();

      reminders.forEach(rem => {
        if (!rem.fired && rem.time <= now) {
          rem.fired = true;
          updated = true;

          // Trigger continuous alarm ringing and PWA notification
          triggerAlarmRinging(rem.text.toUpperCase());
          triggerBrowserNotification("🧠 SECOND BRAIN", rem.text.toUpperCase());
        }
      });

      if (updated) {
        localStorage.setItem('sb_reminders', JSON.stringify(reminders));
      }
    }, 1000);
  }

  // Launch Reminders Loop
  startRemindersLoop();



  /* ══════════════════════════════════════════════════════════════════
     CENTRAL CHAT MEMORY GENERATOR & VECTOR INDEXER (STRUCTURED JSON)
  ══════════════════════════════════════════════════════════════════ */
  async function saveChatTurnToDatabaseNode(userText, assistantText) {
    try {
      const ws = getWorkspace();
      const sourceId = 'chat_memory_log.json';
      
      // 1. Fetch any existing Chat Memory node from the current workspace
      const nodes = window.localDatabase.getNodes(ws);
      let existingNode = nodes.find(n => n.source_id === sourceId);
      
      let chatArray = [];
      if (existingNode) {
        try {
          chatArray = JSON.parse(existingNode.text);
          if (!Array.isArray(chatArray)) chatArray = [];
        } catch (e) {
          chatArray = [];
        }
      }
      
      // Append the new conversational turn as structured objects
      const timestamp = new Date().toISOString();
      chatArray.push({
        timestamp: timestamp,
        role: "user",
        message: userText
      });
      chatArray.push({
        timestamp: timestamp,
        role: "assistant",
        message: assistantText
      });
      
      // Serialize the updated JSON array with clean formatting
      const currentText = JSON.stringify(chatArray, null, 2);
      
      // 2. Chunks generation
      const chunks = chunkText(currentText);
      
      // 3. Compute Embeddings on-device in responsive batches
      const embeddings = await getEmbeddingsBatch(chunks);
      
      // 4. Formulate the central memory document
      const node = {
        workspace_id: ws,
        source_id: sourceId,
        source_type: 'json',
        text: currentText,
        chunks: chunks,
        embeddings: embeddings,
        priority: 2, // High importance
        cluster_id: 2, // Distinct visual styling
        cluster_name: 'Chat Memories',
        dates: extractDatesFromText(currentText),
        timestamp: new Date().toISOString()
      };
      
      // 5. Store locally into IndexedDB
      await window.localDatabase.saveNode(node);
      
      // Clean up the old leftover text node if it exists
      try {
        await window.localDatabase.deleteNode(ws, 'chat_memory_log.txt');
      } catch (e) {}
      
      // 6. Instantly redraw the visual neural graph map to show the live growing chat log
      if (typeof restoreGraphNodes === 'function') {
        restoreGraphNodes();
      }
      console.log("💾 Conversational turn successfully synced into central 'chat_memory_log.json' database node!");
    } catch (e) {
      console.warn("Failed to update central chat memory node:", e);
    }
  }

  }); // DOMContentLoaded
  