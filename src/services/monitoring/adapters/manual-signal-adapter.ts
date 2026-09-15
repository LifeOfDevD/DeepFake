import {
  SignalAdapter,
  RawSignalInput,
  IngestedSignalRaw
} from './adapter-interface.js';
import { UrlNormalizationService } from '../url-normalization-service.js';

export class ManualSignalAdapter implements SignalAdapter {
  public readonly name = 'manual_intake';
  public readonly adapterType = 'manual_input';
  public readonly isSafeReadOnly = true;

  private normalizer = new UrlNormalizationService();

  async processInput(
    rawInputs: RawSignalInput[],
    context?: { actorUserId?: string; notes?: string }
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
          submitted_by_user_id: context?.actorUserId || 'system',
          manual_notes: context?.notes || '',
          intake_method: 'analyst_manual_entry',
          ...input.provenance
        },
        source_type: 'manual_input',
        adapter_name: this.name
      });
    }

    return results;
  }
}
