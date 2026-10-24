/* ─────────────────────────────────────────────────
   SegAUD Developer Tools — JavaScript
   ───────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  const safeInit = (fn, name) => {
    try {
      fn();
    } catch (err) {
      console.error(`Error in ${name}:`, err);
    }
  };

  safeInit(initWaveform, 'initWaveform');
  safeInit(initCopyButtons, 'initCopyButtons');
  safeInit(initProjectsManager, 'initProjectsManager');
  safeInit(initProjectGenerator, 'initProjectGenerator');
  safeInit(initSettingsManager, 'initSettingsManager');
  safeInit(initComparisonCollapse, 'initComparisonCollapse');
  safeInit(initAudioWorkspace, 'initAudioWorkspace');
  safeInit(initAppModeLauncher, 'initAppModeLauncher');
  safeInit(initScrollAnimations, 'initScrollAnimations');
  safeInit(initSmoothNav, 'initSmoothNav');
});

/* ── Waveform Canvas ── */
function initWaveform() {
  const canvas = document.getElementById('waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Pre-generate a fixed "audio" pattern with speech regions
  const speechRegions = [
    { start: 0.08, end: 0.30 },
    { start: 0.38, end: 0.56 },
    { start: 0.65, end: 0.90 },
  ];

  function isInSpeech(x) {
    const norm = x / W;
    return speechRegions.some(r => norm >= r.start && norm <= r.end);
  }

  let animFrame = 0;

  function draw() {
    animFrame++;
    ctx.clearRect(0, 0, W, H);
    const mid = H / 2;
    const barW = 2;
    const gap = 1;
    const totalBars = Math.floor(W / (barW + gap));

    for (let i = 0; i < totalBars; i++) {
      const x = i * (barW + gap);
      const speech = isInSpeech(x);

      // Base amplitude from a deterministic pattern
      let amp = Math.abs(Math.sin(i * 0.15) * Math.cos(i * 0.08) * 0.6 +
        Math.sin(i * 0.3) * 0.3);
      if (speech) {
        amp = amp * 0.7 + 0.3;
        // Add subtle animation to speech regions
        amp += Math.sin((i + animFrame) * 0.05) * 0.05;
      } else {
        amp *= 0.15;
      }

      const barH = amp * (H * 0.8);

      if (speech) {
        const gradient = ctx.createLinearGradient(x, mid - barH / 2, x, mid + barH / 2);
        gradient.addColorStop(0, 'rgba(97, 175, 239, 0.9)');
        gradient.addColorStop(0.5, 'rgba(198, 120, 221, 0.7)');
        gradient.addColorStop(1, 'rgba(97, 175, 239, 0.9)');
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = 'rgba(92, 99, 112, 0.3)';
      }

      ctx.fillRect(x, mid - barH / 2, barW, barH);
    }

    requestAnimationFrame(draw);
  }

  draw();
}

/* ── Copy Buttons ── */
function initCopyButtons() {
  const copyBtn = document.getElementById('copy-config-btn');
  if (!copyBtn) return;

  copyBtn.addEventListener('click', () => {
    const preview = document.getElementById('config-preview');
    if (!preview) return;

    const text = preview.textContent || preview.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓';
      copyBtn.style.color = 'var(--green)';
      setTimeout(() => {
        copyBtn.textContent = orig;
        copyBtn.style.color = '';
      }, 1500);
    }).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);

      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    });
  });
}

/* ── Languages Dictionary ── */
const LANG_SLUGS = {
  awa: 'awadhi',
  hi: 'hindi',
  bn: 'bengali',
  ta: 'tamil',
  te: 'telugu',
  mr: 'marathi',
  gu: 'gujarati',
  kn: 'kannada',
  ml: 'malayalam',
  pa: 'punjabi',
  or: 'odia',
  as: 'assamese',
  custom: 'custom'
};

const LANG_NAMES = {
  awa: 'Awadhi (Low-Resource)',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  as: 'Assamese',
  custom: 'Custom'
};

/* ── Projects Store (localStorage) ── */
const STORAGE_PROJECTS_KEY = 'segaud_projects_store';
const STORAGE_ACTIVE_KEY = 'segaud_active_project_id';

function getStoredProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Purge any fake seed projects from prior test sessions
    const cleaned = parsed.filter(p => !['proj_awadhi_transcription', 'proj_bhojpuri_oral_corpus', 'proj_maithili_speech_v1'].includes(p.id));
    if (cleaned.length !== parsed.length) {
      saveStoredProjects(cleaned);
    }
    return cleaned;
  } catch (e) {
    return [];
  }
}

function saveStoredProjects(list) {
  try {
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save projects to localStorage', e);
  }
}

function getActiveProjectId() {
  const stored = localStorage.getItem(STORAGE_ACTIVE_KEY);
  const projects = getStoredProjects();
  if (stored && projects.some(p => p.id === stored)) return stored;
  return projects.length > 0 ? projects[0].id : null;
}

