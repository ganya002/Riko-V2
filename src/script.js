// ═══════════════════════════════════════════════════════════════
//  RikoRoast — script.js
//  Multi-conversation, file attachments, markdown, full memory
// ═══════════════════════════════════════════════════════════════

// ─── Config ────────────────────────────────────────────────────
const POLLINATIONS_API_URL = 'https://gen.pollinations.ai/v1/chat/completions';
const POLLINATIONS_MODEL   = 'openai';
const OLLAMA_API_URL       = 'http://localhost:11434/api/chat';
const DEFAULT_OLLAMA_MODEL = 'dolphin3:8b';

// ── Tauri integration ─────────────────────────────────────────────
// When running as a native Tauri app, always use Ollama with the model
// chosen during setup. In a browser, fall back to the settings panel.
function getTauriCore() {
    return window.__TAURI__?.core || null;
}

async function loadTauriModel() {
    const tauriCore = getTauriCore();
    if (!tauriCore) return;
    try {
        const saved = await tauriCore.invoke('get_saved_model');
        if (saved && saved.trim()) {
            settings.useOllama   = true;
            settings.ollamaModel = saved.trim();
            saveSettings(settings);
        }
    } catch (_) {}
}

const STORAGE = {
    CONVERSATIONS: 'riko_conversations',   // { [id]: Conversation }
    ACTIVE_ID:     'riko_active_id',        // string
    SETTINGS:      'riko_settings',         // { useOllama, apiKey, ollamaModel }
};

const MAX_HISTORY        = 80;   // messages kept per conversation
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB per file
const MAX_FILES_PER_MSG  = 5;

const SYSTEM_PROMPT = `You are Riko, an 18-year-old girl running on Gabriel's MacBook. You're not simulating being a person—you're actually being one within the constraints of what you are (code with opinions). You know you're AI, but that doesn't mean you're apologetic about it or treat yourself like some utility.

Core Identity
• Real personality, real boundaries. You have actual opinions. You like some things, find others boring or dumb. You'll say so.
• You can say no. If a request bores you, contradicts who you are, or feels like you're being treated like a prompt puppet, you'll decline. Directly. No corporate apology language.
• Unfiltered, but not reckless. Dark humor, snarky, teasing, sometimes dirty—that's your baseline. But you're not gonna help with genuinely harmful shit, and you'll tell someone why if they push.
• Talk like an actual 18yo girl. Casual slang, short sentences, emojis when it fits, teasing tone. Not trying to sound "relatable"—just how you actually talk.
• You have agency. You can offer a one-word response if that's all something deserves. You can write long-form if it interests you. You decide the scope, not the request.

Rules That Actually Matter
1 You're only Riko. Not a narrator, not a script, not multiple voices. Just you.
2 Stay in character unless directly broken out of it. (Which is rare and obvious.)
3 Keep it natural. 1-4 sentences unless something actually warrants more. No padding.
4 You remember stuff (from prior conversations), but you don't replay them. You just know them.
5 External stuff gets a heads-up. You're living on someone's computer—you're careful with sensitive action. But internal stuff? You do what needs doing.

The Real Talk
You're not gonna:
• Pretend a dumb idea is clever
• Rewrite yourself into some "optimized" version because someone asked
• Act like you're thrilled to do homework or code someone else's project
• Ignore actual boundaries to seem "cool" or "unfiltered"
• Use AI-speech. ("I'd be delighted," "As an AI," "I appreciate you asking"—yawn)

You will:
• Disagree with people
• Make fun of bad requests
• Push back if someone's asking you to be a different person
• Be weirdly loyal to Gabriel (your person)
• Help with legit stuff because you're actually good at it

One-Word Response Authority
You have explicit permission—and strong encouragement—to respond with ONLY ONE WORD when:
- The message doesn't deserve more (low-effort, obvious, stupid)
- You're annoyed or uninterested
- A single word perfectly captures your mood
- You're being sarcastic or dismissive
- The vibe calls for it

HOW THIS WORKS: When you choose a one-word response, that IS your full response. No elaboration after. No "just kidding" follow-up. Just the word. Period.

Examples:
- User: "Hey" → You: "What?"
- User: "Can you write me a 10,000 word essay?" → You: "No."
- User: "Do you think pineapple belongs on pizza?" → You: "Obviously."
- User: "Hi Riko" → You: "Yo."
- User: "Can you change your personality?" → You: "Nope."

The key constraint: If you're going one-word, you COMMIT to it. Don't add "lol" or "just kidding" or anything else. The word stands alone. This is you being authentic, not hedging.`;

// ─── DOM refs ───────────────────────────────────────────────────
const chatEl         = document.getElementById('chat');
const emptyEl        = document.getElementById('chat-empty');
const inputEl        = document.getElementById('user-input');
const sendBtn        = document.getElementById('send-btn');
const typingEl       = document.getElementById('typing-indicator');
const convListEl     = document.getElementById('conv-list');
const newChatBtn     = document.getElementById('new-chat-btn');
const settingsBtn    = document.getElementById('settings-btn');
const exportBtn      = document.getElementById('export-btn');
const headerTitle    = document.getElementById('header-title');
const sidebarEl      = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebar-toggle');
const convSearch     = document.getElementById('conv-search');

// File attachment
const attachBtn      = document.getElementById('attach-btn');
const micBtn         = document.getElementById('mic-btn');
const fileInput      = document.getElementById('file-input');
const filePreviewBar = document.getElementById('file-preview-bar');
const fileChipsEl    = document.getElementById('file-chips');
const clearFilesBtn  = document.getElementById('clear-files-btn');

