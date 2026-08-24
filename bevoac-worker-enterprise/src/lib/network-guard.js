const dns = require('dns').promises;
const net = require('net');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REDIRECTS = 2;

const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

const BLOCKED_EXACT_IPV4 = new Set([
  '169.254.169.254',
  '168.63.129.16'
]);

function ipv4ToInt(ip) {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0) >>> 0;
}

function ipv4InCidr(ip, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedIpv4(ip) {
  if (BLOCKED_EXACT_IPV4.has(ip)) return true;
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(ip, base, prefix));
}

function isBlockedIpv6(ip) {
  const normalized = String(ip || '').toLowerCase();

  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;

  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.replace('::ffff:', ''));
  }

  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function normalizeAndValidateUrl(input, guardConfig = {}) {
  let parsed;

  try {
    parsed = new URL(String(input || '').trim());
  } catch (_) {
    throw new Error('Invalid URL for web scan.');
  }

  const allowedSchemes = guardConfig.allowedSchemes || ['https:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = new Set([
    ...(guardConfig.blockedHosts || []),
    'localhost',
    'localhost.localdomain'
  ]);

  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error(`Blocked internal hostname: ${hostname}`);
  }

  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error(`Blocked internal/reserved IP target: ${hostname}`);
  }

  return parsed;
}

function redactUrlForDisplay(input) {
  try {
    const parsed = new URL(String(input || '').trim());
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '[invalid-url]';
  }
}

async function resolvePublicAddresses(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => ({
    address: record.address,
    family: record.family
  }));

  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}.`);
  }

  const blocked = addresses.filter((item) => isBlockedAddress(item.address));
  if (blocked.length > 0) {
    throw new Error(
      `DNS resolution for ${hostname} includes blocked address(es): ${blocked
        .map((item) => item.address)
        .join(', ')}`
    );
  }

  return addresses;
}

async function assertPublicHttpTarget(targetUrl, guardConfig = {}) {
  const parsed = normalizeAndValidateUrl(targetUrl, guardConfig);
  const resolvedAddresses = await resolvePublicAddresses(parsed.hostname);
  const pinned = resolvedAddresses[0];

  if (!pinned || !pinned.address || !net.isIP(pinned.address)) {
    throw new Error(`Unable to pin a valid public IP address for ${parsed.hostname}.`);
  }

  return {
    url: parsed.toString(),
    parsed,
    hostname: parsed.hostname,
    resolvedAddresses,
    pinnedAddress: pinned.address,
    family: pinned.family
  };
}

function buildPinnedLookup(targetInfo) {
  const pinnedAddress = targetInfo.pinnedAddress;
  const pinnedFamily = targetInfo.family;

  if (!pinnedAddress || !net.isIP(pinnedAddress)) {
    throw new Error(`Invalid pinned IP address for ${targetInfo.hostname}: ${pinnedAddress || 'undefined'}`);
  }

  return function lookup(_hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;

    if (typeof cb !== 'function') {
      return;
    }

    if (options && options.all) {
      cb(null, [{ address: pinnedAddress, family: pinnedFamily }]);
      return;
    }

    cb(null, pinnedAddress, pinnedFamily);
  };
}

function requestPinned(targetInfo, timeoutMs, method = 'HEAD', signal = null) {
  return new Promise((resolve) => {
    let lookup;
    let settled = false;
    let req;
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onAbort = () => req?.destroy(signal.reason || new Error('HTTPS request aborted.'));

    try {
      lookup = buildPinnedLookup(targetInfo);
    } catch (error) {
      finish({ error });
      return;
    }

    const path = `${targetInfo.parsed.pathname || '/'}${targetInfo.parsed.search || ''}`;

    req = https.request(
      {
        protocol: 'https:',
        hostname: targetInfo.hostname,
        servername: targetInfo.hostname,
        port: targetInfo.parsed.port || 443,
        path,
        method,
        timeout: timeoutMs,
        lookup,
        rejectUnauthorized: true,
        headers: {
          Host: targetInfo.hostname,
          'User-Agent': 'BevoacSecurityScanner/5.0',
          Accept: '*/*',
          Connection: 'close'
        }
      },
      (res) => {
        res.resume();
        finish(res);
      }
    );

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (error) => finish({ error }));

    req.on('timeout', () => {
      req.destroy(new Error(`HTTPS ${method} timeout after ${timeoutMs}ms`));
    });

    req.end();
  });
}

async function requestHeadersWithFallback(info, timeoutMs, signal = null) {
  let res = await requestPinned(info, timeoutMs, 'HEAD', signal);

  if (res && res.error) {
    const getRes = await requestPinned(info, timeoutMs, 'GET', signal);
    if (!getRes.error) {
      res = getRes;
    }
  }

  return res;
}

async function guardedHead(targetUrl, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  guardConfig = {},
  signal = null
} = {}) {
  let current = targetUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const info = await assertPublicHttpTarget(current, guardConfig);
    const res = await requestHeadersWithFallback(info, timeoutMs, signal);

    if (res.error) {
      return { error: res.error, targetInfo: info, finalUrl: info.url };
    }

    if ([301, 302, 303, 307, 308].includes(Number(res.statusCode)) && res.headers.location) {
      if (redirect === maxRedirects) {
        return { error: new Error('Maximum redirects exceeded'), targetInfo: info, finalUrl: info.url };
      }

      current = new URL(res.headers.location, info.parsed).toString();
      continue;
    }

    return { response: res, targetInfo: info, finalUrl: info.url };
  }

  return { error: new Error('Unexpected redirect guard state') };
}

module.exports = {
  assertPublicHttpTarget,
  guardedHead,
  isBlockedAddress,
  normalizeAndValidateUrl,
  redactUrlForDisplay,
  resolvePublicAddresses
};
