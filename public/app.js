'use strict';

// ══════════════════════════════════════════════════════
// ZapXML Dashboard – Application Logic v2.0
// ══════════════════════════════════════════════════════

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE  = '';
const USER_KEY  = 'zapxml_user_id';

// ─── State ───────────────────────────────────────────────────────────────────
let userId       = null;
let properties   = [];
let currentView  = 'dashboard';
let importMode   = 'single';
let tunnelUrl    = null;

// ─── DOM helpers ─────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const el = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ─── UUID generator ───────────────────────────────────────────────────────────
function generateUUID() {
  return ([1e7]+'-'+1e3+'-'+4e3+'-'+8e3+'-'+1e11).replace(/[018]/g,
    c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ─── Toast notifications ───────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '⚠️', info: 'ℹ️' };
  const tc = $('toast-container');

  const t = el('div', `toast ${type}`, `<span>${icons[type]}</span> ${message}`);
  tc.appendChild(t);

  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ─── View switching ────────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;

  // Hide all views
  ['dashboard', 'import', 'feed'].forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.hidden = v !== view;
  });

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Update topbar titles
  const titles = {
    dashboard: ['Dashboard', 'Seus imóveis importados'],
    import:    ['Importar Imóveis', 'Cole uma URL do Zap Imóveis'],
    feed:      ['Meu Feed XML', 'URL pública para o ImovelWeb CRM'],
  };
  const [title, sub] = titles[view] || ['', ''];
  $('topbar-title').textContent = title;
  $('topbar-sub').textContent   = sub;

  // Trigger side effects
  if (view === 'feed') loadFeedPreview();
}

// Sidebar nav listeners
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(item.dataset.view);
  });
});

// ─── User initialization ──────────────────────────────────────────────────────
async function initUser() {
  // Check URL query parameters first for userId (e.g. ?userId=...)
  const params = new URLSearchParams(window.location.search);
  const queryUserId = params.get('userId');
  
  if (queryUserId) {
    userId = queryUserId;
    localStorage.setItem(USER_KEY, userId);
    // Clean up query param from URL bar without reloading
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
  } else {
    // Get or create UUID from localStorage
    userId = localStorage.getItem(USER_KEY);
    if (!userId) {
      userId = generateUUID();
      localStorage.setItem(USER_KEY, userId);
    }
  }

  // Register user in DB
  try {
    const res = await fetch(`${API_BASE}/api/users/init`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    });
    if (!res.ok) throw new Error('Failed to init user');
  } catch (err) {
    console.warn('[User] Could not register user:', err.message);
  }

  // Set feed URLs
  updateFeedUrls();
}

function updateFeedUrls() {
  if (!userId) return;
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const origin = (tunnelUrl && isLocal) ? tunnelUrl : window.location.origin;
  const feedUrl = `${origin}/feed/${userId}.xml`;
  
  $('feed-chip-url').textContent   = feedUrl;
  $('feed-url-display').textContent = feedUrl;

  const openBtn = $('feed-open-btn');
  if (openBtn) openBtn.href = feedUrl;
}