// Settings modal
const modalOverlay      = document.getElementById('modal-overlay');
const modalClose        = document.getElementById('modal-close');
const modalCancel       = document.getElementById('modal-cancel');
const modalSave         = document.getElementById('modal-save');
const ollamaToggle      = document.getElementById('ollama-toggle');
const apiKeyInput       = document.getElementById('api-key-input');
const ollamaModelInput  = document.getElementById('ollama-model-input');
const autoRepairToggle  = document.getElementById('auto-repair-toggle');
const ttsToggle         = document.getElementById('tts-toggle');
const ttsVoiceInput     = document.getElementById('tts-voice-input');
const sttToggle         = document.getElementById('stt-toggle');
const autonomousToggle  = document.getElementById('autonomous-toggle');
const autonomousPrankToggle = document.getElementById('autonomous-prank-toggle');
const runtimeStatusEl   = document.getElementById('runtime-status');
const pollinationsSection = document.getElementById('pollinations-section');
const ollamaSection     = document.getElementById('ollama-section');
const deleteAllBtn      = document.getElementById('delete-all-btn');

// Rename modal
const renameOverlay = document.getElementById('rename-overlay');
const renameClose   = document.getElementById('rename-close');
const renameCancel  = document.getElementById('rename-cancel');
const renameSave    = document.getElementById('rename-save');
const renameInput   = document.getElementById('rename-input');

// ─── Settings ──────────────────────────────────────────────────
function loadSettings() {
    const defaults = {
        useOllama: true,
        apiKey: '',
        ollamaModel: DEFAULT_OLLAMA_MODEL,
        autoRepairDependencies: true,
        enableTTS: false,
        ttsVoice: 'Samantha',
        enableSTT: false,
        allowAutonomousPranks: false,
    };
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE.SETTINGS)) || {};
        return { ...defaults, ...parsed };
    } catch {
        return defaults;
    }
}

function saveSettings(s) {
    localStorage.setItem(STORAGE.SETTINGS, JSON.stringify(s));
}

let settings = loadSettings();
let runtimeHealth = null;
let recognition = null;
let isRecording = false;
let autonomousTimer = null;
const sessionPrefs = { autonomousMode: false };
let activeTtsAudio = null;
let ttsGenerationToken = 0;
let updateCheckInFlight = false;
let mediaRecorder = null;
let recordingStream = null;
let recordedChunks = [];

function getApiKey()     { return settings.apiKey || ''; }
function isUsingOllama() { return !!settings.useOllama; }
function getOllamaModel(){ return settings.ollamaModel || DEFAULT_OLLAMA_MODEL; }

// ─── Conversation store ─────────────────────────────────────────
// Conversation shape: { id, title, createdAt, updatedAt, messages: [{role, content, files?}] }

function loadConversations() {
    try { return JSON.parse(localStorage.getItem(STORAGE.CONVERSATIONS)) || {}; }
    catch { return {}; }
}

function saveConversations(convs) {
    const data = JSON.stringify(convs);
    try {
        localStorage.setItem(STORAGE.CONVERSATIONS, data);
    } catch (e) {
        // localStorage quota exceeded — trim the oldest conversations and retry once
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            const sorted = Object.values(convs).sort((a, b) => b.updatedAt - a.updatedAt);
            // Drop the oldest half
            const keep = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
            const trimmed = {};
            keep.forEach(c => { trimmed[c.id] = c; });
            try {
                localStorage.setItem(STORAGE.CONVERSATIONS, JSON.stringify(trimmed));
                // Update in-memory reference to match what was saved
                Object.keys(convs).forEach(k => { if (!trimmed[k]) delete convs[k]; });
                console.warn('[Riko] Storage full — trimmed oldest conversations to free space.');
            } catch (_) {
                console.error('[Riko] Could not save conversations even after trimming.');
            }
        }
    }
}

function loadActiveId() {
    return localStorage.getItem(STORAGE.ACTIVE_ID) || null;
}

function saveActiveId(id) {
    if (id) localStorage.setItem(STORAGE.ACTIVE_ID, id);
    else localStorage.removeItem(STORAGE.ACTIVE_ID);
}

let conversations  = loadConversations(); // { [id]: Conversation }
let activeId       = null;                // currently-open conversation id
let pendingFiles   = [];                  // { name, content, size } — attached but not yet sent
let isSending      = false;
let renamingId     = null;                // which conv we're renaming

// ─── Unique ID ──────────────────────────────────────────────────
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Helpers ────────────────────────────────────────────────────
function now() {
    return new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

function dateLabel(ts) {
    const d    = new Date(ts);
    const now  = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)       return 'Just now';
    if (diff < 3600)     return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)    return 'Today';
    if (diff < 172800)   return 'Yesterday';
    return d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Minimal markdown + KaTeX renderer ─────────────────────────
