# ZapXML SaaS v2

Feed XML dinâmico para ImovelWeb CRM, gerado a partir de URLs do Zap Imóveis.

---

## 📁 Estrutura

```
Saas/
├── migrations/
│   └── 001_init.sql       # Schema PostgreSQL
├── public/
│   ├── index.html         # Dashboard SaaS
│   ├── style.css
│   └── app.js
├── src/
│   ├── db.js              # Pool PostgreSQL + auto-migração
│   ├── normalizer.js      # Normalização de dados scrapeados
│   ├── scraper.js         # Puppeteer (imóvel único + listagem)
│   ├── xmlGenerator.js    # Gerador XML formato <Carga> ImovelWeb
│   ├── server.js          # Express entry point
│   └── routes/
│       ├── users.js       # POST /api/users/init
│       ├── import.js      # POST /api/import
│       ├── properties.js  # GET/DELETE /api/properties
│       └── feed.js        # GET /feed/:userId.xml
├── .env
└── package.json
```

---

## 🚀 Como Rodar Localmente

### 1. Pré-requisitos

- Node.js 18+
- PostgreSQL rodando localmente

### 2. Criar o banco de dados

```bash
# No psql ou pgAdmin, criar o banco:
psql -U postgres -c "CREATE DATABASE zapxml;"
```

### 3. Configurar variáveis de ambiente

Edite o arquivo `.env`:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=zapxml
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui
SCRAPE_TIMEOUT=30000
MAX_LISTING_PROPERTIES=50
```

### 4. Instalar dependências

```bash
npm install
```

> ⚠️ Puppeteer baixa o Chromium (~170MB) na primeira instalação.

### 5. Iniciar

```bash
npm start
```

O servidor irá:
- Aplicar o schema do banco automaticamente
- Conectar ao PostgreSQL
- Subir em **http://localhost:3000**

---

## 🔌 API

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/users/init` | Criar/recuperar usuário |
| `POST` | `/api/import` | Importar imóvel(s) |
| `GET`  | `/api/properties?userId=` | Listar imóveis |
| `DELETE` | `/api/property/:id?userId=` | Remover imóvel |
| `GET`  | `/feed/:userId.xml` | **Feed XML público** |
| `GET`  | `/status` | Health check |

---

## 📡 Feed XML Público

Cada usuário tem uma URL única:

```
http://localhost:3000/feed/{userId}.xml
```

Essa URL é exibida no dashboard e pode ser configurada diretamente no ImovelWeb CRM para sincronização automática.

---

## 📄 Formato XML gerado

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Carga>
  <Imoveis>
    <Imovel>
      <CodigoImovel><![CDATA[123456]]></CodigoImovel>
      <TipoImovel><![CDATA[Apartamento]]></TipoImovel>
      <Finalidade><![CDATA[Venda]]></Finalidade>
      <TituloImovel><![CDATA[...]]></TituloImovel>
      <Descricao><![CDATA[...]]></Descricao>
      <PrecoVenda>650000</PrecoVenda>
      <Endereco>
        <Bairro><![CDATA[Vila Mariana]]></Bairro>
        <Cidade><![CDATA[São Paulo]]></Cidade>
        <Estado><![CDATA[SP]]></Estado>
      </Endereco>
      <AreaUtil>85</AreaUtil>
      <Dormitorios>3</Dormitorios>
      <Banheiros>2</Banheiros>
      <Vagas>1</Vagas>
      <Fotos>
        <Foto>
          <URLFoto><![CDATA[https://...]]></URLFoto>
          <Principal>1</Principal>
        </Foto>
      </Fotos>
    </Imovel>
  </Imoveis>
</Carga>
```

---

## 🏗️ Roadmap (não implementado — estrutura preparada)

- [ ] Autenticação (JWT)
- [ ] Planos de assinatura
- [ ] Múltiplos portais (Viva Real, OLX, etc.)
- [ ] Atualização agendada (cron job)
- [ ] Dashboard de analytics
