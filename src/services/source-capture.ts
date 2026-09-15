import { EvidenceValidationError } from './evidence-hasher.js';

export interface SourceValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
}

export interface SourceCaptureResult {
  sourceUrl: string;
  capturedAt: string;
  operatorNotes: string;
}

export interface SourceCaptureProvider {
  validate(url: string): Promise<SourceValidationResult>;
  capture(url: string, notes: string): Promise<SourceCaptureResult>;
}

/**
 * Parses an IPv4 string (in dotted-decimal, octal, hex, or single decimal integer format)
 * into a 32-bit unsigned integer, or returns null if not an IPv4 representation.
 */
export function parseIPv4ToNumber(rawHost: string): number | null {
  const host = rawHost.trim().toLowerCase();

  // 1. Single integer representation (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) {
    const num = host.startsWith('0x') ? parseInt(host, 16) : parseInt(host, 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
      return num >>> 0;
    }
  }

  // 2. Dotted notation (1 to 4 segments, each decimal, octal, or hex)
  const parts = host.split('.');
  if (parts.length > 4 || parts.length === 0) {
    return null;
  }

  const values: number[] = [];
  for (const p of parts) {
    if (!p) return null;
    let val: number;
    if (p.startsWith('0x') || p.startsWith('0X')) {
      val = parseInt(p, 16);
    } else if (p.startsWith('0') && p.length > 1 && /^0[0-7]+$/.test(p)) {
      val = parseInt(p, 8);
    } else if (/^\d+$/.test(p)) {
      val = parseInt(p, 10);
    } else {
      return null;
    }

    if (isNaN(val) || val < 0) return null;
    values.push(val);
  }

  // Calculate 32-bit IPv4 integer
  if (values.length === 4) {
    if (values.some((v) => v > 255)) return null;
    return (((values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3]) >>> 0);
  } else if (values.length === 3) {
    if (values[0] > 255 || values[1] > 255 || values[2] > 65535) return null;
    return (((values[0] << 24) | (values[1] << 16) | values[2]) >>> 0);
  } else if (values.length === 2) {
    if (values[0] > 255 || values[1] > 16777215) return null;
    return (((values[0] << 24) | values[1]) >>> 0);
  } else if (values.length === 1) {
    if (values[0] > 4294967295) return null;
    return values[0] >>> 0;
  }

  return null;
}

/**
 * Checks whether an IPv4 32-bit integer falls within private, loopback, link-local,
 * CGNAT, multicast, or reserved ranges.
 */
export function isPrivateOrRestrictedIPv4(ipNum: number): boolean {
  // 0.0.0.0/8 (Current network)
  if ((ipNum >>> 24) === 0) return true;

  // 10.0.0.0/8 (Private)
  if ((ipNum >>> 24) === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if ((ipNum >>> 24) === 127) return true;

  // 100.64.0.0/10 (Shared / Carrier Grade NAT: 100.64.0.0 - 100.127.255.255)
  if (ipNum >= 0x64400000 && ipNum <= 0x647fffff) return true;

  // 169.254.0.0/16 (Link-Local, AWS/GCP/Azure metadata 169.254.169.254)
  if ((ipNum >>> 16) === 0xa9fe) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (ipNum >= 0xac100000 && ipNum <= 0xac1fffff) return true;

  // 192.168.0.0/16 (Private)
  if ((ipNum >>> 16) === 0xc0a8) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if ((ipNum >>> 8) === 0xc00002) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if ((ipNum >>> 8) === 0xc63364) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if ((ipNum >>> 8) === 0xcb0071) return true;

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if ((ipNum >>> 28) === 14) return true;

  // 240.0.0.0/4 (Reserved / Future Use)
  if ((ipNum >>> 28) === 15) return true;

  return false;
}

/**
 * Checks whether an IPv6 string is loopback, unique local, link-local, or IPv4-mapped private.
 */
export function isPrivateOrRestrictedIPv6(rawIpv6: string): boolean {
  let cleaned = rawIpv6.toLowerCase();
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }

  // Loopback / Unspecified
  if (cleaned === '::1' || cleaned === '::' || cleaned === '0:0:0:0:0:0:0:1' || cleaned === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Unique local addresses (fc00::/7 -> fc00.. - fdff..)
  if (cleaned.startsWith('fc') || cleaned.startsWith('fd') || /^f[cd][0-9a-f]{2}:/i.test(cleaned)) {
    return true;
  }

  // Link-local addresses (fe80::/10 -> fe80.. - febf..)
  if (cleaned.startsWith('fe8') || cleaned.startsWith('fe9') || cleaned.startsWith('fea') || cleaned.startsWith('feb')) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleaned.includes('::ffff:')) {
    const v4Part = cleaned.split('::ffff:')[1];
    if (v4Part) {
      const v4Num = parseIPv4ToNumber(v4Part);
      if (v4Num !== null) {
        return isPrivateOrRestrictedIPv4(v4Num);
      }
    }
    return true;
  }

  return false;
}

