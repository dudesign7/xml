const express = require('express');
const router  = express.Router();
const { pool }  = require('../db');
const { createJob, cancelJob } = require('../jobRunner');

// ─── URL validation ───────────────────────────────────────────────────────────
function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ─── POST /api/import – creates a background job ─────────────────────────────
router.post('/', async (req, res) => {
  const { url, mode = 'single', userId, limit: userLimit } = req.body;

  if (!url || !userId) {
    return res.status(400).json({ error: 'URL e userId são obrigatórios.' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL inválida. Use o formato https://www.zapimoveis.com.br/... ou https://www.vivareal.com.br/...' });
  }

  // Determine limit
  const globalMax = parseInt(process.env.MAX_LISTING_PROPERTIES) || 2000;
  let limit = mode === 'single' ? 1 : (parseInt(userLimit) || globalMax);

  // Safety check
  if (limit > globalMax) limit = globalMax;
  if (limit < 1) limit = 1;

  // Verify user exists
  const { rows: users } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (users.length === 0) {
    return res.status(404).json({ error: 'Usuário não encontrado. Recarregue a página.' });
  }

  // Limit to 3 concurrent active jobs per user
  const { rows: jobs } = await pool.query(
    `SELECT COUNT(*) as n FROM jobs WHERE user_id = $1 AND status IN ('pending','collecting','running')`,
    [userId]
  );
  const activeCount = parseInt(jobs[0]?.n || 0, 10);

  if (activeCount >= 3) {
    return res.status(429).json({
      error: 'Você já tem 3 importações em andamento. Aguarde uma terminar antes de iniciar outra.',
    });
  }

  const jobId = await createJob(userId, url, mode, limit);

  return res.status(202).json({
    jobId,
    status:  'started',
    message: mode === 'listing'
      ? 'Importação em massa iniciada. Acompanhe o progresso pelo jobId.'
      : 'Importação iniciada em background.',
  });
});

// ─── GET /api/import/status/:jobId – poll for progress ───────────────────────
router.get('/status/:jobId', async (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.query;

  const { rows: jobRows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (jobRows.length === 0) return res.status(404).json({ error: 'Job não encontrado.' });
  const job = jobRows[0];

  // Optional ownership check
  if (userId && job.user_id !== userId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  // Compute derived fields
  const processed = job.imported + job.skipped + job.errors;
  const pct = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;

  // ETA estimation (seconds remaining) based on current rate
  // In postgres, created_at is a JS Date object already.
  const createdMs  = new Date(job.created_at).getTime();
  const elapsedMs  = Date.now() - createdMs;
  const rate       = processed / (elapsedMs / 1000); // props/s
  const remaining  = job.total - processed;
  const etaSecs    = (rate > 0 && remaining > 0) ? Math.round(remaining / rate) : null;

  return res.json({
    job: {
      ...job,
      processed,
      pct,
      eta_seconds: etaSecs,
    },
  });
});

// ─── GET /api/import/jobs?userId= – recent jobs list ─────────────────────────
router.get('/jobs', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const { rows } = await pool.query(
    `SELECT id, status, mode, source_url, total, imported, skipped, errors,
            error_msg, created_at, updated_at
     FROM jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId]
  );
  
  const jobs = rows.map(job => {
    const processed = job.imported + job.skipped + job.errors;
    return { ...job, processed, pct: job.total > 0 ? Math.round(processed / job.total * 100) : 0 };
  });

  return res.json({ jobs });
});

// ─── POST /api/import/cancel/:jobId – cancel an active job ───────────────────
router.post('/cancel/:jobId', async (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const { rows: jobRows } = await pool.query('SELECT id, status, user_id FROM jobs WHERE id = $1', [jobId]);
  if (jobRows.length === 0) return res.status(404).json({ error: 'Job não encontrado.' });
  const job = jobRows[0];

  if (job.user_id !== userId) {
    return res.status(404).json({ error: 'Job não encontrado.' });
  }

  const ACTIVE = ['pending', 'collecting', 'running'];
  if (!ACTIVE.includes(job.status)) {
    return res.status(409).json({ error: `Job já está ${job.status}.` });
  }

  await cancelJob(jobId);
  return res.json({ success: true, message: 'Cancelamento solicitado. Os scrapes em andamento terminarão naturalmente.' });
});

// ─── DELETE /api/import/jobs/:jobId – remove a finished job ──────────────────
router.delete('/jobs/:jobId', async (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const { rows: jobRows } = await pool.query('SELECT id, status, user_id FROM jobs WHERE id = $1', [jobId]);
  if (jobRows.length === 0) return res.status(404).json({ error: 'Job não encontrado.' });
  const job = jobRows[0];
  
  if (job.user_id !== userId) return res.status(404).json({ error: 'Job não encontrado.' });

  if (['pending', 'collecting', 'running'].includes(job.status)) {
    return res.status(409).json({ error: 'Não é possível remover um job em andamento.' });
  }

  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  return res.json({ success: true });
});

module.exports = router;
