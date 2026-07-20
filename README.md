# 🧠 Second Brain: Unified Neural Interface

> **See, I'm a very forgetful person — or rather, someone with a cluttered mind. So the idea of having a Second Brain was brought to life.**
>
> Originally built as a web-only desktop project, Second Brain has been fully re-engineered into a high-performance, cross-platform **Progressive Web App (PWA) and completely native Android Application** using Capacitor. It features real-time cloud synchronization, hardware-native voice recording, a selective multi-reminder engine, and a gorgeous cyberpunk Home Screen Widget!

---

## 📱 Desktop-to-Mobile Architecture
Second Brain runs both as a modern, installable **Progressive Web App (PWA)** and as a high-performance **Native Android App**.

### 🌟 Key Upgrades:
- 📲 **Native Android Container (Capacitor):** Fully packaged into a native Android application container, unlocking native hardware APIs and removing mobile browser sandbox restrictions.
- ⚡ **Neon Cyberpunk Widget:** A beautiful home screen companion displaying up to 3 upcoming active reminders, sync time, and a **`⚡ QUICK VOX`** action button to launch your voice dictation instantly.
- ⏰ **Native Local Notifications:** Runs on native OS hardware channels to ring continuous alerts and fire alarms reliably even when the app is completely closed.
- 🎤 **Cross-Browser AI Voice Ingestion:** Utilizes raw hardware `MediaRecorder` stream capture and feeds it to **Groq Whisper AI (`whisper-large-v3`)** for near-zero latency speech-to-text dictation.
- 🎨 **Keyboard Optimizations:** Features standard `Enter` to send, `Shift + Enter` for new lines, and mobile soft-keyboard `enterkeyhint="send"` customization to turn your mobile return carriage key into a striking Send button.

---

## 🧱 Project Structure

```text
Second-Brain/
│
├── frontend/                # Full Client-Side Web & PWA Code
│   ├── index.html           # Main entry point (Desktop/Mobile workstation)
│   ├── second-brain.html    # Secondary workspace interface
│   ├── manifest.json        # PWA manifest configurations
│   ├── service-worker.js    # Service Worker offline-first caching
│   └── test_script.js       # Core logic, database bridges, and sync modules
│
├── android/                 # Fully Generated Native Android Workspace
│   └── app/src/main/
│       ├── java/.../app/    # Native Java classes (Widget & Capacitor plugin)
│       └── res/             # Widget XML, shapes, layouts, and system theme drawables
│
├── backend/                 # Optional Python backend API services
│   ├── Dockerfile           
│   └── requirements.txt     
│
├── capacitor.config.json    # Capacitor build & folder target bridges
├── package.json             # Core dependency manifest
└── README.md                # This comprehensive guide
```

---

## ⚙️ Upgraded Tech Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Frontend Shell** | HTML5, CSS3, ES6 Vanilla JS | High-fidelity interactive UI with responsive glassmorphism |
| **Native Wrapper** | Capacitor 6.0 | Bridges web assets with native mobile APIs and background threads |
| **Local Alerts** | `@capacitor/local-notifications` | Native system notifications bypassing browser limits |
| **Database Cloud** | Supabase | Multi-tenant auth, workspace profile config, & real-time sync |
| **LLM Inference** | Groq (**Llama 3.1 8B**) | Sub-second ultra-low latency chat streaming |
| **Speech-to-Text** | Groq (**Whisper Large v3**) | Hardware-native voice-to-text transcriber |

---

## 🚀 Running Second Brain on Your Physical Phone

Getting your private Second Brain up and running on your actual personal Android phone is incredibly easy. Follow this simple guide to compile, install, and add your new widget!

### 1️⃣ Prepare Your Phone
1. Go to **Settings > About Phone** (or **About Device**).
2. Tap **Build Number** exactly **7 times** until your screen says: *"You are now a developer!"*
3. Go back to main settings, enter the new **Developer Options** section, and turn on **USB Debugging**.
4. Plug your phone into your computer via a USB cable.
5. On your phone screen, accept the prompt: *"Allow USB debugging? (Always allow from this computer)"*.

### 2️⃣ Run the Compilation & Installer
Open your terminal inside the `SecondBrain` root directory and run these commands to configure your environments and push the app directly onto your phone:

#### On Windows (PowerShell):
```powershell
# Point to your Android SDK and Android Studio's built-in Java Compiler
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"

# Sync your latest web assets and compile/run on your physical phone!
npx cap run android
```

#### On macOS / Linux:
```bash
# Point to your SDK directories
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# Run on physical phone
npx cap run android
```

The CLI will detect your physical device, assemble the native build, and boot the app on your phone screen in under a minute!

### 3️⃣ Add the Cyberpunk Widget to Your Home Screen
1. Go to your phone's home screen.
2. Long-press empty space and tap **Widgets** (or **Add Widget**).
3. Search for **Second Brain**.
4. Drag and drop your gorgeous neon-orange widget onto your screen!
5. Open your app and add a reminder using a tag in chat (e.g. `<reminder text="Call college friend Kasu" delay="5:00 PM">`). Click Sync—your reminder list and sync time will dynamically light up right on your home screen!

---

## 🔐 Installation & Static Web Deployment
Because Second Brain is serverless, you can also deploy the browser version for your computer to **any free static host** like Netlify or Vercel:

1. Link this repository to your hosting service (e.g. **Netlify**).
2. Set the build Publish Directory to **`frontend`**.
3. Set your default database credentials in `frontend/index.html` (lines **3203-3205**) so your phone and browser can synchronize to the same Supabase instance:
   ```javascript
   const DEFAULT_SUPABASE_URL = "https://your-project-id.supabase.co";
   const DEFAULT_SUPABASE_ANON_KEY = "your-public-anon-key";
   ```
4. Save and deploy! Both your website and phone app are now synced in real-time.