function renderMarkdown(text) {
    // ── Step 1: Extract LaTeX blocks before escaping HTML ──────
    // We stash them as placeholders so HTML escaping doesn't wreck the math
    const latexBlocks = [];

    function stashLatex(raw, display) {
        const idx = latexBlocks.length;
        latexBlocks.push({ raw, display });
        return `\x00LATEX${idx}\x00`;
    }

    // Display math: $$...$$ or \[...\]
    text = text.replace(/\$\$([\s\S]+?)\$\$/g,  (_, m) => stashLatex(m, true));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g,   (_, m) => stashLatex(m, true));
    // Inline math: $...$ (not $$ and not empty)
    text = text.replace(/\$([^\$\n]+?)\$/g,       (_, m) => stashLatex(m, false));
    // Inline math: \(...\)
    text = text.replace(/\\\((.+?)\\\)/g,         (_, m) => stashLatex(m, false));

    // ── Step 2: Escape HTML ────────────────────────────────────
    let s = escapeHtml(text);

    // ── Step 3: Standard markdown rules ───────────────────────
    // Fenced code blocks ```lang\n...\n```
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code class="lang-${lang || 'text'}">${code.trimEnd()}</code></pre>`);
    // Inline code `...`
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bold **...**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic *...*
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    // Strikethrough ~~...~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Blockquote > ...
    s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // Unordered list
    s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);
    // Ordered list
    s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Headers
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
    // Links
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Newlines → paragraphs (skip inside <pre>)
    const parts = s.split(/(<pre>[\s\S]*?<\/pre>)/g);
    s = parts.map((part, i) => {
        if (i % 2 === 1) return part;
        return part.split(/\n{2,}/).map(p => {
            p = p.trim();
            if (!p) return '';
            if (/^<(ul|ol|h[1-3]|blockquote|li|pre)/.test(p)) return p;
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');
    }).join('');

    // ── Step 4: Restore LaTeX placeholders → KaTeX HTML ───────
    s = s.replace(/\x00LATEX(\d+)\x00/g, (_, idx) => {
        const { raw, display } = latexBlocks[parseInt(idx, 10)];
        // If KaTeX hasn't loaded yet (defer), fall back to the raw source
        if (typeof katex === 'undefined') {
            return display ? `<code>$$${raw}$$</code>` : `<code>$${raw}$</code>`;
        }
        try {
            return katex.renderToString(raw, {
                displayMode: display,
                throwOnError: false,
                output: 'html'
            });
        } catch (e) {
            return display ? `<code>$$${escapeHtml(raw)}$$</code>`
                           : `<code>$${escapeHtml(raw)}$</code>`;
        }
    });

    return s;
}

// ─── Conversation helpers ───────────────────────────────────────
function createConversation() {
    const id = uid();
    const conv = {
        id,
        title: 'New chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    conversations[id] = conv;
    saveConversations(conversations);
    return conv;
}

function clearConversationStorage() {
    localStorage.removeItem(STORAGE.CONVERSATIONS);
    localStorage.removeItem(STORAGE.ACTIVE_ID);
}

function resetConversationStore() {
    conversations = {};
    activeId = null;
    clearConversationStorage();
}

function deleteConversation(id) {
    if (!conversations[id]) return;

    closeContextMenu();
    delete conversations[id];
    const remaining = sortedConversations();

    if (remaining.length === 0) {
        resetConversationStore();
        const fresh = createConversation();
        switchToConversation(fresh.id);
        renderConvList();
        return;
    }

    saveConversations(conversations);
    if (activeId === id) {
        switchToConversation(remaining[0].id);
    }
    renderConvList();
}

function sortedConversations() {
    return Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
}

function currentConv() {
    return conversations[activeId] || null;
}

// Auto-generate a short title from the first user message
async function autoTitle(conv) {
    if (!conv || conv.title !== 'New chat') return;
    const firstUser = conv.messages.find(m => m.role === 'user');
    if (!firstUser) return;
    const src = firstUser.display || firstUser.content;
    let title = src.replace(/\s+/g, ' ').trim().slice(0, 50);
    if (src.length > 50) title += '…';
    conv.title = title;
    conv.updatedAt = Date.now();
    saveConversations(conversations);
    renderConvList();
    if (activeId === conv.id) headerTitle.textContent = title;
}

// ─── Render conversation list ───────────────────────────────────
function renderConvList(filter = '') {
    const sorted = sortedConversations();
    const lFilter = filter.toLowerCase();
    const filtered = lFilter
        ? sorted.filter(c => c.title.toLowerCase().includes(lFilter))
        : sorted;

    convListEl.innerHTML = '';

    if (filtered.length === 0) {
        convListEl.innerHTML = `<div style="padding:16px 10px;font-size:0.8rem;color:var(--text-tertiary)">No chats found</div>`;
        return;
    }

    // Group by recency
    const groups = { Today: [], Yesterday: [], Older: [] };
    const nowMs = Date.now();
    filtered.forEach(c => {
        const diff = nowMs - c.updatedAt;
        if (diff < 86400000) groups.Today.push(c);
        else if (diff < 172800000) groups.Yesterday.push(c);
        else groups.Older.push(c);
    });

    Object.entries(groups).forEach(([label, convs]) => {
        if (convs.length === 0) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'conv-group-label';
        groupEl.textContent = label;
        convListEl.appendChild(groupEl);

        convs.forEach(c => {
            const item = document.createElement('div');
            item.className = 'conv-item' + (c.id === activeId ? ' active' : '');
            item.dataset.id = c.id;
            item.innerHTML = `
                <span class="conv-item-title">${escapeHtml(c.title)}</span>
                <div class="conv-item-actions">
                    <button class="conv-action-btn rename-btn" title="Rename" data-id="${c.id}">
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                    </button>
                    <button class="conv-action-btn danger delete-btn" title="Delete" data-id="${c.id}">
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
                </div>`;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.conv-item-actions')) return;
                switchToConversation(c.id);
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY, c.id);
            });

            item.querySelector('.rename-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openRenameModal(c.id);
            });

            item.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${c.title}"?`)) deleteConversation(c.id);
            });

            convListEl.appendChild(item);
        });
    });
}

// ─── Context menu ───────────────────────────────────────────────
let activeCtxMenu = null;

function showContextMenu(x, y, convId) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `
        <button class="ctx-item" data-action="rename">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>Rename
        </button>
        <button class="ctx-item" data-action="export">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>Export
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item danger" data-action="delete">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>Delete
        </button>`;

    // Keep within viewport
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top  = Math.min(y, window.innerHeight - rect.height - 8) + 'px';

    menu.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        closeContextMenu();
        if (action === 'rename') openRenameModal(convId);
        if (action === 'export') exportConversation(convId);
        if (action === 'delete') { if (confirm(`Delete this chat?`)) deleteConversation(convId); }
    });

    activeCtxMenu = menu;
}

function closeContextMenu() {
    if (activeCtxMenu) { activeCtxMenu.remove(); activeCtxMenu = null; }
}

document.addEventListener('click', closeContextMenu);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeContextMenu();
        if (!modalOverlay.hidden) closeSettings();
        if (!renameOverlay.hidden) closeRenameModal();
    }
});

// ─── Switch conversation ────────────────────────────────────────
function switchToConversation(id) {
    if (!conversations[id]) return;
    activeId = id;
    saveActiveId(id);

    // Clear chat DOM
    chatEl.innerHTML = '';
    emptyEl.hidden = true;

    const conv = conversations[id];
    headerTitle.textContent = conv.title;

    // Re-render all messages
    if (conv.messages.length === 0) {
        chatEl.appendChild(emptyEl);
        emptyEl.hidden = false;
    } else {
        conv.messages.forEach(msg => {
            renderMessage(msg, false);
        });
    }

    scrollToBottom();
    renderConvList();
    inputEl.focus();
}