// ─── Server status ─────────────────────────────────────────────────────────────
async function checkStatus() {
  const statusEl = $('sidebar-status');
  try {
    const res  = await fetch('/status', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const ok   = data.status === 'online' && data.db === 'connected';
    statusEl.className = `sidebar-status ${ok ? 'online' : 'offline'}`;
    statusEl.querySelector('.status-text').textContent = ok ? 'Online' : 'DB Error';

    if (ok && data.tunnelUrl) {
      if (tunnelUrl !== data.tunnelUrl) {
        tunnelUrl = data.tunnelUrl;
        updateFeedUrls();
      }
    }
  } catch {
    statusEl.className = 'sidebar-status offline';
    statusEl.querySelector('.status-text').textContent = 'Offline';
  }
}

// ─── Load properties ───────────────────────────────────────────────────────────
async function loadProperties() {
  if (!userId) return;

  $('loading-state').hidden = false;
  $('empty-state').hidden   = true;
  $('properties-grid').hidden = true;

  try {
    const res  = await fetch(`${API_BASE}/api/properties?userId=${userId}`);
    if (!res.ok) throw new Error('Erro ao carregar imóveis.');
    const data = await res.json();
    properties = data.properties || [];

    renderProperties(properties);
    $('stat-count').textContent = `${properties.length} imóvel${properties.length !== 1 ? 's' : ''}`;

  } catch (err) {
    toast(err.message, 'error');
    console.error(err);
  } finally {
    $('loading-state').hidden = true;
  }
}

// ─── Render property grid ──────────────────────────────────────────────────────
function renderProperties(list) {
  const grid = $('properties-grid');
  grid.innerHTML = '';

  if (!list || list.length === 0) {
    $('empty-state').hidden   = false;
    $('properties-grid').hidden = true;
    return;
  }

  $('empty-state').hidden   = true;
  $('properties-grid').hidden = false;

  list.forEach(prop => {
    const card = buildPropertyCard(prop);
    grid.appendChild(card);
  });
}

function buildPropertyCard(prop) {
  const mainImg  = prop.main_image || (prop.images && prop.images[0]?.url) || null;
  const price    = prop.price > 0 ? `R$ ${Number(prop.price).toLocaleString('pt-BR')}` : 'Preço a consultar';
  const location = [prop.neighborhood, prop.city, prop.state].filter(Boolean).join(', ') || 'Localização não informada';
  const isAluguel = (prop.operation_type || '').toLowerCase().includes('aluguel');

  const card = el('article', 'prop-card');
  card.setAttribute('data-id', prop.id);

  // Photo
  if (mainImg) {
    const img = el('img', 'prop-card-photo');
    img.src     = mainImg;
    img.alt     = prop.title || 'Imóvel';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); card.insertBefore(placeholder(), card.firstChild); };
    card.appendChild(img);
  } else {
    card.appendChild(placeholder());
  }

  function placeholder() {
    const ph = el('div', 'prop-card-photo-placeholder');
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = '🏠';
    return ph;
  }

  const body = el('div', 'prop-card-body');
  body.innerHTML = `
    <span class="prop-card-type">${prop.property_type || 'Imóvel'}</span>
    <div class="prop-card-title" title="${escHtml(prop.title || '')}">${escHtml(prop.title || 'Sem título')}</div>
    <div class="prop-card-location" title="${escHtml(location)}">📍 ${escHtml(location)}</div>
    <div class="prop-card-attrs">
      ${prop.area      > 0 ? `<span class="prop-attr">📐 ${prop.area}m²</span>` : ''}
      ${prop.bedrooms  > 0 ? `<span class="prop-attr">🛏 ${prop.bedrooms}</span>` : ''}
      ${prop.bathrooms > 0 ? `<span class="prop-attr">🚿 ${prop.bathrooms}</span>` : ''}
      ${prop.parking   > 0 ? `<span class="prop-attr">🚗 ${prop.parking}</span>` : ''}
    </div>
    <div class="prop-card-footer">
      <span class="prop-card-price ${isAluguel ? 'aluguel' : ''}">${price}${isAluguel ? '/mês' : ''}</span>
      <button class="btn-delete" data-id="${prop.id}" aria-label="Remover imóvel">🗑 Remover</button>
    </div>
  `;

  card.appendChild(body);

  // Delete listener
  body.querySelector('.btn-delete').addEventListener('click', () => deleteProperty(prop.id, card));

  return card;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Delete property ────────────────────────────────────────────────────────────
async function deleteProperty(id, cardEl) {
  if (!confirm('Remover este imóvel do feed?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/property/${id}?userId=${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao remover.');
    }

    // Animate out
    cardEl.style.transition = 'opacity .25s, transform .25s';
    cardEl.style.opacity    = '0';
    cardEl.style.transform  = 'scale(.95)';
    setTimeout(() => {
      cardEl.remove();
      properties = properties.filter(p => p.id !== id);
      $('stat-count').textContent = `${properties.length} imóvel${properties.length !== 1 ? 's' : ''}`;
      if (properties.length === 0) {
        $('empty-state').hidden   = false;
        $('properties-grid').hidden = true;
      }
    }, 250);

    toast('Imóvel removido com sucesso.', 'success');

  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── Search filter ──────────────────────────────────────────────────────────────
$('search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = properties.filter(p => {
    const haystack = `${p.title} ${p.city} ${p.neighborhood} ${p.property_type}`.toLowerCase();
    return haystack.includes(q);
  });
  renderProperties(filtered);
});

