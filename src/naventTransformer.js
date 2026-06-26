const { create } = require('xmlbuilder2');

// ==========================
// HELPERS
// ==========================
function cleanText(text = '') {
  return text.replace(/mostrar telefone/gi, '').replace(/\n+/g, ' ').trim();
}

function getValidImages(imagesData) {
  if (!imagesData) return [];
  return imagesData
    .map(f => f.url || f.urlImagem)
    .filter(url => url && !url.includes('assets-portal-cms.olx.com.br'));
}

function normalizeNumber(value) {
  const num = parseInt(value);
  return isNaN(num) || num === 0 ? null : num;
}

function mapPropertyType(typeStr = '') {
  const t = typeStr.toLowerCase();
  if (t.includes('apartamento') || t.includes('apto')) return { idTipo: 2, tipo: 'Apartamento', idSubTipo: 1, subTipo: 'Padrão' };
  if (t.includes('casa') || t.includes('sobrado')) return { idTipo: 1, tipo: 'Casa', idSubTipo: 5, subTipo: 'Padrão' };
  if (t.includes('terreno') || t.includes('lote')) return { idTipo: 1003, tipo: 'Terreno', idSubTipo: 8, subTipo: 'Terreno Padrão' };
  return { idTipo: 2, tipo: 'Apartamento', idSubTipo: 1, subTipo: 'Padrão' };
}

function generateNaventXML(propertiesWithImages) {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('OpenNavent')
    .ele('Imoveis');

  propertiesWithImages.forEach(({ property, images }) => {
    const imagensValidas = getValidImages(images);
    if (imagensValidas.length === 0) return; // Ignores properties without valid images

    const imovel = root.ele('Imovel');
    const id = property.external_id || property.id || '';
    
    imovel.ele('codigoAnuncio').txt(id);
    imovel.ele('codigoReferencia').txt(id);

    const pt = mapPropertyType(property.property_type);
    const tipoNode = imovel.ele('tipoPropriedade');
    tipoNode.ele('idTipo').txt(pt.idTipo);
    tipoNode.ele('tipo').txt(pt.tipo);
    tipoNode.ele('idSubTipo').txt(pt.idSubTipo);
    tipoNode.ele('subTipo').txt(pt.subTipo);

    // Caracteristicas
    const caracteristicas = imovel.ele('caracteristicas');
    
    const quartos = normalizeNumber(property.bedrooms);
    if (quartos) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT2');
      c.ele('nome').txt('PRINCIPALES|QUARTO');
      c.ele('valor').txt(quartos);
    }

    const banheiros = normalizeNumber(property.bathrooms);
    if (banheiros) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT3');
      c.ele('nome').txt('PRINCIPALES|BANHEIRO');
      c.ele('valor').txt(banheiros);
    }

    const vagas = normalizeNumber(property.parking);
    if (vagas) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT7');
      c.ele('nome').txt('PRINCIPALES|VAGA');
      c.ele('valor').txt(vagas);
    }
    
    const suites = normalizeNumber(property.suites);
    if (suites) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT4');
      c.ele('nome').txt('PRINCIPALES|SUITE');
      c.ele('valor').txt(suites);
    }

    const age = normalizeNumber(property.age);
    if (age) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT5');
      c.ele('nome').txt('PRINCIPALES|IDADE_DO_IMOVEL');
      c.ele('valor').txt(age);
    }

    let amenitiesArr = [];
    try {
      amenitiesArr = property.amenities ? JSON.parse(property.amenities) : [];
    } catch(e) {}

    const amenitiesMap = {
      'churrasqueira': { id: '20048', nome: 'AREA_PRIVATIVA|CHURRASQUEIRA' },
      'piscina': { id: '10140', nome: 'AREA_PRIVATIVA|PISCINA' },
      'elevador': { id: '20000', nome: 'SERVICOS|ELEVADOR' },
      'área de serviço': { id: '20017', nome: 'AREA_PRIVATIVA|AREA_DE_SERVIÇO' },
      'sala de jantar': { id: '20177', nome: 'AREA_PRIVATIVA|SALA_DE_JANTAR' }
    };

    amenitiesArr.forEach(amenity => {
      const mapItem = amenitiesMap[amenity];
      if (mapItem) {
        const c = caracteristicas.ele('caracteristica');
        c.ele('id').txt(mapItem.id);
        c.ele('nome').txt(mapItem.nome);
        c.ele('idValor').txt('1');
      }
    });
    
    const area = normalizeNumber(property.area);
    if (area) {
      const c = caracteristicas.ele('caracteristica');
      c.ele('id').txt('CFT101');
      c.ele('nome').txt('MEDIDAS|AREA_UTIL');
      c.ele('valor').txt(area);
      
      const c2 = caracteristicas.ele('caracteristica');
      c2.ele('id').txt('CFT100');
      c2.ele('nome').txt('MEDIDAS|AREA_TOTAL');
      c2.ele('valor').txt(area);
      
      const c3 = caracteristicas.ele('caracteristica');
      c3.ele('id').txt('CON1');
      c3.ele('nome').txt('MEDIDAS|UNIDAD_DE_MEDIDA');
      c3.ele('idValor').txt('M2');
    }

    // Titulo e Descricao
    if (property.title) {
        imovel.ele('titulo').txt(property.title);
    }
    imovel.ele('descricao').dat(cleanText(property.description || ''));

    // Preços
    const precos = imovel.ele('precos');
    const preco = precos.ele('preco');
    preco.ele('quantidade').txt(parseFloat(property.price || 0));
    preco.ele('moeda').txt('BRL');
    const finalidade = (property.operation_type || '').toLowerCase().includes('aluguel') ? 'ALQUILER' : 'VENTA';
    preco.ele('operacao').txt(finalidade);

    // Multimidia
    const multimidia = imovel.ele('multimidia');
    const imagensNode = multimidia.ele('imagens');
    imagensValidas.forEach(url => {
      imagensNode.ele('imagem').ele('urlImagem').txt(url);
    });

    // Publicador
    const publicador = imovel.ele('publicador');
    publicador.ele('codigoImobiliaria').txt('47362968'); // hardcoded from example, can be dynamic
    publicador.ele('emailUsuario').txt('');
    publicador.ele('emailContato').txt('');
    publicador.ele('nomeContato').txt('');
    publicador.ele('telefoneContato').txt('');

    // Localizacao
    const localizacao = imovel.ele('localizacao');
    localizacao.ele('pais').txt('Brasil');
    if (property.state) localizacao.ele('estado').txt(property.state);
    if (property.city) localizacao.ele('cidade').txt(property.city);
    if (property.neighborhood) localizacao.ele('bairro').txt(property.neighborhood);
    
    localizacao.ele('mostrarMapa').txt('NO');
    localizacao.ele('endereco').txt(property.street || property.neighborhood || property.city || '');
    localizacao.ele('codigoPostal').txt(property.zipcode || '');
    localizacao.ele('latitude').txt(property.latitude || '');
    localizacao.ele('longitude').txt(property.longitude || '');

    // Publicacao
    const publicacao = imovel.ele('publicacao');
    publicacao.ele('tipoPublicacao').dat('SIMPLE');
  });

  return root.end({ prettyPrint: true });
}

module.exports = { generateNaventXML };
