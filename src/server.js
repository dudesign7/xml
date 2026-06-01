require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const { ping, runMigrations } = require('./db');
const { startTunnel, getTunnelUrl } = require('./tunnel');

// ─── Route modules ────────────────────────────────────────────────────────────
const usersRouter      = require('./routes/users');
const importRouter     = require('./routes/import');
const propertiesRouter = require('./routes/properties');
const feedRouter       = require('./routes/feed');

const app  = express();
const PORT = process.env.PORT || 3000;

// trust proxy to handle the SSH reverse tunnel headers correctly
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Rate limiting ─────────────────────────────────────────────────────────────
const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Muitas importações. Aguarde 1 minuto.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Muitas requisições.' },
});

// ─── NAVENT SYNC API ─────────────────────────────────────────────────────────
app.post('/api/navent/sync', async (req, res) => {
  const { userId, username, password } = req.body;
  if (!userId || !username || !password) {
    return res.status(400).json({ error: 'Faltam credenciais (userId, username, password)' });
  }

  try {
    const NaventPublisher = require('./naventPublisher');
    const publisher = new NaventPublisher(userId, username, password);
    const result = await publisher.publishAll();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/users',      apiLimiter,    usersRouter);
app.use('/api/import',     importLimiter, importRouter);
app.use('/api/properties', apiLimiter,    propertiesRouter);
app.use('/api/property',   apiLimiter,    propertiesRouter); // alias

// ─── Public XML feed ──────────────────────────────────────────────────────────
// GET /feed/:userId.xml – consumed by ImovelWeb CRM
app.use('/feed', feedRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/status', async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await ping();
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }
  res.json({
    status:    'online',
    version:   '2.0.0',
    db:        dbStatus,
    tunnelUrl: getTunnelUrl(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Serve SPA frontend ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ error: 'Erro interno.', details: err.message });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    // Auto-run DB migrations on startup
    console.log('[DB] Aplicando migrações...');
    await runMigrations();

    // Verify DB connection
    const ts = await ping();
    console.log(`[DB] Conectado — ${ts}`);

    app.listen(PORT, () => {
      console.log(`\n🚀 XML Generator SaaS v2 rodando em http://localhost:${PORT}`);
      console.log(`📡 Feed público:  http://localhost:${PORT}/feed/{userId}.xml`);
      console.log(`🔌 Status:        http://localhost:${PORT}/status\n`);
      
      // Inicia o túnel de exposição pública
      startTunnel(PORT);
    });

  } catch (err) {
    console.error('\n❌ Falha ao iniciar servidor:', err.message);
    console.error('   Verifique as configurações do PostgreSQL no arquivo .env\n');
    process.exit(1);
  }
}

boot();

module.exports = app;
