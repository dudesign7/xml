const { create } = require('xmlbuilder2');

// ==========================
// MAPPERS
// ==========================
const tipoMap = {
  "Apartamento": "apartment",
  "Casa": "house",
  "Sobrado": "house",
  "Kitnet": "apartment"
};

const finalidadeMap = {
  "Venda": "sale",
  "Aluguel": "rent"
};

// ==========================
// HELPERS
// ==========================
function cleanText(text = "") {
  return text
    .replace(/mostrar telefone/gi, "")
    .replace(/\(\d{2}\)\s?\d{4,5}-?\d+/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

function extractArea(text) {
  const match = text.match(/(\d+)\s?m²/);
  return match ? parseInt(match[1]) : null;
}

function getValidImages(imagesData) {
  if (!imagesData) return [];
  return imagesData
    .map(f => f.url)
    .filter(url => url && !url.includes("assets-portal-cms.olx.com.br"));
}

function normalizeNumber(value) {
  const num = parseInt(value);
  return isNaN(num) || num === 0 ? null : num;
}

// ==========================
// TRANSFORMADOR
// ==========================
function generateNaventXML(propertiesWithImages) {
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ads");

  propertiesWithImages.forEach(({ property, images }) => {
    const titulo = property.title || "";
    const descricao = cleanText(property.description || "");

    const areaExtraida = extractArea(titulo) || extractArea(descricao);

    const imagensValidas = getValidImages(images);

    // ignora imóveis sem imagem válida
    if (imagensValidas.length === 0) return;

    const ad = root.ele("ad");

    ad.ele("id").txt(property.external_id || property.id || "");

    ad.ele("title").txt(titulo);

    ad.ele("type").txt(
      tipoMap[property.property_type] || "apartment"
    );

    const finalidade = (property.operation_type || "").toLowerCase().includes("aluguel") ? "Aluguel" : "Venda";
    ad.ele("transaction_type").txt(
      finalidadeMap[finalidade] || "sale"
    );

    ad.ele("price").txt(
      parseFloat(property.price || 0)
    );

    // LOCATION
    const location = ad.ele("location");
    location.ele("country").txt("BR");
    location.ele("state").txt(property.state || "RJ");
    location.ele("city").txt(property.city || "Rio de Janeiro");

    // DETAILS
    const details = ad.ele("details");

    const area = normalizeNumber(property.area) || areaExtraida;
    if (area) details.ele("area").txt(area);

    const quartos = normalizeNumber(property.bedrooms);
    if (quartos) details.ele("bedrooms").txt(quartos);

    const banheiros = normalizeNumber(property.bathrooms);
    if (banheiros) details.ele("bathrooms").txt(banheiros);

    const vagas = normalizeNumber(property.parking);
    if (vagas) details.ele("parking_spaces").txt(vagas);

    // DESCRIPTION
    ad.ele("description").txt(descricao);

    // IMAGES
    const imagesNode = ad.ele("images");
    imagensValidas.forEach(url => {
      imagesNode.ele("image").txt(url);
    });
  });

  return root.end({ prettyPrint: true });
}

module.exports = { generateNaventXML };
