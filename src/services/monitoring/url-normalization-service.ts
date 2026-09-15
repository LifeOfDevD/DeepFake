import crypto from 'crypto';

export interface NormalizedUrlResult {
  rawUrl: string;
  normalizedUrl: string;
  platform: string;
  domain: string;
  path: string;
  canonicalHash: string;
}

export class UrlNormalizationService {
  private static readonly TRACKING_PREFIXES = ['utm_'];
  private static readonly TRACKING_PARAMS = new Set([
    'fbclid',
    'gclid',
    'igshid',
    'igsh',
    'ref',
    'ref_src',
    'ref_url',
    'source',
    'feature',
    'si',
    's',
    't',
    'trk',
    'context',
    'mibextid',
    'scm',
    'spm',
    'share_id',
    'vd_source',
    'sub_confirmation'
  ]);

  /**
   * Deterministically normalizes a URL with zero network/DNS calls.
   * Strips tracking parameters, canonicalizes protocols/domains/paths,
   * normalizes Unicode via NFKC, and computes a SHA-256 hash.
   */
  public normalize(rawUrl: string): NormalizedUrlResult {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
      const emptyHash = crypto.createHash('sha256').update('').digest('hex');
      return {
        rawUrl: '',
        normalizedUrl: '',
        platform: 'other',
        domain: '',
        path: '',
        canonicalHash: emptyHash
      };
    }

    // Unicode normalization NFKC
    const nfkc = trimmed.normalize('NFKC');

    let parsed: URL;
    try {
      // Add default https:// if scheme is missing
      if (!/^https?:\/\//i.test(nfkc)) {
        parsed = new URL(`https://${nfkc}`);
      } else {
        parsed = new URL(nfkc);
      }
    } catch {
      // Fallback for severely malformed input
      const sanitized = nfkc.toLowerCase().replace(/[\s\r\n]+/g, '');
      const hash = crypto.createHash('sha256').update(sanitized).digest('hex');
      return {
        rawUrl: trimmed,
        normalizedUrl: sanitized,
        platform: 'other',
        domain: '',
        path: sanitized,
        canonicalHash: hash
      };
    }

    // Protocol: enforce https (unless localhost)
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      parsed.protocol = 'https:';
    }

    // Hostname normalization
    let hostname = parsed.hostname.toLowerCase();

    // Strip mobile/www subdomains
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    } else if (hostname.startsWith('m.')) {
      hostname = hostname.slice(2);
    } else if (hostname.startsWith('mobile.')) {
      hostname = hostname.slice(7);
    }
    parsed.hostname = hostname;

    // Remove default ports
    if ((parsed.protocol === 'https:' && parsed.port === '443') ||
        (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }

    // Tracking parameter removal
    const keysToRemove: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (
        UrlNormalizationService.TRACKING_PARAMS.has(lowerKey) ||
        UrlNormalizationService.TRACKING_PREFIXES.some((p) => lowerKey.startsWith(p))
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      parsed.searchParams.delete(key);
    }

    // Sort query parameters deterministically
    parsed.searchParams.sort();

    // Standardize path
    let pathname = parsed.pathname;
    // Collapse duplicate slashes
    pathname = pathname.replace(/\/+/g, '/');

    // Platform identification and platform-specific path canonicalization
    let platform = 'other';

    if (hostname.includes('instagram.com')) {
      platform = 'instagram';
      // Normalize /username/ -> /username
      pathname = pathname.replace(/\/$/, '');
    } else if (hostname === 'x.com' || hostname === 'twitter.com') {
      platform = 'twitter';
      parsed.hostname = 'x.com';
      pathname = pathname.replace(/\/$/, '');
    } else if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
      platform = 'youtube';
      if (hostname === 'youtu.be') {
        parsed.hostname = 'youtube.com';
        const videoId = pathname.slice(1);
        pathname = '/watch';
        parsed.searchParams.set('v', videoId);
      } else {
        pathname = pathname.replace(/\/$/, '');
      }
    } else if (hostname.includes('facebook.com') || hostname === 'fb.com') {
      platform = 'facebook';
      parsed.hostname = 'facebook.com';
      pathname = pathname.replace(/\/$/, '');
    } else if (hostname.includes('linkedin.com')) {
      platform = 'linkedin';
      pathname = pathname.replace(/\/$/, '');
    } else if (hostname === 't.me' || hostname.includes('telegram.')) {
      platform = 'telegram';
      parsed.hostname = 't.me';
      pathname = pathname.replace(/\/$/, '');
    } else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) {
      platform = 'domain';
      pathname = pathname.replace(/\/$/, '');
    }

    if (!pathname) {
      pathname = '/';
    }

    parsed.pathname = pathname;
    // Remove hash/fragment
    parsed.hash = '';

    const normalizedUrl = parsed.toString().replace(/\/$/, pathname === '/' ? '/' : '');
    const canonicalHash = crypto.createHash('sha256').update(normalizedUrl).digest('hex');

    return {
      rawUrl: trimmed,
      normalizedUrl,
      platform,
      domain: parsed.hostname,
      path: parsed.pathname,
      canonicalHash
    };
  }
}
