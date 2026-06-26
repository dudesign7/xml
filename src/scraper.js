/**
 * scraper.js – Anti-detection scraper for Zap Imóveis
 *
 * Uses puppeteer-extra + Stealth plugin to bypass Cloudflare and Zap's
 * anti-bot measures. Includes:
 *   - All browser fingerprint patches (webdriver, plugins, chrome, canvas…)
 *   - Realistic User-Agent rotation
 *   - Human-like behavior (random delays, scrolling)
 *   - Block page detection before data is saved
 *   - Automatic retry with fresh browser session
 */

const puppeteer   = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { normalize } = require('./normalizer');

// Apply all stealth evasions (patches navigator.webdriver, chrome, canvas, etc.)
puppeteer.use(StealthPlugin());

// ─── Realistic User-Agent pool (recent Chrome on Windows) ─────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.129 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.185 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.216 Safari/537.36',
];

// ─── Realistic viewport pool ──────────────────────────────────────────────────
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900  },
  { width: 1536, height: 864  },
  { width: 1366, height: 768  },
];

// ─── Block detection patterns ─────────────────────────────────────────────────
const BLOCK_PATTERNS = [
  'sorry, you have been blocked',
  'você foi bloqueado',
  'access denied',
  'attention required',
  'enable javascript and cookies',
  'checking your browser',
  'please enable cookies',
  'ddos protection',
  'ray id',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand       = (arr) => arr[Math.floor(Math.random() * arr.length)];
const delay      = (ms) => new Promise(r => setTimeout(r, ms));
const randDelay  = (min, max) => delay(min + Math.random() * (max - min));

function isBlocked(title = '', body = '') {
  const text = `${title} ${body}`.toLowerCase();
  return BLOCK_PATTERNS.some(p => text.includes(p));
}

// ─── Browser singleton ────────────────────────────────────────────────────────
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    const vp = rand(VIEWPORTS);
    console.log('[Browser] Iniciando instância stealth...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Critical: disables the "AutomationControlled" flag that triggers blocks
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        `--window-size=${vp.width},${vp.height}`,
        '--lang=pt-BR,pt',
        // Prevent Puppeteer from passing --enable-automation
        '--disable-infobars',
        '--start-maximized',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: vp,
    });
    console.log('[Browser] Instância stealth iniciada.');
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ─── Page setup ───────────────────────────────────────────────────────────────
async function setupPage(browser, referer = 'https://www.zapimoveis.com.br/') {
  const page = await browser.newPage();
  const ua   = rand(USER_AGENTS);
  const vp   = rand(VIEWPORTS);

  await page.setViewport(vp);
  await page.setUserAgent(ua);

  // Full browser-like headers to match Chrome exactly
  await page.setExtraHTTPHeaders({
    'Accept-Language':          'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding':          'gzip, deflate, br',
    'Cache-Control':            'max-age=0',
    'Sec-Ch-Ua':                `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`,
    'Sec-Ch-Ua-Mobile':         '?0',
    'Sec-Ch-Ua-Platform':       '"Windows"',
    'Sec-Fetch-Dest':           'document',
    'Sec-Fetch-Mode':           'navigate',
    'Sec-Fetch-Site':           'none',
    'Sec-Fetch-User':           '?1',
    'Upgrade-Insecure-Requests':'1',
    'Referer':                   referer,
  });

  // Block only images – NEVER block scripts/CSS (CF challenge needs them)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'media') {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

// ─── Simulate human behavior ──────────────────────────────────────────────────
async function humanize(page) {
  // Random scroll pattern
  await page.evaluate(() => window.scrollTo({ top: 200 + Math.random() * 300, behavior: 'smooth' }));
  await randDelay(600, 1200);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await randDelay(400, 800);
}

// ─── Data extraction ──────────────────────────────────────────────────────────
async function extractData(page) {
  return page.evaluate(() => {
    const getText = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el.innerText?.trim() || '';
      }
      return '';
    };

    const getNumber = (text) => {
      if (!text) return '';
      const match = text.replace(/\./g, '').match(/[\d]+/);
      return match ? match[0] : '';
    };

    // Title
    const title = getText([
      'h1[class*="title"]', 'h1[class*="Title"]',
      '[data-testid="listing-title"]', '.listing-title', 'h1',
    ]);

    // Price
    const rawPrice = getText([
      '[class*="listing-price"]', '[class*="ListingPrice"]',
      '[data-testid="price"]', '[class*="price"]', '.price',
    ]);

    // Area
    const rawArea = getText([
      '[class*="total-area"]', '[class*="TotalArea"]',
      '[class*="usable-area"]', '[aria-label*="área"]', '[title*="m²"]',
    ]);
    const areaMatch = rawArea.match(/(\d+)\s*m²/i);
    const area = areaMatch ? areaMatch[1] : '';

    // ─── Extract numbers from full text fallback ─────────────────────────────
    const fullText = document.body.innerText || '';
    const extractNumber = (regexStr) => {
        const regex = new RegExp(`(\\d+)\\s*(?:${regexStr})`, 'i');
        const match = fullText.match(regex);
        return match ? parseInt(match[1], 10) : 0;
    };

    const bedrooms  = extractNumber('quarto|quartos');
    const bathrooms = extractNumber('banheiro|banheiros');
    const parking   = extractNumber('vaga|vagas');
    const suites    = extractNumber('suíte|suite|suítes|suites');
    const age       = extractNumber('ano|anos|idade');

    // ─── Extract Amenities ───────────────────────────────────────────────────
    const knownAmenities = [
      'churrasqueira', 'piscina', 'elevador', 'academia', 'ar condicionado', 
      'varanda', 'sacada', 'quadra', 'salão de festas', 'playground', 
      'sauna', 'lavabo', 'armários embutidos', 'armário na cozinha', 
      'portaria 24h', 'condomínio fechado', 'área de serviço', 'sala de jantar'
    ];
    
    const extractedAmenities = [];
    document.querySelectorAll('li, span, p').forEach(el => {
      // Check if it's a leaf node to avoid matching huge container blocks
      if (el.children.length === 0) {
        const text = el.innerText?.trim().toLowerCase() || '';
        knownAmenities.forEach(amenity => {
          if (text === amenity || text.includes(amenity)) {
            if (!extractedAmenities.includes(amenity)) {
               extractedAmenities.push(amenity);
            }
          }
        });
      }
    });

    // Location
    const location = getText([
      '[class*="address"]', '[class*="Address"]',
      '[itemprop="address"]', '[data-testid="address"]',
      '[class*="location"]', '[class*="Location"]', '.address',
    ]);

    // Description
    const description = getText([
      '[class*="description"]', '[class*="Description"]',
      '[itemprop="description"]', '[data-testid="description"]',
      '.description',
    ]);

    // Images – try multiple strategies
    let images = [];

    // Strategy 1: carousel/gallery images
    const imgSelectors = [
      '[class*="carousel"] img', '[class*="gallery"] img',
      '[class*="photo"] img', 'img[class*="carousel"]',
      'img[class*="gallery"]', 'img[class*="photo"]',
    ];
    for (const sel of imgSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        const found = Array.from(els)
          .map(el => el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy') || '')
          .filter(src => src && src.startsWith('http') && !src.includes('placeholder'));
        if (found.length > 0) { images = found; break; }
      }
    }

    // Strategy 2: look for picture srcset
    if (images.length === 0) {
      const sources = document.querySelectorAll('picture source[srcset]');
      images = Array.from(sources)
        .map(s => s.srcset?.split(' ')[0])
        .filter(src => src && src.startsWith('http'));
    }

    // Strategy 3: any img with CDN-looking URL
    if (images.length === 0) {
      images = Array.from(document.querySelectorAll('img[src]'))
        .map(img => img.src)
        .filter(src =>
          src && src.startsWith('http') &&
          !src.includes('logo') && !src.includes('icon') &&
          !src.includes('avatar') && !src.includes('sprite') &&
          (src.includes('cdn') || src.includes('img') || src.includes('photo') || src.includes('foto'))
        );
    }

    // Deduplicate
    images = [...new Set(images)];

    // Reference ID from URL
    const refMatch = window.location.href.match(/\/(\d+)\/?(\?|$)/);
    const refId = refMatch ? refMatch[1] : String(Date.now());

    return {
      refId,
      title,
      price:       getNumber(rawPrice),
      area:        area ? parseInt(area, 10) : extractNumber('m²|metros quadrados'),
      bedrooms,
      suites,
      bathrooms,
      parking,
      age,
      amenities:   JSON.stringify(extractedAmenities),
      location,
      description,
      images,
      url: window.location.href,
    };
  });
}

