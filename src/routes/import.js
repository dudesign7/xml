const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { createJob, cancelJob } = require('../jobRunner');

// ─── URL validation ───────────────────────────────────────────────────────────
function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ─── POST /api/import – creates a background job ─────────────────────────────
router.post('/', (req, res) => {
  const { url, mode = 'single', userId, limit: userLimit } = req.body;

  if (!url || !userId) {
    return res.status(400).json({ error: 'URL e userId são obrigatórios.' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL inválida. Use o formato https://www.zapimoveis.com.br/...' });
  }

  // Determine limit
  const globalMax = parseInt(process.env.MAX_LISTING_PROPERTIES) || 2000;
  let limit = mode === 'single' ? 1 : (parseInt(userLimit) || globalMax);

  // Safety check
  if (limit > globalMax) limit = globalMax;
  if (limit < 1) limit = 1;

  // Verify user exists
  const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!userExists) {
    return res.status(404).json({ error: 'Usuário não encontrado. Recarregue a página.' });
  }

  // Limit to 3 concurrent active jobs per user
  const activeCount = db.prepare(
    `SELECT COUNT(*) as n FROM jobs WHERE user_id = ? AND status IN ('pending','collecting','running')`
  ).get(userId)?.n ?? 0;

  if (activeCount >= 3) {
    return res.status(429).json({
      error: 'Você já tem 3 importações em andamento. Aguarde uma terminar antes de iniciar outra.',
    });
  }

  const jobId = createJob(userId, url, mode, limit);

  return res.status(202).json({
    jobId,
    status:  'started',
    message: mode === 'listing'
      ? 'Importação em massa iniciada. Acompanhe o progresso pelo jobId.'
      : 'Importação iniciada em background.',
  });
});

// ─── GET /api/import/status/:jobId – poll for progress ───────────────────────
router.get('/status/:jobId', (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.query;

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });

  // Optional ownership check
  if (userId && job.user_id !== userId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  // Compute derived fields
  const processed = job.imported + job.skipped + job.errors;
  const pct = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;

  // ETA estimation (seconds remaining) based on current rate
  const createdMs  = new Date(job.created_at.replace(' ', 'T') + 'Z').getTime();
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
router.get('/jobs', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const jobs = db.prepare(
    `SELECT id, status, mode, source_url, total, imported, skipped, errors,
            error_msg, created_at, updated_at
     FROM jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 20`
  ).all(userId).map(job => {
    const processed = job.imported + job.skipped + job.errors;
    return { ...job, processed, pct: job.total > 0 ? Math.round(processed / job.total * 100) : 0 };
  });

  return res.json({ jobs });
});

// ─── POST /api/import/cancel/:jobId – cancel an active job ───────────────────
router.post('/cancel/:jobId', (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const job = db.prepare('SELECT id, status, user_id FROM jobs WHERE id = ?').get(jobId);
  if (!job || job.user_id !== userId) {
    return res.status(404).json({ error: 'Job não encontrado.' });
  }

  const ACTIVE = ['pending', 'collecting', 'running'];
  if (!ACTIVE.includes(job.status)) {
    return res.status(409).json({ error: `Job já está ${job.status}.` });
  }

  cancelJob(jobId);
  return res.json({ success: true, message: 'Cancelamento solicitado. Os scrapes em andamento terminarão naturalmente.' });
});

// ─── DELETE /api/import/jobs/:jobId – remove a finished job ──────────────────
router.delete('/jobs/:jobId', (req, res) => {
  const { jobId }  = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  const job = db.prepare('SELECT id, status, user_id FROM jobs WHERE id = ?').get(jobId);
  if (!job || job.user_id !== userId) return res.status(404).json({ error: 'Job não encontrado.' });

  if (['pending', 'collecting', 'running'].includes(job.status)) {
    return res.status(409).json({ error: 'Não é possível remover um job em andamento.' });
  }

  db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  return res.json({ success: true });
});

module.exports = router;