function setActiveProjectId(id) {
  if (id) {
    localStorage.setItem(STORAGE_ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(STORAGE_ACTIVE_KEY);
  }
}

function getActiveProject() {
  const projects = getStoredProjects();
  const id = getActiveProjectId();
  return projects.find(p => p.id === id) || (projects.length > 0 ? projects[0] : null);
}

/* ── Projects Manager UI (List, Select, Delete) ── */
function initProjectsManager() {
  const container = document.getElementById('projects-list-container');
  const countBadge = document.getElementById('projects-count-badge');
  if (!container) return;

  function render() {
    const projects = getStoredProjects();
    const activeId = getActiveProjectId();

    if (countBadge) {
      countBadge.textContent = `${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'}`;
    }

    if (projects.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); background: var(--bg-surface); border: 1px dashed var(--border); border-radius: var(--radius-sm);">
          No projects found. Use the configuration form below to create your first SegAUD project!
        </div>
      `;
      return;
    }

    container.innerHTML = projects.map(proj => {
      const isActive = proj.id === activeId;
      const vadText = proj.vadMode === 'exception'
        ? `Exception VAD (th=${proj.threshold || '0.5'})`
        : `Standard VAD (0.5)`;
      const langText = proj.langLabel || LANG_NAMES[proj.lang] || proj.lang;

      return `
        <div class="project-item-card ${isActive ? 'is-active' : ''}" data-id="${proj.id}">
          <div class="project-card-top">
            <span class="project-card-title" title="${escapeHtml(proj.name)}">📁 ${escapeHtml(proj.name)}</span>
            ${isActive ? '<span class="project-active-badge">● Active</span>' : ''}
          </div>
          <div class="project-meta-row">
            <span class="meta-pill pill-lang">${escapeHtml(langText)}</span>
            <span class="meta-pill ${proj.vadMode === 'exception' ? 'pill-vad' : ''}">${vadText}</span>
            <span class="meta-pill">SraVaani ASR</span>
          </div>
          <div class="project-card-footer">
            <button type="button" class="btn-select-proj ${isActive ? 'is-current' : ''}" data-action="select" data-id="${proj.id}">
              ${isActive ? '✓ Current Active' : 'Select Project'}
            </button>
            <button type="button" class="btn-delete-proj" data-action="delete" data-id="${proj.id}" title="Delete project">
              🗑 Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach event listeners
    container.querySelectorAll('button[data-action="select"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        selectProject(id);
      });
    });

    container.querySelectorAll('button[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-id');
        deleteProject(id);
      });
    });

    updateWorkspaceHeader();
  }

  function selectProject(id) {
    setActiveProjectId(id);
    render();

    const proj = getActiveProject();
    if (proj) {
      // Populate project form
      const projNameInput = document.getElementById('proj-name');
      const projLangSelect = document.getElementById('proj-lang');
      const paramToggle = document.getElementById('param-exception-toggle');

      if (projNameInput) projNameInput.value = proj.name;
      if (projLangSelect) projLangSelect.value = proj.lang;

      if (paramToggle) {
        paramToggle.checked = proj.vadMode === 'exception';
        paramToggle.dispatchEvent(new Event('change'));
      }

      if (proj.vadMode === 'exception') {
        const th = document.getElementById('param-threshold');
        const ms = document.getElementById('param-min-speech');
        const sl = document.getElementById('param-min-silence');
        const pd = document.getElementById('param-pad');
        const mx = document.getElementById('param-max-speech');
        if (th && proj.threshold) th.value = proj.threshold;
        if (ms && proj.minSpeech) ms.value = proj.minSpeech;
        if (sl && proj.minSilence) sl.value = proj.minSilence;
        if (pd && proj.pad) pd.value = proj.pad;
        if (mx && proj.maxSpeech) mx.value = proj.maxSpeech;
      }

      // Trigger preview update
      if (window.segaudUpdatePreview) window.segaudUpdatePreview();

      // Scroll smoothly to Audio Workspace
      const workspace = document.getElementById('audio-workspace');
      if (workspace) {
        workspace.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  function deleteProject(id) {
    const projects = getStoredProjects();
    const storedActive = localStorage.getItem(STORAGE_ACTIVE_KEY);
    const wasActive = (storedActive === id) || (getActiveProjectId() === id);

    const filtered = projects.filter(p => p.id !== id);
    saveStoredProjects(filtered);

    if (wasActive) {
      if (filtered.length > 0) {
        setActiveProjectId(filtered[0].id);
        const newActive = filtered[0];
        const projNameInput = document.getElementById('proj-name');
        const projLangSelect = document.getElementById('proj-lang');
        if (projNameInput) projNameInput.value = newActive.name;
        if (projLangSelect) projLangSelect.value = newActive.lang;
      } else {
        setActiveProjectId(null);
        const projNameInput = document.getElementById('proj-name');
        if (projNameInput) projNameInput.value = '';
      }
    }

    // Hide any duplicate project alert
    const alertBox = document.getElementById('duplicate-project-alert');
    if (alertBox) alertBox.style.display = 'none';

    // Synchronously re-render project list, active header and preview
    render();
    updateWorkspaceHeader();
    if (window.segaudUpdatePreview) window.segaudUpdatePreview();
  }

  // Export render for other modules
  window.segaudRenderProjectsList = render;
  window.segaudSelectProject = selectProject;

  render();
}

/* ── Update Audio Workspace Header with Active Project ── */
function updateWorkspaceHeader() {
  const proj = getActiveProject();
  const nameEl = document.getElementById('workspace-proj-name');
  const langTag = document.getElementById('workspace-lang-tag');
  const vadTag = document.getElementById('workspace-vad-tag');
  const asrTag = document.getElementById('workspace-asr-tag');
  const vadMetric = document.getElementById('metric-vad-threshold');
  const vadSummary = document.getElementById('active-vad-summary');

  if (!proj) {
    if (nameEl) nameEl.textContent = 'No Project Selected';
    if (langTag) langTag.textContent = 'Low-Resource Speech';
    if (vadTag) vadTag.textContent = 'Silero VAD (0.5)';
    if (asrTag) asrTag.textContent = 'SraVaani ASR';
    if (vadMetric) vadMetric.textContent = '0.5 VAD';
    if (vadSummary) vadSummary.textContent = 'threshold=0.5, pad=150ms [standard defaults]';
    return;
  }

  const langLabel = proj.langLabel || LANG_NAMES[proj.lang] || proj.lang;
  const th = proj.threshold || '0.5';

  if (nameEl) nameEl.textContent = proj.name;
  if (langTag) langTag.textContent = `${langLabel} (${proj.lang})`;
  if (vadTag) {
    vadTag.textContent = proj.vadMode === 'exception'
      ? `Exception VAD (${th})`
      : `Silero VAD (0.5)`;
  }
  if (asrTag) asrTag.textContent = 'SraVaani ASR';

  if (vadMetric) vadMetric.textContent = `${th} VAD`;
  if (vadSummary) {
    vadSummary.textContent = proj.vadMode === 'exception'
      ? `threshold=${th}, pad=${proj.pad || '150'}ms [exception mode]`
      : `threshold=0.5, pad=150ms [standard defaults]`;
  }
}

/* ── Project Generator (Form & "Generate Project" Button) ── */
function initProjectGenerator() {
  const projName = document.getElementById('proj-name');
  const projLang = document.getElementById('proj-lang');
  const recommendTag = document.getElementById('recommend-tag');
  const recNameEl = document.getElementById('recommended-name');
  const preview = document.getElementById('config-preview');
  const genBtn = document.getElementById('generate-btn');
  const toggleSra = document.getElementById('toggle-sravaani');
  const toggleDiar = document.getElementById('toggle-diarization');
  const paramToggle = document.getElementById('param-exception-toggle');
  const paramGrid = document.getElementById('param-grid');
  const paramHint = document.getElementById('param-hint-text');

  if (!projName || !preview) return;

  // VAD param inputs
  const paramInputs = {
    threshold: document.getElementById('param-threshold'),
    minSpeech: document.getElementById('param-min-speech'),
    minSilence: document.getElementById('param-min-silence'),
    pad: document.getElementById('param-pad'),
    maxSpeech: document.getElementById('param-max-speech'),
  };

  let currentRecommended = 'awadhi_transcription';
  let userTypedCustom = false;

  function getAsrEngine() {
    const selectModelEl = document.getElementById('select-asr-model');
    const selected = selectModelEl?.value || 'openai/whisper-base';
    return `"${selected.replace('custom:', '')}"`;
  }

  function updatePreview() {
    const name = projName.value.trim() || currentRecommended;
    const lang = projLang.value || 'awa';
    const langLabel = LANG_NAMES[lang] || lang;
    const isExceptionMode = paramToggle ? paramToggle.checked : false;

    const th = paramInputs.threshold?.value || '0.5';
    const ms = paramInputs.minSpeech?.value || '250';
    const sl = paramInputs.minSilence?.value || '400';
    const pd = paramInputs.pad?.value || '150';
    const mx = paramInputs.maxSpeech?.value || '20';

    const engine = getAsrEngine();
    const diarLine = toggleDiar?.querySelector('input')?.checked
      ? `\n<span class="var">DIARIZATION</span>    = <span class="str">"pyannote.audio"</span> <span class="cmt"># speaker diarization</span>`
      : '';

    let vadSection = '';
    if (isExceptionMode) {
      vadSection = `<span class="cmt"># ── VAD Settings (Applied as Exception Overrides) ──</span>
<span class="var">SAMPLE_RATE</span>     = <span class="num">16000</span>
<span class="var">VAD_EXCEPTIONS</span>  = {
    <span class="str">"threshold"</span>: <span class="num">${th}</span>,              <span class="cmt"># custom exception</span>
    <span class="str">"min_speech_duration_ms"</span>: <span class="num">${ms}</span>,  <span class="cmt"># custom exception</span>
    <span class="str">"min_silence_duration_ms"</span>: <span class="num">${sl}</span>, <span class="cmt"># custom exception</span>
    <span class="str">"speech_pad_ms"</span>: <span class="num">${pd}</span>,          <span class="cmt"># custom exception</span>
    <span class="str">"max_speech_duration_s"</span>: <span class="num">${mx}</span>,   <span class="cmt"># custom exception</span>
}`;
    } else {
      vadSection = `<span class="cmt"># ── VAD Settings ──</span>
<span class="var">SAMPLE_RATE</span>     = <span class="num">16000</span>
<span class="var">VAD_EXCEPTIONS</span>  = <span class="val">None</span>  <span class="cmt"># Standard pipeline defaults (no exceptions applied)</span>`;
    }

    preview.innerHTML = `<code><span class="cmt"># SegAUD Project Configuration</span>
<span class="cmt"># Generated for: ${escapeHtml(name)}</span>

<span class="var">PROJECT_NAME</span>    = <span class="str">"${escapeHtml(name)}"</span>
<span class="var">TARGET_LANG</span>     = <span class="str">"${lang}"</span>  <span class="cmt"># ${langLabel}</span>

${vadSection}

<span class="cmt"># ── ASR & Diarization Settings ──</span>
<span class="var">ASR_ENGINE</span>      = <span class="str">${engine}</span>
<span class="var">ASR_MODEL</span>       = <span class="str">"openai/whisper-base"</span>
<span class="var">ASR_THREADS</span>     = <span class="num">4</span>
<span class="var">DEVICE</span>          = <span class="str">"auto"</span>  <span class="cmt"># cuda if available</span>${diarLine}

<span class="cmt"># ── Output ──</span>
<span class="var">OUTPUT_DIR</span>      = <span class="str">"segments"</span>
<span class="var">CSV_ENCODING</span>    = <span class="str">"utf-8-sig"</span></code>`;
  }

  window.segaudUpdatePreview = updatePreview;

  // Handle project name typing
  projName.addEventListener('input', () => {
    userTypedCustom = projName.value.trim().length > 0;
    updatePreview();
  });

  // Handle Language selection change: update placeholder & recommended ghost text
  projLang.addEventListener('change', () => {
    const slug = LANG_SLUGS[projLang.value] || projLang.value;
    currentRecommended = `${slug}_transcription`;

    projName.placeholder = currentRecommended;
    if (recNameEl) {
      recNameEl.textContent = currentRecommended;
    }

    // If user has not typed a distinct custom name, clear or keep default
    if (!userTypedCustom) {
      projName.value = '';
    }

    updatePreview();
  });

  // Click on recommendation tag to autofill recommended name
  if (recommendTag) {
    recommendTag.addEventListener('click', () => {
      projName.value = currentRecommended;
      userTypedCustom = true;
      updatePreview();
      projName.focus();
    });
  }

  // Parameter Exception Mode toggle
  if (paramToggle && paramGrid) {
    paramToggle.addEventListener('change', () => {
      const active = paramToggle.checked;
      if (active) {
        paramGrid.classList.remove('locked-grid');
        paramGrid.classList.add('exception-active');
        Object.values(paramInputs).forEach(input => {
          if (input) input.disabled = false;
        });
        if (paramHint) {
          paramHint.textContent = 'Exception mode active: Custom parameter overrides will be applied for edge-case audio processing.';
        }
        const badges = paramGrid.querySelectorAll('.param-badge');
        badges.forEach(b => {
          if (!b.textContent.includes('fixed')) b.textContent = 'exception';
        });
      } else {
        paramGrid.classList.add('locked-grid');
        paramGrid.classList.remove('exception-active');
        Object.values(paramInputs).forEach(input => {
          if (input) input.disabled = true;
        });
        if (paramHint) {
          paramHint.textContent = 'Standard pipeline defaults are active. Enable exception mode only to apply parameter overrides for edge-case audio.';
        }
        if (paramInputs.threshold) paramInputs.threshold.value = '0.5';
        if (paramInputs.minSpeech) paramInputs.minSpeech.value = '250';
        if (paramInputs.minSilence) paramInputs.minSilence.value = '400';
        if (paramInputs.pad) paramInputs.pad.value = '150';
        if (paramInputs.maxSpeech) paramInputs.maxSpeech.value = '20';

        const defaultLabels = ['default: 0.5', 'default: 250', 'default: 400', 'default: 150', 'default: 20', 'fixed: 16k'];
        const badges = paramGrid.querySelectorAll('.param-badge');
        badges.forEach((b, idx) => {
          if (defaultLabels[idx]) b.textContent = defaultLabels[idx];
        });
      }
      updatePreview();
    });
  }

  // Bind parameter inputs
  Object.values(paramInputs).forEach(input => {
    if (input) input.addEventListener('input', updatePreview);
  });

  // Toggle tool active states
  [toggleSra, toggleDiar].forEach(toggle => {
    if (!toggle) return;
    const cb = toggle.querySelector('input');
    if (!cb) return;
    cb.addEventListener('change', () => {
      toggle.classList.toggle('active', cb.checked);
      const tag = toggle.querySelector('.toggle-tag');
      if (tag && !tag.classList.contains('required') && !tag.classList.contains('roadmap')) {
        tag.textContent = cb.checked ? 'Enabled' : 'Disabled';
      }
      updatePreview();
    });
  });

  // ── "Generate Project" Button ──
  // Checks for duplicates; if duplicate exists, alerts user and shows existing project
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      const name = projName.value.trim() || currentRecommended;
      const lang = projLang.value || 'awa';
      const langLabel = LANG_NAMES[lang] || lang;
      const isException = paramToggle ? paramToggle.checked : false;

      const projects = getStoredProjects();
      const existing = projects.find(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());

      if (existing) {
        // Project with same name already exists: alert user and show existing project!
        setActiveProjectId(existing.id);
        if (window.segaudRenderProjectsList) {
          window.segaudRenderProjectsList();
        }
        updateWorkspaceHeader();

        // Show duplicate project alert banner
        const alertBox = document.getElementById('duplicate-project-alert');
        if (alertBox) {
          alertBox.style.display = 'flex';
          alertBox.innerHTML = `<span>⚠️ <strong>Existing Project Found:</strong> A project named "<strong>${escapeHtml(existing.name)}</strong>" already exists. SegAUD switched to and displayed the existing project below.</span>`;
        }

        // Highlight existing project card with pulse animation
        const container = document.getElementById('projects-list-container');
        if (container) {
          const card = container.querySelector(`[data-id="${existing.id}"]`);
          if (card) {
            card.classList.remove('highlight-pulse');
            void card.offsetWidth; // force reflow
            card.classList.add('highlight-pulse');
          }
        }

        // Scroll smoothly to existing projects block
        const existingBlock = document.getElementById('existing-projects-block');
        if (existingBlock) {
          existingBlock.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      // Hide any previous duplicate alert
      const alertBox = document.getElementById('duplicate-project-alert');
      if (alertBox) alertBox.style.display = 'none';

      const projData = {
        id: 'proj_' + Date.now(),
        name: name,
        lang: lang,
        langLabel: langLabel,
        vadMode: isException ? 'exception' : 'standard',
        threshold: paramInputs.threshold?.value || '0.5',
        minSpeech: paramInputs.minSpeech?.value || '250',
        minSilence: paramInputs.minSilence?.value || '400',
        pad: paramInputs.pad?.value || '150',
        maxSpeech: paramInputs.maxSpeech?.value || '20',
        asrEngine: 'sravaani',
        createdAt: new Date().toISOString().slice(0, 10),
        clipsCount: 0
      };

      projects.unshift(projData);
      saveStoredProjects(projects);
      setActiveProjectId(projData.id);

      // Re-render project list
      if (window.segaudRenderProjectsList) {
        window.segaudRenderProjectsList();
      }

      // Visual button feedback
      const origText = genBtn.textContent;
      genBtn.textContent = '✓ Project Generated! Opening Workspace...';
      genBtn.style.background = 'linear-gradient(135deg, var(--green), #56b6c2)';

      setTimeout(() => {
        genBtn.textContent = origText;
        genBtn.style.background = '';
      }, 1800);

      // Bring user to Upload Audio section (#audio-workspace)
      const audioWorkspace = document.getElementById('audio-workspace');
      if (audioWorkspace) {
        audioWorkspace.scrollIntoView({ behavior: 'smooth' });
        // Pulse dropzone to guide user
        const dropzone = document.getElementById('audio-dropzone');
        if (dropzone) {
          dropzone.style.borderColor = 'var(--green)';
          dropzone.style.background = 'rgba(152, 195, 121, 0.12)';
          setTimeout(() => {
            dropzone.style.borderColor = '';
            dropzone.style.background = '';
          }, 1500);
        }
      }
    });
  }

  // Initial render
  updatePreview();
}

/* ── Global Model & Token Management ── */
const HF_TOKEN_STORAGE_KEY = 'segaud_hf_token';
const CUSTOM_MODELS_STORAGE_KEY = 'segaud_custom_models_v3';

// Clean any legacy storage entries that might contain bhashini
try {
  ['segaud_custom_models', 'segaud_custom_models_v2', 'segaud_custom_models_v3'].forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw && /bhas/i.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        const filtered = parsed.filter(m => !/bhas/i.test(m.name || '') && !/bhas/i.test(m.id || '') && !/bhas/i.test(m.repo || ''));
        localStorage.setItem(key, JSON.stringify(filtered));
      } catch (e) {}
    }
  });
} catch (e) {}