// ─── Single property scraper (with retry) ────────────────────────────────────
async function scrapeProperty(url, attempt = 0) {
  const timeout = parseInt(process.env.SCRAPE_TIMEOUT) || 45000;
  const browser = await getBrowser();
  const page    = await setupPage(browser);

  try {
    console.log(`[Scraper] [${attempt > 0 ? `retry ${attempt}` : 'attempt 1'}] ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    // Allow the page (and any CF challenge JS) to finish
    await randDelay(2500, 4500);

    // ── Block detection ─────────────────────────────────────────────────────
    const pageTitle  = await page.title();
    const bodySnippet = await page.evaluate(
      () => (document.body?.innerText || '').slice(0, 400)
    );

    if (isBlocked(pageTitle, bodySnippet)) {
      if (attempt < 2) {
        console.warn(`[Scraper] Bloqueado (tentativa ${attempt + 1}). Reiniciando sessão...`);
        await page.close();
        await closeBrowser(); // Fresh browser = new fingerprint
        await randDelay(8000, 14000);
        return scrapeProperty(url, attempt + 1);
      }
      throw new Error(
        'Zap Imóveis bloqueou o acesso (proteção Cloudflare). ' +
        'Aguarde alguns minutos e tente novamente.'
      );
    }

    // ── Wait for main content ────────────────────────────────────────────────
    await page.waitForSelector('h1, [class*="price"], [class*="listing"]', { timeout: 20000 })
      .catch(() => console.warn('[Scraper] Seletor principal não encontrado a tempo.'));

    // ── Humanize ─────────────────────────────────────────────────────────────
    await humanize(page);

    // ── Extract data ──────────────────────────────────────────────────────────
    const data = await extractData(page);
    data.url   = data.url || url;

    // Fallback title from <title> tag
    if (!data.title || isBlocked(data.title)) {
      data.title = pageTitle || 'Imóvel';
    }

    // Final block check on extracted content
    if (isBlocked(data.title, data.description || '')) {
      throw new Error('Dados extraídos indicam bloqueio. Tente novamente mais tarde.');
    }

    console.log(`[Scraper] ✅ ${data.title?.slice(0, 60) || url}`);
    return normalize(data);

  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Listing scraper ──────────────────────────────────────────────────────────
async function scrapeListing(url) {
  const timeout = parseInt(process.env.SCRAPE_TIMEOUT) || 45000;
  const maxProps = parseInt(process.env.MAX_LISTING_PROPERTIES) || 50;
  const browser  = await getBrowser();
  const page     = await setupPage(browser);

  try {
    console.log(`[Scraper] Listagem: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout });
    await randDelay(2500, 4500);

    // Block check
    const pageTitle   = await page.title();
    const bodySnippet = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400));
    if (isBlocked(pageTitle, bodySnippet)) {
      throw new Error('Zap Imóveis bloqueou o acesso à listagem. Tente novamente mais tarde.');
    }

    await page.waitForSelector(
      '[class*="listing-card"], [class*="property-card"], [class*="ListingCard"], article',
      { timeout: 20000 }
    ).catch(() => console.warn('[Scraper] Cards da listagem não encontrados a tempo.'));

    await humanize(page);

    // Collect property URLs
    const propertyUrls = await page.evaluate((max) => {
      const selectors = [
        'a[class*="listing-card"]', 'a[class*="property-card"]',
        'a[class*="ListingCard"]',  'a[href*="/imovel/"]',
        '[data-testid="listing-card"] a', 'article a[href]',
      ];

      let links = [];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          links = Array.from(els)
            .map(a => a.href)
            .filter(href => href && (href.includes('zapimoveis') || href.includes('vivareal')));
          if (links.length > 0) break;
        }
      }

      // Fallback: any link to a property detail page
      if (links.length === 0) {
        links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(href => href && href.includes('/imovel/') && !href.includes('#'));
      }

      return [...new Set(links)].slice(0, max);
    }, maxProps);

    console.log(`[Scraper] ${propertyUrls.length} imóveis encontrados na listagem.`);
    await page.close().catch(() => {});

    if (propertyUrls.length === 0) {
      throw new Error('Nenhum imóvel encontrado na listagem. Verifique a URL.');
    }

    // Scrape each property with a delay between requests
    const properties = [];
    for (let i = 0; i < propertyUrls.length; i++) {
      const propUrl = propertyUrls[i];
      console.log(`[Scraper] ${i + 1}/${propertyUrls.length}: ${propUrl}`);
      try {
        const prop = await scrapeProperty(propUrl);
        properties.push(prop);
        // Respectful delay between requests (2–5 seconds)
        if (i < propertyUrls.length - 1) await randDelay(2000, 5000);
      } catch (err) {
        console.warn(`[Scraper] Falha em ${propUrl}: ${err.message}`);
      }
    }

    return properties;

  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

