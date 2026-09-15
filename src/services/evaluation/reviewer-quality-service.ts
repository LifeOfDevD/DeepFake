import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import { ReviewerEvaluation } from '../../domain/types.js';

export interface QualitySamplingResult {
  sampledReviewIds: string[];
  totalCandidateReviews: number;
  samplePercentage: number;
  samplingBatchId: string;
}

export class ReviewerQualityService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Calculates operational quality metrics for a reviewer within an organization
   */
  public computeReviewerMetrics(organizationId: string, reviewerUserId: string): ReviewerEvaluation {
    const reviews = this.db.prepare(`
      SELECT * FROM candidate_reviews
      WHERE organization_id = ? AND reviewed_by_user_id = ?
    `).all(organizationId, reviewerUserId) as any[];

    const total = reviews.length;
    let confirmed = 0;
    let dismissed = 0;
    let quarantined = 0;

    for (const r of reviews) {
      if (r.status === 'confirmed') confirmed++;
      else if (r.status === 'dismissed') dismissed++;
      else if (r.status === 'quarantined') quarantined++;
    }

    // Compute disagreement rate from ground-truth labels vs peers
    const disagreementRows = this.db.prepare(`
      SELECT COUNT(DISTINCT g1.fixture_id) as disagreement_count
      FROM ground_truth_labels g1
      JOIN ground_truth_labels g2 ON g1.fixture_id = g2.fixture_id AND g1.reviewer_user_id != g2.reviewer_user_id
      WHERE g1.reviewer_user_id = ? AND g1.label != g2.label
    `).get(reviewerUserId) as { disagreement_count?: number };

    const disagreementCount = disagreementRows?.disagreement_count || 0;

    // Check existing record or create new snapshot
    const existing = this.db.prepare(`
      SELECT * FROM reviewer_evaluations
      WHERE organization_id = ? AND reviewer_user_id = ?
      ORDER BY recorded_at DESC LIMIT 1
    `).get(organizationId, reviewerUserId) as any;

    const evalId = existing?.id || `rev_eval_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO reviewer_evaluations (
        id, organization_id, reviewer_user_id, total_reviews,
        confirmed_count, dismissed_count, quarantined_count,
        disagreement_count, override_count, avg_duration_seconds,
        sampled_for_second_review, coaching_notes, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_reviews = excluded.total_reviews,
        confirmed_count = excluded.confirmed_count,
        dismissed_count = excluded.dismissed_count,
        quarantined_count = excluded.quarantined_count,
        disagreement_count = excluded.disagreement_count,
        recorded_at = excluded.recorded_at
    `).run(
      evalId,
      organizationId,
      reviewerUserId,
      total,
      confirmed,
      dismissed,
      quarantined,
      disagreementCount,
      existing?.override_count || 0,
      existing?.avg_duration_seconds || 45.0,
      existing?.sampled_for_second_review || 0,
      existing?.coaching_notes || null,
      now
    );

    return this.db.prepare('SELECT * FROM reviewer_evaluations WHERE id = ?').get(evalId) as ReviewerEvaluation;
  }

  /**
   * Adds coaching notes for a reviewer
   */
  public addCoachingNotes(evalId: string, notes: string): void {
    this.db.prepare(`
      UPDATE reviewer_evaluations
      SET coaching_notes = ?
      WHERE id = ?
    `).run(notes, evalId);
  }

  /**
   * Performs random quality sampling on reviewed candidate items for second review
   */
  public performQualitySampling(organizationId: string, samplePercentage = 10): QualitySamplingResult {
    const reviews = this.db.prepare(`
      SELECT id FROM candidate_reviews
      WHERE organization_id = ? AND status IN ('confirmed', 'dismissed')
    `).all(organizationId) as { id: string }[];

    const sampleCount = Math.max(1, Math.round((reviews.length * samplePercentage) / 100));
    const shuffled = [...reviews].sort(() => 0.5 - Math.random());
    const sampled = shuffled.slice(0, sampleCount).map((r) => r.id);
    const batchId = `samp_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    return {
      sampledReviewIds: sampled,
      totalCandidateReviews: reviews.length,
      samplePercentage,
      samplingBatchId: batchId
    };
  }
}
