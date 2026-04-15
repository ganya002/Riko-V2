// ─────────────────────────────────────────────────────────────────
//  RikoRoast — setup.js  (Tauri 2 compatible)
// ─────────────────────────────────────────────────────────────────

// Tauri 2 exposes its API differently from Tauri 1.
// invoke  → window.__TAURI__.core.invoke
// listen  → window.__TAURI__.event.listen
// We wrap them here so the rest of the code stays clean.

function getTauriBridge() {
    const tauri = window.__TAURI__;
    if (tauri?.core && tauri?.event) return tauri;
    return null;
}

async function invoke(cmd, args) {
    const tauri = getTauriBridge();
    if (!tauri) {
        throw new Error('Tauri API unavailable. Rebuild and launch the desktop app.');
    }
    try {
        return await tauri.core.invoke(cmd, args || {});
    } catch (e) {
        console.error(`[invoke] ${cmd} failed:`, e);
        throw e;
    }
}

async function listen(eventName, handler) {
    const tauri = getTauriBridge();
    if (!tauri) {
        throw new Error('Tauri event API unavailable. Rebuild and launch the desktop app.');
    }
    return await tauri.event.listen(eventName, handler);
}

// ── Screens ───────────────────────────────────────────────────────
const screens = {
    welcome:    document.getElementById('screen-welcome'),
    installing: document.getElementById('screen-installing'),
    model:      document.getElementById('screen-model'),
    download:   document.getElementById('screen-download'),
    done:       document.getElementById('screen-done'),
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    const el = screens[name];
    if (!el) { console.error('Unknown screen:', name); return; }
    el.classList.add('active');
    // Retrigger animation
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
}

// ── Step UI helpers ───────────────────────────────────────────────
const STEP_IDS = ['brew_check', 'brew_install', 'ollama_check', 'ollama_install', 'ollama_serve'];

