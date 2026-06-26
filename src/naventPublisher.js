const { pool } = require('./db');
const { generateNaventXML } = require('./naventTransformer');

const NAVENT_API_URL = 'https://api-br.open.navent.com';

class NaventPublisher {
  constructor(userId, username, password) {
    this.userId = userId;
    this.username = username;
    this.password = password;
    this.token = null;
  }

  /**
   * Autentica na API da Navent e retorna o Token
   */
  async authenticate() {
    console.log('[Navent] Autenticando na API...');
    try {
      const bodyParams = new URLSearchParams();
      bodyParams.append('grant_type', 'client_credentials');
      bodyParams.append('client_id', this.username);
      bodyParams.append('client_secret', this.password);

      const response = await fetch(`${NAVENT_API_URL}/v1/application/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Falha na autenticação: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      this.token = data.access_token || data.token;
      console.log('[Navent] Autenticação realizada com sucesso!');
      return this.token;
    } catch (err) {
      console.error('[Navent] Erro de autenticação:', err.message);
      throw err;
    }
  }

  /**
   * Publica os imóveis usando a integração da API Navent.
   * Obs: O endpoint exato pode variar dependendo da configuração da conta (JSON x XML direto).
   */
  async publishAll() {
    if (!this.token) await this.authenticate();

    console.log(`[Navent] Buscando imóveis do usuário ${this.userId}...`);
    // Buscar todos os imóveis deste usuário
    const { rows: properties } = await pool.query(
      `SELECT * FROM properties WHERE user_id = $1`,
      [this.userId]
    );

    if (!properties || properties.length === 0) {
      console.log('[Navent] Nenhum imóvel encontrado para envio.');
      return { success: true, message: 'Nenhum imóvel para sincronizar.' };
    }

    const ids = properties.map(p => p.id);
    const { rows: images } = await pool.query(
      `SELECT * FROM images WHERE property_id = ANY($1::int[]) ORDER BY is_main DESC, display_order ASC`,
      [ids]
    );

    const propertiesWithImages = properties.map(p => ({
      property: p,
      images: images.filter(img => img.property_id === p.id)
    }));

    // Generate Payload using the custom Transformer
    const xmlPayload = generateNaventXML(propertiesWithImages);

    console.log(`[Navent] Sincronizando ${properties.length} imóveis via API...`);
    
    // Na Integração Navent via XML, o portal que faz a leitura (Pull).
    // A API deles (JSON) não aceita o envio direto (Push) do arquivo XML bruto.
    // Portanto, o "Sincronizar" aqui valida se o XML está íntegro e retorna o link
    // para ser colocado no painel da Navent.
    try {
      // Garantir que o XML foi gerado corretamente
      if (xmlPayload && xmlPayload.includes('<OpenNavent>')) {
        console.log('[Navent] XML validado com sucesso!');
        return { 
          success: true, 
          message: `XML com ${properties.length} imóveis gerado com sucesso! Entregue o link do "Meu Feed XML" no painel da ImóvelWeb/Navent para que eles façam a leitura.`,
          xmlPreview: xmlPayload.substring(0, 500)
        };
      } else {
        throw new Error('O XML gerado é inválido ou está vazio.');
      }
    } catch (err) {
      console.error('[Navent] Erro na geração:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = NaventPublisher;
