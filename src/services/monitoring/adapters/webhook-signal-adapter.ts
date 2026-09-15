import crypto from 'crypto';
import {
  SignalAdapter,
  RawSignalInput,
  IngestedSignalRaw
} from './adapter-interface.js';
import { UrlNormalizationService } from '../url-normalization-service.js';

export interface WebhookValidationOptions {
  secret: string;
  signatureHeader?: string;
  timestampHeader?: string;
  rawBody: string;
  maxClockDriftSeconds?: number;
}

export class WebhookSignalAdapter implements SignalAdapter {
  public readonly name = 'inbound_webhook';
  public readonly adapterType = 'webhook';
  public readonly isSafeReadOnly = true;

  private normalizer = new UrlNormalizationService();

  /**
   * Validates inbound webhook HMAC-SHA256 signature and timestamp tolerance
   */
  public verifySignature(options: WebhookValidationOptions): boolean {
    const {
      secret,
      signatureHeader,
      timestampHeader,
      rawBody,
      maxClockDriftSeconds = 300
    } = options;

    if (!signatureHeader || !secret) {
      return false;
    }

    // Timestamp replay check if timestamp header is provided
    if (timestampHeader) {
      const parsedTime = parseInt(timestampHeader, 10);
      if (!isNaN(parsedTime)) {
        const nowSec = Math.floor(Date.now() / 1000);
        // Supports either millisecond or second timestamp
        const actualSec = parsedTime > 1e11 ? Math.floor(parsedTime / 1000) : parsedTime;
        if (Math.abs(nowSec - actualSec) > maxClockDriftSeconds) {
          return false;
        }
      }
    }

    // Calculate expected HMAC
    const hmac = crypto.createHmac('sha256', secret);
    const payloadToSign = timestampHeader ? `${timestampHeader}.${rawBody}` : rawBody;
    hmac.update(payloadToSign);
    const expectedSig = hmac.digest('hex');

    // Clean signature header (support 'sha256=...' prefix)
    const cleanSig = signatureHeader.replace(/^sha256=/i, '').trim();

    try {
      const sigBuf = Buffer.from(cleanSig, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  async processInput(
    rawInputs: RawSignalInput[],
    context?: { partnerId?: string; webhookDeliveryId?: string; signatureValid?: boolean }
  ): Promise<IngestedSignalRaw[]> {
    const results: IngestedSignalRaw[] = [];

    for (const input of rawInputs) {
      if (!input.observed_url || !input.observed_url.trim()) {
        continue;
      }
      const norm = this.normalizer.normalize(input.observed_url);

      results.push({
        observed_url: input.observed_url.trim(),
        platform: input.platform || norm.platform,
        content_type: input.content_type || 'profile',
        observed_at: input.observed_at || new Date().toISOString(),
        raw_payload: input.raw_payload || {},
        provenance: {
          intake_method: 'webhook',
          partner_id: context?.partnerId || 'anonymous_partner',
          delivery_id: context?.webhookDeliveryId || 'unknown',
          signature_verified: context?.signatureValid ?? false,
          received_at: new Date().toISOString(),
          ...input.provenance
        },
        source_type: 'webhook',
        adapter_name: this.name
      });
    }

    return results;
  }
}
