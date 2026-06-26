const express = require('express');
const router  = express.Router();
const { pool }  = require('../db');
const { generateNaventXML: buildFeedXml } = require('../naventTransformer');

/**
 * GET /feed/:userId.xml
 * Public endpoint – consumed by ImovelWeb CRM automatically.
 * Always fresh from DB. No auth required.
 */
router.get('/:userId.xml', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res
      .status(400)
      .set('Content-Type', 'application/xml; charset=UTF-8')
      .send('<?xml version="1.0" encoding="UTF-8"?><Carga><Imoveis/></Carga>');
  }

  try {
    // Verify user exists
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userRows.length === 0) {
      return res
        .status(404)
        .set('Content-Type', 'application/xml; charset=UTF-8')
        .send('<?xml version="1.0" encoding="UTF-8"?><Carga><Imoveis/></Carga>');
    }

    // Fetch all properties
    const { rows: properties } = await pool.query(
      'SELECT * FROM properties WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // Fetch all images in one query using dynamic IN clause
    let imgMap = {};
    if (properties.length > 0) {
      const ids = properties.map(p => p.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: images } = await pool.query(
        `SELECT * FROM images WHERE property_id IN (${placeholders}) ORDER BY display_order ASC`,
        ids
      );

      for (const img of images) {
        if (!imgMap[img.property_id]) imgMap[img.property_id] = [];
        imgMap[img.property_id].push(img);
      }
    }

    const entries = properties.map(property => ({
      property,
      images: imgMap[property.id] || [],
    }));

    const xml = buildFeedXml(entries);

    res.set({
      'Content-Type':   'application/xml; charset=UTF-8',
      'Cache-Control':  'public, max-age=300',
      'X-Total-Listings': String(properties.length),
    });
    return res.send(xml);

  } catch (err) {
    console.error('[Feed] Error:', err.message);
    return res
      .status(500)
      .set('Content-Type', 'application/xml; charset=UTF-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<Carga><Imoveis/></Carga>`);
  }
});

module.exports = router;
