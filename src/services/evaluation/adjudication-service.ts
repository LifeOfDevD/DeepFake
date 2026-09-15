import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  EvaluationDataset,
  EvaluationFixture,
  GroundTruthLabel,
  GroundTruthLabelType,
  FixtureAdjudication,
  CreateEvaluationDatasetInput,
  CreateEvaluationDatasetSchema,
  CreateEvaluationFixtureInput,
  CreateEvaluationFixtureSchema,
  SubmitGroundTruthLabelInput,
  SubmitAdjudicationInput
} from '../../domain/types.js';

export interface FixtureConsensusSummary {
  fixture: EvaluationFixture;
  totalLabels: number;
  distinctReviewers: number;
  labels: GroundTruthLabel[];
  isConflicted: boolean;
  consensusLabel?: GroundTruthLabelType | null;
  adjudication?: FixtureAdjudication | null;
}

export class AdjudicationService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Creates a versioned evaluation dataset
   */
  public createDataset(input: CreateEvaluationDatasetInput, creatorUserId: string): EvaluationDataset {
    const validated = CreateEvaluationDatasetSchema.parse(input);
    const id = `ds_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO evaluation_datasets (
        id, name, version, description, target_subject_types,
        scenario_categories, difficulty_distribution, total_fixtures,
        is_golden, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?, ?, ?)
    `).run(
      id,
      validated.name,
      validated.version,
      validated.description || null,
      JSON.stringify(validated.target_subject_types),
      JSON.stringify(validated.scenario_categories),
      validated.is_golden ? 1 : 0,
      creatorUserId,
      now,
      now
    );

    return this.getDatasetById(id)!;
  }

  public getDatasetById(id: string): EvaluationDataset | null {
    const row = this.db.prepare('SELECT * FROM evaluation_datasets WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      ...row,
      target_subject_types: JSON.parse(row.target_subject_types || '[]'),
      scenario_categories: JSON.parse(row.scenario_categories || '[]'),
      difficulty_distribution: JSON.parse(row.difficulty_distribution || '{}')
    };
  }

  public listDatasets(): EvaluationDataset[] {
    const rows = this.db.prepare('SELECT * FROM evaluation_datasets ORDER BY created_at DESC').all() as any[];
    return rows.map((row) => ({
      ...row,
      target_subject_types: JSON.parse(row.target_subject_types || '[]'),
      scenario_categories: JSON.parse(row.scenario_categories || '[]'),
      difficulty_distribution: JSON.parse(row.difficulty_distribution || '{}')
    }));
  }

  /**
   * Adds a synthetic evaluation fixture to a dataset
   */
  public addFixture(input: CreateEvaluationFixtureInput): EvaluationFixture {
    const validated = CreateEvaluationFixtureSchema.parse(input);
    const id = `fix_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const normalizedUrl = validated.observed_url.trim().toLowerCase().replace(/\/$/, '');

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO evaluation_fixtures (
          id, dataset_id, scenario_category, synthetic_subject, synthetic_platform,
          normalized_url, observed_url, signal_metadata, expected_correlation_outcome,
          expected_risk_band, expected_false_positive_label, expected_human_review_requirement,
          difficulty_level, language_or_script, dataset_version, provenance,
          reviewer_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        validated.dataset_id,
        validated.scenario_category,
        JSON.stringify(validated.synthetic_subject),
        validated.synthetic_platform,
        normalizedUrl,
        validated.observed_url,
        JSON.stringify(validated.signal_metadata),
        validated.expected_correlation_outcome,
        validated.expected_risk_band,
        validated.expected_false_positive_label || null,
        validated.expected_human_review_requirement,
        validated.difficulty_level,
        validated.language_or_script,
        'v1.0',
        JSON.stringify(validated.provenance),
        validated.reviewer_notes || null,
        now,
        now
      );

      // Update total fixtures in dataset
      this.db.prepare(`
        UPDATE evaluation_datasets
        SET total_fixtures = (SELECT COUNT(*) FROM evaluation_fixtures WHERE dataset_id = ?),
            updated_at = ?
        WHERE id = ?
      `).run(input.dataset_id, now, input.dataset_id);
    });

    tx();

    return this.getFixtureById(id)!;
  }

  public getFixtureById(id: string): EvaluationFixture | null {
    const row = this.db.prepare('SELECT * FROM evaluation_fixtures WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      ...row,
      synthetic_subject: JSON.parse(row.synthetic_subject || '{}'),
      signal_metadata: JSON.parse(row.signal_metadata || '{}'),
      provenance: JSON.parse(row.provenance || '{}')
    };
  }

  public listFixtures(datasetId: string, limit = 100, offset = 0): EvaluationFixture[] {
    const rows = this.db.prepare(`
      SELECT * FROM evaluation_fixtures
      WHERE dataset_id = ?
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).all(datasetId, limit, offset) as any[];

    return rows.map((row) => ({
      ...row,
      synthetic_subject: JSON.parse(row.synthetic_subject || '{}'),
      signal_metadata: JSON.parse(row.signal_metadata || '{}'),
      provenance: JSON.parse(row.provenance || '{}')
    }));
  }

  /**
   * Submits an immutable ground-truth label from a reviewer (append-only history)
   */
  public submitLabel(
    fixtureId: string,
    reviewerUserId: string,
    reviewerEmail: string,
    input: SubmitGroundTruthLabelInput
  ): GroundTruthLabel {
    const fixture = this.getFixtureById(fixtureId);
    if (!fixture) {
      throw new Error(`NOT_FOUND: Evaluation fixture ${fixtureId} does not exist`);
    }

    // Determine current version for this reviewer
    const prev = this.db.prepare(`
      SELECT MAX(label_version) as max_v FROM ground_truth_labels
      WHERE fixture_id = ? AND reviewer_user_id = ?
    `).get(fixtureId, reviewerUserId) as { max_v?: number };

    const nextVersion = (prev?.max_v || 0) + 1;
    const labelId = `gtl_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO ground_truth_labels (
        id, fixture_id, reviewer_user_id, reviewer_email,
        label, rationale, confidence, label_version, is_adjudicated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      labelId,
      fixtureId,
      reviewerUserId,
      reviewerEmail,
      input.label,
      input.rationale,
      input.confidence,
      nextVersion,
      now
    );

    return this.db.prepare('SELECT * FROM ground_truth_labels WHERE id = ?').get(labelId) as GroundTruthLabel;
  }

  /**
   * Checks consensus across reviewers for a fixture and flags conflict
   */
  public getConsensusSummary(fixtureId: string): FixtureConsensusSummary {
    const fixture = this.getFixtureById(fixtureId);
    if (!fixture) {
      throw new Error(`NOT_FOUND: Fixture ${fixtureId} not found`);
    }

    // Get latest label per distinct reviewer
    const labels = this.db.prepare(`
      SELECT g.* FROM ground_truth_labels g
      INNER JOIN (
        SELECT fixture_id, reviewer_user_id, MAX(label_version) as max_v
        FROM ground_truth_labels
        WHERE fixture_id = ?
        GROUP BY fixture_id, reviewer_user_id
      ) latest ON g.fixture_id = latest.fixture_id
              AND g.reviewer_user_id = latest.reviewer_user_id
              AND g.label_version = latest.max_v
    `).all(fixtureId) as GroundTruthLabel[];

    const adjudicationRow = this.db.prepare(`
      SELECT * FROM fixture_adjudications WHERE fixture_id = ?
    `).get(fixtureId) as any;

    let adjudication: FixtureAdjudication | null = null;
    if (adjudicationRow) {
      adjudication = {
        ...adjudicationRow,
        conflicting_label_ids: JSON.parse(adjudicationRow.conflicting_label_ids || '[]')
      };
    }

    const uniqueLabels = new Set(labels.map((l) => l.label));
    const isConflicted = uniqueLabels.size > 1 && !adjudication;

    let consensusLabel: GroundTruthLabelType | null = null;
    if (adjudication) {
      consensusLabel = adjudication.resolved_label;
    } else if (labels.length > 0 && uniqueLabels.size === 1) {
      consensusLabel = labels[0].label;
    }

    return {
      fixture,
      totalLabels: labels.length,
      distinctReviewers: labels.length,
      labels,
      isConflicted,
      consensusLabel,
      adjudication
    };
  }

  /**
   * Adjudicates a disputed fixture when independent reviewers disagree
   */
  public adjudicateFixture(
    fixtureId: string,
    adjudicatorUserId: string,
    adjudicatorEmail: string,
    input: SubmitAdjudicationInput
  ): FixtureAdjudication {
    const consensus = this.getConsensusSummary(fixtureId);
    const conflictingLabelIds = consensus.labels.map((l) => l.id);
    const id = `adj_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      // Upsert adjudication
      this.db.prepare(`
        INSERT INTO fixture_adjudications (
          id, fixture_id, adjudicator_user_id, adjudicator_email,
          resolved_label, rationale, conflicting_label_ids, statutory_notes, adjudicated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          resolved_label = excluded.resolved_label,
          rationale = excluded.rationale,
          statutory_notes = excluded.statutory_notes,
          adjudicated_at = excluded.adjudicated_at
      `).run(
        id,
        fixtureId,
        adjudicatorUserId,
        adjudicatorEmail,
        input.resolved_label,
        input.rationale,
        JSON.stringify(conflictingLabelIds),
        input.statutory_notes || null,
        now
      );

      // Mark ground truth labels as adjudicated
      this.db.prepare(`
        UPDATE ground_truth_labels
        SET is_adjudicated = 1
        WHERE fixture_id = ?
      `).run(fixtureId);
    });

    tx();

    return {
      id,
      fixture_id: fixtureId,
      adjudicator_user_id: adjudicatorUserId,
      adjudicator_email: adjudicatorEmail,
      resolved_label: input.resolved_label,
      rationale: input.rationale,
      conflicting_label_ids: conflictingLabelIds,
      statutory_notes: input.statutory_notes || null,
      adjudicated_at: now
    };
  }

  /**
   * Lists all fixtures in a dataset that have unresolved reviewer disagreements
   */
  public listConflictedFixtures(datasetId: string): FixtureConsensusSummary[] {
    const fixtures = this.listFixtures(datasetId, 1000, 0);
    const conflicted: FixtureConsensusSummary[] = [];

    for (const fix of fixtures) {
      const summary = this.getConsensusSummary(fix.id);
      if (summary.isConflicted) {
        conflicted.push(summary);
      }
    }

    return conflicted;
  }

  /**
   * Loads the Phase 7 synthetic evaluation golden fixtures catalog (20 categories)
   */
  public loadSeedCatalog(creatorUserId: string): { dataset: EvaluationDataset; fixtures: EvaluationFixture[] } {
    const seedPath = path.resolve(process.cwd(), 'seeds', 'evaluation-fixtures.json');
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed catalog file not found at ${seedPath}`);
    }
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const dataset = this.createDataset({
      name: seedData.dataset.name,
      version: seedData.dataset.version,
      description: seedData.dataset.description,
      target_subject_types: seedData.dataset.target_subject_types,
      scenario_categories: seedData.fixtures.map((f: any) => f.scenario_category),
      is_golden: Boolean(seedData.dataset.is_golden)
    }, creatorUserId);

    const fixtures: EvaluationFixture[] = [];
    for (const fix of seedData.fixtures) {
      const created = this.addFixture({
        ...fix,
        dataset_id: dataset.id
      });
      fixtures.push(created);
    }

    return { dataset, fixtures };
  }
}
