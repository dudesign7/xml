const express = require('express');
const router = express.Router();
const { scrapeProperty, scrapeListing } = require('../scraper');
const { buildXmlFeed } = require('../xmlGenerator');

// ─── Validate URL helper ──────────────────────────────────────────────────────
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── GET /gerar-xml?url= ──────────────────────────────────────────────────────
// Single property mode
router.get('/gerar-xml', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça uma URL completa (http/https).' });
  }

  try {
    console.log(`[Route] /gerar-xml chamado para: ${url}`);
    const property = await scrapeProperty(url);
    const xml = buildXmlFeed([property]);

    res.set({
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Disposition': `attachment; filename="imovel-${property.refId || Date.now()}.xml"`,
    });
    return res.send(xml);

  } catch (err) {
    console.error('[Route] Erro em /gerar-xml:', err.message);
    return res.status(500).json({
      error: 'Falha ao extrair dados do imóvel.',
      details: err.message,
    });
  }
});

// ─── GET /gerar-xml-lista?url= ────────────────────────────────────────────────
// Listing / search results mode
router.get('/gerar-xml-lista', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça uma URL completa (http/https).' });
  }

  try {
    console.log(`[Route] /gerar-xml-lista chamado para: ${url}`);
    const properties = await scrapeListing(url);

    if (!properties || properties.length === 0) {
      return res.status(404).json({
        error: 'Nenhum imóvel encontrado na listagem.',
        tip: 'Verifique se a URL é uma página de resultados de busca do Zap Imóveis.',
      });
    }

    const xml = buildXmlFeed(properties);

    res.set({
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Disposition': `attachment; filename="listagem-${Date.now()}.xml"`,
    });
    return res.send(xml);

  } catch (err) {
    console.error('[Route] Erro em /gerar-xml-lista:', err.message);
    return res.status(500).json({
      error: 'Falha ao extrair listagem de imóveis.',
      details: err.message,
    });
  }
});

// ─── GET /status – health check ───────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
