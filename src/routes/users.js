const express = require('express');
const router  = express.Router();
const { db }  = require('../db');

/**
 * POST /api/users/init
 * Body: { userId: string (UUID from localStorage) }
 * Creates the user row if not already present. Returns the user record.
 */
router.post('/init', (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return res.status(400).json({ error: 'userId deve ser um UUID válido.' });
  }

  try {
    // INSERT OR IGNORE – idempotent; no-op if user already exists
    db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(userId);
    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(userId);
    return res.json({ user });
  } catch (err) {
    console.error('[Route /users/init]', err.message);
    return res.status(500).json({ error: 'Erro ao inicializar usuário.', details: err.message });
  }
});

/**
 * GET /api/users/:userId/stats
 */
router.get('/:userId/stats', (req, res) => {
  const { userId } = req.params;
  try {
    const row = db.prepare('SELECT COUNT(*) as total FROM properties WHERE user_id = ?').get(userId);
    return res.json({ total: row?.total ?? 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
