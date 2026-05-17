/**
 * Decodes the obfuscated video server URLs from witanime.you episode pages.
 *
 * Protocol reverse-engineered from abz100.js:
 *   1. window.resourceRegistry (from _zG variable) contains reversed+base64 URLs
 *   2. window.configRegistry (from _zH variable) contains offset configs
 *   3. Reversal → base64 decode → trim trailing N bytes → final iframe URL
 */
function decodeVideoServers(html) {
  const zG = extractVariable(html, '_zG');
  const zH = extractVariable(html, '_zH');

  if (!zG || !zH) return [];

  let resourceRegistry;
  let configRegistry;
  try {
    resourceRegistry = JSON.parse(Buffer.from(zG, 'base64').toString('utf8'));
    configRegistry = JSON.parse(Buffer.from(zH, 'base64').toString('utf8'));
  } catch {
    return [];
  }

  const servers = [];

  for (let i = 0; i < resourceRegistry.length; i++) {
    const raw = resourceRegistry[i];
    const config = configRegistry[i];
    if (!raw || !config) continue;

    // Step 1: Reverse the string
    let reversed = raw.split('').reverse().join('');

    // Step 2: Remove non-base64 characters
    reversed = reversed.replace(/[^A-Za-z0-9+/=]/g, '');

    // Step 3: Get the offset from config
    let offset = 0;
    try {
      const keyIndex = Buffer.from(config.k, 'base64').toString('utf8');
      offset = config.d[parseInt(keyIndex, 10)];
    } catch {
      continue;
    }

    // Step 4: Base64 decode and trim
    let decoded;
    try {
      decoded = Buffer.from(reversed, 'base64').toString('utf8');
    } catch {
      continue;
    }
    decoded = decoded.slice(0, -offset || undefined);

    // Step 5: Parse server name from config.v (base64 encoded)
    let name = '';
    try {
      name = Buffer.from(config.v, 'base64').toString('utf8');
    } catch {
      name = `Server ${i + 1}`;
    }

    servers.push({
      id: i.toString(),
      name,
      url: decoded,
    });
  }

  return servers;
}

/**
 * Extracts a JavaScript variable value from HTML as a quoted string.
 * Works with both single and double quotes.
 */
function extractVariable(html, varName) {
  const patterns = [
    new RegExp(`var\\s+${varName}\\s*=\\s*"([^"]*)"`, 's'),
    new RegExp(`var\\s+${varName}\\s*=\\s*'([^']*)'`, 's'),
    // Also match the discovered pattern: _zG="[base64]"
    new RegExp(`${varName}\\s*=\\s*"([^"]*)"`, 's'),
    new RegExp(`${varName}\\s*=\\s*'([^']*)'`, 's'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Decodes base64-encoded onclick episode URLs from the episode sidebar.
 * Example: aHR0cHM6Ly93aXRhbmltZS55b3UvZXBpc29kZS8uLi4= → full URL
 */
function decodeEpisodeUrl(encoded) {
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Decodes the XOR-obfuscated episode list from anime pages.
 *
 * Protocol reverse-engineered from rnd.js:
 *   1. `processedEpisodeData` = '<base64_encrypted>.<base64_key>'
 *   2. Split by '.', atob both parts
 *   3. XOR first part bytes against repeating key bytes
 *   4. JSON.parse the result → array of { url, number, type, screenshot }
 */
function decodeEpisodeData(raw) {
  if (!raw) return [];

  try {
    const parts = raw.split('.');
    if (parts.length !== 2) return [];

    const encrypted = Buffer.from(parts[0], 'base64');
    const key = Buffer.from(parts[1], 'base64');

    const decrypted = Buffer.alloc(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ key[i % key.length];
    }

    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return [];
  }
}

module.exports = { decodeVideoServers, decodeEpisodeUrl, decodeEpisodeData, extractVariable };