// ─── Import logic (background jobs + polling) ─────────────────────────────────
let pollingInterval = null;
let activeJobId     = null;

const STATUS_ICONS = {
  pending:    '⏳',
  collecting: '🔍',
  running:    '⚙️',
  done:       '✅',
  failed:     '❌',
  cancelled:  '🚫',
};

const STATUS_LABELS = {
  pending:    'Na fila...',
  collecting: 'Coletando imóveis da listagem...',
  running:    'Extraindo dados...',
  done:       'Importação concluída!',
  failed:     'Falha na importação.',
  cancelled:  'Importação cancelada.',
};


function formatEta(secs) {
  if (!secs || secs <= 0) return '';
  if (secs < 60)   return `~${secs}s restantes`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m >= 60
    ? `~${Math.floor(m / 60)}h ${m % 60}min`
    : `~${m}min ${s > 0 ? s + 's' : ''}`;
}

function updateProgressUI(job) {
  const progEl  = $('import-progress');
  const labelEl = $('progress-label');
  const fillEl  = $('progress-fill');
  const cancelBtn = $('import-cancel-btn');
  if (!progEl) return;

  progEl.hidden = false;

  const isActive = ['pending', 'collecting', 'running'].includes(job.status);
  if (cancelBtn) cancelBtn.hidden = !isActive;

  const processed = job.processed ?? (job.imported + job.skipped + job.errors);

  const pct       = job.pct ?? (job.total > 0 ? Math.round(processed / job.total * 100) : 0);
  const icon      = STATUS_ICONS[job.status] || '⏳';
  const eta       = job.eta_seconds ? ` — ${formatEta(job.eta_seconds)}` : '';

  if (job.status === 'collecting') {
    // Indeterminate: show URL count collected so far
    labelEl.textContent = `${icon} Coletando imóveis... ${job.total > 0 ? job.total + ' encontrados' : ''}`;
    fillEl.style.cssText = ''; // let CSS animation play
  } else if (job.status === 'running') {
    labelEl.textContent = `${icon} Extraindo: ${processed}/${job.total} imóveis (${pct}%)${eta}`;
    // Switch to determinate mode
    fillEl.style.animation  = 'none';
    fillEl.style.marginLeft = '0';
    fillEl.style.width      = `${pct}%`;
  } else if (job.status === 'done') {
    let msg = `✅ ${job.imported} importados`;
    if (job.skipped > 0) msg += `, ${job.skipped} duplicados`;
    if (job.errors  > 0) msg += `, ${job.errors} erros`;
    labelEl.textContent = msg;
    fillEl.style.animation  = 'none';
    fillEl.style.marginLeft = '0';
    fillEl.style.width      = '100%';
  } else if (job.status === 'failed') {
    labelEl.textContent = `❌ Erro: ${job.error_msg || 'desconhecido'}`;
    fillEl.style.width  = '100%';
    fillEl.style.background = 'var(--error, #ef4444)';
  } else {
    labelEl.textContent = `${icon} ${STATUS_LABELS[job.status] || 'Processando...'}`;
  }
}

function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

