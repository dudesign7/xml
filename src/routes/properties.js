const express = require('express');
const router  = express.Router();
const { db }  = require('../db');

// ─── GET /api/properties?userId=:id ──────────────────────────────────────────
router.get('/', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    // Fetch properties with image counts and main image
    const properties = db.prepare(`
      SELECT
        p.*,
        COUNT(i.id)                                    AS image_count,
        MIN(CASE WHEN i.is_main = 1 THEN i.url END)   AS main_image
      FROM properties p
      LEFT JOIN images i ON i.property_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all(userId);

    // Attach images to each property
    if (properties.length > 0) {
      const ids          = properties.map(p => p.id);
      const placeholders = ids.map(() => '?').join(', ');
      const images       = db.prepare(
        `SELECT * FROM images WHERE property_id IN (${placeholders}) ORDER BY display_order ASC`
      ).all(...ids);

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
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const property = db.prepare(
      'SELECT * FROM properties WHERE id = ? AND user_id = ?'
    ).get(id, userId);
    if (!property) return res.status(404).json({ error: 'Imóvel não encontrado.' });

    property.images = db.prepare(
      'SELECT * FROM images WHERE property_id = ? ORDER BY display_order'
    ).all(id);

    return res.json({ property });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/property/:id ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id }     = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const prop = db.prepare(
      'SELECT id FROM properties WHERE id = ? AND user_id = ?'
    ).get(id, userId);
    if (!prop) return res.status(404).json({ error: 'Imóvel não encontrado ou sem permissão.' });

    db.prepare('DELETE FROM properties WHERE id = ?').run(id);
    return res.json({ success: true, deletedId: parseInt(id) });

  } catch (err) {
    console.error('[DELETE /property]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/properties/cleanup?userId= ──────────────────────────────────
// Removes blocked/invalid data already saved to the DB
const CLEANUP_PATTERNS = [
  'sorry, you have been blocked',
  'você foi bloqueado',
  'access denied',
  'attention required',
  'checking your browser',
];
router.delete('/cleanup', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const properties = db.prepare(
      'SELECT id, title FROM properties WHERE user_id = ?'
    ).all(userId);

    let removed = 0;
    for (const prop of properties) {
      const text = (prop.title || '').toLowerCase();
      if (CLEANUP_PATTERNS.some(p => text.includes(p))) {
        db.prepare('DELETE FROM properties WHERE id = ?').run(prop.id);
        removed++;
      }
    }

    return res.json({ success: true, removed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
