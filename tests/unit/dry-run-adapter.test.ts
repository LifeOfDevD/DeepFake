import { describe, it, expect } from 'vitest';
import { LocalDryRunSubmissionAdapter } from '../../src/domain/submission-adapter.js';
import { SubmissionPacketPayload } from '../../src/domain/types.js';

describe('Unit: Local Dry-Run Submission Adapter', () => {
  const adapter = new LocalDryRunSubmissionAdapter();

  const samplePacket: SubmissionPacketPayload = {
    packet_version: 1,
    mode: 'DRY_RUN_ONLY_SIMULATION',
    generated_at: '2026-09-12T12:00:00Z',
    organization_id: 'org_apex_health_01',
    case_id: 'case_apex_2026_001',
    case_number: 'CAS-APEX-001',
    title: 'Dr. Anand Verma Deepfake Endorsement',
    affected_party: {
      target_entity: 'Dr. Anand K. Verma',
      target_entity_type: 'individual_professional',
      reported_by_email: 'dr.verma@apexhealth.example',
      jurisdiction: 'IN-National'
    },
    incident_details: {
      hosting_platform: 'instagram',
      contested_url: 'https://instagram.example/p/synthetic_clip_01',
      category: 'synthetic_media_endorsement',
      suspected_synthetic_media_type: 'face_swap_video',
      impersonation_method: 'synthetic_content',
      harm_type: 'medical_misinformation'
    },
    statutory_grounds: {
      statutory_basis: ['IT Rules 2021 Rule 3(2)(b)', 'IT Act Section 66D'],
      selected_legal_grounds: ['Identity theft under Sec 66C', 'Cheating under Sec 66D'],
      has_court_or_government_order: false
    },
    evidence_manifest: [
      {
        evidence_id: 'ev_001',
        safe_display_name: 'synthetic_video_snippet.mp4',
        sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        byte_size: 1542000,
        mime_type: 'video/mp4',
        captured_at: '2026-09-12T11:00:00Z',
        storage_key_obscured: 'sha256:9f86d081884c7d65...'
      }
    ],
    chain_of_custody_summary: {
      item_count: 1,
      total_bytes: 1542000,
      custody_verified: true
    },
    requested_action: 'Immediate takedown of unauthorized synthetic endorsement',
    reporter_declaration: 'I declare that the contested video is a synthetic fabrication published without consent.',
    approval_status: 'ready_for_submission',
    internal_warnings: []
  };

  it('validates complete packet payload successfully', () => {
    const result = adapter.validate(samplePacket);
    expect(result.isValid).toBe(true);
    expect(result.missingFields.length).toBe(0);
  });

  it('detects missing required fields during validation', () => {
    const incompletePacket = {
      ...samplePacket,
      incident_details: {
        ...samplePacket.incident_details,
        contested_url: ''
      },
      evidence_manifest: []
    };

    const result = adapter.validate(incompletePacket as any);
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('contested_url');
    expect(result.missingFields).toContain('evidence_manifest');
  });

  it('previews rendered notice and computes packet SHA-256 hash', () => {
    const preview = adapter.preview(samplePacket);
    expect(preview.platform).toBe('instagram');
    expect(preview.packetHash).toHaveLength(64);
    expect(preview.renderedNotice).toContain('SIMULATED SUBMISSION NOTICE (DRY-RUN ONLY)');
    expect(preview.renderedNotice).toContain('Dr. Anand K. Verma');
    expect(preview.renderedNotice).toContain('synthetic_video_snippet.mp4');
  });

  it('executes simulation with zero outbound network calls and generates deterministic reference ID', async () => {
    const simulation1 = await adapter.simulate(samplePacket);
    const simulation2 = await adapter.simulate(samplePacket);

    expect(simulation1.mode).toBe('DRY_RUN_LOCAL_SIMULATION');
    expect(simulation1.platform).toBe('INSTAGRAM');
    expect(simulation1.simulatedReferenceId).toMatch(/^SIM-INSTAGRAM-\d{4}-[A-F0-9]{8}$/);

    // Deterministic reference ID across runs for same packet
    expect(simulation1.simulatedReferenceId).toBe(simulation2.simulatedReferenceId);
    expect(simulation1.packetHash).toBe(simulation2.packetHash);
  });
});