function startPolling(jobId) {
  stopPolling();
  activeJobId = jobId;

  pollingInterval = setInterval(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/import/status/${jobId}?userId=${userId}`);
      if (!res.ok) { stopPolling(); return; }
      const { job } = await res.json();

      updateProgressUI(job);
      renderJobHistory(); // refresh sidebar job list

      if (['done', 'failed'].includes(job.status)) {
        stopPolling();
        [$('qi-btn-single'), $('qi-btn-listing'), $('import-btn')].forEach(b => { if (b) b.disabled = false; });

        if (job.status === 'done') {
          let msg = `✅ ${job.imported} imóvel${job.imported !== 1 ? 's' : ''} importado${job.imported !== 1 ? 's' : ''}`;
          if (job.skipped > 0) msg += `, ${job.skipped} duplicado${job.skipped !== 1 ? 's' : ''}`;
          if (job.errors  > 0) msg += `, ${job.errors} erro${job.errors !== 1 ? 's' : ''}`;
          toast(msg, 'success', 7000);
          await loadProperties();
          if (currentView === 'import') switchView('dashboard');
        } else {
          toast(`❌ ${job.error_msg || 'Erro durante importação'}`, 'error', 8000);
        }

        // Hide progress after 5 seconds
        setTimeout(() => {
          const p = $('import-progress');
          if (p && activeJobId === jobId) { p.hidden = true; }
        }, 5000);
      }
    } catch (err) {
      console.warn('[Polling] Erro:', err.message);
    }
  }, 2000); // poll every 2 seconds
}

async function runImport(url, mode, customLimit) {
  if (!url.trim()) { toast('Cole uma URL do Zap Imóveis.', 'error'); return; }
  try { new URL(url); } catch { toast('URL inválida. Use https://...', 'error'); return; }

  [$('qi-btn-single'), $('qi-btn-listing'), $('import-btn')].forEach(b => { if (b) b.disabled = true; });

  // Show initial progress state
  const prog = $('import-progress');
  const fill = $('progress-fill');
  if (prog) {
    prog.hidden = false;
    if (fill) { fill.style = ''; } // reset to CSS animation
    $('progress-label').textContent =
      mode === 'listing' ? '🔍 Iniciando coleta da listagem...' : '🔍 Iniciando extração...';
  }

  try {
    const res  = await fetch(`${API_BASE}/api/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url, mode, userId, limit: customLimit }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const { jobId } = data;
    activeJobId = jobId;
    startPolling(jobId);

    const modeLabel = mode === 'listing' ? 'listagem (pode levar vários minutos)' : 'imóvel';
    toast(`⚙️ Importação da ${modeLabel} iniciada!`, 'info', 5000);

  } catch (err) {
    toast(`Erro ao iniciar importação: ${err.message}`, 'error', 6000);
    if (prog) prog.hidden = true;
    [$('qi-btn-single'), $('qi-btn-listing'), $('import-btn')].forEach(b => { if (b) b.disabled = false; });
  }
}

// ─── Cancel Job API Call ─────────────────────────────────────────────────────
async function requestCancelJob(jobId) {
  if (!confirm('Deseja realmente cancelar este trabalho de importação?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/import/cancel/${jobId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Erro ao cancelar.');
    }
    toast('Solicitação de cancelamento enviada.', 'info');
    renderJobHistory();
  } catch (err) {
    toast(`Erro: ${err.message}`, 'error');
  }
}