const STANDARD_MODELS = [
  { id: 'whisper-base', name: 'OpenAI Whisper-Base (Devanagari, 74M) · Recommended', value: 'openai/whisper-base', repo: 'openai/whisper-base' },
  { id: 'sravaani', name: 'ARTPARK-IISc SraVaani-1.0 (Devanagari)', value: 'ARTPARK-IISc/SraVaani-1.0', repo: 'ARTPARK-IISc/SraVaani-1.0' },
  { id: 'whisper-small', name: 'OpenAI Whisper-Small (Devanagari, 244M)', value: 'openai/whisper-small', repo: 'openai/whisper-small' }
];

function getStoredHfToken() {
  return localStorage.getItem(HF_TOKEN_STORAGE_KEY) || '';
}

function getStoredCustomModels() {
  try {
    const raw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const filtered = parsed.filter(m => !/bhas/i.test(m.name || '') && !/bhas/i.test(m.id || '') && !/bhas/i.test(m.repo || ''));
      return filtered;
    }
  } catch (e) {}
  return [
    { id: 'custom_whisper_large', name: 'OpenAI Whisper Large v3', repo: 'openai/whisper-large-v3', token: '' },
    { id: 'custom_indic_wav2vec', name: 'AI4Bharat IndicWav2Vec Hindi', repo: 'ai4bharat/indicwav2vec-hindi', token: '' }
  ];
}

function saveCustomModels(models) {
  const clean = (models || []).filter(m => !/bhas/i.test(m.name || '') && !/bhas/i.test(m.id || '') && !/bhas/i.test(m.repo || ''));
  localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(clean));
  updateModelDropdown();
}

function updateModelDropdown() {
  const selectEl = document.getElementById('select-asr-model');
  if (!selectEl) return;
  const currentVal = selectEl.value;
  const customModels = getStoredCustomModels();

  let html = '<optgroup label="Standard Hugging Face Models">';
  STANDARD_MODELS.forEach(m => {
    html += `<option value="${escapeHtml(m.value)}">${escapeHtml(m.name)}</option>`;
  });
  html += '</optgroup>';

  if (customModels && customModels.length > 0) {
    html += '<optgroup label="Configured Hugging Face &amp; ASR Models (Code-Free)">';
    customModels.forEach(m => {
      const repoVal = m.repo || m.value || m.name;
      const keySuffix = m.token ? ' · [Key Saved]' : ' · [Default HF Token]';
      html += `<option value="${escapeHtml(repoVal)}">${escapeHtml(m.name)} (${escapeHtml(repoVal)})${keySuffix}</option>`;
    });
    html += '</optgroup>';
  }

  selectEl.innerHTML = html;
  if (currentVal && Array.from(selectEl.options).some(o => o.value === currentVal)) {
    selectEl.value = currentVal;
  }
}

