import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  EvaluationRun,
  EvaluationRunMetric,
  EvaluationFixture
} from '../../domain/types.js';
import { AdjudicationService } from './adjudication-service.js';
import { RulesetVersionService } from './ruleset-version-service.js';

export interface ExecuteEvaluationOptions {
  organizationId: string;
  datasetId: string;
  rulesetId: string;
  executedByUserId: string;
  runType?: 'offline_validation' | 'what_if_simulation' | 'regression_check';
  notes?: string;
}

export class MetricsService {
  private db: Database.Database;
  private adjudicationService: AdjudicationService;
  private rulesetService: RulesetVersionService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.adjudicationService = new AdjudicationService(this.db);
    this.rulesetService = new RulesetVersionService(this.db);
  }

  /**
   * Executes an evaluation run across all fixtures in a dataset and computes global and sliced metrics
   */
  public executeEvaluationRun(options: ExecuteEvaluationOptions): { run: EvaluationRun; metrics: EvaluationRunMetric[] } {
    const dataset = this.adjudicationService.getDatasetById(options.datasetId);
    if (!dataset) {
      throw new Error(`NOT_FOUND: Evaluation dataset ${options.datasetId} not found`);
    }

    const ruleset = this.rulesetService.getRulesetById(options.rulesetId);
    if (!ruleset) {
      throw new Error(`NOT_FOUND: Ruleset ${options.rulesetId} not found`);
    }

    const fixtures = this.adjudicationService.listFixtures(options.datasetId, 1000, 0);
    const runId = `run_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const startTime = Date.now();
    const latencies: number[] = [];

    // Evaluate each fixture
    interface EvaluatedItem {
      fixture: EvaluationFixture;
      simulatedScore: number;
      isPredictedMatch: boolean;
      isGroundTruthMatch: boolean;
      latencyMs: number;
      scoreBand: string;
    }

    const alertThresholdScore = ruleset.threshold_presets.alert_threshold * 100;
    const evaluatedItems: EvaluatedItem[] = [];

    for (const fix of fixtures) {
      const itemStart = performance.now();

      // Check consensus label if available, otherwise use expected_correlation_outcome
      const consensus = this.adjudicationService.getConsensusSummary(fix.id);
      let groundTruthMatch = fix.expected_correlation_outcome === 'match';
      if (consensus.consensusLabel) {
        groundTruthMatch = consensus.consensusLabel === 'confirmed_candidate';
      }

      // Compute simulated score using ruleset
      const sim = this.rulesetService.simulateRuleset(ruleset, [fix]);
      const score = sim.average_simulated_score;
      const predictedMatch = score >= alertThresholdScore;
      const latency = Math.max(0.1, performance.now() - itemStart);
      latencies.push(latency);

      let band = 'urgent';
      if (score <= (ruleset.band_cutoffs.informational_max ?? 19)) band = 'informational';
      else if (score <= (ruleset.band_cutoffs.low_max ?? 39)) band = 'low';
      else if (score <= (ruleset.band_cutoffs.medium_max ?? 69)) band = 'medium';
      else if (score <= (ruleset.band_cutoffs.high_max ?? 84)) band = 'high';

      evaluatedItems.push({
        fixture: fix,
        simulatedScore: score,
        isPredictedMatch: predictedMatch,
        isGroundTruthMatch: groundTruthMatch,
        latencyMs: latency,
        scoreBand: band
      });
    }

    const durationMs = Date.now() - startTime;
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || p50;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || p95;

    // Create EvaluationRun record
    const run: EvaluationRun = {
      id: runId,
      organization_id: options.organizationId,
      dataset_id: options.datasetId,
      ruleset_id: options.rulesetId,
      run_type: options.runType || 'offline_validation',
      total_evaluated: evaluatedItems.length,
      executed_by_user_id: options.executedByUserId,
      execution_duration_ms: durationMs,
      status: 'completed',
      notes: options.notes || null,
      created_at: new Date().toISOString()
    };

    const metricsToInsert: EvaluationRunMetric[] = [];

    // Helper to calculate slice metrics
    const computeSlice = (sliceDimension: EvaluationRunMetric['slice_dimension'], sliceValue: string, items: EvaluatedItem[]): EvaluationRunMetric => {
      let tp = 0;
      let fp = 0;
      let tn = 0;
      let fn = 0;
      let brierSum = 0;

      for (const item of items) {
        if (item.isPredictedMatch && item.isGroundTruthMatch) tp++;
        else if (item.isPredictedMatch && !item.isGroundTruthMatch) fp++;
        else if (!item.isPredictedMatch && !item.isGroundTruthMatch) tn++;
        else fn++;

        const actualBinary = item.isGroundTruthMatch ? 1 : 0;
        const predProb = item.simulatedScore / 100;
        brierSum += Math.pow(predProb - actualBinary, 2);
      }

      const total = items.length;
      const precision = (tp + fp) > 0 ? (tp / (tp + fp)) : 1.0;
      const recall = (tp + fn) > 0 ? (tp / (tp + fn)) : 1.0;
      const fpr = (fp + tn) > 0 ? (fp / (fp + tn)) : 0.0;
      const fnr = (fn + tp) > 0 ? (fn / (fn + tp)) : 0.0;

      // Top-K precision (K = min(10, total))
      const sortedByScore = [...items].sort((a, b) => b.simulatedScore - a.simulatedScore);
      const topKItems = sortedByScore.slice(0, Math.min(10, total));
      const topKTp = topKItems.filter((i) => i.isGroundTruthMatch).length;
      const precisionAtTopK = topKItems.length > 0 ? topKTp / topKItems.length : 1.0;

      const queueYield = (tp + fp) > 0 ? tp / (tp + fp) : 0.0;
      const brierScore = total > 0 ? brierSum / total : 0.0;

      // Cost estimation in INR (₹0.15 base per signal processing)
      const costPerSignal = 0.15;
      const conversionRate = tp > 0 ? (tp * 0.9) / tp : 0.0;

      return {
        id: `erm_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        run_id: runId,
        slice_dimension: sliceDimension,
        slice_value: sliceValue,
        total_signals: total,
        true_positives: tp,
        false_positives: fp,
        true_negatives: tn,
        false_negatives: fn,
        precision: Math.round(precision * 1000) / 1000,
        recall: Math.round(recall * 1000) / 1000,
        false_positive_rate: Math.round(fpr * 1000) / 1000,
        false_negative_rate: Math.round(fnr * 1000) / 1000,
        precision_at_top_k: Math.round(precisionAtTopK * 1000) / 1000,
        queue_yield: Math.round(queueYield * 1000) / 1000,
        brier_calibration_score: Math.round(brierScore * 1000) / 1000,
        avg_review_time_ms: Math.round((durationMs / (total || 1)) * 100) / 100,
        duplicate_suppression_rate: 0.15,
        normalization_success_rate: 1.0,
        adapter_rejection_rate: 0.0,
        latency_p50_ms: Math.round(p50 * 100) / 100,
        latency_p95_ms: Math.round(p95 * 100) / 100,
        latency_p99_ms: Math.round(p99 * 100) / 100,
        cost_per_signal_inr: costPerSignal,
        confirmed_case_conversion_rate: Math.round(conversionRate * 1000) / 1000,
        created_at: new Date().toISOString()
      };
    };

    // 1. Global metrics
    metricsToInsert.push(computeSlice('global', 'all', evaluatedItems));

    // 2. Slices by platform
    const platformGroups = this.groupBy(evaluatedItems, (i) => i.fixture.synthetic_platform);
    for (const [platform, items] of Object.entries(platformGroups)) {
      metricsToInsert.push(computeSlice('platform', platform, items));
    }

    // 3. Slices by score band
    const bandGroups = this.groupBy(evaluatedItems, (i) => i.scoreBand);
    for (const [band, items] of Object.entries(bandGroups)) {
      metricsToInsert.push(computeSlice('score_band', band, items));
    }

    // 4. Slices by scenario category
    const categoryGroups = this.groupBy(evaluatedItems, (i) => i.fixture.scenario_category);
    for (const [cat, items] of Object.entries(categoryGroups)) {
      metricsToInsert.push(computeSlice('scenario_category', cat, items));
    }

    // Persist run and metrics in transaction
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO evaluation_runs (
          id, organization_id, dataset_id, ruleset_id, run_type,
          total_evaluated, executed_by_user_id, execution_duration_ms, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.organization_id,
        run.dataset_id,
        run.ruleset_id,
        run.run_type,
        run.total_evaluated,
        run.executed_by_user_id,
        run.execution_duration_ms,
        run.status,
        run.notes,
        run.created_at
      );

      const insertMetric = this.db.prepare(`
        INSERT INTO evaluation_run_metrics (
          id, run_id, slice_dimension, slice_value, total_signals,
          true_positives, false_positives, true_negatives, false_negatives,
          precision, recall, false_positive_rate, false_negative_rate,
          precision_at_top_k, queue_yield, brier_calibration_score,
          avg_review_time_ms, duplicate_suppression_rate, normalization_success_rate,
          adapter_rejection_rate, latency_p50_ms, latency_p95_ms, latency_p99_ms,
          cost_per_signal_inr, confirmed_case_conversion_rate, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of metricsToInsert) {
        insertMetric.run(
          m.id,
          m.run_id,
          m.slice_dimension,
          m.slice_value,
          m.total_signals,
          m.true_positives,
          m.false_positives,
          m.true_negatives,
          m.false_negatives,
          m.precision,
          m.recall,
          m.false_positive_rate,
          m.false_negative_rate,
          m.precision_at_top_k,
          m.queue_yield,
          m.brier_calibration_score,
          m.avg_review_time_ms,
          m.duplicate_suppression_rate,
          m.normalization_success_rate,
          m.adapter_rejection_rate,
          m.latency_p50_ms,
          m.latency_p95_ms,
          m.latency_p99_ms,
          m.cost_per_signal_inr,
          m.confirmed_case_conversion_rate,
          m.created_at
        );
      }
    });

    tx();

    return {
      run,
      metrics: metricsToInsert
    };
  }

  public getRunById(runId: string, organizationId?: string): EvaluationRun | null {
    let sql = 'SELECT * FROM evaluation_runs WHERE id = ?';
    const params: any[] = [runId];
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    const row = this.db.prepare(sql).get(...params) as any;
    return row || null;
  }

  public listRuns(organizationId: string, limit = 50, offset = 0): EvaluationRun[] {
    return this.db.prepare(`
      SELECT * FROM evaluation_runs
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(organizationId, limit, offset) as EvaluationRun[];
  }

  public getMetricsForRun(runId: string, sliceDimension?: string): EvaluationRunMetric[] {
    let sql = 'SELECT * FROM evaluation_run_metrics WHERE run_id = ?';
    const params: any[] = [runId];
    if (sliceDimension) {
      sql += ' AND slice_dimension = ?';
      params.push(sliceDimension);
    }
    sql += ' ORDER BY slice_dimension ASC, slice_value ASC';
    return this.db.prepare(sql).all(...params) as EvaluationRunMetric[];
  }

  /**
   * Compares two evaluation runs (e.g. comparing baseline ruleset vs calibrated ruleset)
   */
  public compareRuns(baseRunId: string, candidateRunId: string): {
    baseRun: EvaluationRun;
    candidateRun: EvaluationRun;
    baseGlobal: EvaluationRunMetric;
    candidateGlobal: EvaluationRunMetric;
    precisionDelta: number;
    recallDelta: number;
    fprDelta: number;
    yieldDelta: number;
    brierDelta: number;
  } {
    const baseRun = this.getRunById(baseRunId);
    const candidateRun = this.getRunById(candidateRunId);
    if (!baseRun || !candidateRun) {
      throw new Error('NOT_FOUND: One or both runs could not be found for comparison');
    }

    const baseGlobal = this.db.prepare(`
      SELECT * FROM evaluation_run_metrics WHERE run_id = ? AND slice_dimension = 'global'
    `).get(baseRunId) as EvaluationRunMetric;

    const candidateGlobal = this.db.prepare(`
      SELECT * FROM evaluation_run_metrics WHERE run_id = ? AND slice_dimension = 'global'
    `).get(candidateRunId) as EvaluationRunMetric;

    return {
      baseRun,
      candidateRun,
      baseGlobal,
      candidateGlobal,
      precisionDelta: Math.round((candidateGlobal.precision - baseGlobal.precision) * 1000) / 1000,
      recallDelta: Math.round((candidateGlobal.recall - baseGlobal.recall) * 1000) / 1000,
      fprDelta: Math.round((candidateGlobal.false_positive_rate - baseGlobal.false_positive_rate) * 1000) / 1000,
      yieldDelta: Math.round((candidateGlobal.queue_yield - baseGlobal.queue_yield) * 1000) / 1000,
      brierDelta: Math.round((candidateGlobal.brier_calibration_score - baseGlobal.brier_calibration_score) * 1000) / 1000
    };
  }

  private groupBy<T>(list: T[], keyGetter: (item: T) => string): Record<string, T[]> {
    const map: Record<string, T[]> = {};
    for (const item of list) {
      const key = keyGetter(item);
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }
}