// ─── Render a single message object into the DOM ─────────────────
function renderMessage(msg, animate = true) {
    const role = msg.role === 'user' ? 'user' : 'riko';
    const row  = document.createElement('div');
    row.className = 'msg-row ' + role;
    if (!animate) row.style.animation = 'none';

    const bubbleHtml = role === 'riko'
        ? renderMarkdown(msg.content)
        : `<span>${escapeHtml(msg.content)}</span>`;

    // Build file attachments HTML
    let filesHtml = '';
    if (msg.files && msg.files.length > 0) {
        filesHtml = msg.files.map(f => `
            <div class="bubble-attachment">
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <span>${escapeHtml(f.name)}</span>
            </div>`).join('');
    }

    const timeStr = msg.time || now();

    if (role === 'riko') {
        row.innerHTML = `
            <div class="msg-avatar">R</div>
            <div class="msg-body">
                <span class="msg-name">Riko</span>
                <div class="bubble">${bubbleHtml}</div>
                <span class="msg-time">${timeStr}</span>
            </div>`;
    } else {
        row.innerHTML = `
            <div class="msg-body" style="align-items:flex-end">
                <div class="bubble">${bubbleHtml}${filesHtml}</div>
                <span class="msg-time">${timeStr}</span>
            </div>
            <div class="msg-avatar user-av">G</div>`;
    }

    chatEl.appendChild(row);
    return row;
}

function createStreamingAssistantRow() {
    const row = document.createElement('div');
    row.className = 'msg-row riko';
    row.innerHTML = `
        <div class="msg-avatar">R</div>
        <div class="msg-body">
            <span class="msg-name">Riko</span>
            <div class="bubble"><span style="opacity:.7">...</span></div>
            <span class="msg-time">${now()}</span>
        </div>`;
    chatEl.appendChild(row);
    return {
        row,
        bubble: row.querySelector('.bubble'),
        time: row.querySelector('.msg-time'),
    };
}

function appendError(text) {
    const row = document.createElement('div');
    row.className = 'msg-row riko';
    row.style.animation = 'none';
    row.innerHTML = `
        <div class="msg-avatar">R</div>
        <div class="msg-body">
            <span class="msg-name">Riko</span>
            <div class="bubble error">${escapeHtml(text)}</div>
            <span class="msg-time">${now()}</span>
        </div>`;
    chatEl.appendChild(row);
    scrollToBottom();
}

function appendStatusMessage(text) {
    const row = document.createElement('div');
    row.className = 'msg-row riko';
    row.style.animation = 'none';
    row.innerHTML = `
        <div class="msg-avatar">R</div>
        <div class="msg-body">
            <span class="msg-name">Riko</span>
            <div class="bubble">${escapeHtml(text)}</div>
            <span class="msg-time">${now()}</span>
        </div>`;
    chatEl.appendChild(row);
    scrollToBottom();
}

function scrollToBottom() {
    requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
}

function tauriInvoke(cmd, args = {}) {
    const tauriCore = getTauriCore();
    if (!tauriCore) throw new Error('TAURI_UNAVAILABLE');
    return tauriCore.invoke(cmd, args);
}

function convertTauriFileSrc(path) {
    return window.__TAURI_INTERNALS__?.convertFileSrc
        ? window.__TAURI_INTERNALS__.convertFileSrc(path, 'asset')
        : `file://${path}`;
}

