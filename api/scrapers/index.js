const scrapePloetz = require('./ploetzblog');
const scrapeHomebaking = require('./homebaking');
const scrapeBrotdoc = require('./brotdoc');

const scrapers = {
  'ploetzblog.de': scrapePloetz,
  'homebaking.at': scrapeHomebaking,
  'brotdoc.com': scrapeBrotdoc,
};

// Wir exportieren ein Objekt, das die Funktion enthält
module.exports = {
  getScraper: (url) => {
    const domain = Object.keys(scrapers).find(d => url.includes(d));
    return scrapers[domain] || null;
  }
};