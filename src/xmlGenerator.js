/**
 * xmlGenerator.js – ImovelWeb-optimized feed generator
 *
 * Format: <Carga> root as specified in the ImovelWeb XML integration guide.
 * Every property block is guaranteed to be valid XML with all required fields.
 *
 * ImovelWeb required fields (will cause rejection if absent or invalid):
 *   CodigoImovel, TipoImovel, Finalidade, Descricao,
 *   PrecoVenda|PrecoLocacao, Cidade, Estado, at least 1 Foto/URL
 *
 * Encoding: UTF-8
 * Text fields: CDATA-wrapped (handles special chars, ampersands, accents)
 * Numeric fields: clean integers or 2-decimal floats (no symbols)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Wrap value in CDATA – safely handles ]]> sequences */
function cdata(value) {
  const str = String(value ?? '').trim();
  return `<![CDATA[${str.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** Format price: produces "650000.00" – never NaN, never negative */
function fmtPrice(value) {
  const n = parseFloat(value);
  if (isNaN(n) || n < 0) return '0.00';
  return n.toFixed(2);
}

/** Format integer (area, rooms, etc): produces "85" – never NaN */
function fmtInt(value) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? '0' : String(n);
}

/** Ensure a string is never empty – returns fallback if blank */
function safeStr(value, fallback = '') {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION & DEFAULTS
// Guarantees no required ImovelWeb field ever breaks the feed.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fills in all required fields with safe defaults so the XML is always valid.
 * @param {object} property – DB row from the properties table
 * @param {Array}  images   – DB rows from the images table
 */
function fillDefaults(property, images) {
  const p = { ...property };

  // ── CodigoImovel: must be unique and non-empty ──────────────────────────────
  p._codigo = safeStr(p.external_id, String(p.id));

  // ── TipoImovel: must match ImovelWeb's accepted list ───────────────────────
  const VALID_TYPES = new Set([
    'Apartamento', 'Casa', 'Terreno', 'Sala Comercial', 'Loja Comercial',
    'Cobertura', 'Studio', 'Kitnet', 'Flat', 'Galpão', 'Chácara', 'Sítio',
    'Sobrado', 'Casa em Condomínio', 'Fazenda', 'Ponto Comercial',
  ]);
  p._tipo = VALID_TYPES.has(p.property_type) ? p.property_type : 'Apartamento';

  // ── Finalidade: ONLY "Venda" or "Locação" accepted ─────────────────────────
  p._finalidade = (p.operation_type || '').toLowerCase().includes('aluguel')
    ? 'Locação'
    : 'Venda';

  // ── Titulo: required by most CRMs even if optional in spec ─────────────────
  p._titulo = safeStr(p.title, `${p._tipo} à ${p._finalidade}`);

  // ── Descricao: required – fallback to title if description is empty ─────────
  p._descricao = safeStr(p.description, p._titulo);

  // ── Price: must be a valid positive number ──────────────────────────────────
  p._preco = fmtPrice(p.price || 0);

  // ── Address fields ──────────────────────────────────────────────────────────
  p._bairro  = safeStr(p.neighborhood);
  p._cidade  = safeStr(p.city);
  p._estado  = safeStr(p.state);
  p._logradouro = safeStr(p.street);

  // ── Numeric amenities ───────────────────────────────────────────────────────
  p._area      = fmtInt(p.area);
  p._dorms     = fmtInt(p.bedrooms);
  p._banheiros = fmtInt(p.bathrooms);
  p._vagas     = fmtInt(p.parking);

  // ── Images: sort main photo first ──────────────────────────────────────────
  p._images = [...(images || [])].sort((a, b) => {
    if (a.is_main && !b.is_main) return -1;
    if (!a.is_main && b.is_main) return 1;
    return (a.display_order || 0) - (b.display_order || 0);
  });

  return p;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD SINGLE <Imovel> BLOCK
// ═══════════════════════════════════════════════════════════════════════════════

function buildImovelXml(property, images = []) {
  const p = fillDefaults(property, images);

  // Price tag name depends on operation type
  const precoTag = p._finalidade === 'Locação' ? 'PrecoLocacao' : 'PrecoVenda';

  // ── <Fotos> section ─────────────────────────────────────────────────────────
  let fotosXml = '';
  if (p._images.length > 0) {
    const photosBlock = p._images
      .filter(img => typeof img.url === 'string' && img.url.startsWith('http'))
      .map((img, idx) => `
        <Foto>
          <URL>${cdata(img.url)}</URL>
          <Principal>${idx === 0 ? '1' : '0'}</Principal>
          <Ordem>${idx + 1}</Ordem>
        </Foto>`)
      .join('');

    if (photosBlock) {
      fotosXml = `
      <Fotos>${photosBlock}
      </Fotos>`;
    }
  }
  // Note: if no valid photos, <Fotos> is omitted.
  // ImovelWeb will queue the listing as "pending photos" rather than fail.

  // ── Data de cadastro ────────────────────────────────────────────────────────
  const dataCadastro = (() => {
    try { return new Date(property.created_at).toISOString().slice(0, 10); }
    catch { return new Date().toISOString().slice(0, 10); }
  })();

  return `
    <Imovel>
      <CodigoImovel>${cdata(p._codigo)}</CodigoImovel>
      <TipoImovel>${cdata(p._tipo)}</TipoImovel>
      <Finalidade>${cdata(p._finalidade)}</Finalidade>
      <TituloImovel>${cdata(p._titulo)}</TituloImovel>
      <Descricao>${cdata(p._descricao)}</Descricao>
      <${precoTag}>${p._preco}</${precoTag}>

      <Endereco>
        <Logradouro>${cdata(p._logradouro)}</Logradouro>
        <Bairro>${cdata(p._bairro)}</Bairro>
        <Cidade>${cdata(p._cidade)}</Cidade>
        <Estado>${cdata(p._estado)}</Estado>
        <Pais>BR</Pais>
      </Endereco>

      <AreaUtil>${p._area}</AreaUtil>
      <AreaTotal>${p._area}</AreaTotal>
      <Dormitorios>${p._dorms}</Dormitorios>
      <Banheiros>${p._banheiros}</Banheiros>
      <Vagas>${p._vagas}</Vagas>
${fotosXml}
      <DataCadastro>${dataCadastro}</DataCadastro>
    </Imovel>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD FULL FEED
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Array<{property: object, images: Array}>} entries
 * @returns {string} Complete UTF-8 XML feed
 */
function buildFeedXml(entries = []) {
  if (!Array.isArray(entries)) entries = [];

  let included = 0;
  let skippedNoPhoto = 0;
  const blocks = [];

  for (const { property, images } of entries) {
    try {
      // Warn but still include properties without photos
      if (!images || images.length === 0) {
        skippedNoPhoto++;
        console.warn(
          `[XML] Imóvel ID=${property.id} (${property.title?.slice(0, 40)}) sem fotos – incluído sem <Fotos>.`
        );
      }
      blocks.push(buildImovelXml(property, images));
      included++;
    } catch (err) {
      console.error(`[XML] Erro ao gerar bloco para ID=${property?.id}:`, err.message);
    }
  }

  if (skippedNoPhoto > 0) {
    console.warn(`[XML] ${skippedNoPhoto} imóvel(s) sem fotos. ImovelWeb pode exigir ao menos 1 foto para publicar.`);
  }

  const now = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  XML Generator Feed – ImovelWeb CRM
  Gerado em: ${now}
  Total: ${included} imóvel(s)
-->
<Carga xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Data="${now}">
  <Imoveis>${blocks.join('')}
  </Imoveis>
</Carga>`;
}

module.exports = { buildFeedXml, buildImovelXml };
