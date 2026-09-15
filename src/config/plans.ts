export interface PlanLimits {
  maxUsers: number;
  maxActiveCases: number;
  maxMonthlyEvidenceUploads: number;
  maxStorageBytes: number;
  maxSimulatedSubmissionsPerMonth: number;
}

export interface PlanOverageRates {
  perAdditionalUserInr: number;
  perAdditionalCaseInr: number;
  perAdditionalGigabyteInr: number;
  perAdditionalSimulationInr: number;
}

export interface PlanDefinition {
  id: 'pilot' | 'professional' | 'enterprise';
  name: string;
  description: string;
  basePriceInr: number;
  billingInterval: 'month';
  limits: PlanLimits;
  overageRates: PlanOverageRates;
  enabledFeatures: string[];
}

export const ALL_FEATURE_FLAGS = [
  'evidence_locker',
  'statutory_clocks',
  'platform_playbooks',
  'dry_run_submissions',
  'reupload_observations',
  'retention_automation',
  'export',
  'api_access',
  'advanced_audit_reports'
] as const;

export type FeatureFlagKey = (typeof ALL_FEATURE_FLAGS)[number];

export const PLAN_CATALOG: Record<string, PlanDefinition> = {
  pilot: {
    id: 'pilot',
    name: 'Controlled Pilot',
    description: 'Designed for synthetic validation and controlled institutional pilot trials.',
    basePriceInr: 0,
    billingInterval: 'month',
    limits: {
      maxUsers: 10,
      maxActiveCases: 25,
      maxMonthlyEvidenceUploads: 100,
      maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
      maxSimulatedSubmissionsPerMonth: 50
    },
    overageRates: {
      perAdditionalUserInr: 0,
      perAdditionalCaseInr: 0,
      perAdditionalGigabyteInr: 0,
      perAdditionalSimulationInr: 0
    },
    enabledFeatures: [
      'evidence_locker',
      'statutory_clocks',
      'platform_playbooks',
      'dry_run_submissions',
      'reupload_observations',
      'retention_automation',
      'export',
      'api_access',
      'advanced_audit_reports'
    ]
  },
  professional: {
    id: 'professional',
    name: 'Professional Incident Response',
    description: 'For corporate security desks and digital forensics response teams.',
    basePriceInr: 49000,
    billingInterval: 'month',
    limits: {
      maxUsers: 25,
      maxActiveCases: 100,
      maxMonthlyEvidenceUploads: 500,
      maxStorageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
      maxSimulatedSubmissionsPerMonth: 250
    },
    overageRates: {
      perAdditionalUserInr: 1500,
      perAdditionalCaseInr: 500,
      perAdditionalGigabyteInr: 100,
      perAdditionalSimulationInr: 250
    },
    enabledFeatures: [
      'evidence_locker',
      'statutory_clocks',
      'platform_playbooks',
      'dry_run_submissions',
      'reupload_observations',
      'retention_automation',
      'export',
      'api_access',
      'advanced_audit_reports'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Dedicated',
    description: 'Custom governance, dedicated retention rules, and unlimited operational capacity.',
    basePriceInr: 149000,
    billingInterval: 'month',
    limits: {
      maxUsers: 100,
      maxActiveCases: 500,
      maxMonthlyEvidenceUploads: 2500,
      maxStorageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
      maxSimulatedSubmissionsPerMonth: 1000
    },
    overageRates: {
      perAdditionalUserInr: 1000,
      perAdditionalCaseInr: 350,
      perAdditionalGigabyteInr: 75,
      perAdditionalSimulationInr: 150
    },
    enabledFeatures: [
      'evidence_locker',
      'statutory_clocks',
      'platform_playbooks',
      'dry_run_submissions',
      'reupload_observations',
      'retention_automation',
      'export',
      'api_access',
      'advanced_audit_reports'
    ]
  }
};

export function getPlanDefinition(planTier: string): PlanDefinition {
  return PLAN_CATALOG[planTier] || PLAN_CATALOG.pilot;
}

export function listAvailablePlans(): PlanDefinition[] {
  return Object.values(PLAN_CATALOG);
}
