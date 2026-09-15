import Database from 'better-sqlite3';
import { getDatabase } from '../../db/connection.js';

export interface PrivacyComplianceReport {
  organizationId: string;
  totalMonitoredSubjects: number;
  activeMandatesCount: number;
  unmandatedSubjectsCount: number;
  highSensitivitySubjectCount: number;
  biometricTemplatesStoredCount: number;
  expiredFixturesPurged: number;
  isCompliant: boolean;
  notes: string[];
}

export class PrivacyReviewService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Executes a privacy compliance check across monitored subjects and evaluation fixtures
   */
  public executePrivacyAudit(organizationId: string): PrivacyComplianceReport {
    const subjects = this.db.prepare(`
      SELECT * FROM monitored_subjects WHERE organization_id = ?
    `).all(organizationId) as any[];

    let activeMandates = 0;
    let unmandated = 0;
    let highSensitivity = 0;
    let biometricTemplatesStored = 0;
    const notes: string[] = [];

    for (const sub of subjects) {
      if (sub.authorization_basis && sub.authorization_reference && sub.authorization_reference.length > 3) {
        activeMandates++;
      } else {
        unmandated++;
        notes.push(`Subject ${sub.canonical_name} (${sub.id}) lacks complete authorization reference.`);
      }

      if (sub.sensitivity === 'high' || sub.sensitivity === 'critical') {
        highSensitivity++;
      }

      // Check if raw biometrics erroneously stored
      if (sub.voice_enrollment_status === 'enrolled' || sub.face_enrollment_status === 'enrolled') {
        biometricTemplatesStored++;
      }
    }

    // Purge expired fixtures older than 180 days from non-golden datasets
    const purgeResult = this.db.prepare(`
      DELETE FROM evaluation_fixtures
      WHERE dataset_id IN (SELECT id FROM evaluation_datasets WHERE is_golden = 0)
        AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days')
    `).run();

    const isCompliant = unmandated === 0 && biometricTemplatesStored === 0;

    return {
      organizationId,
      totalMonitoredSubjects: subjects.length,
      activeMandatesCount: activeMandates,
      unmandatedSubjectsCount: unmandated,
      highSensitivitySubjectCount: highSensitivity,
      biometricTemplatesStoredCount: biometricTemplatesStored,
      expiredFixturesPurged: purgeResult.changes,
      isCompliant,
      notes
    };
  }

  /**
   * Enforces privacy restrictions for high-sensitivity subjects by redacting reference media
   */
  public enforceSubjectPrivacyGuards(subjectId: string, organizationId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE monitored_subjects
      SET reference_images_metadata = '[]',
          reference_audio_metadata = '[]',
          voice_enrollment_status = 'not_enrolled',
          face_enrollment_status = 'not_enrolled',
          updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(now, subjectId, organizationId);
  }
}
