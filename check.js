// Quick syntax check for all modules
const modules = [
  './src/normalizer',
  './src/xmlGenerator',
  './src/db',
  './src/scraper',
  './src/jobRunner',
  './src/routes/users',
  './src/routes/import',
  './src/routes/properties',
  './src/routes/feed',

];

let ok = true;
for (const m of modules) {
  try {
    require(m);
    console.log('✅', m);
  } catch (e) {
    console.error('❌', m, '->', e.message);
    ok = false;
  }
}
console.log(ok ? '\nAll modules loaded OK' : '\nSome modules failed');
process.exit(ok ? 0 : 1);
