const db = require('./db');
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
      const response = await fetch(`${NAVENT_API_URL}/v1/authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: this.username,
          clave: this.password
        })
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
    const { rows: properties } = await db.query(
      `SELECT * FROM properties WHERE user_id = ?`,
      [this.userId]
    );

    if (!properties || properties.length === 0) {
      console.log('[Navent] Nenhum imóvel encontrado para envio.');
      return { success: true, message: 'Nenhum imóvel para sincronizar.' };
    }

    const { rows: images } = await db.queryIn(
      `SELECT * FROM images WHERE property_id IN __IN__ ORDER BY is_main DESC, display_order ASC`,
      properties.map(p => p.id)
    );

    const propertiesWithImages = properties.map(p => ({
      property: p,
      images: images.filter(img => img.property_id === p.id)
    }));

    // Generate Payload using the custom Transformer
    const xmlPayload = generateNaventXML(propertiesWithImages);

    console.log(`[Navent] Sincronizando ${properties.length} imóveis via API...`);
    
    // Tenta enviar para o endpoint de Avisos (Lote/XML) da Navent.
    try {
      const response = await fetch(`${NAVENT_API_URL}/v1/avisos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml', // Testando raw XML primeiro
          'Authorization': `Bearer ${this.token}`
        },
        body: xmlPayload
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Navent API (${response.status}): ${errorText}`);
      }

      const resultData = await response.json().catch(() => ({}));
      console.log('[Navent] Imóveis publicados com sucesso na conta!', resultData);
      return { success: true, message: `Sincronizados ${properties.length} imóveis` };
    } catch (err) {
      console.error('[Navent] Erro na publicação:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = NaventPublisher;
