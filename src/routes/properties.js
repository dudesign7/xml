const express = require('express');
const router  = express.Router();
const { pool }  = require('../db');

// ─── GET /api/properties?userId=:id ──────────────────────────────────────────
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const { rows: properties } = await pool.query(`
      SELECT
        p.*,
        COUNT(i.id)::int                               AS image_count,
        MIN(CASE WHEN i.is_main = 1 THEN i.url END)   AS main_image
      FROM properties p
      LEFT JOIN images i ON i.property_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [userId]);

    if (properties.length > 0) {
      const ids = properties.map(p => p.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: images } = await pool.query(
        `SELECT * FROM images WHERE property_id IN (${placeholders}) ORDER BY display_order ASC`,
        ids
      );

      const imgMap = {};
      for (const img of images) {
        if (!imgMap[img.property_id]) imgMap[img.property_id] = [];
        imgMap[img.property_id].push(img);
      }
      for (const prop of properties) {
        prop.images = imgMap[prop.id] || [];
      }
    }

    return res.json({ properties });

  } catch (err) {
    console.error('[GET /properties]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/properties/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const { rows: propRows } = await pool.query(
      'SELECT * FROM properties WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (propRows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado.' });
    
    const property = propRows[0];
    const { rows: images } = await pool.query(
      'SELECT * FROM images WHERE property_id = $1 ORDER BY display_order',
      [id]
    );
    property.images = images;

    return res.json({ property });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/property/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id }     = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const { rows: propRows } = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (propRows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado ou sem permissão.' });

    await pool.query('DELETE FROM properties WHERE id = $1', [id]);
    return res.json({ success: true, deletedId: parseInt(id) });

  } catch (err) {
    console.error('[DELETE /property]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/properties/cleanup?userId= ──────────────────────────────────
const CLEANUP_PATTERNS = [
  'sorry, you have been blocked',
  'você foi bloqueado',
  'access denied',
  'attention required',
  'checking your browser',
];
router.delete('/cleanup', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const { rows: properties } = await pool.query(
      'SELECT id, title FROM properties WHERE user_id = $1',
      [userId]
    );

    let removed = 0;
    for (const prop of properties) {
      const text = (prop.title || '').toLowerCase();
      if (CLEANUP_PATTERNS.some(p => text.includes(p))) {
        await pool.query('DELETE FROM properties WHERE id = $1', [prop.id]);
        removed++;
      }
    }

    return res.json({ success: true, removed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