module.exports = { scrapeProperty, scrapeListing, scrapePaginatedUrls, closeBrowser };

// ═══════════════════════════════════════════════════════════════════════════════
// PAGINATED URL COLLECTION
// Traverses multiple Zap Imóveis listing pages and returns all property URLs.
// Supports up to 2000 properties (≈100+ pages).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds the URL for a specific page of a Zap listing.
 * Handles both ?pagina=N and hash-based pagination.
 */
function buildPageUrl(baseUrl, pageNum) {
  try {
    const url = new URL(baseUrl);
    // Strip trailing slash for consistency
    const cleanPath = url.pathname.replace(/\/$/, '');
    url.pathname = cleanPath;
    if (pageNum <= 1) {
      url.searchParams.delete('pagina');
    } else {
      url.searchParams.set('pagina', String(pageNum));
    }
    return url.href;
  } catch {
    if (pageNum <= 1) return baseUrl;
    const base = baseUrl.replace(/\/$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}pagina=${pageNum}`;
  }
}

/**
 * Scrapes ALL property URLs from a paginated Zap Imóveis listing.
 * @param {string}   baseUrl  - Search/listing/agent URL
 * @param {number}   maxUrls  - Maximum URLs to collect (default 2000)
 * @param {Function} onProgress - Called after each page: ({ found, page, hasNextPage })
 * @returns {Promise<string[]>}
 */
async function scrapePaginatedUrls(baseUrl, maxUrls = 2000, onProgress = () => {}) {
  const allUrls        = new Set();
  const timeout        = parseInt(process.env.SCRAPE_TIMEOUT) || 45000;
  const maxPages       = Math.min(500, Math.ceil(maxUrls / 10) + 10);
  const browser        = await getBrowser();
  const isImobiliaria  = baseUrl.includes('/imobiliaria/');

  console.log(`[PaginatedScraper] Iniciando coleta (alvo: ${maxUrls} URLs, até ${maxPages} págs, tipo: ${isImobiliaria ? 'imobiliária' : 'busca'})`);

  let consecutiveEmpty = 0; // safety: stop after N pages with no new URLs

  for (let pageNum = 1; pageNum <= maxPages && allUrls.size < maxUrls; pageNum++) {
    const pageUrl = buildPageUrl(baseUrl, pageNum);
    const page    = await setupPage(browser, baseUrl);

    try {
      console.log(`[PaginatedScraper] Pág ${pageNum}: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });

      // Wait for property links to appear
      await page.waitForSelector('a[href*="/imovel/"]', { timeout: 20000 }).catch(() => {});
      await randDelay(2500, 4500);

      // ── Block detection ──────────────────────────────────────────────────
      const pageTitle   = await page.title();
      const bodySnippet = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600));
      if (isBlocked(pageTitle, bodySnippet)) {
        console.warn(`[PaginatedScraper] Bloqueado na pág ${pageNum}. Parando.`);
        await page.close().catch(() => {});
        break;
      }

      // ── Scroll to load lazy content ──────────────────────────────────────
      await page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 900);
          await new Promise(r => setTimeout(r, 500));
        }
        window.scrollTo(0, 0);
      });
      await randDelay(800, 1500);

      // ── Extract URLs + pagination info ───────────────────────────────────
      const data = await page.evaluate(() => {
        // Collect all property links
        const links = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.href || '';
          if (h.includes('/imovel/') && !h.includes('#') && !h.includes('javascript')) {
            // Normalize: remove query params from property URLs
            try {
              const u = new URL(h);
              links.add(u.origin + u.pathname);
            } catch {
              links.add(h);
            }
          }
        });

        // ── Next page button detection ───────────────────────────────────
        const NEXT_SELECTORS = [
          '[aria-label="Próxima página"]',
          '[aria-label="next page"]',
          '[data-testid="pagination-next"]',
          '[rel="next"]',
          '[aria-label*="próxima"]',
          '[aria-label*="Próxima"]',
          '.pagination__next',
          'button[title*="próxima"]',
          'li.next a',
          'a.next',
        ];
        let hasNextPage = false;
        for (const sel of NEXT_SELECTORS) {
          const el = document.querySelector(sel);
          if (el) {
            const disabled = el.disabled
              || el.getAttribute('disabled') !== null
              || el.classList.contains('disabled')
              || el.getAttribute('aria-disabled') === 'true';
            if (!disabled) { hasNextPage = true; break; }
          }
        }

        // ── Total count from page ────────────────────────────────────────
        const totalSelectors = [
          '[data-testid="total-listing-count"]',
          '.results-summary strong',
          '[class*="TotalCount"]',
          '[class*="totalCount"]',
          '[class*="total-count"]',
          'h1[class*="title"]',
          '[class*="ResultCount"]',
        ];
        let total = 0;
        for (const sel of totalSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const m = (el.innerText || '').replace(/\./g, '').match(/\d+/);
            if (m) { total = parseInt(m[0]); break; }
          }
        }

        return { urls: [...links], hasNextPage, total };
      });

      await page.close().catch(() => {});

      const before = allUrls.size;
      data.urls.forEach(u => allUrls.add(u));
      const added = allUrls.size - before;

      onProgress({ found: allUrls.size, page: pageNum, hasNextPage: data.hasNextPage, total: data.total });
      console.log(`[PaginatedScraper] Pág ${pageNum}: +${added} novos (total: ${allUrls.size}${data.total ? '/' + data.total : ''}, nextPage: ${data.hasNextPage})`);

      if (added === 0) {
        consecutiveEmpty++;
        console.log(`[PaginatedScraper] Nenhum novo URL nesta pág (${consecutiveEmpty} vazia(s) consecutiva(s)).`);
        // For imobiliaria pages: try up to 2 empty pages before stopping
        // (sometimes a page loads slowly or is slightly different)
        if (consecutiveEmpty >= 2) {
          console.log(`[PaginatedScraper] Parando: ${consecutiveEmpty} páginas sem novos imóveis.`);
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      // For imobiliaria URLs: always try the next page using pagina= param
      // (don't rely solely on hasNextPage button detection)
      if (!data.hasNextPage && !isImobiliaria) {
        console.log(`[PaginatedScraper] Fim de paginação detectado (sem botão próxima).`);
        break;
      }

      await randDelay(2500, 5000);

    } catch (err) {
      await page.close().catch(() => {});
      console.warn(`[PaginatedScraper] Erro na pág ${pageNum}: ${err.message.slice(0, 120)}`);
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
    }
  }

  const result = [...allUrls].slice(0, maxUrls);
  console.log(`[PaginatedScraper] Concluído: ${result.length} URLs únicas coletadas.`);
  return result;
}


