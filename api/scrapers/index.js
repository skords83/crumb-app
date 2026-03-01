const scrapePloetzblog = require('./ploetzblog');
const scrapeBrotdoc    = require('./brotdoc');
const scrapeMarcelPaa  = require('./marcelpaa');
const scrapeHomebaking = require('./homebaking');
const scrapeJoSemola   = require('./josemola');
const parseHtmlImport  = require('./smry');
const axios            = require('axios');

// ── SMRY-FALLBACK: URL fetchen, dann HTML-Parser aufrufen ────
const scrapeViaSmry = async (originalUrl) => {
  const smryUrl = `https://smry.app/${originalUrl}`;
  console.log(`⚠️ Unbekannte Quelle – versuche smry.app: ${smryUrl}`);
  try {
    const { data: html } = await axios.get(smryUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    return await parseHtmlImport(html, originalUrl);
  } catch (err) {
    console.error('smry.app Fallback fehlgeschlagen:', err.message);
    return null;
  }
};

// ── ROUTER ───────────────────────────────────────────────────
const getScraper = (url) => {
  const u = (url || '').toLowerCase();
  if (u.includes('ploetzblog.de'))  return scrapePloetzblog;
  if (u.includes('brotdoc.com'))    return scrapeBrotdoc;
  if (u.includes('marcelpaa.com'))  return scrapeMarcelPaa;
  if (u.includes('homebaking.at'))  return scrapeHomebaking;
  if (u.includes('josemola.de'))    return scrapeJoSemola;

  // Fallback: smry.app als Proxy
  return scrapeViaSmry;
};

module.exports = { getScraper };