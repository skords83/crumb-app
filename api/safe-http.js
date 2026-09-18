const axios = require('axios');
const dns = require('dns');
const net = require('net');

const MAX_REMOTE_RESPONSE_BYTES = 5 * 1024 * 1024;

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    // Only global unicast; reject mapped IPv4, local, multicast and transition ranges.
    const global = new net.BlockList();
    global.addSubnet('2000::', 3, 'ipv6');
    const special = new net.BlockList();
    special.addSubnet('2001::', 23, 'ipv6');
    special.addSubnet('2001:db8::', 32, 'ipv6');
    special.addSubnet('2002::', 16, 'ipv6');
    special.addSubnet('3fff::', 20, 'ipv6');
    return global.check(address, 'ipv6') && !special.check(address, 'ipv6');
  }
  return false;
}

function parseRemoteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Ungültige externe URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Nur HTTPS-URLs ohne Zugangsdaten sind erlaubt');
  }
  return url;
}

async function resolvePublicHost(hostname) {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error('Zieladresse ist nicht öffentlich erreichbar');
  }
  return addresses;
}

function safeLookup(hostname, options, callback) {
  resolvePublicHost(hostname)
    .then((addresses) => {
      const family = typeof options === 'number' ? options : options?.family;
      const matches = family ? addresses.filter(a => a.family === family) : addresses;
      if (!matches.length) throw new Error('Keine öffentliche Adresse für diese Adressfamilie');
      if (options?.all) callback(null, matches);
      else callback(null, matches[0].address, matches[0].family);
    })
    .catch(callback);
}

async function safeGet(url, options = {}) {
  const parsed = parseRemoteUrl(url);
  await resolvePublicHost(parsed.hostname);

  return axios.get(parsed.toString(), {
    ...options,
    lookup: safeLookup,
    maxRedirects: 3,
    maxContentLength: MAX_REMOTE_RESPONSE_BYTES,
    maxBodyLength: MAX_REMOTE_RESPONSE_BYTES,
    proxy: false,
    beforeRedirect: (redirectOptions) => {
      // Node bypasses DNS lookup for IP literals, so validate these explicitly.
      const hostname = redirectOptions.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(hostname) && !isPublicIp(hostname)) {
        throw new Error('Weiterleitung auf eine interne Adresse blockiert');
      }
      if (redirectOptions.protocol !== 'https:') {
        throw new Error('Weiterleitung auf ein unsicheres Protokoll blockiert');
      }
    },
  });
}

module.exports = { safeGet, isPublicIp, parseRemoteUrl, safeLookup };
