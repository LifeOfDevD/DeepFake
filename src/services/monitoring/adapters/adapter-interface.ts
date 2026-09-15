import { SignalContentType, SignalSourceType } from '../../../domain/types.js';

export interface RawSignalInput {
  observed_url: string;
  platform?: string;
  content_type?: SignalContentType;
  observed_at?: string;
  raw_payload?: Record<string, any>;
  provenance?: Record<string, any>;
}

export interface IngestedSignalRaw {
  observed_url: string;
  platform: string;
  content_type: SignalContentType;
  observed_at: string;
  raw_payload?: Record<string, any>;
  provenance: Record<string, any>;
  source_type: SignalSourceType;
  adapter_name: string;
}

export interface SignalAdapter {
  readonly name: string;
  readonly adapterType: SignalSourceType;
  readonly isSafeReadOnly: boolean;

  processInput(
    rawInputs: RawSignalInput[],
    context?: Record<string, any>
  ): Promise<IngestedSignalRaw[]>;
}