function setStepState(stepId, state, desc) {
    const el = document.getElementById(`step-${stepId}`);
    if (!el) return;
    el.hidden = false;

    const iconEl = el.querySelector('.step-icon');
    const descEl = el.querySelector('.step-desc');

    iconEl.className = `step-icon ${state}`;

    const icons = {
        pending: `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg>`,
        running: `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16 8 8 0 01-8-8z"/></svg>`,
        done:    `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`,
        error:   `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
    };

    iconEl.innerHTML = icons[state] || icons.pending;
    if (desc && descEl) descEl.textContent = desc;
}

// ── DOM refs ──────────────────────────────────────────────────────
const passwordNotice = document.getElementById('password-notice');
const installError   = document.getElementById('install-error');
const installErrMsg  = document.getElementById('install-error-msg');

// ── Setup event listener ──────────────────────────────────────────
let setupUnlisten = null;

async function listenToSetupEvents() {
    // Clean up previous listener if any
    if (setupUnlisten) { setupUnlisten(); setupUnlisten = null; }

    setupUnlisten = await listen('setup-step', ({ payload }) => {
        const { step, status, message } = payload;
        console.log('[setup-step]', step, status, message);

        if (step === 'pipeline_done') {
            setTimeout(goToModelScreen, 600);
            return;
        }

        setStepState(step, status, message);

        if (status === 'needs_password') {
            passwordNotice.hidden = false;
        } else if (status !== 'running') {
            // Only hide password notice once we move past that state
            passwordNotice.hidden = true;
        }

        if (status === 'error') {
            installErrMsg.textContent = message;
            installError.hidden = false;
        }
    });
}

// ── Model screen ──────────────────────────────────────────────────
let selectedModelId = null;

async function goToModelScreen() {
    showScreen('model');

    let models = [], rec = null;

    try {
        models = await invoke('list_models');
    } catch (e) {
        console.error('list_models failed:', e);
        models = [];
    }

    try {
        rec = await invoke('get_model_recommendation');
    } catch (e) {
        console.error('get_model_recommendation failed:', e);
        // Fallback if hardware detection fails
        rec = {
            model_id: 'dolphin3:8b',
            display_name: 'Dolphin 3 · 8B',
            reason: 'The recommended model for most Macs.',
            size_gb: 4.9,
        };
    }

    const recCard   = document.getElementById('recommendation-card');
    const modelList = document.getElementById('model-list');
    const useRecBtn = document.getElementById('use-recommended-btn');
    const useSelBtn = document.getElementById('use-selected-btn');
    const modelSub  = document.getElementById('model-sub');

    document.getElementById('rec-model-name').textContent = rec.display_name;
    document.getElementById('rec-reason').textContent     = rec.reason;
    document.getElementById('rec-size').textContent       = `~${rec.size_gb.toFixed(1)} GB download`;

    if (models.length === 0) {
        recCard.hidden   = false;
        useRecBtn.hidden = false;
        modelSub.textContent = 'No AI models found. We recommend the one below for your Mac.';

        // Remove old listeners before adding new one
        const newBtn = useRecBtn.cloneNode(true);
        useRecBtn.parentNode.replaceChild(newBtn, useRecBtn);
        newBtn.addEventListener('click', () => startDownload(rec.model_id, rec.display_name));
    } else {
        modelSub.textContent = 'Pick a model — or download the recommended one.';
        modelList.hidden     = false;
        useSelBtn.hidden     = false;

        const recInstalled = models.some(m => m.name === rec.model_id);

        if (!recInstalled) {
            recCard.hidden   = false;
            useRecBtn.hidden = false;
            useRecBtn.textContent = 'Download recommended';
            const newBtn = useRecBtn.cloneNode(true);
            useRecBtn.parentNode.replaceChild(newBtn, useRecBtn);
            newBtn.addEventListener('click', () => startDownload(rec.model_id, rec.display_name));
        }

        modelList.innerHTML = '';
        models.forEach((m, i) => {
            const item = document.createElement('div');
            item.className = 'model-item' + (i === 0 ? ' selected' : '');
            if (i === 0) selectedModelId = m.name;

            item.innerHTML = `
                <div class="model-radio"><div class="model-radio-dot"></div></div>
                <div class="model-info">
                    <div class="model-name">${m.name}</div>
                    <div class="model-size">${m.size_gb > 0 ? m.size_gb.toFixed(1) + ' GB' : 'Installed'}</div>
                </div>`;

            item.addEventListener('click', () => {
                document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                selectedModelId = m.name;
            });

            modelList.appendChild(item);
        });

        const newSelBtn = useSelBtn.cloneNode(true);
        useSelBtn.parentNode.replaceChild(newSelBtn, useSelBtn);
        newSelBtn.addEventListener('click', async () => {
            if (!selectedModelId) return;
            await invoke('save_model', { modelName: selectedModelId });
            await invoke('mark_setup_complete');
            showScreen('done');
        });
    }
}

// ── Download screen ───────────────────────────────────────────────
async function startDownload(modelId, displayName) {
    showScreen('download');
    document.getElementById('dl-model-name').textContent = displayName;

    const progressFill   = document.getElementById('progress-fill');
    const progressPct    = document.getElementById('progress-pct');
    const progressSize   = document.getElementById('progress-size');
    const progressEta    = document.getElementById('progress-eta');
    const progressStatus = document.getElementById('progress-status');

    const unlisten = await listen('pull-progress', ({ payload }) => {
        const { status, percent, downloaded_gb, total_gb, eta_seconds } = payload;

        progressFill.style.width = `${percent}%`;
        progressPct.textContent  = `${Math.round(percent)}%`;

        if (status === 'downloading') {
            progressStatus.textContent = 'Downloading…';
            if (total_gb > 0) {
                progressSize.textContent = `${downloaded_gb.toFixed(2)} GB / ${total_gb.toFixed(2)} GB`;
            } else if (downloaded_gb > 0) {
                progressSize.textContent = `${downloaded_gb.toFixed(2)} GB downloaded`;
            }
            if (eta_seconds != null) {
                progressEta.textContent = formatEta(eta_seconds);
            } else {
                progressEta.textContent = 'Estimating…';
            }
        } else if (status === 'verifying') {
            progressStatus.textContent = 'Verifying download…';
            progressEta.textContent    = 'Almost done…';
        } else if (status === 'starting') {
            progressStatus.textContent = 'Connecting to Ollama…';
            progressSize.textContent   = 'Preparing download…';
            progressEta.textContent    = 'Estimating…';
        } else if (status === 'done') {
            progressFill.style.width   = '100%';
            progressPct.textContent    = '100%';
            progressStatus.textContent = 'Download complete!';
            progressEta.textContent    = '';
            unlisten();
            setTimeout(async () => {
                await invoke('save_model', { modelName: modelId });
                await invoke('mark_setup_complete');
                showScreen('done');
            }, 800);
        } else if (status === 'error') {
            progressStatus.textContent = 'Download failed. Close the app and try again.';
            unlisten();
        }
    });

    try {
        await invoke('pull_model', { modelName: modelId });
    } catch (e) {
        progressStatus.textContent = `Error: ${e}`;
        console.error('pull_model error:', e);
    }
}

function formatEta(seconds) {
    if (seconds <= 0)  return 'Done';
    if (seconds < 60)  return `${seconds}s remaining`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s remaining` : `${m}m remaining`;
}

// ── Button wiring ─────────────────────────────────────────────────
document.getElementById('launch-btn').addEventListener('click', async () => {
    await invoke('launch_chat');
});

document.getElementById('start-btn').addEventListener('click', async () => {
    console.log('[setup] Start button clicked');
    showScreen('installing');

    // Reset step states — hide optional ones
    STEP_IDS.forEach(id => {
        setStepState(id, 'pending', '');
        if (id === 'brew_install' || id === 'ollama_install') {
            const el = document.getElementById(`step-${id}`);
            if (el) el.hidden = true;
        }
    });

    passwordNotice.hidden = true;
    installError.hidden   = true;

    // Start listening for backend events BEFORE invoking
    await listenToSetupEvents();

    try {
        // Check if already fully set up
        const isComplete = await invoke('is_setup_complete');
        if (isComplete) {
            console.log('[setup] Already complete — checking ollama…');
            const isRunning = await invoke('check_ollama_running');
            if (!isRunning) await invoke('start_ollama');
            await goToModelScreen();
            return;
        }

        // Run the full pipeline
        console.log('[setup] Running setup pipeline…');
        await invoke('run_setup');
        // pipeline_done event triggers goToModelScreen via the listener
    } catch (e) {
        console.error('[setup] run_setup error:', e);
        installErrMsg.textContent = String(e);
        installError.hidden = false;
    }
});

document.getElementById('retry-btn').addEventListener('click', async () => {
    installError.hidden   = true;
    passwordNotice.hidden = true;
    STEP_IDS.forEach(id => setStepState(id, 'pending', ''));
    await listenToSetupEvents();
    try {
        await invoke('run_setup');
    } catch (e) {
        installErrMsg.textContent = String(e);
        installError.hidden = false;
    }
});

// ── Init — verify Tauri API is available ──────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    if (!getTauriBridge()) {
        console.error('[setup] Tauri API not found on window.__TAURI__.core');
        const startBtn = document.getElementById('start-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Desktop bridge unavailable';
        }
        // Show a visible error so it's obvious in dev
        document.body.innerHTML += `
            <div style="position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
                background:#f87171;color:#111;padding:10px 18px;border-radius:8px;
                font-size:13px;font-family:monospace;z-index:9999">
                Tauri API not found — rebuild the app
            </div>`;
    } else {
        console.log('[setup] Tauri API ready ✓');
    }
});
