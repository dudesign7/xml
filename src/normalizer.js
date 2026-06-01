/**
 * normalizer.js
 * Transforms raw scraped data into a clean, DB-ready property object.
 * Ensures no null values break the XML or DB constraints.
 */

// ─── Property type mapping ─────────────────────────────────────────────────────
const PROPERTY_TYPE_MAP = {
  apartamento: 'Apartamento',
  apto:        'Apartamento',
  ap:          'Apartamento',
  casa:        'Casa',
  sobrado:     'Casa',
  terreno:     'Terreno',
  lote:        'Terreno',
  cobertura:   'Cobertura',
  studio:      'Studio',
  kitnet:      'Kitnet',
  kitinete:    'Kitnet',
  comercial:   'Sala Comercial',
  sala:        'Sala Comercial',
  loja:        'Loja Comercial',
  galpao:      'Galpão',
  galpão:      'Galpão',
  chacara:     'Chácara',
  chácara:     'Chácara',
  sitio:       'Sítio',
  sítio:       'Sítio',
  flat:        'Flat',
};

function normalizePropertyType(raw = '') {
  const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [key, value] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (text.includes(key)) return value;
  }
  return 'Apartamento'; // safe default
}

// ─── Operation type ───────────────────────────────────────────────────────────
function normalizeOperationType(raw = '') {
  const text = raw.toLowerCase();
  if (text.includes('aluguel') || text.includes('alugar') || text.includes('locacao') || text.includes('locação')) {
    return 'Aluguel';
  }
  return 'Venda';
}

// ─── Price: "R$ 1.250.000" → 1250000.00 ─────────────────────────────────────
function normalizePrice(raw = '') {
  if (!raw) return 0;
  // Remove currency symbols and text
  let cleaned = String(raw)
    .replace(/R\$\s*/gi, '')
    .replace(/[^\d.,]/g, '')
    .trim();
  if (!cleaned) return 0;
  // Handle Brazilian number format: 1.250.000,00 → 1250000.00
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // If only dots, could be thousand separators (e.g. 1.250.000)
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : Math.round(value * 100) / 100;
}

// ─── Area: "85 m²" → 85 ──────────────────────────────────────────────────────
function normalizeArea(raw = '') {
  if (!raw) return 0;
  const match = String(raw).replace(/\./g, '').match(/(\d+)/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  return isNaN(value) ? 0 : value;
}

// ─── Integer fields ───────────────────────────────────────────────────────────
function normalizeInt(raw = '') {
  if (raw === null || raw === undefined || raw === '') return 0;
  const match = String(raw).match(/\d+/);
  if (!match) return 0;
  const value = parseInt(match[0], 10);
  return isNaN(value) ? 0 : value;
}

// ─── Location parser ──────────────────────────────────────────────────────────
// Input examples:
//   "Rua das Flores, 123 - Vila Mariana, São Paulo - SP"
//   "Ipanema, Rio de Janeiro - RJ"
//   "São Paulo, SP"
function parseLocation(location = '') {
  const result = { street: '', neighborhood: '', city: '', state: '' };
  if (!location) return result;

  // Try to extract state (2-letter code at the end after " - " or ",")
  const stateMatch = location.match(/[-,]\s*([A-Z]{2})\s*$/);
  if (stateMatch) {
    result.state = stateMatch[1];
    location = location.slice(0, stateMatch.index).trim();
  }

  // Split remaining by " - " first, then ","
  const dashParts = location.split(' - ').map(p => p.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    // Last dash section is usually "City" or "Neighborhood, City"
    const lastPart = dashParts[dashParts.length - 1];
    const commaParts = lastPart.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      result.neighborhood = commaParts[0];
      result.city = commaParts.slice(1).join(', ').trim();
    } else {
      result.city = lastPart;
    }
    result.street = dashParts.slice(0, dashParts.length - 1).join(' - ');
  } else {
    // Just comma-separated
    const parts = location.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      result.street = parts[0];
      result.neighborhood = parts[1];
      result.city = parts.slice(2).join(', ').trim();
    } else if (parts.length === 2) {
      result.neighborhood = parts[0];
      result.city = parts[1];
    } else {
      result.city = location;
    }
  }

  return result;
}

// ─── Safe string ──────────────────────────────────────────────────────────────
function safeStr(val, maxLen = 2000) {
  if (val === null || val === undefined) return '';
  return String(val).trim().slice(0, maxLen);
}

// ─── Main normalizer ──────────────────────────────────────────────────────────
function normalize(raw) {
  const loc = parseLocation(raw.location || '');
  const combinedTypeSource = `${raw.title || ''} ${raw.url || ''}`;

  return {
    externalId:    safeStr(raw.refId || raw.externalId || ''),
    sourceUrl:     safeStr(raw.url || '', 2000),
    title:         safeStr(raw.title || 'Imóvel sem título', 500),
    description:   safeStr(raw.description || '', 5000),
    price:         normalizePrice(raw.price),
    operationType: normalizeOperationType(combinedTypeSource),
    propertyType:  normalizePropertyType(combinedTypeSource || raw.type || ''),
    area:          normalizeArea(raw.area),
    bedrooms:      normalizeInt(raw.bedrooms),
    bathrooms:     normalizeInt(raw.bathrooms),
    parking:       normalizeInt(raw.parking),
    street:        safeStr(loc.street, 500),
    neighborhood:  safeStr(loc.neighborhood, 255),
    city:          safeStr(loc.city, 255),
    state:         safeStr(loc.state, 10),
    country:       'BR',
    images:        Array.isArray(raw.images)
      ? raw.images.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 30)
      : [],
  };
}

module.exports = { normalize, normalizePrice, normalizeArea, normalizeInt, normalizePropertyType, parseLocation };