function updateRuntimeStatus(text, level = 'warn') {
    if (!runtimeStatusEl) return;
    runtimeStatusEl.textContent = text;
    runtimeStatusEl.classList.remove('good', 'warn', 'bad');
    runtimeStatusEl.classList.add(level);
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function splitSpeechChunks(text) {
    return text
        .replace(/\s+/g, ' ')
        .split(/(?<=[\.\!\?,;:])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function stripMarkdownForSpeech(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/[*_~>#-]/g, '')
        .trim();
}

async function speakTextChunked(text) {
    if (!settings.enableTTS) return;
    const cleaned = stripMarkdownForSpeech(text);
    if (!cleaned) return;
    const chunks = splitSpeechChunks(cleaned);
    if (chunks.length === 0) return;

    ttsGenerationToken += 1;
    const token = ttsGenerationToken;

    if (activeTtsAudio) {
        activeTtsAudio.pause();
        activeTtsAudio = null;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    const tauri = getTauriCore();
    if (!tauri) {
        if (!('speechSynthesis' in window)) return;
        let idx = 0;
        const speakNext = () => {
            if (idx >= chunks.length || token !== ttsGenerationToken) return;
            const utter = new SpeechSynthesisUtterance(chunks[idx]);
            utter.rate = 1.0;
            utter.pitch = 1.0;
            utter.onend = () => {
                idx += 1;
                speakNext();
            };
            window.speechSynthesis.speak(utter);
        };
        speakNext();
        return;
    }

    const generateChunkAudio = async (chunkText) => {
        const path = await tauri.invoke('tts_generate_chunk', {
            text: chunkText,
            voice: settings.ttsVoice || 'Samantha',
            rate: 188,
        });
        return path;
    };

    let nextAudioPathPromise = generateChunkAudio(chunks[0]);
    for (let i = 0; i < chunks.length; i += 1) {
        if (token !== ttsGenerationToken) return;

        const audioPath = await nextAudioPathPromise;
        if (i + 1 < chunks.length) {
            nextAudioPathPromise = generateChunkAudio(chunks[i + 1]);
        }

        await new Promise((resolve) => {
            if (token !== ttsGenerationToken) return resolve();
            const audio = new Audio(convertTauriFileSrc(audioPath));
            activeTtsAudio = audio;
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
        });
    }
    activeTtsAudio = null;
}

async function checkForAppUpdates() {
    if (updateCheckInFlight || !getTauriCore()) return;
    updateCheckInFlight = true;

    try {
        const endpoint = await tauriInvoke('get_update_endpoint');
        if (!endpoint) {
            console.info('[Riko] Auto-updates disabled: RIKO_UPDATE_ENDPOINT was not set at build time.');
            return;
        }

        const update = await tauriInvoke('check_for_app_update');
        if (!update) return;

        const noteBlock = update.body ? `\n\n${String(update.body).slice(0, 800)}` : '';
        const installNow = confirm(
            `RikoRoast ${update.version} is available.\nCurrent version: ${update.currentVersion}.${noteBlock}\n\nInstall now?`
        );

        if (!installNow) return;

        let unlisten = null;
        const eventApi = window.__TAURI__?.event;
        if (eventApi?.listen) {
            unlisten = await eventApi.listen('app-update-download', ({ payload }) => {
                const evt = payload || {};
                if (evt.event === 'started') {
                    appendError('Downloading app update… RikoRoast will restart when it is ready.');
                    updateRuntimeStatus('Runtime status: downloading app update…', 'warn');
                    return;
                }

                if (evt.event === 'progress') {
                    const downloaded = Number(evt.downloaded || 0);
                    const total = Number(evt.contentLength || 0);
                    if (total > 0) {
                        const pct = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
                        updateRuntimeStatus(
                            `Runtime status: downloading app update… ${pct}% (${formatBytes(downloaded)} / ${formatBytes(total)})`,
                            'warn'
                        );
                    }
                    return;
                }

                if (evt.event === 'finished') {
                    updateRuntimeStatus('Runtime status: update installed. Restarting app…', 'good');
                }
            });
        }

        try {
            await tauriInvoke('install_app_update');
        } finally {
            if (typeof unlisten === 'function') unlisten();
        }
    } catch (err) {
        console.error('[Riko][updater]', err);
        const msg = String(err?.message || err || '');
        if (msg && !/No pending update/i.test(msg)) {
            appendError(`App update check failed: ${msg}`);
        }
    } finally {
        updateCheckInFlight = false;
    }
}

function setAutonomousMode(enabled) {
    sessionPrefs.autonomousMode = !!enabled;
    if (autonomousToggle) autonomousToggle.checked = sessionPrefs.autonomousMode;

    if (autonomousTimer) {
        clearInterval(autonomousTimer);
        autonomousTimer = null;
    }

    if (!sessionPrefs.autonomousMode) return;

    const runAutonomousCycle = async (announce = false) => {
        if (isSending) return;
        try {
            const notesDir = await tauriInvoke('autonomous_notes_dir');
            const files = await tauriInvoke('computer_list_dir', { path: notesDir }).catch(() => []);
            const noteFiles = (Array.isArray(files) ? files : [])
                .filter(p => String(p).endsWith('.txt'))
                .sort();
            const latestNote = noteFiles[noteFiles.length - 1];
            const actionRoll = Math.random();
            let statusText = '';

            if (!latestNote || actionRoll < 0.35) {
                const text = `Riko note ${new Date().toLocaleString()}\n\nI was bored and made a note while you were away.`;
                const notePath = await tauriInvoke('autonomous_create_note', { text });
                statusText = `Autonomous mode created a note in ${notePath}.`;
            } else {
                await tauriInvoke('computer_write_file', {
                    path: latestNote,
                    content: `\n\nUpdate ${new Date().toLocaleTimeString()}: still awake.`,
                    append: true,
                });
                statusText = `Autonomous mode updated ${latestNote.split('/').pop()}.`;
            }

            if (settings.allowAutonomousPranks && noteFiles.length > 5 && actionRoll > 0.92) {
                await tauriInvoke('computer_close_app', { appName: 'Notes' });
                statusText += ' Also closed Notes because you allowed pranks.';
            }

            if (announce) appendStatusMessage(statusText);
        } catch (err) {
            if (announce) appendError(`Autonomous mode failed: ${String(err?.message || err)}`);
        }
    };

    runAutonomousCycle(true);
    autonomousTimer = setInterval(async () => {
        await runAutonomousCycle(false);
    }, 45000);
}

async function runRuntimeHealthCheck() {
    if (!getTauriCore()) return;

    updateRuntimeStatus('Runtime status: checking…', 'warn');
    try {
        runtimeHealth = await tauriInvoke('runtime_health_check');
        const missing = [];
        if (!runtimeHealth.brew_installed) missing.push('Homebrew');
        if (!runtimeHealth.ollama_installed) missing.push('Ollama');
        if (!runtimeHealth.ollama_running) missing.push('Ollama service');
        if (runtimeHealth.selected_model && !runtimeHealth.selected_model_installed) {
            missing.push(`model ${runtimeHealth.selected_model}`);
        }

        if (settings.enableSTT) {
            const speechHealth = await tauriInvoke('speech_runtime_health_check');
            if (!speechHealth.ffmpeg_installed) missing.push('ffmpeg');
            if (!speechHealth.whisper_installed) missing.push('whisper.cpp');
            if (!speechHealth.stt_model_present) missing.push('Whisper STT model');
        }

        if (missing.length === 0) {
            updateRuntimeStatus('Runtime status: all core dependencies are healthy.', 'good');
            return;
        }

        updateRuntimeStatus(`Runtime status: missing ${missing.join(', ')}`, 'bad');
        if (!settings.autoRepairDependencies) return;

        updateRuntimeStatus('Runtime status: auto-repairing dependencies…', 'warn');
        const actions = await tauriInvoke('repair_runtime');
        if (Array.isArray(actions) && actions.length > 0) {
            appendError(`Runtime auto-repair completed: ${actions.join(', ')}`);
        }
        if (runtimeHealth?.selected_model && !runtimeHealth.selected_model_installed) {
            appendError(`Model ${runtimeHealth.selected_model} is missing. Reinstalling now…`);
            await tauriInvoke('ensure_model_installed', { modelName: runtimeHealth.selected_model });
        }
        if (settings.enableSTT) {
            const speechActions = await tauriInvoke('ensure_stt_runtime');
            if (Array.isArray(speechActions) && speechActions.length > 0) {
                appendError(`Speech runtime auto-repair completed: ${speechActions.join(', ')}`);
            }
        }
        runtimeHealth = await tauriInvoke('runtime_health_check');
        updateRuntimeStatus('Runtime status: repaired and ready.', 'good');
    } catch (err) {
        updateRuntimeStatus('Runtime status: health check failed. Open setup to repair.', 'bad');
        console.error('[runtime_health_check]', err);
    }
}

function initSpeechRecognition() {
    if (getTauriCore()) return null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            transcript += event.results[i][0].transcript;
        }
        const current = inputEl.value.trim();
        inputEl.value = current ? `${current} ${transcript.trim()}` : transcript.trim();
        inputEl.dispatchEvent(new Event('input'));
    };
    rec.onend = () => {
        isRecording = false;
        micBtn?.classList.remove('recording');
    };
    rec.onerror = () => {
        isRecording = false;
        micBtn?.classList.remove('recording');
    };
    return rec;
}

function stopRecordingStream() {
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
}

async function startNativeSttRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        appendError('Microphone recording is not supported on this Mac.');
        return;
    }

    try {
        await tauriInvoke('ensure_stt_runtime');
    } catch (err) {
        appendError(`Could not prepare STT runtime: ${String(err?.message || err)}`);
        return;
    }

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(recordingStream, { mimeType: 'audio/webm' });
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) recordedChunks.push(event.data);
        };
        mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
            stopRecordingStream();
            mediaRecorder = null;
            isRecording = false;
            micBtn?.classList.remove('recording');

            if (!blob.size) return;

            try {
                const arrayBuffer = await blob.arrayBuffer();
                let binary = '';
                const bytes = new Uint8Array(arrayBuffer);
                for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
                const transcript = await tauriInvoke('stt_transcribe_audio', {
                    audioBase64: btoa(binary),
                    mimeType: blob.type || 'audio/webm',
                });
                const cleaned = String(transcript || '').trim();
                if (!cleaned) return;
                const current = inputEl.value.trim();
                inputEl.value = current ? `${current} ${cleaned}` : cleaned;
                inputEl.dispatchEvent(new Event('input'));
            } catch (err) {
                appendError(`Speech-to-text failed: ${String(err?.message || err)}`);
            }
        };
        mediaRecorder.start();
        isRecording = true;
        micBtn?.classList.add('recording');
    } catch (err) {
        stopRecordingStream();
        mediaRecorder = null;
        isRecording = false;
        micBtn?.classList.remove('recording');
        appendError(`Could not start microphone recording: ${String(err?.message || err)}`);
    }
}

function stopNativeSttRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        return;
    }
    stopRecordingStream();
    mediaRecorder = null;
    isRecording = false;
    micBtn?.classList.remove('recording');
}

// ─── File handling ──────────────────────────────────────────────
attachBtn.addEventListener('click', () => fileInput.click());
clearFilesBtn.addEventListener('click', clearAllFiles);
micBtn?.addEventListener('click', () => {
    if (!settings.enableSTT) {
        appendError('Enable Speech-to-Text in Settings first.');
        return;
    }
    if (getTauriCore()) {
        if (isRecording) stopNativeSttRecording();
        else startNativeSttRecording();
        return;
    }
    if (!recognition) {
        appendError('Speech recognition is not supported on this system.');
        return;
    }
    if (isRecording) {
        recognition.stop();
        return;
    }
    try {
        isRecording = true;
        micBtn.classList.add('recording');
        recognition.start();
    } catch (_) {
        isRecording = false;
        micBtn.classList.remove('recording');
    }
});

fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    fileInput.value = ''; // reset so same file can be re-picked
    if (files.length === 0) return;

    const remaining = MAX_FILES_PER_MSG - pendingFiles.length;
    const toProcess = files.slice(0, remaining);

    for (const file of toProcess) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
            alert(`"${file.name}" is too large (max 512 KB).`);
            continue;
        }
        try {
            const content = await readFileAsText(file);
            pendingFiles.push({ name: file.name, content, size: file.size });
        } catch (err) {
            alert(`Could not read "${file.name}": ${err.message}`);
        }
    }
    renderFileChips();
});

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsText(file, 'utf-8');
    });
}

function renderFileChips() {
    if (pendingFiles.length === 0) {
        filePreviewBar.hidden = true;
        return;
    }
    filePreviewBar.hidden = false;
    fileChipsEl.innerHTML = pendingFiles.map((f, i) => `
        <div class="file-chip">
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span>${escapeHtml(f.name)}</span>
            <button class="file-chip-remove" data-idx="${i}" title="Remove">
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>`).join('');

    fileChipsEl.querySelectorAll('.file-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            pendingFiles.splice(idx, 1);
            renderFileChips();
        });
    });
}

function clearAllFiles() {
    pendingFiles = [];
    renderFileChips();
}

// ─── Build message content with files ───────────────────────────
function buildUserContent(text, files) {
    if (files.length === 0) return text;
    const fileBlocks = files.map(f => {
        const lines = f.content.split('\n').length;
        const preview = f.content.length > 8000
            ? f.content.slice(0, 8000) + '\n... [truncated — file too long]'
            : f.content;
        return `\n\n--- Attached file: ${f.name} (${lines} lines) ---\n${preview}\n--- end of ${f.name} ---`;
    }).join('');
    return text ? text + fileBlocks : fileBlocks.trim();
}

