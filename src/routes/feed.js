const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { buildFeedXml } = require('../xmlGenerator');

/**
 * GET /feed/:userId.xml
 * Public endpoint – consumed by ImovelWeb CRM automatically.
 * Always fresh from DB. No auth required.
 */
router.get('/:userId.xml', (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res
      .status(400)
      .set('Content-Type', 'application/xml; charset=UTF-8')
      .send('<?xml version="1.0" encoding="UTF-8"?><Carga><Imoveis/></Carga>');
  }

  try {
    // Verify user exists
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res
        .status(404)
        .set('Content-Type', 'application/xml; charset=UTF-8')
        .send('<?xml version="1.0" encoding="UTF-8"?><Carga><Imoveis/></Carga>');
    }

    // Fetch all properties
    const properties = db.prepare(
      'SELECT * FROM properties WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);

    // Fetch all images in one query using dynamic IN clause
    let imgMap = {};
    if (properties.length > 0) {
      const ids          = properties.map(p => p.id);
      const placeholders = ids.map(() => '?').join(', ');
      const images       = db.prepare(
        `SELECT * FROM images WHERE property_id IN (${placeholders}) ORDER BY display_order ASC`
      ).all(...ids);

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
