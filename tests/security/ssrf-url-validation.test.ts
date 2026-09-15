import { describe, it, expect } from 'vitest';
import { ManualSourceCaptureProvider, parseIPv4ToNumber, isPrivateOrRestrictedIPv4 } from '../../src/services/source-capture.js';

describe('Security: SSRF Prevention & Source URL Hardening', () => {
  const provider = new ManualSourceCaptureProvider();

  it('correctly parses alternative IPv4 representations (integer, hex, octal)', () => {
    // 127.0.0.1 = 0x7F000001 = 2130706433
    expect(parseIPv4ToNumber('127.0.0.1')).toBe(2130706433);
    expect(parseIPv4ToNumber('2130706433')).toBe(2130706433);
    expect(parseIPv4ToNumber('0x7f000001')).toBe(2130706433);
    expect(parseIPv4ToNumber('0177.0.0.1')).toBe(2130706433);

    // 10.0.0.1 = 167772161
    expect(parseIPv4ToNumber('10.0.0.1')).toBe(167772161);
    expect(parseIPv4ToNumber('167772161')).toBe(167772161);
  });

  it('identifies private, loopback, CGNAT, and link-local IPv4 ranges', () => {
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('127.0.0.1')!)).toBe(true);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('10.50.1.2')!)).toBe(true);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('172.20.14.5')!)).toBe(true);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('192.168.1.100')!)).toBe(true);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('169.254.169.254')!)).toBe(true);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('100.64.0.1')!)).toBe(true); // CGNAT
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('0.0.0.0')!)).toBe(true);

    // Public IPs should not be restricted
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('8.8.8.8')!)).toBe(false);
    expect(isPrivateOrRestrictedIPv4(parseIPv4ToNumber('1.1.1.1')!)).toBe(false);
  });

  it('rejects loopback addresses in all notations', async () => {
    const loopbacks = [
      'http://127.0.0.1/secret',
      'http://localhost/admin',
      'http://2130706433/path',
      'http://0x7f000001/path',
      'http://0177.0.0.1/path',
      'http://[::1]/internal'
    ];

    for (const url of loopbacks) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
    }
  });

  it('rejects private network ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', async () => {
    const privateUrls = [
      'http://10.0.0.1:8080/metrics',
      'http://172.16.0.5/api',
      'http://172.31.255.254/',
      'http://192.168.0.1/router',
      'http://192.168.1.254/'
    ];

    for (const url of privateUrls) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
    }
  });

  it('rejects cloud metadata endpoints and internal DNS names', async () => {
    const cloudEndpoints = [
      'http://169.254.169.254/computeMetadata/v1/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata/v1/',
      'http://instance-data/latest/meta-data/',
      'http://database.internal/dump',
      'http://service.local/status'
    ];

    for (const url of cloudEndpoints) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
    }
  });

  it('rejects IPv6 private, link-local, and IPv4-mapped loopback', async () => {
    const ipv6Targets = [
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/'
    ];

    for (const url of ipv6Targets) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
    }
  });

  it('rejects embedded credentials in URLs', async () => {
    const credUrls = [
      'http://admin:supersecret@example.com/page',
      'https://user:password@legit-site.org/post'
    ];

    for (const url of credUrls) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('credentials');
    }
  });

  it('rejects non-http(s) schemes', async () => {
    const badSchemes = [
      'ftp://ftp.example.com/file',
      'file:///etc/passwd',
      'gopher://gopher.example.com',
      'javascript:alert(1)'
    ];

    for (const url of badSchemes) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(false);
    }
  });

  it('accepts valid public social and web URLs without external network queries', async () => {
    const validUrls = [
      'https://instagram.com/reel/C89xYz123',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://x.com/fake_account_01/status/19827391',
      'https://facebook.com/watch/?v=123456789'
    ];

    for (const url of validUrls) {
      const res = await provider.validate(url);
      expect(res.valid).toBe(true);
      expect(res.normalizedUrl).toBeDefined();
    }
  });
});
