import { describe, it, expect } from 'vitest';
import { UrlNormalizationService } from '../../src/services/monitoring/url-normalization-service.js';

describe('Unit: UrlNormalizationService', () => {
  const normalizer = new UrlNormalizationService();

  it('strips tracking parameters and sorts remaining query parameters', () => {
    const input = 'https://www.example.com/item?utm_source=twitter&b=2&utm_medium=cpc&a=1&fbclid=xyz123';
    const result = normalizer.normalize(input);

    expect(result.domain).toBe('example.com');
    expect(result.normalizedUrl).toBe('https://example.com/item?a=1&b=2');
    expect(result.canonicalHash).toHaveLength(64);
  });

  it('strips mobile and www subdomains and standardizes http to https', () => {
    const mInput = 'http://m.instagram.com/fake_account/?igsh=abcde';
    const result = normalizer.normalize(mInput);

    expect(result.platform).toBe('instagram');
    expect(result.domain).toBe('instagram.com');
    expect(result.normalizedUrl).toBe('https://instagram.com/fake_account');
  });

  it('canonicalizes twitter.com to x.com', () => {
    const input = 'https://twitter.com/impersonator_ceo/?ref_src=twsrc';
    const result = normalizer.normalize(input);

    expect(result.platform).toBe('twitter');
    expect(result.domain).toBe('x.com');
    expect(result.normalizedUrl).toBe('https://x.com/impersonator_ceo');
  });

  it('canonicalizes youtu.be shortlinks to youtube.com/watch', () => {
    const input = 'https://youtu.be/dQw4w9WgXcQ?si=abcdef12345';
    const result = normalizer.normalize(input);

    expect(result.platform).toBe('youtube');
    expect(result.domain).toBe('youtube.com');
    expect(result.normalizedUrl).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('handles Telegram and LinkedIn platforms correctly', () => {
    const tg = normalizer.normalize('https://t.me/fake_channel/');
    expect(tg.platform).toBe('telegram');
    expect(tg.normalizedUrl).toBe('https://t.me/fake_channel');

    const li = normalizer.normalize('https://www.linkedin.com/in/imposter-exec?trk=feed');
    expect(li.platform).toBe('linkedin');
    expect(li.normalizedUrl).toBe('https://linkedin.com/in/imposter-exec');
  });

  it('produces deterministic SHA-256 hash for duplicate candidates', () => {
    const url1 = 'https://example.com/scam?utm_source=ad&id=42';
    const url2 = 'http://www.example.com/scam/?id=42&fbclid=tracker';

    const res1 = normalizer.normalize(url1);
    const res2 = normalizer.normalize(url2);

    expect(res1.normalizedUrl).toBe(res2.normalizedUrl);
    expect(res1.canonicalHash).toBe(res2.canonicalHash);
  });

  it('handles empty or malformed input gracefully without crashing', () => {
    const empty = normalizer.normalize('');
    expect(empty.normalizedUrl).toBe('');
    expect(empty.canonicalHash).toHaveLength(64);

    const malformed = normalizer.normalize('not a url at all');
    expect(malformed.normalizedUrl).toBeDefined();
    expect(malformed.canonicalHash).toHaveLength(64);
  });
});