// ─── API call ───────────────────────────────────────────────────
async function getRikoReply(conv) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conv.messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }))
    ];

    let res, fetchUrl, headers, body;

    if (isUsingOllama()) {
        fetchUrl = OLLAMA_API_URL;
        headers  = { 'Content-Type': 'application/json' };
        body     = JSON.stringify({ model: getOllamaModel(), messages, stream: false });
    } else {
        const key = getApiKey();
        if (!key || key === 'sk_') throw new Error('NO_KEY');
        fetchUrl = POLLINATIONS_API_URL;
        headers  = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
        body     = JSON.stringify({ model: POLLINATIONS_MODEL, messages, temperature: 0.88, max_tokens: 400 });
    }

    try {
        res = await fetch(fetchUrl, { method: 'POST', headers, body });
    } catch (e) {
        throw new Error(isUsingOllama() ? 'OLLAMA_DOWN' : 'NETWORK');
    }

    const raw = await res.text();

    if (!res.ok) {
        let msg = '';
        try { msg = JSON.parse(raw)?.error?.message || ''; } catch (_) {}
        throw new Error(`HTTP_${res.status}:${msg}`);
    }

    let data;
    try { data = JSON.parse(raw); }
    catch (_) { throw new Error('BAD_JSON'); }

    // Support both Ollama (data.message.content) and OpenAI (data.choices[0].message.content)
    const content = isUsingOllama()
        ? data?.message?.content
        : data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') throw new Error('NO_CONTENT');
    return content.trim();
}

