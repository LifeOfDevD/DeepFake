import crypto from 'crypto';
import { SubmissionPacketPayload, EvidenceManifestItem } from './types.js';

export interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
  warnings: string[];
}

export interface SubmissionPreview {
  platform: string;
  route: string;
  renderedNotice: string;
  manifest: EvidenceManifestItem[];
  packetHash: string;
  generatedAt: string;
}

export interface SimulationResult {
  simulatedReferenceId: string;
  platform: string;
  packetHash: string;
  simulatedAt: string;
  mode: 'DRY_RUN_LOCAL_SIMULATION';
  auditSummary: string;
}

export interface PlatformSubmissionAdapter {
  validate(packet: SubmissionPacketPayload): ValidationResult;
  preview(packet: SubmissionPacketPayload): SubmissionPreview;
  simulate(packet: SubmissionPacketPayload): Promise<SimulationResult>;
}

export class LocalDryRunSubmissionAdapter implements PlatformSubmissionAdapter {
  validate(packet: SubmissionPacketPayload): ValidationResult {
    const missingFields: string[] = [];
    const warnings: string[] = [];

    if (!packet.incident_details?.contested_url) {
      missingFields.push('contested_url');
    }
    if (!packet.affected_party?.target_entity) {
      missingFields.push('target_entity');
    }
    if (!packet.incident_details?.hosting_platform) {
      missingFields.push('hosting_platform');
    }
    if (!packet.evidence_manifest || packet.evidence_manifest.length === 0) {
      missingFields.push('evidence_manifest');
    }
    if (!packet.reporter_declaration) {
      warnings.push('Formal reporter declaration is empty or missing.');
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
      warnings
    };
  }

  preview(packet: SubmissionPacketPayload): SubmissionPreview {
    const platform = packet.incident_details.hosting_platform;
    const packetHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(packet, null, 2))
      .digest('hex');

    const notice = [
      `# SIMULATED SUBMISSION NOTICE (DRY-RUN ONLY)`,
      `**Platform:** ${platform.toUpperCase()}`,
      `**Packet SHA-256 Digest:** \`${packetHash}\``,
      `**Target Entity:** ${packet.affected_party.target_entity}`,
      `**Contested URL:** ${packet.incident_details.contested_url}`,
      `**Statutory Grounds:** ${packet.statutory_grounds.statutory_basis.join(', ') || 'IT Act 2000 & IT Rules 2021'}`,
      `---`,
      `### Notice Body`,
      `To the Grievance Officer, ${platform.toUpperCase()}:`,
      ``,
      `Formal demand is hereby registered regarding unauthorized digital impersonation and synthetic media deployment.`,
      `Under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021,`,
      `the contested content violates due diligence standards and statutory provisions of the IT Act 2000.`,
      ``,
      `**Factual Basis:** ${packet.incident_details.factual_basis || 'Deceptive profile and synthetic likeness theft without authorization.'}`,
      ``,
      `### Cryptographic Evidence Manifest`,
      `| Artifact | Type | SHA-256 Digest | Captured At |`,
      `| :--- | :--- | :--- | :--- |`,
      ...packet.evidence_manifest.map(
        (e) => `| ${e.safe_display_name} | ${e.mime_type} | \`${e.sha256.substring(0, 16)}...\` | ${e.captured_at} |`
      ),
      ``,
      `**Declaration:** ${packet.reporter_declaration}`,
      `---`,
      `*NOTE: This notice is generated in controlled dry-run simulation mode. No external network requests dispatched.*`
    ].join('\n');

    return {
      platform,
      route: 'simulated_local_grievance_desk',
      renderedNotice: notice,
      manifest: packet.evidence_manifest,
      packetHash,
      generatedAt: new Date().toISOString()
    };
  }

  async simulate(packet: SubmissionPacketPayload): Promise<SimulationResult> {
    // STRICT INVARIANT: Zero outbound network calls, zero live platform mutations.
    const platform = packet.incident_details.hosting_platform.toUpperCase();
    const packetHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(packet, null, 2))
      .digest('hex');

    const year = new Date().getFullYear();
    const shortHash = packetHash.substring(0, 8).toUpperCase();
    const simulatedReferenceId = `SIM-${platform}-${year}-${shortHash}`;
    const simulatedAt = new Date().toISOString();

    return {
      simulatedReferenceId,
      platform,
      packetHash,
      simulatedAt,
      mode: 'DRY_RUN_LOCAL_SIMULATION',
      auditSummary: `Simulated platform submission dispatched to ${platform} under reference ${simulatedReferenceId}. Zero external packets transmitted.`
    };
  }
}