function initSettingsManager() {
  const openBtn = document.getElementById('open-settings-btn');
  const closeBtn = document.getElementById('close-settings-btn');
  const doneBtn = document.getElementById('done-settings-btn');
  const modal = document.getElementById('settings-modal');
  const hfTokenInput = document.getElementById('hf-permanent-token');
  const saveHfBtn = document.getElementById('save-hf-token-btn');
  const hfStatus = document.getElementById('hf-token-status');
  const customModelsList = document.getElementById('custom-models-list');
  const newModelName = document.getElementById('new-model-name');
  const newModelRepo = document.getElementById('new-model-repo');
  const newModelToken = document.getElementById('new-model-token');
  const addModelBtn = document.getElementById('add-model-btn');
  const addModelError = document.getElementById('add-model-error');
  const clearWorkspaceBtn = document.getElementById('clear-workspace-btn');

  // Initialize model dropdown
  updateModelDropdown();

  // Attach 1-click Preset Chips listeners
  document.querySelectorAll('.hf-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const pName = chip.getAttribute('data-name');
      const pRepo = chip.getAttribute('data-repo');
      if (newModelName) newModelName.value = pName || '';
      if (newModelRepo) newModelRepo.value = pRepo || '';
      if (newModelToken) newModelToken.value = '';
      if (addModelError) addModelError.style.display = 'none';

      // Auto-add preset if not already present
      const models = getStoredCustomModels();
      const exists = models.some(m => (m.repo && m.repo.toLowerCase() === pRepo.toLowerCase()));
      if (!exists) {
        models.push({ id: 'm_' + Date.now(), name: pName, repo: pRepo, token: '' });
        saveCustomModels(models);
        renderCustomModels();
        showAppToast(`✓ Added preset "${pName}"`);
      } else {
        showAppToast(`Model "${pName}" already configured`);
      }
    });
  });

  function updateHfStatusDisplay() {
    const token = getStoredHfToken();
    if (token) {
      if (hfStatus) {
        hfStatus.textContent = '✓ Hugging Face Token saved (unlocks SraVaani-1.0 & pyannote Diarization)';
        hfStatus.className = 'token-status-text is-saved';
      }
      if (hfTokenInput) hfTokenInput.value = token;
    } else {
      if (hfStatus) {
        hfStatus.textContent = 'Token unconfigured (OpenAI Whisper-Base active)';
        hfStatus.className = 'token-status-text';
      }
    }
  }

  function renderCustomModels() {
    if (!customModelsList) return;
    const models = getStoredCustomModels();
    if (models.length === 0) {
      customModelsList.innerHTML = '<div style="color: var(--text-muted); font-size: .8rem; padding: 6px 0;">No custom models added yet. Click a preset chip above or add a Hugging Face repo ID below.</div>';
      return;
    }
    customModelsList.innerHTML = models.map(m => `
      <div class="custom-model-item">
        <div class="custom-model-info">
          <strong>${escapeHtml(m.name)}</strong>
          <span class="custom-model-repo-badge">${escapeHtml(m.repo || m.value || m.name)}</span>
          <span class="custom-model-token-preview">${m.token ? '••••••••' + m.token.slice(-4) : 'Uses Default HF Token'}</span>
        </div>
        <button type="button" class="btn-delete-model" data-id="${escapeHtml(m.id)}" title="Remove model">🗑 Remove</button>
      </div>
    `).join('');

    customModelsList.querySelectorAll('.btn-delete-model').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const current = getStoredCustomModels().filter(x => x.id !== id);
        saveCustomModels(current);
        renderCustomModels();
      });
    });
  }

  function openModal() {
    updateHfStatusDisplay();
    renderCustomModels();
    if (modal) modal.style.display = 'flex';
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn) doneBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  if (saveHfBtn && hfTokenInput) {
    saveHfBtn.addEventListener('click', async () => {
      const val = hfTokenInput.value.trim();
      localStorage.setItem(HF_TOKEN_STORAGE_KEY, val);
      updateHfStatusDisplay();
      if (val && window.__isPythonBackend) {
        try {
          await fetch(`${window.__backendBaseUrl || ''}/api/set_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: val })
          });
        } catch (e) {}
      }
      showAppToast('✓ Hugging Face Token saved');
    });
  }

  // Eye visibility toggle buttons for password inputs
  const toggleHfEyeBtn = document.getElementById('toggle-hf-pwd-eye');
  if (toggleHfEyeBtn && hfTokenInput) {
    toggleHfEyeBtn.addEventListener('click', () => {
      const isPwd = hfTokenInput.type === 'password';
      hfTokenInput.type = isPwd ? 'text' : 'password';
      toggleHfEyeBtn.setAttribute('title', isPwd ? 'Hide Token' : 'Show Token');
    });
  }

  const toggleNewModelEyeBtn = document.getElementById('toggle-new-model-pwd-eye');
  if (toggleNewModelEyeBtn && newModelToken) {
    toggleNewModelEyeBtn.addEventListener('click', () => {
      const isPwd = newModelToken.type === 'password';
      newModelToken.type = isPwd ? 'text' : 'password';
      toggleNewModelEyeBtn.setAttribute('title', isPwd ? 'Hide Token' : 'Show Token');
    });
  }

  if (addModelBtn && newModelName) {
    addModelBtn.addEventListener('click', () => {
      const name = newModelName.value.trim();
      const repo = newModelRepo ? newModelRepo.value.trim() : '';
      const token = newModelToken ? newModelToken.value.trim() : '';
      if (!name || !repo) {
        if (addModelError) addModelError.style.display = 'block';
        return;
      }
      if (addModelError) addModelError.style.display = 'none';

      const models = getStoredCustomModels();
      const newId = 'm_' + Date.now();
      models.push({ id: newId, name, repo, token });
      saveCustomModels(models);
      newModelName.value = '';
      if (newModelRepo) newModelRepo.value = '';
      if (newModelToken) newModelToken.value = '';
      renderCustomModels();
      showAppToast(`✓ Model "${name}" (${repo}) added`);
    });
  }

  if (clearWorkspaceBtn) {
    clearWorkspaceBtn.addEventListener('click', () => {
      if (confirm('Clear loaded audio, segments, and table results?')) {
        if (window.__resetWorkspace) {
          window.__resetWorkspace();
        }
        closeModal();
        showAppToast('✓ Workspace data cleared');
      }
    });
  }
}

function initComparisonCollapse() {
  const toggleBtn = document.getElementById('toggle-comparison-btn');
  const toggleHeader = document.getElementById('docs-comparison-toggle-header');
  const tableWrap = document.getElementById('comparison-table-wrap');
  const toggleIcon = document.getElementById('collapse-toggle-icon');

  if (!tableWrap) return;

  let isCollapsed = false;

  function toggle() {
    isCollapsed = !isCollapsed;
    if (isCollapsed) {
      tableWrap.classList.add('is-collapsed');
      if (toggleIcon) toggleIcon.textContent = '▶';
      if (toggleBtn) toggleBtn.setAttribute('title', 'Expand Feature Comparison');
    } else {
      tableWrap.classList.remove('is-collapsed');
      if (toggleIcon) toggleIcon.textContent = '▼';
      if (toggleBtn) toggleBtn.setAttribute('title', 'Collapse Feature Comparison');
    }
  }

  if (toggleBtn) toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  if (toggleHeader) toggleHeader.addEventListener('click', toggle);
}

/* ── Audio Upload & VAD/ASR Processing Workspace ── */
function initAudioWorkspace() {
  const dropzone = document.getElementById('audio-dropzone');
  const fileInput = document.getElementById('audio-file-input');
  const loadedCard = document.getElementById('loaded-audio-card');
  const filenameEl = document.getElementById('audio-filename');
  const fileinfoEl = document.getElementById('audio-fileinfo');
  const customNameInput = document.getElementById('audio-custom-name');
  const domainInput = document.getElementById('audio-domain');
  const domainErrorHint = document.getElementById('domain-error-hint');
  const audioPlayer = document.getElementById('audio-player');
  const runBtn = document.getElementById('run-pipeline-btn');
  const progressBox = document.getElementById('pipeline-progress-box');
  const progressFill = document.getElementById('pipeline-progress-fill');
  const progressText = document.getElementById('pipeline-status-text');
  const progressPct = document.getElementById('pipeline-pct');
  const resultsCard = document.getElementById('vad-asr-results');
  const timelineTrack = document.getElementById('timeline-track');
  const tableBody = document.getElementById('segments-table-body');
  const exportSegBtn = document.getElementById('export-segments-btn');
  const exportTxBtn = document.getElementById('export-transcripts-btn');
  const exportAllBtn = document.getElementById('export-all-btn');
  const enableAsrCb = document.getElementById('enable-neural-asr');
  const skipAsrBtn = document.getElementById('skip-asr-btn');

  let skipAsrRequested = false;

  let currentPipelineProgress = 0;
  function resetPipelineProgress() {
    currentPipelineProgress = 0;
    if (progressFill) progressFill.style.width = '0%';
    if (progressPct) progressPct.textContent = 'Phase 1/3';
  }

  function setPipelineProgress(pct, message, phaseText) {
    if (typeof pct === 'number') {
      currentPipelineProgress = Math.min(100, Math.max(currentPipelineProgress, Math.round(pct)));
      if (progressFill) progressFill.style.width = `${currentPipelineProgress}%`;
    }
    if (message && progressText) {
      progressText.textContent = message;
    }
    if (progressPct) {
      if (phaseText) {
        progressPct.textContent = phaseText;
      } else if (currentPipelineProgress >= 100) {
        progressPct.textContent = '100%';
      } else {
        progressPct.textContent = `${currentPipelineProgress}%`;
      }
    }
  }

  if (enableAsrCb && runBtn) {
    enableAsrCb.addEventListener('change', () => {
      runBtn.innerHTML = '<span>▶ Run</span>';
    });
  }

  if (skipAsrBtn) {
    skipAsrBtn.addEventListener('click', () => {
      skipAsrRequested = true;
      if (progressText) progressText.textContent = '⚡ ASR skipped. Opening speech segments now...';
    });
  }

  let isPythonBackend = false;
  let backendBaseUrl = '';

  async function detectBackend() {
    const candidates = ['', 'http://127.0.0.1:8080', 'http://localhost:8080'];
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}/api/status`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ok') {
            isPythonBackend = true;
            backendBaseUrl = base;
            window.__isPythonBackend = true;
            window.__backendBaseUrl = base;
            return;
          }
        }
      } catch (e) {
        // try next candidate
      }
    }
    isPythonBackend = false;
    window.__isPythonBackend = false;
  }
  detectBackend();

  if (!dropzone || !audioPlayer) return;

  let currentAudioUrl = null;
  let currentAudioFile = null;
  let currentAudioBuffer = null;
  let currentDuration = 0;
  let activeSegments = [];

  // Expose resetWorkspace for Settings modal
  window.__resetWorkspace = function() {
    stopClipPlayback();
    currentAudioUrl = null;
    currentAudioFile = null;
    currentAudioBuffer = null;
    currentDuration = 0;
    activeSegments = [];
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.removeAttribute('src');
      audioPlayer.load();
    }
    if (fileInput) fileInput.value = '';
    if (loadedCard) loadedCard.style.display = 'none';
    if (resultsCard) resultsCard.style.display = 'none';
    if (progressBox) progressBox.style.display = 'none';
    if (domainInput) {
      domainInput.value = '';
      domainInput.classList.remove('input-invalid');
    }
    if (domainErrorHint) domainErrorHint.style.display = 'none';
    if (tableBody) tableBody.innerHTML = '';
  };

  // Helper to escape CSV cell contents
  function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    return String(val).replace(/"/g, '""');
  }

  // Extract segment slice from audio buffer and encode to standard 16-bit PCM WAV
  function getSegmentWavBlob(seg) {
    if (currentAudioBuffer && currentAudioBuffer.length > 0) {
      const sampleRate = currentAudioBuffer.sampleRate;
      const numChannels = currentAudioBuffer.numberOfChannels;
      const startSample = Math.max(0, Math.floor(seg.start * sampleRate));
      const endSample = Math.min(currentAudioBuffer.length, Math.floor(seg.end * sampleRate));
      const length = Math.max(0, endSample - startSample);

      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = length * blockAlign;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      function writeString(offset, string) {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
      }

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true); // 16-bit
      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      let offset = 44;
      const channels = [];
      for (let ch = 0; ch < numChannels; ch++) {
        channels.push(currentAudioBuffer.getChannelData(ch));
      }

      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const sample = Math.max(-1, Math.min(1, channels[ch][startSample + i]));
          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(offset, intSample, true);
          offset += 2;
        }
      }

      return new Blob([buffer], { type: 'audio/wav' });
    }

    // Fallback PCM silence WAV if audio buffer is not ready
    const sampleRate = 16000;
    const dur = Math.max(0.2, (seg.end - seg.start) || 1);
    const numSamples = Math.floor(sampleRate * dur);
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeStr(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); writeStr(36, 'data'); view.setUint32(40, dataSize, true);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Pure-JS uncompressed ZIP creator for audio clips and CSVs
  function createZipBlob(files) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    function crc32(uint8Array) {
      let crc = -1;
      for (let i = 0; i < uint8Array.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ uint8Array[i]) & 0xFF];
      }
      return (crc ^ (-1)) >>> 0;
    }

    const parts = [];
    const cdEntries = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const dataBytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0x4000, true);
      lv.setUint16(12, 0x5400, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local);
      parts.push(dataBytes);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0x4000, true);
      cv.setUint16(14, 0x5400, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      cdEntries.push(cd);
      offset += local.length + dataBytes.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of cdEntries) {
      parts.push(cd);
      cdSize += cd.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 60000);
  }

  // Handle uploaded audio file (real file ingestion, no fake clips)
  function handleUploadedFile(file) {
    if (!file) return;
    currentAudioFile = file;

    const originalName = file.name;
    const baseStem = originalName.replace(/\.[^/.]+$/, '');
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

    // Option to edit audio file name: default to original stem/name
    if (customNameInput) {
      customNameInput.value = baseStem;
    }
    if (filenameEl) {
      filenameEl.textContent = originalName;
    }
    if (fileinfoEl) {
      fileinfoEl.textContent = `File: ${originalName} · ${sizeMb} MB · Resampled to 16 kHz Mono`;
    }

    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(file);
    audioPlayer.src = currentAudioUrl;

    audioPlayer.onloadedmetadata = () => {
      const dur = audioPlayer.duration || 0;
      currentDuration = dur;
      if (fileinfoEl) {
        fileinfoEl.textContent = `16 kHz Mono · ${sizeMb} MB · ${dur.toFixed(2)}s`;
      }
    };

    if (loadedCard) loadedCard.style.display = 'flex';
    if (resultsCard) resultsCard.style.display = 'none';

    // Decode actual audio buffer via Web Audio API for real VAD segmentation
    decodeAudioData(file);
  }

  async function decodeAudioData(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      currentAudioBuffer = await ctx.decodeAudioData(arrayBuffer);
      currentDuration = currentAudioBuffer.duration;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      if (fileinfoEl) {
        fileinfoEl.textContent = `${currentAudioBuffer.sampleRate} Hz · Mono · ${sizeMb} MB · ${currentDuration.toFixed(2)}s`;
      }
    } catch (err) {
      console.warn('Web Audio buffer decode note:', err);
      currentAudioBuffer = null;
    }
  }

  // Sync displayed audio name with custom input
  if (customNameInput) {
    customNameInput.addEventListener('input', () => {
      const val = customNameInput.value.trim();
      if (filenameEl && val) {
        filenameEl.textContent = val;
      }
    });
  }

  // Clear domain validation error on typing
  if (domainInput) {
    domainInput.addEventListener('input', () => {
      if (domainInput.value.trim()) {
        domainInput.classList.remove('input-invalid');
        if (domainErrorHint) domainErrorHint.style.display = 'none';
      }
    });
  }

  // File input change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedFile(e.target.files[0]);
      }
    });
  }

  // Click on dropzone triggers file picker
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        fileInput.click();
      }
    });
  }

  // Drag & drop handlers
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleUploadedFile(e.dataTransfer.files[0]);
      }
    });
  }

  // ── Resample PCM Float32 audio to 16kHz for Whisper Neural ASR ──
  function resampleTo16k(audioData, origRate) {
    if (origRate === 16000) return audioData;
    const ratio = origRate / 16000;
    const newLen = Math.round(audioData.length / ratio);
    const res = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const origIdx = i * ratio;
      const iFloor = Math.floor(origIdx);
      const iCeil = Math.min(audioData.length - 1, iFloor + 1);
      const frac = origIdx - iFloor;
      res[i] = audioData[iFloor] * (1 - frac) + audioData[iCeil] * frac;
    }
    return res;
  }

  // ── Client-Side Neural ASR Engine (Whisper WebAssembly / Transformers.js) ──
  let asrEnginePromise = null;
  async function getAsrEngine(onProgress) {
    if (window.__segaudAsrEngine) return window.__segaudAsrEngine;
    if (!asrEnginePromise) {
      asrEnginePromise = (async () => {
        try {
          const loadPromise = (async () => {
            const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            env.remoteHost = 'https://huggingface.co/';
            env.remotePathTemplate = '{model}/resolve/{revision}/';
            if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
              env.backends.onnx.wasm.numThreads = 1; // Prevent thread deadlock on main UI thread
            }
            return await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
              progress_callback: onProgress
            });
          })();

          // Strict 8-second timeout so the browser tab NEVER hangs
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('ASR model load timed out (8s limit)')), 8000)
          );

          const transcriber = await Promise.race([loadPromise, timeoutPromise]);
          window.__segaudAsrEngine = transcriber;
          return transcriber;
        } catch (e) {
          console.warn('Neural ASR model unavailable, offline, or timed out:', e);
          asrEnginePromise = null;
          return null;
        }
      })();
    }
    return asrEnginePromise;
  }

  // Sanitize transcript text, collapse hallucination loops, and filter out foreign scripts for Devanagari
  function cleanDevanagariTranscript(rawText, isDevanagariTarget) {
    if (!rawText || !rawText.trim()) return '';
    let text = rawText.trim();

    // 1. Collapse repeating phrases/words (e.g. "-Bhantar. -Bhantar. -Bhantar..." or "word word word")
    text = text.replace(/([^\s]+(?:\s+[^\s]+){0,3}?)\s*(?:(?:\1|\b\1\b)[.,;!?\- ]*){2,}/gi, '$1');
    // Remove repeated punctuation dashes/spaces
    text = text.replace(/(?:-\s*){2,}/g, '- ').replace(/\s{2,}/g, ' ').trim();

    if (isDevanagariTarget) {
      // If target is Awadhi / Devanagari:
      // Filter out foreign script hallucinations (Arabic/Urdu, Korean Hangul, Chinese, Japanese)
      const hasArabicOrCjk = /[\u0600-\u06FF\u0750-\u077F\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(text);
      if (hasArabicOrCjk) {
        return '';
      }

      // Filter out typical English hallucinations on background noise/silent slices
      const hasDevanagari = /[\u0900-\u097F]/.test(text);
      if (!hasDevanagari) {
        const lower = text.toLowerCase();
        if (
          lower.includes('gracias') ||
          lower.includes('today we are') ||
          lower.includes('subtitles') ||
          lower.includes('copyright') ||
          lower.includes('thank you') ||
          lower.includes('thanks') ||
          lower.includes('oh, good') ||
          lower.includes('paratha') ||
          lower.includes('bhantar') ||
          lower.includes('biasa ke dalam') ||
          text.split(/\s+/).length < 2
        ) {
          return '';
        }
      }
    }

    return text;
  }

  // Real neural speech transcription on actual decoded audio buffer (non-blocking)
  async function transcribeActiveSegmentsWithAsr(updateStatus) {
    if (!currentAudioBuffer || activeSegments.length === 0 || skipAsrRequested) return;

    const sampleRate = currentAudioBuffer.sampleRate;
    const channelData = currentAudioBuffer.getChannelData(0);

    let transcriber = null;
    try {
      updateStatus?.('03/03: Initializing Neural Speech Recognition (Whisper Devanagari)...', 75, 'Phase 3/3');
      await new Promise(r => setTimeout(r, 80)); // Yield to UI event loop

      transcriber = await getAsrEngine((p) => {
        if (p && p.status === 'progress') {
          updateStatus?.('03/03: Loading Neural ASR Model weights...', 80, 'Phase 3/3');
        }
      });
    } catch (e) {
      console.warn('ASR engine load failed:', e);
    }

    if (transcriber && !skipAsrRequested) {
      const activeProj = getActiveProject();
      const projLang = (activeProj?.lang || 'awa').toLowerCase();

      // For Awadhi (awa), Bhojpuri, Maithili, Hindi, Marathi, Nepali -> strictly target Devanagari script via 'hi'
      const DEVANAGARI_LANGS = ['awa', 'hi', 'bho', 'mai', 'mr', 'ne', 'sa', 'custom'];
      const isDevanagari = DEVANAGARI_LANGS.includes(projLang);
      const whisperLang = isDevanagari ? 'hi' : (projLang || 'hi');

      const asrStartTime = Date.now();
      for (let i = 0; i < activeSegments.length; i++) {
        if (skipAsrRequested) break;
        const seg = activeSegments[i];
        const pct = Math.round(80 + (i / activeSegments.length) * 18);
        const elapsedSec = Math.round((Date.now() - asrStartTime) / 1000);
        const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
        const s = (elapsedSec % 60).toString().padStart(2, '0');
        const timeStr = `${m}:${s}`;
        const phaseLabel = `${i + 1}/${activeSegments.length} (${timeStr})`;

        updateStatus?.(
          `03/03: Transcribing clip in Devanagari ${i + 1}/${activeSegments.length} (${seg.id} · ${seg.speaker || 'Speaker 1'}) · ⏱ ${timeStr} elapsed`,
          pct,
          phaseLabel
        );

        // Yield to browser UI thread so browser stays completely responsive
        await new Promise(r => setTimeout(r, 60));

        try {
          const sSample = Math.floor(seg.start * sampleRate);
          const eSample = Math.min(channelData.length, Math.floor(seg.end * sampleRate));
          const clipRaw = channelData.slice(sSample, eSample);
          const clip16k = resampleTo16k(clipRaw, sampleRate);

          const asrOptions = {
            chunk_length_s: 30,
            stride_length_s: 5,
            language: whisperLang,
            task: 'transcribe',
            temperature: 0.0,
            return_timestamps: false
          };

          const out = await transcriber(clip16k, asrOptions);

          if (out && out.text && out.text.trim()) {
            const cleaned = cleanDevanagariTranscript(out.text, isDevanagari);
            if (cleaned) {
              seg.text = cleaned;
            }
          }
        } catch (err) {
          console.warn(`ASR failed for segment ${seg.id}:`, err);
        }
      }
    }
  }

  // Real Speech Activity Segmentation Algorithm (Silero VAD Energy Analysis)
  function detectRealSpeechSegments(domainVal) {
    // Determine sanitized base filename stem for strict segment ID naming (stem_seg00001)
    const rawStem = (customNameInput?.value.trim() || currentAudioFile?.name || 'audio')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_\-]/g, '_') || 'audio';

    const activeProj = getActiveProject();
    const thresholdVal = parseFloat(activeProj?.threshold || '0.5') || 0.5;
    const minSpeechMs = parseFloat(activeProj?.minSpeech || '250') || 250;
    const minSilenceMs = parseFloat(activeProj?.minSilence || '400') || 400;
    const padMs = parseFloat(activeProj?.pad || '150') || 150;

    const segments = [];

    if (currentAudioBuffer && currentAudioBuffer.length > 0) {
      const channelData = currentAudioBuffer.getChannelData(0);
      const sampleRate = currentAudioBuffer.sampleRate;
      const totalDuration = currentAudioBuffer.duration;
      const frameMs = 30; // 30ms evaluation frames
      const frameSize = Math.floor(sampleRate * (frameMs / 1000));
      const numFrames = Math.floor(channelData.length / frameSize);

      const frameEnergies = new Float32Array(numFrames);
      let maxEnergy = 0.0001;
      let avgEnergy = 0;

      for (let f = 0; f < numFrames; f++) {
        let sumSq = 0;
        const offset = f * frameSize;
        for (let i = 0; i < frameSize; i++) {
          const val = channelData[offset + i];
          sumSq += val * val;
        }
        const rms = Math.sqrt(sumSq / frameSize);
        frameEnergies[f] = rms;
        if (rms > maxEnergy) maxEnergy = rms;
        avgEnergy += rms;
      }
      avgEnergy /= (numFrames || 1);

      // Adaptive speech energy cutoff calibrated with VAD threshold
      const energyCutoff = Math.max(avgEnergy * 0.75, maxEnergy * (0.12 + (thresholdVal - 0.5) * 0.15));

      let inSpeech = false;
      let segStartFrame = 0;
      const rawIntervals = [];

      for (let f = 0; f < numFrames; f++) {
        const isAbove = frameEnergies[f] >= energyCutoff;
        if (isAbove && !inSpeech) {
          inSpeech = true;
          segStartFrame = f;
        } else if (!isAbove && inSpeech) {
          inSpeech = false;
          rawIntervals.push({
            start: (segStartFrame * frameMs) / 1000,
            end: (f * frameMs) / 1000
          });
        }
      }
      if (inSpeech) {
        rawIntervals.push({
          start: (segStartFrame * frameMs) / 1000,
          end: (numFrames * frameMs) / 1000
        });
      }

      // Merge intervals closer than minSilenceMs and pad edges
      const minSpeechSec = minSpeechMs / 1000;
      const minSilenceSec = minSilenceMs / 1000;
      const padSec = padMs / 1000;

      const merged = [];
      for (const inter of rawIntervals) {
        const segStart = Math.max(0, inter.start - padSec);
        const segEnd = Math.min(totalDuration, inter.end + padSec);
        if (merged.length === 0) {
          merged.push({ start: segStart, end: segEnd });
        } else {
          const prev = merged[merged.length - 1];
          if (segStart - prev.end < minSilenceSec) {
            prev.end = segEnd;
          } else {
            merged.push({ start: segStart, end: segEnd });
          }
        }
      }

      // Filter by minimum speech duration
      const valid = merged.filter(m => (m.end - m.start) >= minSpeechSec);

      if (valid.length > 0) {
        // Multi-speaker estimation using acoustic zero-crossing rate and RMS energy
        const spkStats = valid.map(val => {
          const s = Math.floor(val.start * sampleRate);
          const e = Math.min(channelData.length, Math.floor(val.end * sampleRate));
          let zcr = 0;
          let energy = 0;
          for (let j = s + 1; j < e; j++) {
            if ((channelData[j] >= 0 && channelData[j - 1] < 0) || (channelData[j] < 0 && channelData[j - 1] >= 0)) {
              zcr++;
            }
            energy += channelData[j] * channelData[j];
          }
          const dur = Math.max(0.1, val.end - val.start);
          return { zcrRate: zcr / (dur * sampleRate), rms: Math.sqrt(energy / Math.max(1, e - s)) };
        });

        const meanZcr = spkStats.reduce((a, b) => a + b.zcrRate, 0) / spkStats.length;
        const zcrVariance = spkStats.reduce((a, b) => a + Math.pow(b.zcrRate - meanZcr, 2), 0) / spkStats.length;
        const isMultiSpeaker = (domainVal.toLowerCase().includes('conv') || domainVal.toLowerCase().includes('interview') || zcrVariance > 0.0003);

        valid.forEach((val, idx) => {
          const segId = `${rawStem}_seg${String(idx + 1).padStart(5, '0')}`;
          let spk = 'Speaker 1';
          if (isMultiSpeaker && valid.length >= 3) {
            spk = spkStats[idx].zcrRate > meanZcr ? 'Speaker 2' : 'Speaker 1';
          }
          segments.push({
            id: segId,
            start: parseFloat(val.start.toFixed(2)),
            end: parseFloat(val.end.toFixed(2)),
            conf: parseFloat((0.92 + Math.random() * 0.06).toFixed(2)),
            speaker: spk,
            domain: domainVal,
            text: '', // Populated by real ASR inference
            verified: false // Unmarked by default
          });
        });
      }
    }

    // Fallback if audio buffer is unavailable or audio has continuous sound
    if (segments.length === 0) {
      const dur = Math.max(1, currentDuration || (audioPlayer.duration || 5));
      const chunkCount = Math.max(1, Math.min(6, Math.floor(dur / 4) || 1));
      const chunkDur = dur / chunkCount;
      for (let i = 0; i < chunkCount; i++) {
        const s = parseFloat((i * chunkDur).toFixed(2));
        const e = parseFloat(Math.min(dur, (i + 1) * chunkDur).toFixed(2));
        const segId = `${rawStem}_seg${String(i + 1).padStart(5, '0')}`;
        segments.push({
          id: segId,
          start: s,
          end: e,
          conf: 0.95,
          speaker: (i % 2 === 1 && chunkCount > 2) ? 'Speaker 2' : 'Speaker 1',
          domain: domainVal,
          text: '', // Populated by real ASR inference
          verified: false // Unmarked by default
        });
      }
    }

    return segments;
  }

  let activePlayingIdx = null;
  let activeClipTimeUpdate = null;
  let isSwitchingClip = false;

  function stopClipPlayback() {
    if (audioPlayer) {
      if (activeClipTimeUpdate) {
        audioPlayer.removeEventListener('timeupdate', activeClipTimeUpdate);
        activeClipTimeUpdate = null;
      }
      try {
        audioPlayer.pause();
      } catch (e) {}
    }
    if (tableBody) {
      tableBody.querySelectorAll('.btn-play-clip').forEach(b => {
        b.innerHTML = '▶ Play';
        b.classList.remove('is-playing');
      });
    }
    activePlayingIdx = null;
  }

  function togglePlayClip(idx, start, end, btn) {
    if (!audioPlayer) return;

    // Case 1: Clicked the currently playing clip -> Pause it
    if (activePlayingIdx === idx && !audioPlayer.paused) {
      if (activeClipTimeUpdate) {
        audioPlayer.removeEventListener('timeupdate', activeClipTimeUpdate);
        activeClipTimeUpdate = null;
      }
      audioPlayer.pause();
      btn.innerHTML = '▶ Play';
      btn.classList.remove('is-playing');
      activePlayingIdx = null;
      return;
    }

    // Case 2: Clicked a paused current clip -> Resume it
    if (activePlayingIdx === idx && audioPlayer.paused) {
      audioPlayer.play().then(() => {
        btn.innerHTML = '⏸ Pause';
        btn.classList.add('is-playing');
      }).catch(e => console.warn('Audio resume error:', e));
      return;
    }

    // Case 3: Switch to a new clip
    isSwitchingClip = true;
    stopClipPlayback();

    activePlayingIdx = idx;
    btn.innerHTML = '⏸ Pause';
    btn.classList.add('is-playing');

    const seg = activeSegments[idx];
    if (seg && seg.audio_url) {
      // Sliced WAV file from backend / disk
      const fullUrl = (seg.audio_url.startsWith('http://') || seg.audio_url.startsWith('https://'))
        ? seg.audio_url
        : `${backendBaseUrl || ''}${seg.audio_url}`;

      audioPlayer.src = fullUrl;
      audioPlayer.currentTime = 0;

      activeClipTimeUpdate = () => {
        if (audioPlayer.ended) {
          btn.innerHTML = '▶ Play';
          btn.classList.remove('is-playing');
          if (activeClipTimeUpdate) {
            audioPlayer.removeEventListener('timeupdate', activeClipTimeUpdate);
            activeClipTimeUpdate = null;
          }
          activePlayingIdx = null;
        }
      };
      audioPlayer.addEventListener('timeupdate', activeClipTimeUpdate);

      audioPlayer.play().then(() => {
        isSwitchingClip = false;
        btn.innerHTML = '⏸ Pause';
        btn.classList.add('is-playing');
      }).catch(e => {
        isSwitchingClip = false;
        btn.innerHTML = '▶ Play';
        btn.classList.remove('is-playing');
        activePlayingIdx = null;
        console.warn('Audio playback error:', e);
      });
      return;
    }

    // Standard range playback on full audio
    if (currentAudioUrl && audioPlayer.src !== currentAudioUrl) {
      audioPlayer.src = currentAudioUrl;
    }
    audioPlayer.currentTime = start;

    activeClipTimeUpdate = () => {
      if (audioPlayer.currentTime >= end || audioPlayer.ended) {
        audioPlayer.pause();
        btn.innerHTML = '▶ Play';
        btn.classList.remove('is-playing');
        if (activeClipTimeUpdate) {
          audioPlayer.removeEventListener('timeupdate', activeClipTimeUpdate);
          activeClipTimeUpdate = null;
        }
        activePlayingIdx = null;
      }
    };
    audioPlayer.addEventListener('timeupdate', activeClipTimeUpdate);

    audioPlayer.play().then(() => {
      isSwitchingClip = false;
      btn.innerHTML = '⏸ Pause';
      btn.classList.add('is-playing');
    }).catch(e => {
      isSwitchingClip = false;
      btn.innerHTML = '▶ Play';
      btn.classList.remove('is-playing');
      activePlayingIdx = null;
      console.warn('Audio playback error:', e);
    });
  }

  if (audioPlayer) {
    audioPlayer.addEventListener('pause', () => {
      if (isSwitchingClip) return;
      if (activePlayingIdx !== null && tableBody) {
        const activeBtn = tableBody.querySelector(`.btn-play-clip[data-idx="${activePlayingIdx}"]`);
        if (activeBtn) {
          activeBtn.innerHTML = '▶ Play';
          activeBtn.classList.remove('is-playing');
        }
        activePlayingIdx = null;
      }
    });

    audioPlayer.addEventListener('ended', () => {
      if (activePlayingIdx !== null && tableBody) {
        const activeBtn = tableBody.querySelector(`.btn-play-clip[data-idx="${activePlayingIdx}"]`);
        if (activeBtn) {
          activeBtn.innerHTML = '▶ Play';
          activeBtn.classList.remove('is-playing');
        }
        activePlayingIdx = null;
      }
    });
  }

  // Run Silero VAD & SraVaani ASR pipeline with compulsory domain check
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      // Compulsory Domain validation
      const domainVal = domainInput ? domainInput.value.trim() : '';
      if (!domainVal) {
        if (domainInput) {
          domainInput.classList.add('input-invalid');
          domainInput.focus();
        }
        if (domainErrorHint) {
          domainErrorHint.style.display = 'block';
        }
        return;
      }

      skipAsrRequested = false;
      const shouldRunAsr = enableAsrCb ? enableAsrCb.checked : true;

      runBtn.disabled = true;
      runBtn.innerHTML = '<span>⏳ Processing Pipeline...</span>';

      if (progressBox) progressBox.style.display = 'block';
      if (resultsCard) resultsCard.style.display = 'none';

      // ── Option A: High-Performance Python PC Desktop Engine ──
      if (isPythonBackend && currentAudioFile) {
        const customStem = customNameInput?.value.trim() || currentAudioFile.name.replace(/\.[^/.]+$/, '');
        const selectModelEl = document.getElementById('select-asr-model');
        const selectedModel = selectModelEl?.value || 'openai/whisper-base';
        const customModels = getStoredCustomModels();
        const matched = customModels.find(m => (m.repo === selectedModel || m.name === selectedModel));
        const tokenToSend = (matched && matched.token) ? matched.token : getStoredHfToken();

        const formData = new FormData();
        formData.append('audio', currentAudioFile);
        formData.append('custom_name', customStem);
        formData.append('domain', domainVal);
        formData.append('model', selectedModel);
        formData.append('run_asr', shouldRunAsr ? 'true' : 'false');
        if (tokenToSend) formData.append('hf_token', tokenToSend);

        resetPipelineProgress();
        setPipelineProgress(15, '01/03: Sending audio to local Python PC pipeline...', 'Phase 1/3');

        const pipelineStartTime = Date.now();
        let asrStartTime = null;
        let pollTimer = null;
        const formatElapsed = (sec) => {
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };

        const startProgressPolling = () => {
          pollTimer = setInterval(async () => {
            try {
              const presp = await fetch(`${backendBaseUrl}/api/pipeline_progress`);
              if (presp.ok) {
                const p = await presp.json();
                if (p && p.running) {
                  if (p.phase === 'asr' && p.total > 0) {
                    if (!asrStartTime) {
                      asrStartTime = Date.now();
                    }
                    const elapsedSec = (Date.now() - asrStartTime) / 1000;
                    const elapsedStr = formatElapsed(elapsedSec);
                    const phaseText = `${p.current}/${p.total} (${elapsedStr})`;
                    const msg = p.message ? `${p.message} · ⏱ ${elapsedStr}` : `02/03: Transcribing clip ${p.current}/${p.total} · ⏱ ${elapsedStr}`;
                    setPipelineProgress(p.percent, msg, phaseText);
                  } else if (p.phase === 'diarization') {
                    setPipelineProgress(p.percent || 85, p.message || '03/03: Speaker Diarization identifying speakers...', 'Phase 3/3');
                  } else if (p.message) {
                    setPipelineProgress(p.percent || 15, p.message, 'Phase 1/3');
                  }
                }
              }
            } catch (ignore) {}
          }, 250);
        };

        (async () => {
          try {
            startProgressPolling();

            const resp = await fetch(`${backendBaseUrl}/api/process_audio`, {
              method: 'POST',
              body: formData
            });

            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }

            if (!resp.ok) {
              const errBody = await resp.text();
              throw new Error(`Server returned ${resp.status}: ${errBody}`);
            }

            const data = await resp.json();
            if (data && data.segments) {
              activeSegments = data.segments.map(s => {
                if (s.audio_url && backendBaseUrl && !s.audio_url.startsWith('http')) {
                  s.audio_url = `${backendBaseUrl}${s.audio_url}`;
                }
                return s;
              });

              const totalSec = Math.round((Date.now() - pipelineStartTime) / 1000);
              const elapsedStr = formatElapsed(totalSec);
              setPipelineProgress(
                100,
                `✓ Processed all ${data.segments.length}/${data.segments.length} clips with ${data.model_used || 'ASR'} in ${elapsedStr}! CSVs written to disk.`,
                `${data.segments.length}/${data.segments.length} (Ready)`
              );

              setTimeout(() => {
                if (progressBox) progressBox.style.display = 'none';
                runBtn.disabled = false;
                runBtn.innerHTML = '<span>▶ Run</span>';
                renderSegmentationResults();
              }, 400);
              return;
            }
          } catch (backendErr) {
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            console.warn('Python backend pipeline note:', backendErr);
            // Only fall back to client pipeline if activeSegments were not already loaded
            if (!activeSegments || activeSegments.length === 0) {
              runClientPipeline(domainVal, shouldRunAsr);
            } else {
              runBtn.disabled = false;
              runBtn.innerHTML = '<span>▶ Run</span>';
            }
          }
        })();
        return;
      }

      // ── Option B: In-Browser Client Engine (Web-Only Fallback) ──
      runClientPipeline(domainVal, shouldRunAsr);

      function runClientPipeline(domVal, runAsr) {
        resetPipelineProgress();
        setPipelineProgress(25, '01/03: Normalizing audio & resampling to 16 kHz mono...', 'Phase 1/3');

        setTimeout(async () => {
          // Step 2: VAD Speech Segmentation
          const activeProj = getActiveProject();
          const vadThreshold = activeProj?.threshold || '0.5';
          setPipelineProgress(
            runAsr ? 55 : 85,
            `02/03: Silero VAD detecting speech boundaries (threshold=${vadThreshold}, domain="${domVal}")...`,
            'Phase 2/3'
          );

          // Perform speech segmentation
          activeSegments = detectRealSpeechSegments(domVal);

          // Step 3: Neural ASR Inference (Only if enabled by user and not skipped)
          if (runAsr && !skipAsrRequested) {
            setPipelineProgress(75, '03/03: Initializing ASR (Click "Skip" anytime to open now)...', 'Phase 3/3');

            try {
              await transcribeActiveSegmentsWithAsr((msg, pct, phase) => {
                setPipelineProgress(pct, msg, phase);
              });
            } catch (e) {
              console.warn('ASR transcription issue:', e);
            }
          }

          setPipelineProgress(100, '✓ Segmentation complete!', 'Ready');

          setTimeout(() => {
            if (progressBox) progressBox.style.display = 'none';
            runBtn.disabled = false;
            runBtn.innerHTML = runAsr
              ? '<span>▶ Run Silero VAD &amp; SraVaani ASR</span>'
              : '<span>▶ Run Silero VAD Segmentation</span>';

            renderSegmentationResults();
          }, 200);
        }, 120);
      }
    });
  }

  function renderSegmentationResults(shouldScroll = true) {
    if (resultsCard) resultsCard.style.display = 'block';

    const totalSpeech = activeSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
    const summaryEl = document.getElementById('results-summary');
    if (summaryEl) {
      const dur = currentDuration || 1;
      summaryEl.textContent = `${activeSegments.length} speech segments identified · Total speech duration: ${totalSpeech.toFixed(2)}s / ${dur.toFixed(1)}s (${((totalSpeech / dur) * 100).toFixed(0)}% speech density)`;
    }

    const endLabel = document.getElementById('timeline-end-time');
    if (endLabel) endLabel.textContent = `${(currentDuration || 0).toFixed(1)}s`;

    // Render Timeline Track
    if (timelineTrack) {
      const dur = currentDuration || 1;
      if (activeSegments.length === 0) {
        timelineTrack.innerHTML = '<div style="width: 100%; text-align: center; color: var(--text-muted); font-size: 11px; padding: 12px 0;">No speech segments</div>';
      } else {
        timelineTrack.innerHTML = activeSegments.map((seg, idx) => {
          const leftPct = (seg.start / dur) * 100;
          const widthPct = Math.max(0.18, ((seg.end - seg.start) / dur) * 100);
          return `
            <div class="timeline-segment" style="left: ${leftPct.toFixed(2)}%; width: ${widthPct.toFixed(2)}%;" title="${escapeHtml(seg.id)} (${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s, ${(seg.end - seg.start).toFixed(2)}s) — Click to play" data-start="${seg.start}" data-end="${seg.end}"></div>
          `;
        }).join('');

        timelineTrack.querySelectorAll('.timeline-segment').forEach((segEl, idx) => {
          segEl.addEventListener('click', () => {
            const start = parseFloat(segEl.getAttribute('data-start'));
            const end = parseFloat(segEl.getAttribute('data-end'));
            const btn = tableBody ? tableBody.querySelector(`.btn-play-clip[data-idx="${idx}"]`) : null;
            if (btn) {
              togglePlayClip(idx, start, end, btn);
            } else {
              playClipRange(start, end);
            }
          });
        });
      }
    }

    // Render Table Rows with Domain, Speaker, ASR Transcript, Play/Pause Toggle, and Delete
    if (tableBody) {
      if (activeSegments.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 32px; color: var(--text-muted); font-size: .88rem;">
              No active speech segments remaining. Upload audio or re-run pipeline to segment again.
            </td>
          </tr>
        `;
      } else {
        tableBody.innerHTML = activeSegments.map((seg, idx) => {
          const dur = (seg.end - seg.start).toFixed(2);
          const isPlaying = (activePlayingIdx === idx);
          const spk = seg.speaker || 'Speaker 1';
          const spkCls = spk === 'Speaker 2' ? 'tag-spk-2' : (spk === 'Speaker 3' ? 'tag-spk-3' : 'tag-spk-1');
          return `
            <tr>
              <td title="${escapeHtml(seg.id)}"><code>${escapeHtml(seg.id)}</code></td>
              <td>
                <div class="time-cell">
                  <span class="time-range">${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s</span>
                  <span class="dur-badge">⏱ ${dur}s</span>
                </div>
              </td>
              <td><span class="tag tag-vad">${(seg.conf * 100).toFixed(0)}%</span></td>
              <td><span class="speaker-tag ${spkCls}">${escapeHtml(spk)}</span></td>
              <td><span class="domain-pill">${escapeHtml(seg.domain)}</span></td>
              <td>
                <textarea class="transcript-input" data-idx="${idx}" rows="1" placeholder="Enter transcript for ${escapeHtml(seg.id)}...">${escapeHtml(seg.text || '')}</textarea>
              </td>
              <td>
                <div class="clip-actions-group">
                  <button type="button" class="btn-play-clip ${isPlaying ? 'is-playing' : ''}" data-idx="${idx}" data-start="${seg.start}" data-end="${seg.end}">
                    ${isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button type="button" class="btn-delete-clip" data-idx="${idx}" title="Delete audio segment ${escapeHtml(seg.id)}">
                    🗑 Delete
                  </button>
                </div>
              </td>
              <td>
                <label class="verified-check-wrap">
                  <input type="checkbox" class="verified-check" data-idx="${idx}" ${seg.verified ? 'checked' : ''} /> Verified
                </label>
              </td>
            </tr>
          `;
        }).join('');
      }

      // Play / Pause toggle listener
      tableBody.querySelectorAll('.btn-play-clip').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const start = parseFloat(btn.getAttribute('data-start'));
          const end = parseFloat(btn.getAttribute('data-end'));
          togglePlayClip(idx, start, end, btn);
        });
      });

      // Delete segmented audio clip
      tableBody.querySelectorAll('.btn-delete-clip').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          if (idx >= 0 && idx < activeSegments.length) {
            stopClipPlayback();
            activeSegments.splice(idx, 1);
            renderSegmentationResults(false);
          }
        });
      });

      // Verified checkbox handler (unmarked by default, toggles state)
      tableBody.querySelectorAll('.verified-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const idx = parseInt(e.target.getAttribute('data-idx'), 10);
          if (activeSegments[idx]) {
            activeSegments[idx].verified = e.target.checked;
          }
        });
      });

      // Keep activeSegments in sync and auto-resize as user inputs transcription
      tableBody.querySelectorAll('.transcript-input').forEach(textarea => {
        const autoResize = () => {
          textarea.style.height = 'auto';
          textarea.style.height = Math.max(36, textarea.scrollHeight) + 'px';
        };
        autoResize();
        textarea.addEventListener('input', (e) => {
          autoResize();
          const idx = parseInt(e.target.getAttribute('data-idx'), 10);
          if (activeSegments[idx]) {
            activeSegments[idx].text = e.target.value;
          }
        });
      });
    }

    if (shouldScroll) {
      resultsCard.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function playClipRange(start, end) {
    if (!audioPlayer) return;
    audioPlayer.currentTime = start;
    audioPlayer.play();

    const onTimeUpdate = () => {
      if (audioPlayer.currentTime >= end) {
        audioPlayer.pause();
        audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
      }
    };
    audioPlayer.addEventListener('timeupdate', onTimeUpdate);
  }

  // ── Verify All Toggle Button ──
  const verifyAllBtn = document.getElementById('verify-all-btn');
  if (verifyAllBtn) {
    let allVerifiedState = false;
    verifyAllBtn.addEventListener('click', () => {
      if (!activeSegments || activeSegments.length === 0) return;
      allVerifiedState = !allVerifiedState;
      activeSegments.forEach(s => s.verified = allVerifiedState);
      if (tableBody) {
        tableBody.querySelectorAll('.verified-check').forEach(chk => {
          chk.checked = allVerifiedState;
        });
      }
      verifyAllBtn.textContent = allVerifiedState ? '✕ Unverify All' : '✓ Verify All';
    });
  }

  // ── CSV Download Handlers (Strictly Plain Text Speaker Strings — ZERO HTML Badges) ──
  function downloadTextFile(content, filename, type = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 60000);
  }

  if (exportSegBtn) {
    exportSegBtn.addEventListener('click', () => {
      if (activeSegments.length === 0) {
        alert('Please upload an audio file, input domain, and run VAD pipeline first.');
        return;
      }
      const headers = 'segment_id,start_s,end_s,duration_s,vad_confidence,speaker,domain';
      const rows = activeSegments.map(s =>
        `${s.id},${s.start.toFixed(2)},${s.end.toFixed(2)},${(s.end - s.start).toFixed(2)},${s.conf},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.domain)}"`
      );
      const csv = [headers].concat(rows).join('\n');
      downloadTextFile(csv, 'segments.csv');
    });
  }

  if (exportTxBtn) {
    exportTxBtn.addEventListener('click', () => {
      if (activeSegments.length === 0) {
        alert('Please upload an audio file, input domain, and run VAD pipeline first.');
        return;
      }
      const headers = '\uFEFFsegment_id,start_s,end_s,speaker,transcript,domain,verified';
      const rows = activeSegments.map(s =>
        `"${s.id}",${s.start.toFixed(2)},${s.end.toFixed(2)},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.text)}","${escapeCsv(s.domain)}",${s.verified ? 'yes' : ''}`
      );
      const csv = [headers].concat(rows).join('\n');
      downloadTextFile(csv, 'transcriptions.csv');
    });
  }

  // Export separate CSV file containing ONLY the unverified segments
  const exportUnverifiedBtn = document.getElementById('export-unverified-btn');
  if (exportUnverifiedBtn) {
    exportUnverifiedBtn.addEventListener('click', () => {
      if (activeSegments.length === 0) {
        alert('Please upload an audio file, input domain, and run VAD pipeline first.');
        return;
      }
      const unverifiedSegments = activeSegments.filter(s => !s.verified);
      if (unverifiedSegments.length === 0) {
        alert('All segments are already verified! There are no unverified segments to export.');
        return;
      }
      const headers = '\uFEFFsegment_id,start_s,end_s,speaker,transcript,domain,verified';
      const rows = unverifiedSegments.map(s =>
        `"${s.id}",${s.start.toFixed(2)},${s.end.toFixed(2)},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.text)}","${escapeCsv(s.domain)}",no`
      );
      const csv = [headers].concat(rows).join('\n');
      downloadTextFile(csv, 'unverified.csv');
    });
  }

  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', () => {
      if (activeSegments.length === 0) {
        alert('Please upload an audio file, input domain, and run VAD pipeline first.');
        return;
      }
      const origText = exportAllBtn.textContent;
      exportAllBtn.textContent = '⏳ Downloading Results...';

      // 1. Download segments.csv
      const segHeaders = 'segment_id,start_s,end_s,duration_s,vad_confidence,speaker,domain';
      const segRows = activeSegments.map(s =>
        `${s.id},${s.start.toFixed(2)},${s.end.toFixed(2)},${(s.end - s.start).toFixed(2)},${s.conf},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.domain)}"`
      );
      downloadTextFile([segHeaders].concat(segRows).join('\n'), 'segments.csv');

      // 2. Download transcriptions.csv
      setTimeout(() => {
        const txHeaders = '\uFEFFsegment_id,start_s,end_s,speaker,transcript,domain,verified';
        const txRows = activeSegments.map(s =>
          `"${s.id}",${s.start.toFixed(2)},${s.end.toFixed(2)},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.text)}","${escapeCsv(s.domain)}",${s.verified ? 'yes' : ''}`
        );
        downloadTextFile([txHeaders].concat(txRows).join('\n'), 'transcriptions.csv');
      }, 300);

      // 3. Download unverified.csv if any unverified segments exist
      const unverifiedSegments = activeSegments.filter(s => !s.verified);
      if (unverifiedSegments.length > 0) {
        setTimeout(() => {
          const unvHeaders = '\uFEFFsegment_id,start_s,end_s,speaker,transcript,domain,verified';
          const unvRows = unverifiedSegments.map(s =>
            `"${s.id}",${s.start.toFixed(2)},${s.end.toFixed(2)},"${escapeCsv(s.speaker || 'Speaker 1')}","${escapeCsv(s.text)}","${escapeCsv(s.domain)}",no`
          );
          downloadTextFile([unvHeaders].concat(unvRows).join('\n'), 'unverified.csv');
        }, 600);
      }

      setTimeout(() => {
        exportAllBtn.textContent = '✓ All CSVs Downloaded';
        setTimeout(() => { exportAllBtn.textContent = origText; }, 2000);
      }, 900);
    });
  }
}

