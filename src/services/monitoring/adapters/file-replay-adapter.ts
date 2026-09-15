import fs from 'fs';
import path from 'path';
import {
  SignalAdapter,
  RawSignalInput,
  IngestedSignalRaw
} from './adapter-interface.js';
import { UrlNormalizationService } from '../url-normalization-service.js';

export class FileReplaySignalAdapter implements SignalAdapter {
  public readonly name = 'file_replay';
  public readonly adapterType = 'file_replay';
  public readonly isSafeReadOnly = true;

  private normalizer = new UrlNormalizationService();

  /**
   * Replays signals from a specified local JSON or CSV file path.
   * Prevents path traversal and validates file existence.
   */
  async replayFile(
    filePath: string,
    context?: { allowedDir?: string; actorUserId?: string }
  ): Promise<IngestedSignalRaw[]> {
    const resolvedPath = path.resolve(filePath);
    const baseDir = context?.allowedDir ? path.resolve(context.allowedDir) : process.cwd();

    // Security check: ensure path is within allowed base directory
    if (!resolvedPath.startsWith(baseDir)) {
      throw new Error(`SECURITY_VIOLATION: Replay path ${filePath} is outside allowed directory`);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`FILE_NOT_FOUND: Replay file ${resolvedPath} does not exist`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    let rawSignals: RawSignalInput[] = [];

    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(content);
      rawSignals = Array.isArray(parsed) ? parsed : (parsed.signals || []);
    } else if (filePath.endsWith('.csv')) {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const header = lines[0].split(',').map((h) => h.trim());
        const urlIdx = header.indexOf('observed_url');
        const platformIdx = header.indexOf('platform');
        const typeIdx = header.indexOf('content_type');

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim());
          if (urlIdx !== -1 && cols[urlIdx]) {
            rawSignals.push({
              observed_url: cols[urlIdx],
              platform: platformIdx !== -1 ? cols[platformIdx] : undefined,
              content_type: typeIdx !== -1 ? (cols[typeIdx] as any) : undefined
            });
          }
        }
      }
    } else {
      throw new Error(`UNSUPPORTED_FORMAT: File must be .json or .csv`);
    }

    return this.processInput(rawSignals, {
      ...context,
      replayed_from_file: path.basename(filePath)
    });
  }

  async processInput(
    rawInputs: RawSignalInput[],
    context?: Record<string, any>
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
          intake_method: 'file_replay',
          replayed_at: new Date().toISOString(),
          ...context,
          ...input.provenance
        },
        source_type: 'file_replay',
        adapter_name: this.name
      });
    }

    return results;
  }
}