/**
 * Manual source capture provider for Phase 2.
 * Validates syntax, normalizes URLs, blocks SSRF/internal network targets,
 * and records metadata without performing any live network fetching.
 */
export class ManualSourceCaptureProvider implements SourceCaptureProvider {
  public async validate(rawUrl: string): Promise<SourceValidationResult> {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { valid: false, error: 'Source URL is required.' };
    }

    const trimmed = rawUrl.trim();
    if (trimmed.length > 2048) {
      return { valid: false, error: 'Source URL exceeds maximum permitted length of 2048 characters.' };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, error: 'Invalid URL format.' };
    }

    // 1. Protocol / Scheme validation
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: `Disallowed URL protocol '${parsed.protocol}'. Only http: and https: are supported.` };
    }

    // 2. Reject embedded user credentials
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'Embedded user credentials in source URL are prohibited.' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // 3. Reject prohibited internal / cloud hostnames
    const prohibitedHostnames = [
      'localhost',
      'metadata.google.internal',
      'metadata',
      'instance-data',
      'docker.for.mac.localhost',
      'docker.for.win.localhost',
      'host.docker.internal'
    ];
    if (prohibitedHostnames.includes(hostname)) {
      return { valid: false, error: 'Localhost and internal network addresses are prohibited.' };
    }

    // Reject internal domain suffixes
    const prohibitedSuffixes = [
      '.internal',
      '.local',
      '.localhost',
      '.onion',
      '.corp',
      '.lan',
      '.home',
      '.invalid'
    ];

    for (const suffix of prohibitedSuffixes) {
      if (hostname.endsWith(suffix)) {
        return { valid: false, error: `Internal domain extension '${suffix}' is prohibited.` };
      }
    }

    // 4. IPv4 detection (dotted, octal, hex, decimal integer)
    const ipv4Num = parseIPv4ToNumber(hostname);
    if (ipv4Num !== null) {
      if (isPrivateOrRestrictedIPv4(ipv4Num)) {
        return { valid: false, error: 'Private, loopback, link-local, and reserved IPv4 addresses are prohibited.' };
      }
    }

    // 5. IPv6 detection
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      if (isPrivateOrRestrictedIPv6(hostname)) {
        return { valid: false, error: 'Private, loopback, and link-local IPv6 addresses are prohibited.' };
      }
    } else if (isPrivateOrRestrictedIPv6(hostname)) {
      return { valid: false, error: 'Private, loopback, and link-local IPv6 addresses are prohibited.' };
    }

    return {
      valid: true,
      normalizedUrl: parsed.toString()
    };
  }

  public async capture(url: string, notes: string = ''): Promise<SourceCaptureResult> {
    const validation = await this.validate(url);
    if (!validation.valid || !validation.normalizedUrl) {
      throw new EvidenceValidationError(validation.error || 'Invalid source URL', 'INVALID_SOURCE_URL');
    }

    return {
      sourceUrl: validation.normalizedUrl,
      capturedAt: new Date().toISOString(),
      operatorNotes: notes.trim()
    };
  }
}