// ─── Jobs history (recent imports) ───────────────────────────────────────────
async function renderJobHistory() {
  const container = $('jobs-history');
  if (!container || !userId) return;

  try {
    const res  = await fetch(`${API_BASE}/api/import/jobs?userId=${userId}`);
    if (!res.ok) return;
    const { jobs } = await res.json();
    if (!jobs?.length) { container.innerHTML = '<p class="jobs-empty">Nenhuma importação ainda.</p>'; return; }

    container.innerHTML = jobs.map(job => {
      const pct      = job.pct || 0;
      const icon     = STATUS_ICONS[job.status] || '⏳';
      const isActive = ['pending','collecting','running'].includes(job.status);
      const processed= job.processed || 0;
      const dateStr  = new Date(job.created_at.replace(' ','T')+'Z').toLocaleString('pt-BR');
      const shortUrl = job.source_url.length > 45 ? job.source_url.slice(0,45)+'…' : job.source_url;

      return `
        <div class="job-item job-${job.status}" data-job-id="${job.id}">
          <div class="job-item-header">
            <span class="job-item-icon">${icon}</span>
            <div class="job-item-info">
              <span class="job-item-url" title="${escHtml(job.source_url)}">${escHtml(shortUrl)}</span>
              <span class="job-item-date">${dateStr}</span>
            </div>
            ${isActive ? `
              <button class="btn-cancel job-item-cancel" data-id="${job.id}">
                <span aria-hidden="true">🚫</span> Cancelar
              </button>
            ` : `
              <span class="job-badge job-badge-${job.status}">${job.status.toUpperCase()}</span>
            `}
          </div>
          ${isActive ? `
            <div class="job-mini-progress">
              <div class="job-mini-fill" style="width:${pct}%"></div>
            </div>
            <div class="job-item-stats">${processed}${job.total > 0 ? '/'+job.total : ''} processados</div>
          ` : `
            <div class="job-item-stats">
              ${job.imported > 0 ? `✅ ${job.imported} importados ` : ''}
              ${job.skipped > 0  ? `⏭ ${job.skipped} duplicados ` : ''}
              ${job.errors > 0   ? `⚠️ ${job.errors} erros` : ''}
              ${job.status === 'cancelled' ? `🚫 Cancelado` : ''}
              ${job.error_msg    ? `<span class="job-error-msg">${escHtml(job.error_msg.slice(0,60))}</span>` : ''}
            </div>
          `}
        </div>`;
    }).join('');

  } catch (err) {
    console.warn('[Jobs] Erro ao carregar histórico:', err.message);
  }
}

// Add history delegation
const jobsHistory = $('jobs-history');
if (jobsHistory) {
  jobsHistory.addEventListener('click', (e) => {
    const btn = e.target.closest('.job-item-cancel');
    if (btn) requestCancelJob(btn.dataset.id);
  });
}

// Add main progress cancel button
const mainCancelBtn = $('import-cancel-btn');
if (mainCancelBtn) {
  mainCancelBtn.addEventListener('click', () => {
    if (activeJobId) requestCancelJob(activeJobId);
  });
}



// Quick import bar
$('qi-btn-single').addEventListener('click', () => {
  runImport($('qi-url').value.trim(), 'single', 1);
});
$('qi-btn-listing').addEventListener('click', () => {
  const limit = parseInt($('qi-limit').value);
  runImport($('qi-url').value.trim(), 'listing', limit);
});


$('qi-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runImport($('qi-url').value.trim(), importMode);
});

// Mode selector in import view
const updateImportUI = () => {
  const modeSingle = $('mode-single');
  const modeListing = $('mode-listing');
  const limitGroup = $('import-limit-group');
  if (modeSingle) modeSingle.classList.toggle('active', importMode === 'single');
  if (modeListing) modeListing.classList.toggle('active', importMode === 'listing');
  if (limitGroup) limitGroup.hidden = importMode !== 'listing';
};

if ($('mode-single')) {
  $('mode-single').addEventListener('click', () => {
    importMode = 'single';
    updateImportUI();
  });
}

if ($('mode-listing')) {
  $('mode-listing').addEventListener('click', () => {
    importMode = 'listing';
    updateImportUI();
  });
}


const importBtn = $('import-btn');
if (importBtn) {
  importBtn.addEventListener('click', () => {
    const url   = $('import-url').value.trim();
    const limit = importMode === 'listing' ? parseInt($('import-limit').value) : 1;
    runImport(url, importMode, limit);
  });
}