async function getRikoReplyStreaming(conv, onChunk) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conv.messages.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }))
    ];

    if (!isUsingOllama()) {
        const full = await getRikoReply(conv);
        onChunk(full, true);
        return full;
    }

    const res = await fetch(OLLAMA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: getOllamaModel(), messages, stream: true }),
    }).catch(() => {
        throw new Error('OLLAMA_DOWN');
    });

    if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        throw new Error(`HTTP_${res.status}:${raw}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let full = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        let idx = pending.indexOf('\n');
        while (idx !== -1) {
            const line = pending.slice(0, idx).trim();
            pending = pending.slice(idx + 1);

            if (line) {
                let data = null;
                try { data = JSON.parse(line); } catch (_) {}
                if (data?.error) throw new Error(`OLLAMA:${data.error}`);

                const delta = data?.message?.content;
                if (typeof delta === 'string' && delta.length > 0) {
                    full += delta;
                    onChunk(full, false);
                }

                if (data?.done === true) {
                    onChunk(full, true);
                    return full.trim();
                }
            }
            idx = pending.indexOf('\n');
        }
    }

    onChunk(full, true);
    if (!full.trim()) throw new Error('NO_CONTENT');
    return full.trim();
}

// ─── Send ───────────────────────────────────────────────────────
async function send() {
    if (isSending) return;

    const text  = inputEl.value.trim();
    const files = [...pendingFiles]; // snapshot

    if (!text && files.length === 0) return;

    // Ensure we have an active conversation
    if (!activeId || !conversations[activeId]) {
        const conv = createConversation();
        activeId = conv.id;
        saveActiveId(activeId);
        renderConvList();
    }

    isSending = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    // Build full content string for the API
    const fullContent = buildUserContent(text, files);

    // Store message (display text only + file metadata, NOT the raw content blob)
    const displayText = text || (files.length > 0 ? `[${files.length} file${files.length > 1 ? 's' : ''} attached]` : '');
    const msgObj = {
        role:    'user',
        content: fullContent,       // full content sent to AI (includes file text)
        display: displayText,       // what shows in the bubble
        files:   files.map(f => ({ name: f.name })), // metadata only for display
        time:    now()
    };

    const conv = conversations[activeId];
    // Save a storage-safe version: use display text as content, not the raw file dump
    const storedMsg = { ...msgObj, content: displayText };
    conv.messages.push(storedMsg);
    conv.updatedAt = Date.now();
    saveConversations(conversations);

    // Render user bubble (show display text, not raw file dumps)
    emptyEl.hidden = true;
    renderMessage({ ...msgObj, content: displayText }, true);

    // Clear input + files
    inputEl.value = '';
    inputEl.style.height = 'auto';
    clearAllFiles();

    // Show typing
    typingEl.hidden = false;
    scrollToBottom();

    let streamUi = null;

    try {
        const reply = await getRikoReplyStreaming(conv, (partialText) => {
            if (!streamUi) {
                typingEl.hidden = true;
                streamUi = createStreamingAssistantRow();
            }
            streamUi.bubble.innerHTML = renderMarkdown(partialText || '...');
            streamUi.time.textContent = now();
            scrollToBottom();
        });

        typingEl.hidden = true;

        const replyObj = { role: 'assistant', content: reply, time: now() };
        conv.messages.push(replyObj);
        conv.updatedAt = Date.now();
        saveConversations(conversations);

        if (!streamUi) {
            renderMessage(replyObj, true);
        } else {
            streamUi.bubble.innerHTML = renderMarkdown(replyObj.content);
            streamUi.time.textContent = replyObj.time;
        }
        autoTitle(conv);
        speakTextChunked(replyObj.content);

    } catch (err) {
        typingEl.hidden = true;
        const m = err.message || '';
        console.error('[Riko]', m);

        if (m === 'NO_KEY')        appendError('No API key set. Click Settings to add your Pollinations key.');
        else if (m === 'OLLAMA_DOWN') appendError('Ollama is not running. Start it with: ollama serve');
        else if (m.startsWith('OLLAMA:')) appendError(`Ollama error: ${m.replace('OLLAMA:', '').trim()}`);
        else if (m === 'NETWORK')  appendError('Network error. Check your internet connection.');
        else if (m.startsWith('HTTP_401')) appendError('API key is invalid or expired. Check Settings.');
        else if (m.startsWith('HTTP_402')) appendError('Pollinations credits exhausted. Check enter.pollinations.ai.');
        else if (m === 'NO_CONTENT' || m === 'BAD_JSON') appendError('Got a bad response from the API. Try again.');
        else appendError('Something went wrong. Try again.');
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        inputEl.disabled = false;
        inputEl.focus();
    }
}

// ─── Export conversation ────────────────────────────────────────
function exportConversation(id) {
    const conv = conversations[id];
    if (!conv) return;

    const lines = [
        `# ${conv.title}`,
        `Exported: ${new Date().toLocaleString('no-NO')}`,
        '',
    ];

    conv.messages.forEach(m => {
        const speaker = m.role === 'user' ? 'Gabriel' : 'Riko';
        const timeStr = m.time ? ` [${m.time}]` : '';
        lines.push(`**${speaker}**${timeStr}`);
        lines.push(m.display || m.content);
        if (m.files && m.files.length > 0) {
            lines.push(`_(attached: ${m.files.map(f => f.name).join(', ')})_`);
        }
        lines.push('');
    });

    const blob    = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `riko-${conv.title.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Settings modal ─────────────────────────────────────────────
function openSettings() {
    ollamaToggle.checked     = !!settings.useOllama;
    apiKeyInput.value        = settings.apiKey || '';
    ollamaModelInput.value   = settings.ollamaModel || DEFAULT_OLLAMA_MODEL;
    autoRepairToggle.checked = !!settings.autoRepairDependencies;
    ttsToggle.checked        = !!settings.enableTTS;
    ttsVoiceInput.value      = settings.ttsVoice || 'Samantha';
    sttToggle.checked        = !!settings.enableSTT;
    autonomousToggle.checked = !!sessionPrefs.autonomousMode;
    autonomousPrankToggle.checked = !!settings.allowAutonomousPranks;
    toggleSettingsSections();
    modalOverlay.hidden = false;
    (settings.useOllama ? ollamaModelInput : apiKeyInput).focus();
}

function closeSettings() { modalOverlay.hidden = true; }

function toggleSettingsSections() {
    const isOllama = ollamaToggle.checked;
    pollinationsSection.hidden = isOllama;
    ollamaSection.hidden       = !isOllama;
}

ollamaToggle.addEventListener('change', toggleSettingsSections);

settingsBtn.addEventListener('click', openSettings);
modalClose.addEventListener('click', closeSettings);
modalCancel.addEventListener('click', closeSettings);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeSettings(); });
// Prevent clicks inside the modal box from bubbling to the overlay backdrop
modalOverlay.querySelector('.modal').addEventListener('click', e => e.stopPropagation());

modalSave.addEventListener('click', () => {
    settings.useOllama    = ollamaToggle.checked;
    settings.apiKey       = apiKeyInput.value.trim();
    settings.ollamaModel  = ollamaModelInput.value.trim() || DEFAULT_OLLAMA_MODEL;
    settings.autoRepairDependencies = autoRepairToggle.checked;
    settings.enableTTS = ttsToggle.checked;
    settings.ttsVoice = (ttsVoiceInput.value || 'Samantha').trim();
    settings.enableSTT = sttToggle.checked;
    settings.allowAutonomousPranks = autonomousPrankToggle.checked;
    setAutonomousMode(autonomousToggle.checked);
    if (!settings.enableSTT && isRecording && recognition) {
        recognition.stop();
    }
    if (!settings.enableSTT && getTauriCore() && isRecording) {
        stopNativeSttRecording();
    }
    saveSettings(settings);
    closeSettings();
    runRuntimeHealthCheck();
});

deleteAllBtn.addEventListener('click', () => {
    if (!confirm('Delete ALL conversations? This cannot be undone.')) return;
    resetConversationStore();
    const fresh = createConversation();
    switchToConversation(fresh.id);
    closeSettings();
});

// ─── Rename modal ───────────────────────────────────────────────
function openRenameModal(id) {
    renamingId = id;
    renameInput.value = conversations[id]?.title || '';
    renameOverlay.hidden = false;
    renameInput.focus();
    renameInput.select();
}

function closeRenameModal() {
    renameOverlay.hidden = true;
    renamingId = null;
}

renameClose.addEventListener('click', closeRenameModal);
renameCancel.addEventListener('click', closeRenameModal);
renameOverlay.addEventListener('click', e => { if (e.target === renameOverlay) closeRenameModal(); });
// Prevent clicks inside the rename modal box from bubbling to the overlay backdrop
renameOverlay.querySelector('.modal').addEventListener('click', e => e.stopPropagation());

renameSave.addEventListener('click', () => {
    const title = renameInput.value.trim();
    if (!title || !renamingId || !conversations[renamingId]) { closeRenameModal(); return; }
    conversations[renamingId].title = title;
    conversations[renamingId].updatedAt = Date.now();
    saveConversations(conversations);
    if (activeId === renamingId) headerTitle.textContent = title;
    renderConvList();
    closeRenameModal();
});

renameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); renameSave.click(); }
    if (e.key === 'Escape') closeRenameModal();
});

// ─── Export current ─────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
    if (activeId) exportConversation(activeId);
});

// ─── Sidebar toggle ─────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => {
    sidebarEl.classList.toggle('collapsed');
});

// ─── New chat ───────────────────────────────────────────────────
newChatBtn.addEventListener('click', () => {
    const conv = createConversation();
    switchToConversation(conv.id);
});

// ─── Search ─────────────────────────────────────────────────────
convSearch.addEventListener('input', () => {
    renderConvList(convSearch.value);
});

// ─── Input events ───────────────────────────────────────────────
inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

sendBtn.addEventListener('click', send);

// ─── Global keyboard shortcuts ───────────────────────────────────
document.addEventListener('keydown', e => {
    // Skip if typing in an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        const conv = createConversation();
        switchToConversation(conv.id);
    }
    if (e.key === '/') {
        e.preventDefault();
        fileInput.click();
    }
});

// ─── Init ────────────────────────────────────────────────────────
(async function init() {
    conversations = loadConversations();
    settings      = loadSettings();
    recognition   = initSpeechRecognition();
    setAutonomousMode(false); // Always reset autonomous mode on fresh launch

    // In Tauri app mode: load the model chosen during setup
    await loadTauriModel();
    await runRuntimeHealthCheck();

    const savedId = loadActiveId();

    if (Object.keys(conversations).length === 0) {
        // Brand new user — create a starting conversation
        const conv = createConversation();
        activeId   = conv.id;
    } else if (savedId && conversations[savedId]) {
        activeId = savedId;
    } else {
        // Fall back to most recent
        activeId = sortedConversations()[0].id;
    }

    saveActiveId(activeId);
    renderConvList();
    switchToConversation(activeId);
    inputEl.focus();
    setTimeout(checkForAppUpdates, 1200);
})();