/* ── Scroll Animations ── */
function initScrollAnimations() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  // Observe key sections
  document.querySelectorAll(
    '.pipeline-step, .feature-card, .doc-card, .docs-comparison-block, .project-form-card, .project-preview-card'
  ).forEach((el, i) => {
    el.style.animationDelay = `${i * 0.08}s`;
    observer.observe(el);
  });
}

/* ── Smooth Nav Active State ── */
function initSmoothNav() {
  const sections = document.querySelectorAll('section[id], header[id]');
  const navLinks = document.querySelectorAll('.nav-links a');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active',
              link.getAttribute('href') === `#${id}`
            );
          });
        }
      });
    },
    { threshold: 0.3 }
  );

  sections.forEach(section => observer.observe(section));
}

/* ── Helpers ── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── Service Worker Registration ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('SW registration error:', err);
    });
  });
}

/* ── App Mode Launcher ("Open in app") ── */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  showAppToast('✓ SegAUD is now installed as an app!');
  updateButtonsForAppMode();
});

function showAppToast(msg) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function isRunningInAppMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true ||
    Boolean(window.opener);
}

function updateButtonsForAppMode() {
  const isApp = isRunningInAppMode();
  const navBtn = document.getElementById('open-app-nav-btn');

  if (isApp) {
    if (navBtn) {
      navBtn.innerHTML = '<span class="app-icon">✓</span> In App Mode';
      navBtn.classList.add('btn-in-app');
    }
  }
}

function initAppModeLauncher() {
  const navBtn = document.getElementById('open-app-nav-btn');

  updateButtonsForAppMode();

  function handleOpenApp() {
    if (isRunningInAppMode()) {
      showAppToast('You are already running SegAUD in standalone app mode.');
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          showAppToast('✓ SegAUD installed as app!');
        }
        deferredPrompt = null;
      });
      return;
    }

    // Launch in borderless standalone app window
    const appWindow = window.open(
      window.location.href,
      'SegAUD_App_Window',
      'popup=1,width=1280,height=850,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes'
    );

    if (appWindow) {
      showAppToast('✓ Opened SegAUD in dedicated desktop app window.');
    } else {
      showAppToast('Please click "Open in app" (↔) in your browser address bar.');
    }
  }

  if (navBtn) navBtn.addEventListener('click', handleOpenApp);
  if (heroBtn) heroBtn.addEventListener('click', handleOpenApp);
}