// ─── Copy feed URL ──────────────────────────────────────────────────────────────
async function copyFeedUrl() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const origin = (tunnelUrl && isLocal) ? tunnelUrl : window.location.origin;
  const url = `${origin}/feed/${userId}.xml`;
  try {
    await navigator.clipboard.writeText(url);
    toast('URL do feed copiada!', 'success');
  } catch {
    // Fallback
    const ta = Object.assign(document.createElement('textarea'), { value: url, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast('URL do feed copiada!', 'success');
  }
}

$('feed-chip-copy').addEventListener('click', copyFeedUrl);
$('feed-copy-btn').addEventListener('click', copyFeedUrl);
$('feed-chip').addEventListener('click', (e) => {
  if (!e.target.closest('.feed-chip-copy')) copyFeedUrl();
});

// ─── Load feed XML preview ──────────────────────────────────────────────────────
async function loadFeedPreview() {
  const previewEl = $('feed-xml-preview');
  const loadingEl = $('feed-loading');

  previewEl.hidden = true;
  loadingEl.hidden = false;

  try {
    const res = await fetch(`/feed/${userId}.xml`);
    if (!res.ok) throw new Error('Erro ao carregar feed.');
    const xml = await res.text();

    // Show preview (first 6000 chars)
    previewEl.textContent = xml.length > 6000 ? xml.slice(0, 6000) + '\n...' : xml;
    previewEl.hidden = false;
  } catch (err) {
    previewEl.textContent = `<!-- Erro ao carregar feed: ${err.message} -->`;
    previewEl.hidden = false;
  } finally {
    loadingEl.hidden = true;
  }
}

$('feed-refresh-btn').addEventListener('click', loadFeedPreview);

// ─── Cleanup blocked data ──────────────────────────────────────────────────────
const cleanupBtn = $('cleanup-btn');
if (cleanupBtn) {
  cleanupBtn.addEventListener('click', async () => {
    if (!confirm('Remover todos os imóveis com dados bloqueados (ex: "Sorry, you have been blocked")?')) return;
    cleanupBtn.disabled = true;
    try {
      const res  = await fetch(`${API_BASE}/api/properties/cleanup?userId=${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao limpar.');
      if (data.removed > 0) {
        toast(`🧹 ${data.removed} imóvel(s) bloqueado(s) removido(s).`, 'success');
        await loadProperties();
      } else {
        toast('Nenhum dado bloqueado encontrado.', 'info');
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, 'error');
    } finally {
      cleanupBtn.disabled = false;
    }
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  await initUser();
  checkStatus();
  setInterval(checkStatus, 30000);
  loadProperties();
  renderJobHistory();
  // Refresh job history every 10s (in case user came back with active jobs)
  setInterval(renderJobHistory, 10000);
}

// ─── Navent API Sync ──────────────────────────────────────────────────────────
const btnSyncNavent = $('btnSyncNavent');
if (btnSyncNavent) {
  btnSyncNavent.addEventListener('click', async () => {
    const user = $('naventUser').value.trim();
    const pass = $('naventPass').value.trim();
    const feedback = $('naventFeedback');
    
    if (!user || !pass) {
      toast('Preencha o Usuário e a Senha da Navent', 'error');
      return;
    }

    btnSyncNavent.disabled = true;
    btnSyncNavent.innerHTML = '<span class="btn-icon" aria-hidden="true">⏳</span> Sincronizando...';
    feedback.hidden = true;

    try {
      const res = await fetch(`${API_BASE}/api/navent/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user,
          password: pass,
          userId: userId
        })
      });

      const data = await res.json();
      
      feedback.hidden = false;
      if (res.ok) {
        toast('Sincronização com Navent concluída com sucesso!', 'success');
        feedback.className = 'import-result success';
        feedback.innerHTML = `✅ <strong>Sucesso:</strong> ${data.message || 'Imóveis enviados.'}`;
      } else {
        toast('Erro ao sincronizar com Navent.', 'error');
        feedback.className = 'import-result error';
        feedback.innerHTML = `❌ <strong>Erro:</strong> ${data.error || 'Falha na comunicação'}<br><small>${data.details || ''}</small>`;
      }
    } catch (err) {
      toast(`Erro de conexão: ${err.message}`, 'error');
      feedback.hidden = false;
      feedback.className = 'import-result error';
      feedback.innerHTML = `❌ <strong>Erro:</strong> ${err.message}`;
    } finally {
      btnSyncNavent.disabled = false;
      btnSyncNavent.innerHTML = '<span class="btn-icon" aria-hidden="true">🔄</span> Sincronizar Agora';
    }
  });
}

boot();
