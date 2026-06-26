/**
 * jobRunner.js – Background import job processor
 *
 * Handles all heavy lifting for bulk imports:
 *  1. Collects property URLs from paginated listings (up to 2000)
 *  2. Scrapes each property with controlled concurrency (pLimit)
 *  3. Saves to PostgreSQL via transactions
 *  4. Updates job progress in real-time (every 2 seconds)
 *
 * Jobs are fire-and-forget: POST /api/import returns {jobId} immediately.
 * Frontend polls GET /api/import/status/:jobId for progress.
 * To stop a running job call cancelJob(jobId) – queued tasks are skipped
 * and the job is marked 'cancelled' after in-flight scrapes finish.
 */

const { v4: uuidv4 }  = require('uuid');
const pLimit           = require('p-limit');
const { pool }         = require('./db');
const { scrapeProperty, scrapePaginatedUrls } = require('./scraper');

// ─── Cancellation flags (in-memory) ──────────────────────────────────────────
// Maps jobId → true when the user requests a cancel.
// Checked at the start of every p-limit task so queued scrapes are skipped.
const cancelFlags = new Map();

// ─── Block detection (prevent saving CF block pages) ─────────────────────────
const BLOCK_PATTERNS = [
  'sorry, you have been blocked',
  'você foi bloqueado',
  'access denied',
  'attention required',
  'checking your browser',
];
function isBlockedData(normalized) {
  const text = `${normalized.title} ${normalized.description || ''}`.toLowerCase();
  return BLOCK_PATTERNS.some(p => text.includes(p));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function updateJob(jobId, fields) {
  const keys  = Object.keys(fields);
  const sets  = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const vals  = [...keys.map(k => fields[k]), jobId];
  try {
    await pool.query(`UPDATE jobs SET ${sets}, updated_at = NOW() WHERE id = $${keys.length + 1}`, vals);
  } catch (err) {
    console.error('[JobRunner] updateJob error:', err.message);
  }
}

async function getJob(jobId) {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return rows[0];
}

// ─── Save a single normalized property ───────────────────────────────────────
async function saveProperty(normalized, userId) {
  // Duplicate check
  if (normalized.externalId) {
    const { rows } = await pool.query(
      'SELECT id FROM properties WHERE user_id = $1 AND external_id = $2',
      [userId, normalized.externalId]
    );
    if (rows.length > 0) return { skipped: true, id: rows[0].id };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: propInfo } = await client.query(`
      INSERT INTO properties
        (user_id, external_id, source_url, title, description, price,
         operation_type, property_type, area, bedrooms, suites, bathrooms, parking, age, amenities,
         street, neighborhood, city, state, country)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING id
    `, [
      userId,
      normalized.externalId    || null,
      normalized.sourceUrl     || null,
      normalized.title         || '',
      normalized.description   || '',
      normalized.price         || 0,
      normalized.operationType || 'Venda',
      normalized.propertyType  || 'Apartamento',
      normalized.area          || 0,
      normalized.bedrooms      || 0,
      normalized.suites        || 0,
      normalized.bathrooms     || 0,
      normalized.parking       || 0,
      normalized.age           || 0,
      normalized.amenities     || '[]',
      normalized.street        || '',
      normalized.neighborhood  || '',
      normalized.city          || '',
      normalized.state         || '',
      normalized.country       || 'BR'
    ]);

    const propertyId = propInfo[0].id;

    if (normalized.images?.length > 0) {
      for (let i = 0; i < normalized.images.length; i++) {
        await client.query(
          'INSERT INTO images (property_id, url, is_main, display_order) VALUES ($1,$2,$3,$4)',
          [propertyId, normalized.images[i], i === 0 ? 1 : 0, i]
        );
      }
    }

    await client.query('COMMIT');
    return { skipped: false, id: propertyId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Core job processor ───────────────────────────────────────────────────────
async function processJob(jobId) {
  const job = await getJob(jobId);
  if (!job) { console.warn(`[JobRunner] Job ${jobId} não encontrado.`); return; }
  if (job.status !== 'pending') { console.warn(`[JobRunner] Job ${jobId} já ${job.status}.`); return; }

  const CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY) || 3;
  const LIMIT       = job.limit_total || 1;
  const limit       = pLimit(CONCURRENCY);

  console.log(`[Job ${jobId.slice(0,8)}] Iniciando | mode=${job.mode} | concurrency=${CONCURRENCY} | limit=${LIMIT}`);


  try {
    // ── Phase 1: Collect URLs ────────────────────────────────────────────────
    let urls = [];
    await updateJob(jobId, { status: 'collecting' });

    if (job.mode === 'listing') {
      urls = await scrapePaginatedUrls(job.source_url, LIMIT, ({ found, page }) => {
        updateJob(jobId, { total: found }).catch(()=>{});
        console.log(`[Job ${jobId.slice(0,8)}] Coletando: ${found} URLs (página ${page})`);
      });
    } else {

      urls = [job.source_url];
    }

    if (urls.length === 0) {
      await updateJob(jobId, { status: 'failed', error_msg: 'Nenhum imóvel encontrado na URL informada.' });
      return;
    }

    await updateJob(jobId, { total: urls.length, status: 'running' });
    console.log(`[Job ${jobId.slice(0,8)}] ${urls.length} imóveis para processar.`);

    // ── Phase 2: Scrape + save with concurrency ──────────────────────────────
    let imported = 0, skipped = 0, errors = 0;
    let lastDbFlush = Date.now();

    const flush = (force = false) => {
      if (force || Date.now() - lastDbFlush > 2000) {
        updateJob(jobId, { imported, skipped, errors }).catch(()=>{});
        lastDbFlush = Date.now();
      }
    };

    const tasks = urls.map((url, idx) => limit(async () => {
      // ── Honour cancellation request ──────────────────────────────────────
      if (cancelFlags.get(jobId)) return;

      // Small stagger for first batch (up to CONCURRENCY tasks start nearly simultaneously)
      if (idx < CONCURRENCY) await new Promise(r => setTimeout(r, idx * 400));

      try {
        const normalized = await scrapeProperty(url);

        if (isBlockedData(normalized)) {
          console.warn(`[Job ${jobId.slice(0,8)}] Bloco detectado: ${url.slice(0, 60)}`);
          errors++;
          flush();
          return;
        }

        const result = await saveProperty(normalized, job.user_id);
        if (result.skipped) skipped++;
        else imported++;

      } catch (err) {
        errors++;
        const msg = err.message?.slice(0, 120) || 'Erro desconhecido';
        console.warn(`[Job ${jobId.slice(0,8)}] ✘ ${url.slice(0, 60)}: ${msg}`);
      }

      flush();
    }));

    await Promise.all(tasks);

    // ── Check if the job was cancelled mid-flight ────────────────────────────
    const wasCancelled = cancelFlags.get(jobId);
    cancelFlags.delete(jobId);

    if (wasCancelled) {
      await updateJob(jobId, { imported, skipped, errors, status: 'cancelled' });
      console.log(
        `[Job ${jobId.slice(0,8)}] 🚫 Cancelado — ` +
        `importados=${imported} skipped=${skipped} errors=${errors}`
      );
    } else {
      // Final flush
      await updateJob(jobId, { imported, skipped, errors, status: 'done' });
      console.log(
        `[Job ${jobId.slice(0,8)}] ✅ Concluído — ` +
        `importados=${imported} skipped=${skipped} errors=${errors}`
      );
    }

  } catch (err) {
    const msg = err.message?.slice(0, 500) || 'Erro inesperado';
    await updateJob(jobId, { status: 'failed', error_msg: msg });
    console.error(`[Job ${jobId.slice(0,8)}] ❌ Falha:`, msg);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new import job and fires it in the background.
 * @returns {string} jobId (UUID)
 */
async function createJob(userId, url, mode = 'single', limit = 1) {
  const jobId = uuidv4();
  await pool.query(
    'INSERT INTO jobs (id, user_id, source_url, mode, limit_total) VALUES ($1,$2,$3,$4,$5)',
    [jobId, userId, url, mode, limit]
  );

  // Fire-and-forget: non-blocking background execution
  setImmediate(() => {
    processJob(jobId).catch(err => {
      console.error('[JobRunner] Uncaught error in processJob:', err.message);
      try {
        updateJob(jobId, { status: 'failed', error_msg: err.message?.slice(0, 500) }).catch(()=>{});
      } catch (_) {}
    });
  });

  console.log(`[JobRunner] Job criado: ${jobId.slice(0, 8)} | user=${userId.slice(0,8)} | mode=${mode}`);
  return jobId;
}

/**
 * Requests cancellation of an active job.
 * Queued tasks are skipped; in-flight scrapes complete naturally.
 * @param {string} jobId
 */
async function cancelJob(jobId) {
  cancelFlags.set(jobId, true);
  // Immediately reflect in DB so the UI updates without waiting for Promise.all
  try {
    await updateJob(jobId, { status: 'cancelled' });
  } catch (_) {}
  console.log(`[JobRunner] 🚫 Cancelamento solicitado para ${jobId.slice(0,8)}`);
}

module.exports = { createJob, cancelJob };
