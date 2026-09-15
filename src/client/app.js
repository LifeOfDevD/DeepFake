// ============================================================================
// Digital Impersonation Response Desk - Operational Client (Phase 3)
// ============================================================================

let currentOrgId = '';
let currentUserId = '';
let currentUserRole = '';
let demoUsers = [];
let allCases = [];
let activeCaseId = null;
let activeCaseData = null;
let activeSubmissionId = null;
let activeSubmissionData = null;
let allPlatforms = [];
let allPlaybooks = [];
let allEscalations = [];
let allObservations = [];
let allNotifications = [];
let currentActiveView = 'cases';
let currentReportTypes = [];
let currentReportResult = null;
let allMonitoredSubjects = [];
let allCandidateReviews = [];
let allMonitoringPolicies = [];
let activeReviewItem = null;
let allProviderConnections = [];
let allIntegrationSignals = [];
let activeKillSwitchState = null;

// Submission 11-State Colors (Phase 4)
const SUBMISSION_STATUS_STYLES = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  needs_information: 'bg-amber-950 text-amber-300 border-amber-800',
  ready_for_review: 'bg-cyan-950 text-cyan-300 border-cyan-800',
  approved_for_simulation: 'bg-indigo-950 text-indigo-300 border-indigo-800 font-bold',
  simulated_submitted: 'bg-blue-950 text-blue-300 border-blue-800',
  acknowledged: 'bg-teal-950 text-teal-300 border-teal-800',
  response_received: 'bg-purple-950 text-purple-300 border-purple-800',
  action_taken: 'bg-emerald-950 text-emerald-300 border-emerald-800 font-bold',
  rejected: 'bg-rose-950 text-rose-300 border-rose-800',
  escalation_required: 'bg-orange-950 text-orange-300 border-orange-800 font-bold animate-pulse',
  closed: 'bg-slate-800 text-slate-500 border-slate-700'
};

// Status colors
const STATUS_STYLES = {
  new: 'bg-blue-950 text-blue-300 border-blue-800',
  triage: 'bg-cyan-950 text-cyan-300 border-cyan-800',
  awaiting_authority: 'bg-amber-950 text-amber-300 border-amber-800',
  evidence_collection: 'bg-sky-950 text-sky-300 border-sky-800',
  human_review: 'bg-yellow-950 text-yellow-300 border-yellow-800',
  ready_for_submission: 'bg-indigo-950 text-indigo-300 border-indigo-800',
  submitted: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  awaiting_response: 'bg-teal-950 text-teal-300 border-teal-800',
  escalated: 'bg-orange-950 text-orange-300 border-orange-800',
  resolved: 'bg-green-950 text-green-300 border-green-800',
  closed: 'bg-slate-800 text-slate-400 border-slate-700',
  rejected: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  blocked: 'bg-purple-950 text-purple-300 border-purple-800 animate-pulse'
};

const APPROVAL_STYLES = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  triage_complete: 'bg-blue-950 text-blue-300 border-blue-800',
  awaiting_legal_review: 'bg-purple-950 text-purple-300 border-purple-800',
  legal_review_approved: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  ready_for_submission: 'bg-indigo-950 text-indigo-300 border-indigo-800',
  submission_simulated: 'bg-teal-950 text-teal-300 border-teal-800',
  rejected: 'bg-rose-950 text-rose-300 border-rose-800',
  blocked: 'bg-purple-950 text-purple-300 border-purple-800'
};

const PRIORITY_STYLES = {
  critical: 'text-rose-400 bg-rose-950/60 border-rose-900',
  high: 'text-amber-400 bg-amber-950/60 border-amber-900',
  medium: 'text-blue-400 bg-blue-950/60 border-blue-900',
  low: 'text-slate-400 bg-slate-800 border-slate-700'
};

const SENSITIVITY_STYLES = {
  normal: 'bg-slate-800 text-slate-300 border-slate-700',
  sensitive: 'bg-amber-950 text-amber-300 border-amber-800',
  restricted: 'bg-rose-950 text-rose-300 border-rose-800',
  prohibited: 'bg-purple-950 text-purple-300 border-purple-800 font-bold'
};

const EVIDENCE_STATUS_STYLES = {
  available: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  quarantined: 'bg-purple-950 text-purple-300 border-purple-800 animate-pulse font-bold',
  rejected: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  deletion_requested: 'bg-amber-950 text-amber-300 border-amber-800',
  deleted: 'bg-rose-950 text-rose-400 border-rose-900 line-through',
  retention_expired: 'bg-slate-800 text-slate-500 border-slate-700'
};

let activeEvidenceId = null;
let currentEvidenceItem = null;

// State Machine transitions graph for UI guidance
const STATE_TRANSITIONS = {
  new: ['triage', 'blocked'],
  triage: ['awaiting_authority', 'rejected', 'blocked'],
  awaiting_authority: ['evidence_collection', 'rejected', 'blocked'],
  evidence_collection: ['human_review', 'rejected', 'blocked'],
  human_review: ['ready_for_submission', 'rejected', 'blocked'],
  ready_for_submission: ['submitted', 'human_review', 'rejected'],
  submitted: ['awaiting_response'],
  awaiting_response: ['resolved', 'escalated', 'closed'],
  escalated: ['ready_for_submission', 'resolved', 'closed'],
  resolved: ['closed'],
  rejected: ['closed'],
  blocked: ['closed'],
  closed: []
};

// API Client Helper
async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-organization-id': currentOrgId,
    'x-user-id': currentUserId,
    ...(options.headers || {})
  };

  const response = await fetch(path, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }

  return data;
}

// ----------------------------------------------------------------------------
// Initialization & Switchers
// ----------------------------------------------------------------------------

async function init() {
  try {
    const usersRes = await fetch('/api/auth/demo-users');
    const usersData = await usersRes.json();
    demoUsers = usersData.data;

    const orgsRes = await fetch('/api/organizations', {
      headers: { 'x-user-id': demoUsers[0].id }
    });
    const orgsData = await orgsRes.json();
    const organizations = orgsData.data;

    const orgSelector = document.getElementById('orgSelector');
    orgSelector.innerHTML = organizations
      .map((o) => `<option value="${o.id}">${o.name} (${o.jurisdiction})</option>`)
      .join('');

    currentOrgId = organizations[0].id;
    updateUserSelector();

    orgSelector.addEventListener('change', (e) => {
      currentOrgId = e.target.value;
      updateUserSelector();
      loadCases();
      loadTasks();
      loadAuditEvents();
      loadNotifications();
      loadMonitoringBadge();
      refreshCurrentActiveView();
    });

    document.getElementById('userSelector').addEventListener('change', (e) => {
      currentUserId = e.target.value;
      const user = demoUsers.find((u) => u.id === currentUserId);
      currentUserRole = user ? (user.role || user.system_role) : 'user';
      updateUserBadge();
      loadCases();
      loadNotifications();
      refreshCurrentActiveView();
    });

    setupNavigation();
    setupFilters();
    setupModals();

    await Promise.all([
      loadCases(),
      loadTasks(),
      loadEscalations(),
      loadReuploads(),
      loadPlatformsAndPlaybooks(),
      loadNotifications(),
      loadMonitoringBadge()
    ]);
  } catch (err) {
    console.error('Initialization error:', err);
  }
}

function refreshCurrentActiveView() {
  switch (currentActiveView) {
    case 'onboarding': loadOnboarding(); break;
    case 'usage': loadUsage(); break;
    case 'billing': loadBilling(); break;
    case 'reports': loadReports(); break;
    case 'workers': loadWorkers(); break;
    case 'monitoring': loadMonitoring(); break;
    case 'evaluation': loadEvaluation(); break;
    case 'integrations': loadIntegrations(); break;
  }
}

function updateUserSelector() {
  const userSelector = document.getElementById('userSelector');
  const eligibleUsers = demoUsers.filter(
    (u) => u.organization_id === currentOrgId || u.system_role === 'system_admin'
  );

  userSelector.innerHTML = eligibleUsers
    .map((u) => `<option value="${u.id}">${u.full_name} [${u.role || u.system_role}]</option>`)
    .join('');

  if (eligibleUsers.length > 0) {
    currentUserId = eligibleUsers[0].id;
    currentUserRole = eligibleUsers[0].role || eligibleUsers[0].system_role;
  }
  updateUserBadge();
}

function updateUserBadge() {
  const badge = document.getElementById('currentUserRoleBadge');
  badge.textContent = `Role: ${currentUserRole}`;
}

// ----------------------------------------------------------------------------
// Navigation & Sub-Tabs
// ----------------------------------------------------------------------------

function switchMainView(viewName) {
  currentActiveView = viewName;
  const views = {
    cases: { view: document.getElementById('casesView'), btn: document.getElementById('navCasesBtn'), load: loadCases },
    tasks: { view: document.getElementById('tasksView'), btn: document.getElementById('navTasksBtn'), load: loadTasks },
    escalations: { view: document.getElementById('escalationsView'), btn: document.getElementById('navEscalationsBtn'), load: loadEscalations },
    reuploads: { view: document.getElementById('reuploadsView'), btn: document.getElementById('navReuploadsBtn'), load: loadReuploads },
    platforms: { view: document.getElementById('platformsView'), btn: document.getElementById('navPlatformsBtn'), load: loadPlatformsAndPlaybooks },
    audit: { view: document.getElementById('auditView'), btn: document.getElementById('navAuditBtn'), load: loadAuditEvents },
    onboarding: { view: document.getElementById('onboardingView'), btn: document.getElementById('navOnboardingBtn'), load: loadOnboarding },
    usage: { view: document.getElementById('usageView'), btn: document.getElementById('navUsageBtn'), load: loadUsage },
    billing: { view: document.getElementById('billingView'), btn: document.getElementById('navBillingBtn'), load: loadBilling },
    reports: { view: document.getElementById('reportsView'), btn: document.getElementById('navReportsBtn'), load: loadReports },
    workers: { view: document.getElementById('workersView'), btn: document.getElementById('navWorkersBtn'), load: loadWorkers },
    monitoring: { view: document.getElementById('monitoringView'), btn: document.getElementById('navMonitoringBtn'), load: loadMonitoring },
    evaluation: { view: document.getElementById('evaluationView'), btn: document.getElementById('navEvaluationBtn'), load: loadEvaluation },
    integrations: { view: document.getElementById('integrationsView'), btn: document.getElementById('navIntegrationsBtn'), load: loadIntegrations }
  };

  Object.keys(views).forEach((key) => {
    const item = views[key];
    if (!item.view || !item.btn) return;
    if (key === viewName) {
      item.view.classList.remove('hidden');
      item.btn.className = 'w-full text-left px-3 py-2 rounded text-slate-200 bg-slate-800/80 font-medium text-xs flex items-center justify-between transition-colors';
      if (item.load) item.load();
    } else {
      item.view.classList.add('hidden');
      item.btn.className = 'w-full text-left px-3 py-2 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 text-xs flex items-center justify-between transition-colors';
    }
  });
}

function setupNavigation() {
  document.getElementById('navCasesBtn').addEventListener('click', () => switchMainView('cases'));
  document.getElementById('navTasksBtn').addEventListener('click', () => switchMainView('tasks'));
  document.getElementById('navEscalationsBtn').addEventListener('click', () => switchMainView('escalations'));
  document.getElementById('navReuploadsBtn').addEventListener('click', () => switchMainView('reuploads'));
  document.getElementById('navPlatformsBtn').addEventListener('click', () => switchMainView('platforms'));
  document.getElementById('navAuditBtn').addEventListener('click', () => switchMainView('audit'));
  document.getElementById('navOnboardingBtn')?.addEventListener('click', () => switchMainView('onboarding'));
  document.getElementById('navUsageBtn')?.addEventListener('click', () => switchMainView('usage'));
  document.getElementById('navBillingBtn')?.addEventListener('click', () => switchMainView('billing'));
  document.getElementById('navReportsBtn')?.addEventListener('click', () => switchMainView('reports'));
  document.getElementById('navWorkersBtn')?.addEventListener('click', () => switchMainView('workers'));
  document.getElementById('navMonitoringBtn')?.addEventListener('click', () => switchMainView('monitoring'));
  document.getElementById('navEvaluationBtn')?.addEventListener('click', () => switchMainView('evaluation'));
  document.getElementById('navIntegrationsBtn')?.addEventListener('click', () => switchMainView('integrations'));

  document.getElementById('refreshAuditBtn').addEventListener('click', loadAuditEvents);
  document.getElementById('refreshTasksBtn').addEventListener('click', loadTasks);
  document.getElementById('refreshEscalationsBtn')?.addEventListener('click', loadEscalations);
  document.getElementById('refreshReuploadsBtn')?.addEventListener('click', loadReuploads);
  document.getElementById('refreshOnboardingBtn')?.addEventListener('click', loadOnboarding);
  document.getElementById('refreshUsageBtn')?.addEventListener('click', loadUsage);
  document.getElementById('refreshBillingBtn')?.addEventListener('click', loadBilling);
  document.getElementById('refreshWorkersBtn')?.addEventListener('click', loadWorkers);
  document.getElementById('refreshMonitoringBtn')?.addEventListener('click', loadMonitoring);
  document.getElementById('refreshEvalBtn')?.addEventListener('click', loadEvaluation);

  setupEvaluationNavigation();

  // Case Sub-Tabs Setup
  document.getElementById('caseTabOverviewBtn').addEventListener('click', () => switchCaseSubTab('overview'));
  document.getElementById('caseTabReadinessBtn').addEventListener('click', () => switchCaseSubTab('readiness'));
  document.getElementById('caseTabEvidenceBtn').addEventListener('click', () => switchCaseSubTab('evidence'));
  document.getElementById('caseTabSubmissionBtn').addEventListener('click', () => switchCaseSubTab('submission'));
}

function switchCaseSubTab(tab) {
  const tabs = ['overview', 'readiness', 'evidence', 'submission'];
  tabs.forEach((t) => {
    const pane = document.getElementById(`case${t.charAt(0).toUpperCase() + t.slice(1)}TabPane`);
    const btn = document.getElementById(`caseTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    if (t === tab) {
      pane?.classList.remove('hidden');
      btn?.classList.add('border-indigo-500', 'text-indigo-400');
      btn?.classList.remove('border-transparent', 'text-slate-400');
    } else {
      pane?.classList.add('hidden');
      btn?.classList.remove('border-indigo-500', 'text-indigo-400');
      btn?.classList.add('border-transparent', 'text-slate-400');
    }
  });
}

function setupFilters() {
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const categoryFilter = document.getElementById('categoryFilter');

  const filterHandler = () => {
    const query = searchInput.value.toLowerCase().trim();
    const status = statusFilter.value;
    const cat = categoryFilter.value;

    const filtered = allCases.filter((c) => {
      const matchSearch =
        !query ||
        c.title.toLowerCase().includes(query) ||
        c.target_entity.toLowerCase().includes(query) ||
        c.case_number.toLowerCase().includes(query) ||
        c.contested_url.toLowerCase().includes(query);
      const matchStatus = !status || c.status === status;
      const matchCategory = !cat || c.category === cat;
      return matchSearch && matchStatus && matchCategory;
    });

    renderCasesTable(filtered);
  };

  searchInput.addEventListener('input', filterHandler);
  statusFilter.addEventListener('change', filterHandler);
  categoryFilter.addEventListener('change', filterHandler);
}

// ----------------------------------------------------------------------------
// Case Management & Table Rendering
// ----------------------------------------------------------------------------

async function loadCases() {
  try {
    const res = await apiRequest('/api/cases');
    allCases = res.data;
    renderMetrics(allCases);
    renderCasesTable(allCases);
  } catch (err) {
    console.error('Failed to load cases:', err);
  }
}

function renderMetrics(cases) {
  document.getElementById('statTotalCases').textContent = cases.length;
  document.getElementById('statCriticalCases').textContent = cases.filter((c) => c.priority === 'critical').length;
  document.getElementById('statReviewCases').textContent = cases.filter((c) => c.status === 'human_review').length;
  document.getElementById('statReadyCases').textContent = cases.filter((c) => c.status === 'ready_for_submission' || c.approval_status === 'ready_for_submission').length;
  document.getElementById('statBlockedCases').textContent = cases.filter((c) => c.status === 'blocked').length;
  document.getElementById('sidebarCaseCount').textContent = cases.length;
}

function renderCasesTable(cases) {
  const tbody = document.getElementById('casesTableBody');
  if (cases.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-slate-500">
          No cases found matching the criteria. Click "+ Intake Incident" to begin.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = cases
    .map((c) => {
      const statusStyle = STATUS_STYLES[c.status] || 'bg-slate-800 text-slate-300 border-slate-700';
      const priorityStyle = PRIORITY_STYLES[c.priority] || 'text-slate-400 bg-slate-800 border-slate-700';
      const approvalStyle = APPROVAL_STYLES[c.approval_status || 'draft'] || 'bg-slate-800 text-slate-300 border-slate-700';

      return `
        <tr class="hover:bg-slate-800/40 cursor-pointer transition-colors border-b border-slate-800/60" onclick="openCaseDetail('${c.id}')">
          <td class="py-3 px-3 font-mono font-semibold text-indigo-400">${escapeHtml(c.case_number)}</td>
          <td class="py-3 px-3 max-w-xs">
            <div class="font-medium text-slate-100 truncate">${escapeHtml(c.title)}</div>
            <div class="text-[11px] text-slate-400 truncate mt-0.5">Target: ${escapeHtml(c.target_entity)}</div>
          </td>
          <td class="py-3 px-3">
            <span class="text-slate-300 text-xs">${escapeHtml(formatCategory(c.category))}</span>
          </td>
          <td class="py-3 px-3 text-slate-300 text-xs">${escapeHtml(c.hosting_platform)}</td>
          <td class="py-3 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${priorityStyle}">
              ${escapeHtml(c.priority)}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${approvalStyle}">
              ${escapeHtml((c.approval_status || 'draft').replace(/_/g, ' ').toUpperCase())}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${statusStyle}">
              ${escapeHtml(c.status.replace(/_/g, ' ').toUpperCase())}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <button onclick="event.stopPropagation(); openCaseDetail('${c.id}')" class="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium">
              View & Triage
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

// ----------------------------------------------------------------------------
// Case Detail Modal & Phase 3 Operations
// ----------------------------------------------------------------------------

window.openCaseDetail = async function (caseId) {
  activeCaseId = caseId;
  try {
    const res = await apiRequest(`/api/cases/${caseId}`);
    const { case: c, status_history, notes } = res.data;
    activeCaseData = c;

    document.getElementById('modalCaseNumber').textContent = c.case_number;
    document.getElementById('modalCaseTitle').textContent = c.title;
    document.getElementById('modalTargetEntity').textContent = `${c.target_entity} (${c.target_entity_type || 'individual'})`;
    document.getElementById('modalHostingPlatform').textContent = c.hosting_platform;
    document.getElementById('modalCategory').textContent = formatCategory(c.category);
    document.getElementById('modalPriority').textContent = c.priority.toUpperCase();

    const contestedLink = document.getElementById('modalContestedUrl');
    contestedLink.textContent = c.contested_url;
    contestedLink.href = c.contested_url;

    // Status badge
    const statusBadge = document.getElementById('modalStatusBadge');
    statusBadge.textContent = c.status.toUpperCase().replace(/_/g, ' ');
    statusBadge.className = `text-xs font-mono font-bold px-2 py-0.5 rounded border ${STATUS_STYLES[c.status] || ''}`;

    // Approval state badge
    const approvalBadge = document.getElementById('modalApprovalStateBadge');
    const appStatus = c.approval_status || 'draft';
    approvalBadge.textContent = appStatus.toUpperCase().replace(/_/g, ' ');
    approvalBadge.className = `text-xs font-mono font-bold px-2 py-0.5 rounded border ${APPROVAL_STYLES[appStatus] || ''}`;

    // Quarantine banner
    const quarantineBanner = document.getElementById('modalQuarantineBanner');
    if (c.status === 'blocked') {
      quarantineBanner.classList.remove('hidden');
    } else {
      quarantineBanner.classList.add('hidden');
    }

    // Statutory tags
    const statutoryContainer = document.getElementById('modalStatutoryTags');
    const grounds = JSON.parse(c.statutory_basis || '[]');
    statutoryContainer.innerHTML = grounds
      .map((g) => `<span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 text-[11px]">${escapeHtml(g)}</span>`)
      .join('');

    // Setup Next Status Select based on state machine
    const nextSelect = document.getElementById('modalNextStatusSelect');
    const allowed = STATE_TRANSITIONS[c.status] || [];
    nextSelect.innerHTML = allowed
      .map((s) => `<option value="${s}">${s.replace(/_/g, ' ').toUpperCase()}</option>`)
      .join('');

    const applyBtn = document.getElementById('modalApplyStatusBtn');
    if (allowed.length === 0) {
      nextSelect.disabled = true;
      applyBtn.disabled = true;
      applyBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      nextSelect.disabled = false;
      applyBtn.disabled = false;
      applyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    document.getElementById('modalTransitionError').classList.add('hidden');
    document.getElementById('modalTransitionReason').value = '';

    renderNotes(notes);
    renderHistory(status_history);

    // Load Phase 3 & 4 components
    await Promise.all([
      loadTriageInfo(caseId),
      loadClockInfo(caseId),
      loadReadinessInfo(caseId),
      loadDuplicateInfo(caseId),
      loadSubmissionPacket(caseId),
      loadCaseEvidence(caseId),
      loadCaseSubmissions(caseId)
    ]);

    switchCaseSubTab('overview');
    document.getElementById('caseDetailModal').classList.remove('hidden');
  } catch (err) {
    alert('Failed to load case details: ' + err.message);
  }
};

async function loadTriageInfo(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/triage`);
    const triage = res.data;
    document.getElementById('triageClassificationBadge').textContent = triage.classification.replace(/_/g, ' ').toUpperCase();
    document.getElementById('triageNotes').textContent = triage.notes || 'Triage completed.';

    const rulesContainer = document.getElementById('triageRulesContainer');
    rulesContainer.innerHTML = triage.triggered_rules
      .map((r) => `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono text-[10px]">${escapeHtml(r)}</span>`)
      .join('');
  } catch (err) {
    console.error('Failed to load triage:', err);
  }
}

async function loadClockInfo(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/clocks`);
    const evalData = res.data;
    const clock = evalData.clock;

    document.getElementById('clockStatusBadge').textContent = clock.current_status.toUpperCase();
    document.getElementById('clockOperationalBasis').textContent = clock.operational_basis;

    const ackHoursElem = document.getElementById('clockAckHours');
    ackHoursElem.textContent = `${evalData.acknowledgement_remaining_hours}h`;
    document.getElementById('clockAckDate').textContent = new Date(clock.acknowledgement_deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const subBox = document.getElementById('clockSubBox');
    const subHoursElem = document.getElementById('clockSubHours');
    subHoursElem.textContent = `${evalData.submission_remaining_hours}h`;
    document.getElementById('clockSubDate').textContent = new Date(clock.submission_deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    if (evalData.is_overdue) {
      subHoursElem.className = 'text-lg font-bold text-rose-400 mt-0.5 font-mono-num animate-pulse';
      subBox.className = 'p-2.5 bg-rose-950/40 rounded border border-rose-800';
    } else if (evalData.is_urgent) {
      subHoursElem.className = 'text-lg font-bold text-rose-400 mt-0.5 font-mono-num';
      subBox.className = 'p-2.5 bg-rose-950/30 rounded border border-rose-900';
    } else if (evalData.is_due_soon) {
      subHoursElem.className = 'text-lg font-bold text-amber-400 mt-0.5 font-mono-num';
      subBox.className = 'p-2.5 bg-amber-950/30 rounded border border-amber-900';
    } else {
      subHoursElem.className = 'text-lg font-bold text-emerald-400 mt-0.5 font-mono-num';
      subBox.className = 'p-2.5 bg-slate-900/80 rounded border border-slate-800';
    }

    const escHoursElem = document.getElementById('clockEscHours');
    escHoursElem.textContent = `${evalData.escalation_remaining_hours}h`;
    document.getElementById('clockEscDate').textContent = new Date(clock.escalation_deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const warnBanner = document.getElementById('clockWarningBanner');
    if (evalData.warnings && evalData.warnings.length > 0) {
      warnBanner.innerHTML = evalData.warnings.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join('');
      warnBanner.classList.remove('hidden');
    } else {
      warnBanner.classList.add('hidden');
    }

    // Statutory-Source Discipline (Phase 4)
    const deadlineBadge = document.getElementById('statutoryDeadlineTypeBadge');
    if (deadlineBadge) {
      if ((evalData.deadline_type || clock.deadline_type) === 'legally_mandatory') {
        deadlineBadge.textContent = 'Legally Mandatory';
        deadlineBadge.className = 'text-[9px] uppercase px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono font-bold tracking-wider';
      } else {
        deadlineBadge.textContent = 'Internal SLA';
        deadlineBadge.className = 'text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono font-bold tracking-wider';
      }
    }

    const opRule = document.getElementById('statutoryOperationalRule');
    if (opRule) opRule.textContent = evalData.operational_rule || clock.operational_rule || 'IT_RULES_2021_RULE_3_2_B';

    const jurBadge = document.getElementById('statutoryJurisdictionBadge');
    if (jurBadge) jurBadge.textContent = evalData.jurisdiction || clock.jurisdiction || 'IN-National';

    const citationText = document.getElementById('statutoryCitationText');
    if (citationText) citationText.textContent = clock.source_citation || 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021';

    const effDate = document.getElementById('statutoryEffectiveDate');
    if (effDate) effDate.textContent = clock.effective_date || '2021-02-25';

    const verDate = document.getElementById('statutoryVerifiedDate');
    if (verDate) verDate.textContent = clock.last_verified_date || '2026-09-01';

    const srcLink = document.getElementById('statutorySourceLink');
    if (srcLink) {
      const url = clock.source_url_or_identifier;
      if (url && url.startsWith('http')) {
        srcLink.href = url;
        srcLink.classList.remove('hidden');
      } else {
        srcLink.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Failed to load clocks:', err);
  }
}

async function loadReadinessInfo(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/readiness`);
    const r = res.data;

    const badge = document.getElementById('modalReadinessBadge');
    const headerBadge = document.getElementById('readinessStatusHeaderBadge');

    if (r.is_ready) {
      badge.textContent = 'READY';
      badge.className = 'px-1.5 py-0.2 rounded bg-emerald-950 text-[10px] text-emerald-300 font-bold border border-emerald-800';
      headerBadge.textContent = 'ALL 14 CHECKS PASSED';
      headerBadge.className = 'text-xs font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold';
    } else {
      badge.textContent = 'BLOCKERS ACTIVE';
      badge.className = 'px-1.5 py-0.2 rounded bg-rose-950 text-[10px] text-rose-300 font-bold border border-rose-800';
      headerBadge.textContent = 'BLOCKING GATES UNFULFILLED';
      headerBadge.className = 'text-xs font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold';
    }

    document.getElementById('passedChecksCount').textContent = r.passed_checks.length;
    document.getElementById('missingChecksCount').textContent = r.missing_requirements.length;

    const passedList = document.getElementById('passedChecksList');
    passedList.innerHTML = r.passed_checks
      .map((chk) => `
        <div class="p-2 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
          <span class="font-mono text-[11px] text-emerald-400">✓ ${escapeHtml(chk)}</span>
          <span class="text-[10px] text-slate-500">Verified</span>
        </div>
      `)
      .join('');

    const missingList = document.getElementById('missingChecksList');
    if (r.missing_requirements.length === 0) {
      missingList.innerHTML = '<div class="p-4 text-center text-slate-500">No missing or blocking requirements. Case is ready for submission.</div>';
    } else {
      missingList.innerHTML = r.missing_requirements
        .map((m) => `
          <div class="p-2 bg-rose-950/30 rounded border border-rose-900/60 space-y-0.5">
            <div class="flex items-center justify-between">
              <span class="font-mono font-bold text-[11px] text-rose-400">${escapeHtml(m.code)}</span>
              <span class="text-[10px] uppercase font-bold text-rose-300">${escapeHtml(m.severity)}</span>
            </div>
            <div class="text-[11px] text-slate-300">${escapeHtml(m.message)}</div>
          </div>
        `)
        .join('');
    }
  } catch (err) {
    console.error('Failed to load readiness:', err);
  }
}

async function loadDuplicateInfo(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/duplicates`);
    const duplicates = res.data;
    const banner = document.getElementById('modalDuplicateBanner');
    const pendingDupes = duplicates.filter((d) => d.status === 'pending_review');

    if (pendingDupes.length > 0) {
      banner.classList.remove('hidden');
      const resolveBtn = document.getElementById('modalResolveDuplicateBtn');
      resolveBtn.onclick = async () => {
        try {
          await apiRequest(`/api/cases/${caseId}/duplicates/${pendingDupes[0].id}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ status: 'dismissed' })
          });
          banner.classList.add('hidden');
        } catch (err) {
          alert('Failed to resolve duplicate: ' + err.message);
        }
      };
    } else {
      banner.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load duplicates:', err);
  }
}

async function loadSubmissionPacket(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/submission-packet`);
    const packet = res.data;

    document.getElementById('packetDigestBadge').textContent = `SHA-256: ${packet.packet_hash}`;
    document.getElementById('packetMarkdownView').textContent = packet.packet_markdown;
    document.getElementById('packetJsonView').textContent = packet.packet_json;

    document.getElementById('btnCopyPacketJson').onclick = () => {
      navigator.clipboard.writeText(packet.packet_json);
      alert('Canonical JSON copied to clipboard.');
    };
  } catch (err) {
    console.error('Failed to load submission packet:', err);
  }
}

// ----------------------------------------------------------------------------
// Phase 4: Platform Grievance Operations & Submission Control Plane
// ----------------------------------------------------------------------------

const SUBMISSION_WORKFLOW_STEPS = [
  { key: 'draft', label: '1. Draft' },
  { key: 'needs_information', label: '2. Info Req' },
  { key: 'ready_for_review', label: '3. Ready Review' },
  { key: 'approved_for_simulation', label: '4. Approved' },
  { key: 'simulated_submitted', label: '5. Simulated' },
  { key: 'acknowledged', label: '6. Acknowledged' },
  { key: 'response_received', label: '7. Response' },
  { key: 'action_taken', label: '8. Action Taken' },
  { key: 'rejected', label: '8b. Rejected' },
  { key: 'escalation_required', label: '9. Escalation' },
  { key: 'closed', label: '10. Closed' }
];

async function loadCaseSubmissions(caseId) {
  try {
    const res = await apiRequest(`/api/submissions/cases/${caseId}`);
    const submissions = res.data;

    const select = document.getElementById('caseSubmissionsSelect');
    const container = document.getElementById('activeSubmissionContainer');
    const noSubState = document.getElementById('noSubmissionsState');

    if (!submissions || submissions.length === 0) {
      select.innerHTML = '<option value="">No submissions created yet</option>';
      select.disabled = true;
      container.classList.add('hidden');
      noSubState.classList.remove('hidden');
      activeSubmissionId = null;
      activeSubmissionData = null;
      return;
    }

    select.disabled = false;
    select.innerHTML = submissions
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === activeSubmissionId ? 'selected' : ''}>[${s.status.toUpperCase()}] ${escapeHtml(s.platform_id)} (${escapeHtml(s.playbook_id)}) - v${s.packet_version}</option>`
      )
      .join('');

    container.classList.remove('hidden');
    noSubState.classList.add('hidden');

    const selectedSubId = activeSubmissionId && submissions.some((s) => s.id === activeSubmissionId)
      ? activeSubmissionId
      : submissions[0].id;

    select.value = selectedSubId;
    await loadSubmissionDetail(selectedSubId);
  } catch (err) {
    console.error('Failed to load case submissions:', err);
  }
}

async function loadSubmissionDetail(submissionId) {
  try {
    activeSubmissionId = submissionId;
    const res = await apiRequest(`/api/submissions/${submissionId}`);
    const { submission: sub, approvals, responses } = res.data;
    activeSubmissionData = res.data;

    // Status Badge & Platform Reference
    const statusBadge = document.getElementById('subStatusBadge');
    statusBadge.textContent = sub.status.toUpperCase().replace(/_/g, ' ');
    statusBadge.className = `text-xs font-mono font-bold px-2 py-0.5 rounded border ${SUBMISSION_STATUS_STYLES[sub.status] || ''}`;

    const refElem = document.getElementById('subPlatformRefId');
    refElem.textContent = sub.platform_reference_number || 'None (Unacknowledged)';

    // Workflow Stepper
    renderSubmissionWorkflowSteps(sub.status);

    // Cryptographic Packet Hash Integrity Check
    const hashDisplay = document.getElementById('subPacketHashDisplay');
    hashDisplay.textContent = sub.packet_hash;

    const tamperBadge = document.getElementById('subPacketTamperBadge');
    const hasHashMismatch = approvals.some((a) => a.packet_hash && a.packet_hash !== sub.packet_hash);
    if (hasHashMismatch) {
      tamperBadge.textContent = 'TAMPER WARNING / HASH MISMATCH';
      tamperBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold animate-pulse';
    } else {
      tamperBadge.textContent = 'VERIFIED PACKET HASH';
      tamperBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold';
    }

    // Multi-faceted Approvals Matrix
    renderApprovalsMatrix(sub, approvals);

    // Dry-run simulation control
    const simBtn = document.getElementById('btnDispatchSimulation');
    const simBox = document.getElementById('simulationResultBox');
    if (sub.status === 'approved_for_simulation') {
      simBtn.disabled = false;
      simBtn.textContent = 'Simulate Platform Submission';
      simBtn.className = 'px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow cursor-pointer';
    } else if (['simulated_submitted', 'acknowledged', 'response_received', 'action_taken', 'rejected', 'closed'].includes(sub.status)) {
      simBtn.disabled = true;
      simBtn.textContent = '✓ Submission Already Simulated';
      simBtn.className = 'px-4 py-1.5 bg-slate-800 text-slate-400 rounded text-xs font-semibold border border-slate-700 cursor-not-allowed';
      if (sub.platform_reference_number) {
        simBox.innerHTML = `<div>Simulated Reference ID: <span class="text-emerald-400 font-bold">${escapeHtml(sub.platform_reference_number)}</span></div><div class="text-[11px] text-slate-400 mt-0.5">Mode: Deterministic Local Dry-Run Adapter (Zero network calls)</div>`;
        simBox.classList.remove('hidden');
      }
    } else {
      simBtn.disabled = true;
      simBtn.textContent = 'Awaiting Required Approvals';
      simBtn.className = 'px-4 py-1.5 bg-slate-800 text-slate-500 rounded text-xs font-medium border border-slate-700 cursor-not-allowed';
      simBox.classList.add('hidden');
    }

    // Render Grievance Responses
    renderSubmissionResponses(responses);

    // Markdown & JSON Previews
    document.getElementById('subMarkdownNoticeView').textContent = sub.packet_markdown || 'No markdown notice generated.';
    document.getElementById('subCanonicalJsonView').textContent = sub.packet_payload_json || '{}';

    document.getElementById('btnCopyNoticeMarkdown').onclick = () => {
      navigator.clipboard.writeText(sub.packet_markdown);
      alert('Statutory notice copied to clipboard.');
    };

    document.getElementById('btnCopySubPacketJson').onclick = () => {
      navigator.clipboard.writeText(sub.packet_payload_json);
      alert('Canonical JSON copied to clipboard.');
    };
  } catch (err) {
    console.error('Failed to load submission detail:', err);
  }
}

function renderSubmissionWorkflowSteps(currentStatus) {
  const container = document.getElementById('submissionWorkflowSteps');
  if (!container) return;

  const activeIndex = SUBMISSION_WORKFLOW_STEPS.findIndex((s) => s.key === currentStatus);

  container.innerHTML = SUBMISSION_WORKFLOW_STEPS.slice(0, 6)
    .map((step, idx) => {
      const isPast = activeIndex >= idx;
      const isCurrent = step.key === currentStatus;
      const color = isCurrent
        ? 'bg-indigo-600 text-white font-bold'
        : isPast
        ? 'bg-slate-800 text-slate-300'
        : 'bg-slate-900 text-slate-600';
      return `<div class="p-1.5 rounded border border-slate-800 ${color}">${escapeHtml(step.label)}</div>`;
    })
    .join('');
}

function renderApprovalsMatrix(submission, approvals) {
  const container = document.getElementById('approvalFacetsContainer');
  if (!container) return;

  const facets = [
    { key: 'evidence_sufficiency', label: 'Evidence Sufficiency', roles: 'Analyst, Manager, Legal' },
    { key: 'legal_sufficiency', label: 'Legal Sufficiency', roles: 'Legal Reviewer (Strict)' },
    { key: 'platform_route_selection', label: 'Route Selection', roles: 'Case Manager, Legal' },
    { key: 'simulated_submission', label: 'Simulation Dispatch', roles: 'Case Manager, Legal' }
  ];

  container.innerHTML = facets
    .map((facet) => {
      const approval = approvals.find((a) => a.approval_facet === facet.key);
      const isApproved = approval && approval.decision === 'approved';
      const isRejected = approval && approval.decision === 'rejected';

      const statusBadge = isApproved
        ? '<span class="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">APPROVED</span>'
        : isRejected
        ? '<span class="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold">REJECTED</span>'
        : '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">PENDING</span>';

      return `
        <div class="p-3 bg-slate-900 rounded border border-slate-800 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-200 text-xs">${escapeHtml(facet.label)}</span>
            ${statusBadge}
          </div>
          <div class="text-[10px] text-slate-400">Role: ${escapeHtml(facet.roles)}</div>
          ${
            approval
              ? `<div class="text-[10px] text-slate-300 truncate">By: <span class="text-indigo-300 font-mono">${escapeHtml(approval.approver_user_id)}</span></div>
                 <div class="text-[10px] text-slate-400 truncate" title="${escapeHtml(approval.decision_reason)}">${escapeHtml(approval.decision_reason)}</div>
                 <div class="text-[9px] text-slate-500 font-mono">${new Date(approval.approved_at).toLocaleTimeString('en-IN')}</div>`
              : '<div class="text-[10px] text-slate-600 italic">Sign-off required prior to simulation</div>'
          }
        </div>
      `;
    })
    .join('');
}

function renderSubmissionResponses(responses) {
  const list = document.getElementById('subResponsesList');
  if (!list) return;

  if (!responses || responses.length === 0) {
    list.innerHTML = '<div class="p-4 text-center text-slate-500">No platform responses recorded yet. Click <strong>+ Record Ack</strong> or <strong>+ Record Decision</strong> when received.</div>';
    return;
  }

  list.innerHTML = responses
    .map((r) => `
      <div class="p-2.5 bg-slate-900/60 rounded border border-slate-800 space-y-1">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono uppercase font-bold">
              ${escapeHtml(r.response_type.replace(/_/g, ' '))}
            </span>
            <span class="text-slate-200 font-medium text-xs">${escapeHtml(formatCategory(r.response_category))}</span>
          </div>
          <span class="text-[10px] text-slate-500 font-mono">${new Date(r.received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
        </div>
        ${r.platform_reference_number ? `<div class="text-[11px] text-slate-400">Reference: <span class="font-mono text-indigo-400">${escapeHtml(r.platform_reference_number)}</span></div>` : ''}
        ${r.takedown_result ? `<div class="text-[11px] text-slate-300">Takedown Action: <strong class="text-emerald-400">${escapeHtml(r.takedown_result.toUpperCase())}</strong></div>` : ''}
        ${r.rejection_reason ? `<div class="text-[11px] text-rose-300">Rejection Note: ${escapeHtml(r.rejection_reason)}</div>` : ''}
        ${r.operator_notes ? `<div class="text-[11px] text-slate-400 italic">"${escapeHtml(r.operator_notes)}"</div>` : ''}
      </div>
    `)
    .join('');
}

// ----------------------------------------------------------------------------
// Platform Registry & Playbooks Rendering
// ----------------------------------------------------------------------------

async function loadPlatformsAndPlaybooks() {
  try {
    const [platRes, playRes] = await Promise.all([
      apiRequest('/api/platforms'),
      apiRequest('/api/playbooks')
    ]);

    allPlatforms = platRes.data;
    allPlaybooks = playRes.data;

    renderPlatforms(allPlatforms);
    renderPlaybooks(allPlaybooks);
    populatePlatformDropdowns(allPlatforms, allPlaybooks);
  } catch (err) {
    console.error('Failed to load platforms/playbooks:', err);
  }
}

function populatePlatformDropdowns(platforms, playbooks) {
  const subPlat = document.getElementById('newSubPlatformSelect');
  if (subPlat) {
    subPlat.innerHTML = platforms
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.display_name || p.id)}</option>`)
      .join('');
  }

  const subPb = document.getElementById('newSubPlaybookSelect');
  if (subPb) {
    subPb.innerHTML = playbooks
      .map((pb) => `<option value="${pb.id}">${escapeHtml(pb.title || pb.display_name || pb.slug)} (${pb.expected_response_window_hours || pb.sla_response_hours || 72}h)</option>`)
      .join('');
  }

  const obsPlat = document.getElementById('obsPlatformSelect');
  if (obsPlat) {
    obsPlat.innerHTML = '<option value="">Auto-Detect / Web</option>' + platforms
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.display_name || p.id)}</option>`)
      .join('');
  }

  const polPlat = document.getElementById('policyPlatformSelect');
  if (polPlat) {
    polPlat.innerHTML = platforms
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.display_name || p.id)}</option>`)
      .join('');
  }
}

function renderPlatforms(platforms) {
  const container = document.getElementById('platformsContainer');
  if (!container) return;

  container.innerHTML = platforms
    .map((p) => {
      const displayName = p.name || p.display_name || 'Platform';
      const code = p.slug || p.platform_code || p.id;
      const jurisdiction = p.country_or_jurisdiction || 'IN-Intermediary';
      const grievanceContact = p.grievance_contact_route || p.grievance_email || 'grievance@intermediary.example';
      const policyVersion = p.current_version ? `v${p.current_version}` : (p.policy_version || 'v1');
      const policyUrl = p.impersonation_policy_url || p.portal_url || '';
      const escalation = p.escalation_route || 'Rule 3A Grievance Appellate Committee (GAC)';
      const supportedCategories = Array.isArray(p.supported_complaint_categories) ? p.supported_complaint_categories : [];
      const slaResponseHours = p.expected_response_window_hours || 72;
      const slaAckHours = p.expected_acknowledgement_window_hours || 24;

      let designationTitle = `${displayName} Grievance Redressal Office`;
      if (code === 'generic_web') {
        designationTitle = 'Registrar & Host Abuse Redressal Desk';
      } else if (code === 'telegram') {
        designationTitle = 'Telegram Abuse & Nodal Redressal Channel';
      } else if (code === 'x') {
        designationTitle = 'X Resident Grievance Officer (India)';
      } else if (code === 'youtube') {
        designationTitle = 'YouTube Nodal Grievance Redressal (India)';
      } else if (code === 'meta') {
        designationTitle = 'Meta India Grievance Officer';
      } else if (code === 'instagram') {
        designationTitle = 'Instagram Grievance Officer (India)';
      } else if (code === 'linkedin') {
        designationTitle = 'LinkedIn India Grievance Redressal Officer';
      }

      return `
        <div class="p-4 bg-slate-900 rounded border border-slate-800 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <div class="font-bold text-slate-100 text-sm flex items-center gap-2">
              <span>${escapeHtml(displayName)}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">${escapeHtml(code)}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-semibold">
                SLA: ${slaResponseHours}h
              </span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold uppercase">
                ${escapeHtml(jurisdiction)}
              </span>
            </div>
          </div>

          <div class="p-2.5 bg-slate-950 rounded border border-slate-800/80 space-y-1">
            <div class="font-semibold text-slate-200 text-[11px]">${escapeHtml(designationTitle)}</div>
            <div class="text-slate-400 text-[10px]">Statutory Contact under IT Rules 2021 / Applicable Framework</div>
            <div class="text-indigo-400 font-mono text-[11px]">${escapeHtml(grievanceContact)}</div>
            <div class="text-slate-500 text-[10px]">Escalation: ${escapeHtml(escalation)}</div>
            <div class="text-[10px] text-slate-400 pt-0.5 flex gap-3">
              <span>Ack SLA: <strong class="text-slate-200 font-mono">${slaAckHours}h</strong></span>
              <span>Resolution SLA: <strong class="text-amber-300 font-mono">${slaResponseHours}h</strong></span>
            </div>
          </div>

          <div class="flex flex-wrap gap-1">
            ${supportedCategories.slice(0, 3).map((c) => `<span class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400 font-mono">${escapeHtml(c)}</span>`).join('')}
          </div>

          <div class="flex items-center justify-between text-[11px] pt-1">
            <span class="text-slate-400">Policy Version: <strong class="text-slate-200 font-mono">${escapeHtml(policyVersion)}</strong></span>
            ${policyUrl ? `<a href="${escapeHtml(policyUrl)}" target="_blank" class="text-indigo-400 hover:underline">Grievance Portal ↗</a>` : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderPlaybooks(playbooks) {
  const container = document.getElementById('playbooksContainer');
  if (!container) return;

  container.innerHTML = playbooks
    .map((pb) => {
      const title = pb.title || pb.display_name || 'Playbook';
      const hours = pb.expected_response_window_hours || pb.sla_response_hours || 72;
      const desc = pb.description || pb.guidance_note || '';
      const category = pb.incident_category || 'general';
      const platforms = Array.isArray(pb.applicable_platforms) ? pb.applicable_platforms : [];
      let escalationText = 'Standard Statutory Escalation';
      if (Array.isArray(pb.escalation_rules) && pb.escalation_rules.length > 0) {
        escalationText = pb.escalation_rules[0];
      } else if (typeof pb.escalation_rules === 'string') {
        escalationText = pb.escalation_rules;
      } else if (typeof pb.escalation_route === 'string') {
        escalationText = pb.escalation_route;
      }

      return `
        <div class="p-4 bg-slate-900 rounded border border-slate-800 space-y-2 text-xs flex flex-col justify-between">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-100">${escapeHtml(title)}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold">${hours}h SLA</span>
            </div>
            <div class="text-slate-400 text-[11px]">${escapeHtml(desc)}</div>
            <div class="flex flex-wrap gap-1">
              <span class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-indigo-300 font-mono">${escapeHtml(category)}</span>
              ${platforms.map((p) => `<span class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-400 font-mono">${escapeHtml(p)}</span>`).join('')}
            </div>
          </div>
          <div class="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
            <span class="truncate max-w-[200px]" title="${escapeHtml(escalationText)}">Escalation: <strong class="text-amber-400">${escapeHtml(escalationText)}</strong></span>
            <span>Req Legal: <strong class="text-slate-200 font-mono">${pb.requires_legal_review ? 'Yes' : 'No'}</strong></span>
          </div>
        </div>
      `;
    })
    .join('');
}

// ----------------------------------------------------------------------------
// Case Escalations Management
// ----------------------------------------------------------------------------

async function loadEscalations() {
  try {
    const res = await apiRequest('/api/escalations');
    allEscalations = res.data;

    const countElem = document.getElementById('sidebarEscalationCount');
    if (countElem) {
      countElem.textContent = allEscalations.filter((e) => e.status === 'open' || e.status === 'in_progress').length;
    }

    renderEscalationsTable(allEscalations);
  } catch (err) {
    console.error('Failed to load escalations:', err);
  }
}

function renderEscalationsTable(escalations) {
  const tbody = document.getElementById('escalationsTableBody');
  if (!tbody) return;

  if (escalations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500">No case escalations active. Incidents proceeding normally within SLA.</td></tr>';
    return;
  }

  tbody.innerHTML = escalations
    .map((esc) => {
      const sevStyle =
        esc.severity === 'critical_statutory'
          ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse font-bold'
          : esc.severity === 'urgent'
          ? 'bg-amber-950 text-amber-300 border-amber-800 font-bold'
          : 'bg-blue-950 text-blue-300 border-blue-800';

      const statusStyle =
        esc.status === 'resolved'
          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
          : 'bg-indigo-950 text-indigo-300 border-indigo-800';

      return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
          <td class="py-2.5 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border uppercase font-mono ${sevStyle}">
              ${escapeHtml(esc.severity.replace(/_/g, ' '))}
            </span>
          </td>
          <td class="py-2.5 px-3 font-semibold text-slate-200">
            ${escapeHtml(formatCategory(esc.escalation_trigger))}
          </td>
          <td class="py-2.5 px-3 font-mono text-indigo-400">
            <button onclick="openCaseDetail('${esc.case_id}')" class="hover:underline">
              ${escapeHtml(esc.case_id)}
            </button>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px] font-mono font-bold">
              ${escapeHtml(esc.recommended_action.replace(/_/g, ' ').toUpperCase())}
            </span>
          </td>
          <td class="py-2.5 px-3 text-slate-300">
            ${escapeHtml(esc.target_authority_or_court || 'Appellate Forum')}
          </td>
          <td class="py-2.5 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${statusStyle}">
              ${escapeHtml(esc.status.toUpperCase())}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right">
            ${
              esc.status !== 'resolved'
                ? `<button onclick="handleResolveEscalation('${esc.id}')" class="text-xs text-indigo-400 hover:text-indigo-300 underline">
                     Resolve
                   </button>`
                : '<span class="text-slate-500 text-[10px]">Closed</span>'
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

window.handleResolveEscalation = async function (escalationId) {
  const notes = prompt('Enter resolution summary / outcome notes:');
  if (!notes || !notes.trim()) return;

  try {
    await apiRequest(`/api/escalations/${escalationId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_notes: notes.trim() })
    });
    await loadEscalations();
  } catch (err) {
    alert('Failed to resolve escalation: ' + err.message);
  }
};

// ----------------------------------------------------------------------------
// Related Content & Re-Upload Tracker
// ----------------------------------------------------------------------------

async function loadReuploads() {
  try {
    const res = await apiRequest('/api/re-uploads');
    allObservations = res.data;

    const countElem = document.getElementById('sidebarReuploadCount');
    if (countElem) {
      countElem.textContent = allObservations.length;
    }

    renderReuploadsTable(allObservations);
  } catch (err) {
    console.error('Failed to load re-uploads:', err);
  }
}

function renderReuploadsTable(observations) {
  const tbody = document.getElementById('reuploadsTableBody');
  if (!tbody) return;

  if (observations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500">No related content or re-upload observations registered yet.</td></tr>';
    return;
  }

  tbody.innerHTML = observations
    .map((obs) => {
      const relStyle =
        obs.relationship === 'exact_reupload'
          ? 'bg-rose-950 text-rose-300 border-rose-800 font-bold'
          : obs.relationship === 'modified_reupload'
          ? 'bg-amber-950 text-amber-300 border-amber-800'
          : 'bg-indigo-950 text-indigo-300 border-indigo-800';

      const statStyle =
        obs.status === 'confirmed_infringing'
          ? 'bg-rose-950 text-rose-300 border-rose-800 font-bold'
          : obs.status === 'removed'
          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
          : 'bg-slate-800 text-slate-300 border-slate-700';

      return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
          <td class="py-2.5 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border uppercase font-mono ${statStyle}">
              ${escapeHtml(obs.status.replace(/_/g, ' '))}
            </span>
          </td>
          <td class="py-2.5 px-3 max-w-sm">
            <div class="text-slate-100 font-medium truncate">${escapeHtml(obs.observed_url)}</div>
            <div class="text-[10px] text-emerald-400 font-mono truncate mt-0.5" title="Clean Normalized URL (Tracking stripped)">
              Clean: ${escapeHtml(obs.normalized_url)}
            </div>
          </td>
          <td class="py-2.5 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-mono ${relStyle}">
              ${escapeHtml(obs.relationship.replace(/_/g, ' ').toUpperCase())}
            </span>
          </td>
          <td class="py-2.5 px-3 text-slate-300">
            ${escapeHtml(obs.platform_id || 'Web / Social')}
          </td>
          <td class="py-2.5 px-3 font-mono font-bold text-slate-200">
            ${(obs.similarity_score * 100).toFixed(0)}%
          </td>
          <td class="py-2.5 px-3 text-slate-300 truncate max-w-xs">
            ${escapeHtml(obs.target_entity)}
          </td>
          <td class="py-2.5 px-3 text-right space-x-2">
            <button onclick="handleUpdateObservationStatus('${obs.id}', 'confirmed_infringing')" class="text-xs text-rose-400 hover:text-rose-300 underline">
              Confirm
            </button>
            <button onclick="handleUpdateObservationStatus('${obs.id}', 'removed')" class="text-xs text-emerald-400 hover:text-emerald-300 underline">
              Mark Removed
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.handleUpdateObservationStatus = async function (obsId, status) {
  try {
    await apiRequest(`/api/re-uploads/${obsId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
    await loadReuploads();
  } catch (err) {
    alert('Failed to update observation status: ' + err.message);
  }
};

// ----------------------------------------------------------------------------
// Task Queue Rendering (Phase 3)
// ----------------------------------------------------------------------------

async function loadTasks() {
  try {
    const res = await apiRequest('/api/workflow/tasks');
    const tasks = res.data;
    document.getElementById('sidebarTaskCount').textContent = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
    renderTasksTable(tasks);
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

function renderTasksTable(tasks) {
  const tbody = document.getElementById('tasksTableBody');
  if (tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-8 text-slate-500">
          No workflow tasks currently pending.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tasks
    .map((t) => {
      const priorityStyle =
        t.priority === 'p1' ? 'text-rose-400 bg-rose-950/60 border-rose-900' :
        t.priority === 'p2' ? 'text-amber-400 bg-amber-950/60 border-amber-900' :
        'text-blue-400 bg-blue-950/60 border-blue-900';

      const statusStyle =
        t.status === 'completed' ? 'text-emerald-300 bg-emerald-950 border-emerald-800' :
        t.status === 'in_progress' ? 'text-amber-300 bg-amber-950 border-amber-800' :
        'text-indigo-300 bg-indigo-950 border-indigo-800';

      return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
          <td class="py-3 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${priorityStyle}">
              ${escapeHtml(t.priority)}
            </span>
          </td>
          <td class="py-3 px-3 font-mono text-xs text-indigo-400">${escapeHtml(t.task_type)}</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-300">${escapeHtml(t.case_id)}</td>
          <td class="py-3 px-3 text-xs text-slate-300 max-w-sm">${escapeHtml(t.creation_reason)}</td>
          <td class="py-3 px-3 text-xs text-slate-400">${escapeHtml(t.assigned_role)}</td>
          <td class="py-3 px-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-mono font-bold ${statusStyle}">
              ${escapeHtml(t.status.toUpperCase())}
            </span>
          </td>
          <td class="py-3 px-3 text-right space-x-1.5">
            ${t.status === 'pending' ? `
              <button onclick="acknowledgeTask('${t.id}')" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] rounded border border-slate-700">
                Acknowledge
              </button>
            ` : ''}
            ${t.status !== 'completed' && t.status !== 'cancelled' ? `
              <button onclick="completeTask('${t.id}')" class="px-2 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-[11px] rounded border border-emerald-800">
                Complete
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    })
    .join('');
}

window.acknowledgeTask = async function (taskId) {
  try {
    await apiRequest(`/api/workflow/tasks/${taskId}/acknowledge`, { method: 'POST' });
    await loadTasks();
  } catch (err) {
    alert('Failed to acknowledge task: ' + err.message);
  }
};

window.completeTask = async function (taskId) {
  const reason = prompt('Provide resolution summary for completing this task:');
  if (!reason || reason.trim().length < 3) return;

  try {
    await apiRequest(`/api/workflow/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completion_reason: reason.trim() })
    });
    await loadTasks();
  } catch (err) {
    alert('Failed to complete task: ' + err.message);
  }
};

function renderNotes(notes) {
  const container = document.getElementById('modalNotesList');
  if (notes.length === 0) {
    container.innerHTML = '<div class="text-slate-500 py-3 text-center">No internal notes recorded yet.</div>';
    return;
  }

  container.innerHTML = notes
    .map((n) => `
      <div class="py-2">
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-medium text-slate-300">${escapeHtml(n.author_name)}</span>
          <span class="font-mono-num">${new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="mt-1 text-slate-200 text-xs">${escapeHtml(n.content)}</div>
      </div>
    `)
    .join('');
}

function renderHistory(history) {
  const container = document.getElementById('modalHistoryTimeline');
  if (history.length === 0) {
    container.innerHTML = '<div class="text-slate-500 py-3 text-center">No status transitions recorded.</div>';
    return;
  }

  container.innerHTML = history
    .map((h) => `
      <div class="relative pl-4 pb-3 border-l border-slate-800 last:border-l-0 text-xs">
        <div class="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-slate-700 border border-slate-900"></div>
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span class="font-mono">${escapeHtml(h.from_status)} &rarr; ${escapeHtml(h.to_status)}</span>
          <span class="font-mono-num">${new Date(h.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="text-slate-300 mt-0.5">${escapeHtml(h.reason)}</div>
        <div class="text-[10px] text-slate-500 mt-0.5">By: ${escapeHtml(h.actor_email)}</div>
      </div>
    `)
    .join('');
}

// ----------------------------------------------------------------------------
// Evidence Locker Operations (Phase 2)
// ----------------------------------------------------------------------------

async function loadCaseEvidence(caseId) {
  try {
    const res = await apiRequest(`/api/cases/${caseId}/evidence`);
    const items = res.data;
    renderEvidenceTable(items);
    document.getElementById('modalEvidenceCountBadge').textContent = items.length;
  } catch (err) {
    console.error('Failed to load evidence:', err);
  }
}

function renderEvidenceTable(items) {
  const tbody = document.getElementById('evidenceTableBody');
  const emptyState = document.getElementById('evidenceEmptyState');

  if (items.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  tbody.innerHTML = items
    .map((item) => {
      const statusStyle = EVIDENCE_STATUS_STYLES[item.status] || 'bg-slate-800 text-slate-300';
      const sensitivityStyle = SENSITIVITY_STYLES[item.sensitivity_level] || 'bg-slate-800 text-slate-300';
      const isHold = Boolean(item.legal_hold);
      const isQuarantine = item.status === 'quarantined' || Boolean(item.is_quarantined);

      return `
        <tr class="hover:bg-slate-900/50 cursor-pointer transition-colors border-b border-slate-800/60" onclick="openEvidenceInspect('${item.id}')">
          <td class="py-2.5 px-3">
            <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">${item.storage_key ? 'FILE' : 'URL'}</span>
          </td>
          <td class="py-2.5 px-3 font-medium text-slate-200 max-w-xs truncate">${escapeHtml(item.file_name)}</td>
          <td class="py-2.5 px-3 font-mono text-[11px] text-emerald-400">${item.sha256 ? item.sha256.substring(0, 16) + '...' : '--'}</td>
          <td class="py-2.5 px-3 text-slate-400 font-mono-num text-[11px]">${formatBytes(item.byte_size)}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono border ${statusStyle}">${item.status.toUpperCase()}</span>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono border ${sensitivityStyle}">${item.sensitivity_level.toUpperCase()}</span>
          </td>
          <td class="py-2.5 px-3">
            ${isHold ? '<span class="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold">HOLD</span>' : '<span class="text-slate-600 text-[11px]">--</span>'}
          </td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="event.stopPropagation(); openEvidenceInspect('${item.id}')" class="text-xs text-indigo-400 hover:text-indigo-300 font-medium">Inspect</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.openEvidenceInspect = async function (evidenceId) {
  activeEvidenceId = evidenceId;
  try {
    const res = await apiRequest(`/api/evidence/${evidenceId}`);
    const { item, access_events } = res.data;
    currentEvidenceItem = item;

    document.getElementById('inspectEvidenceTitle').textContent = item.file_name;
    document.getElementById('inspectSafeName').textContent = item.file_name;
    document.getElementById('inspectOriginalName').textContent = item.original_filename || '--';
    document.getElementById('inspectSha256').textContent = item.sha256 || 'None (Unverified)';
    document.getElementById('inspectSizeMime').textContent = `${formatBytes(item.byte_size)} (${item.mime_type || 'unknown'})`;
    document.getElementById('inspectUploadedBy').textContent = `${item.uploaded_by} on ${new Date(item.created_at).toLocaleString('en-IN')}`;

    const statusBadge = document.getElementById('inspectStatusBadge');
    statusBadge.textContent = item.status.toUpperCase();
    statusBadge.className = `px-2 py-0.5 rounded font-mono text-[10px] border ${EVIDENCE_STATUS_STYLES[item.status] || ''}`;

    const sensBadge = document.getElementById('inspectSensitivityBadge');
    sensBadge.textContent = item.sensitivity_level.toUpperCase();
    sensBadge.className = `px-2 py-0.5 rounded font-mono text-[10px] border ${SENSITIVITY_STYLES[item.sensitivity_level] || ''}`;

    const expiryElem = document.getElementById('inspectRetentionExpiry');
    expiryElem.textContent = item.retention_expires_at
      ? new Date(item.retention_expires_at).toLocaleDateString('en-IN')
      : 'Indefinite';

    const holdBadge = document.getElementById('inspectHoldBadge');
    const holdBtn = document.getElementById('inspectHoldBtn');
    if (item.legal_hold) {
      holdBadge.classList.remove('hidden');
      holdBtn.textContent = 'Release Legal Hold';
    } else {
      holdBadge.classList.add('hidden');
      holdBtn.textContent = 'Place Legal Hold';
    }

    const qBanner = document.getElementById('inspectQuarantineBanner');
    const qBtn = document.getElementById('inspectQuarantineBtn');
    if (item.status === 'quarantined' || Boolean(item.is_quarantined)) {
      qBanner.classList.remove('hidden');
      qBtn.textContent = 'Unquarantine';
    } else {
      qBanner.classList.add('hidden');
      qBtn.textContent = 'Quarantine';
    }

    const previewBox = document.getElementById('inspectPreviewBox');
    if (item.status === 'quarantined' || Boolean(item.is_quarantined)) {
      previewBox.innerHTML = '<div class="text-purple-300 font-medium">⚠️ Raw asset preview suppressed under quarantine policy.</div>';
    } else if (item.source_url) {
      previewBox.innerHTML = `
        <div class="text-left w-full space-y-2">
          <div class="text-slate-400">Captured Source URL:</div>
          <a href="${item.source_url}" target="_blank" class="text-indigo-400 break-all underline">${item.source_url}</a>
        </div>
      `;
    } else if (item.mime_type?.startsWith('image/')) {
      previewBox.innerHTML = '<div class="text-slate-400 text-xs">Cryptographically secured image preserved in isolated storage vault.</div>';
    } else {
      previewBox.innerHTML = `<div class="text-slate-400 text-xs">Binary artifact (${escapeHtml(item.mime_type || 'octet-stream')}) stored in tamper-evident locker.</div>`;
    }

    const eventsList = document.getElementById('inspectAccessEventsList');
    if (access_events.length === 0) {
      eventsList.innerHTML = '<div class="text-slate-500 py-2 text-center">No access events recorded.</div>';
    } else {
      eventsList.innerHTML = access_events
        .map((ev) => `
          <div class="py-1 flex items-center justify-between text-[11px]">
            <div>
              <span class="font-bold text-slate-300">${escapeHtml(ev.action)}</span>
              <span class="text-slate-500">by ${escapeHtml(ev.actor_email)}</span>
            </div>
            <div class="text-slate-400">${new Date(ev.created_at).toLocaleString('en-IN')}</div>
          </div>
        `)
        .join('');
    }

    const approveBtn = document.getElementById('inspectApproveDeleteBtn');
    if (item.status === 'deletion_requested' && (currentUserRole === 'org_owner' || currentUserRole === 'system_admin')) {
      approveBtn.classList.remove('hidden');
    } else {
      approveBtn.classList.add('hidden');
    }

    document.getElementById('evidenceInspectModal').classList.remove('hidden');
  } catch (err) {
    alert('Failed to inspect evidence: ' + err.message);
  }
};

// ----------------------------------------------------------------------------
// Audit Ledger
// ----------------------------------------------------------------------------

async function loadAuditEvents() {
  try {
    const res = await apiRequest('/api/audit-events');
    const events = res.data;
    renderAuditTable(events);
  } catch (err) {
    console.error('Failed to load audit events:', err);
  }
}

function renderAuditTable(events) {
  const tbody = document.getElementById('auditTableBody');
  if (events.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-500">Audit ledger is currently empty.</td></tr>';
    return;
  }

  tbody.innerHTML = events
    .map((e) => `
      <tr class="hover:bg-slate-800/40 transition-colors border-b border-slate-800/60">
        <td class="py-2.5 px-3 text-slate-400">${new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
        <td class="py-2.5 px-3 text-slate-200 font-medium">${escapeHtml(e.actor_email)}</td>
        <td class="py-2.5 px-3 text-indigo-400 font-mono">${escapeHtml(e.action)}</td>
        <td class="py-2.5 px-3 text-slate-400 font-mono text-[11px]">${escapeHtml(e.resource_type)}:${escapeHtml(e.resource_id.substring(0, 8))}...</td>
        <td class="py-2.5 px-3 text-slate-300 max-w-xs truncate text-[11px]">${escapeHtml(JSON.stringify(e.details))}</td>
        <td class="py-2.5 px-3 text-slate-500 font-mono text-[11px]">${escapeHtml(e.ip_address || 'internal')}</td>
      </tr>
    `)
    .join('');
}

// ----------------------------------------------------------------------------
// Modal Setup & Event Listeners
// ----------------------------------------------------------------------------

function setupModals() {
  document.getElementById('closeDetailModalBtn').addEventListener('click', () => {
    document.getElementById('caseDetailModal').classList.add('hidden');
  });

  document.getElementById('closeInspectModalBtn').addEventListener('click', () => {
    document.getElementById('evidenceInspectModal').classList.add('hidden');
  });

  // Re-evaluate readiness button
  document.getElementById('btnReevaluateReadiness').addEventListener('click', async () => {
    if (!activeCaseId) return;
    await loadReadinessInfo(activeCaseId);
  });

  // Phase 3 Approval State Transition Handlers
  document.getElementById('btnReqLegalReview').addEventListener('click', async () => {
    if (!activeCaseId) return;
    try {
      await apiRequest(`/api/cases/${activeCaseId}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          to_state: 'awaiting_legal_review',
          reason: 'Legal review formally requested prior to submission packet preparation.'
        })
      });
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      alert('Approval transition failed: ' + err.message);
    }
  });

  document.getElementById('btnApproveLegalReview').addEventListener('click', async () => {
    if (!activeCaseId) return;
    const reason = prompt('As legal counsel, provide approval rationale:');
    if (!reason || reason.trim().length < 3) return;

    try {
      await apiRequest(`/api/cases/${activeCaseId}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          to_state: 'legal_review_approved',
          reason: reason.trim()
        })
      });
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      alert('Legal approval failed: ' + err.message);
    }
  });

  document.getElementById('btnMarkReadyForSubmission').addEventListener('click', async () => {
    if (!activeCaseId) return;
    const reason = prompt('Provide case manager approval note for marking ready for submission:');
    if (!reason || reason.trim().length < 3) return;

    try {
      await apiRequest(`/api/cases/${activeCaseId}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          to_state: 'ready_for_submission',
          reason: reason.trim()
        })
      });
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      alert('Transition to ready_for_submission failed: ' + err.message);
    }
  });

  document.getElementById('btnRejectCase').addEventListener('click', async () => {
    if (!activeCaseId) return;
    const reason = prompt('Provide mandatory rejection justification (min 3 characters):');
    if (!reason || reason.trim().length < 3) return;

    try {
      await apiRequest(`/api/cases/${activeCaseId}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          to_state: 'rejected',
          reason: reason.trim()
        })
      });
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      alert('Rejection failed: ' + err.message);
    }
  });

  // Simulate Submission Dispatch
  document.getElementById('btnSimulateSubmissionDispatch').addEventListener('click', async () => {
    if (!activeCaseId) return;
    if (!confirm('Simulate dispatching the dry-run takedown notice packet to intermediary legal operations?')) return;

    try {
      await apiRequest(`/api/cases/${activeCaseId}/simulate-submission`, { method: 'POST' });
      alert('Submission simulation completed successfully. Packet status updated to simulated.');
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      alert('Submission simulation failed: ' + err.message);
    }
  });

  // Operational Status Transition
  document.getElementById('modalApplyStatusBtn').addEventListener('click', async () => {
    if (!activeCaseId) return;
    const nextStatus = document.getElementById('modalNextStatusSelect').value;
    const reason = document.getElementById('modalTransitionReason').value.trim();
    const errorDiv = document.getElementById('modalTransitionError');

    if (!reason || reason.length < 3) {
      errorDiv.textContent = 'A substantive transition reason (min 3 chars) is required.';
      errorDiv.classList.remove('hidden');
      return;
    }

    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/cases/${activeCaseId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ to_status: nextStatus, reason })
      });
      await openCaseDetail(activeCaseId);
      await loadCases();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Internal Note Submission
  document.getElementById('modalAddNoteBtn').addEventListener('click', async () => {
    if (!activeCaseId) return;
    const input = document.getElementById('modalNewNoteContent');
    const content = input.value.trim();
    if (!content) return;

    try {
      await apiRequest(`/api/cases/${activeCaseId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content, is_internal_only: true })
      });
      input.value = '';
      const res = await apiRequest(`/api/cases/${activeCaseId}`);
      renderNotes(res.data.notes);
    } catch (err) {
      alert('Failed to add note: ' + err.message);
    }
  });

  // File Upload Toggles
  document.getElementById('btnToggleUploadFile').addEventListener('click', () => {
    document.getElementById('uploadFilePanel').classList.remove('hidden');
    document.getElementById('addUrlPanel').classList.add('hidden');
  });
  document.getElementById('cancelUploadFileBtn').addEventListener('click', () => {
    document.getElementById('uploadFilePanel').classList.add('hidden');
  });
  document.getElementById('btnCancelUpload').addEventListener('click', () => {
    document.getElementById('uploadFilePanel').classList.add('hidden');
  });

  // Source URL Toggles
  document.getElementById('btnToggleAddUrl').addEventListener('click', () => {
    document.getElementById('addUrlPanel').classList.remove('hidden');
    document.getElementById('uploadFilePanel').classList.add('hidden');
  });
  document.getElementById('cancelAddUrlBtn').addEventListener('click', () => {
    document.getElementById('addUrlPanel').classList.add('hidden');
  });
  document.getElementById('btnCancelAddUrl').addEventListener('click', () => {
    document.getElementById('addUrlPanel').classList.add('hidden');
  });

  // File Drop Zone
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('evidenceFileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      document.getElementById('dropZonePrompt').classList.add('hidden');
      const selected = document.getElementById('dropZoneSelected');
      selected.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
      selected.classList.remove('hidden');
      if (!document.getElementById('uploadDisplayName').value) {
        document.getElementById('uploadDisplayName').value = file.name;
      }
    }
  });

  // File Upload Submission
  document.getElementById('uploadFileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeCaseId || !fileInput.files.length) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('safe_display_name', document.getElementById('uploadDisplayName').value.trim() || file.name);
    formData.append('sensitivity_level', document.getElementById('uploadSensitivity').value);

    const errorDiv = document.getElementById('uploadError');
    try {
      errorDiv.classList.add('hidden');
      const response = await fetch(`/api/cases/${activeCaseId}/evidence/upload`, {
        method: 'POST',
        headers: {
          'x-organization-id': currentOrgId,
          'x-user-id': currentUserId
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'Upload failed');

      document.getElementById('uploadFilePanel').classList.add('hidden');
      document.getElementById('uploadFileForm').reset();
      document.getElementById('dropZonePrompt').classList.remove('hidden');
      document.getElementById('dropZoneSelected').classList.add('hidden');
      await loadCaseEvidence(activeCaseId);
      await loadReadinessInfo(activeCaseId);
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Add Source URL Submission
  document.getElementById('addUrlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeCaseId) return;

    const payload = {
      source_url: document.getElementById('sourceUrlInput').value.trim(),
      safe_display_name: document.getElementById('sourceUrlDisplayName').value.trim(),
      sensitivity_level: document.getElementById('sourceUrlSensitivity').value,
      operator_notes: document.getElementById('sourceUrlNotes').value.trim() || undefined
    };

    const errorDiv = document.getElementById('addUrlError');
    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/cases/${activeCaseId}/evidence/url`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      document.getElementById('addUrlPanel').classList.add('hidden');
      document.getElementById('addUrlForm').reset();
      await loadCaseEvidence(activeCaseId);
      await loadReadinessInfo(activeCaseId);
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Download Evidence Asset with Mandatory Token
  document.getElementById('inspectDownloadBtn').addEventListener('click', async () => {
    if (!activeEvidenceId) return;
    try {
      const res = await apiRequest(`/api/evidence/${activeEvidenceId}/download-token`);
      const { download_token } = res.data;
      window.location.href = `/api/evidence/${activeEvidenceId}/download?token=${encodeURIComponent(download_token)}`;
    } catch (err) {
      alert('Failed to obtain download authorization token: ' + err.message);
    }
  });

  // Copy SHA-256 Digest
  document.getElementById('btnCopySha').addEventListener('click', () => {
    const sha = document.getElementById('inspectSha256').textContent;
    if (sha && sha !== '--') {
      navigator.clipboard.writeText(sha);
      alert('SHA-256 cryptographic digest copied to clipboard.');
    }
  });

  // Quarantine / Unquarantine
  document.getElementById('inspectQuarantineBtn').addEventListener('click', async () => {
    if (!activeEvidenceId || !currentEvidenceItem) return;
    const isQuarantined = currentEvidenceItem.status === 'quarantined' || Boolean(currentEvidenceItem.is_quarantined);
    const actionPrompt = isQuarantined
      ? 'Provide justification for removing asset from quarantine:'
      : 'Provide mandatory justification for quarantining this asset:';
    const reason = prompt(actionPrompt);
    if (!reason || !reason.trim()) return;

    try {
      const endpoint = isQuarantined
        ? `/api/evidence/${activeEvidenceId}/unquarantine`
        : `/api/evidence/${activeEvidenceId}/quarantine`;

      await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      await openEvidenceInspect(activeEvidenceId);
      await loadCaseEvidence(activeCaseId);
      await loadReadinessInfo(activeCaseId);
    } catch (err) {
      alert('Quarantine failed: ' + err.message);
    }
  });

  // Place / Release Legal Hold
  document.getElementById('inspectHoldBtn').addEventListener('click', async () => {
    if (!activeEvidenceId || !currentEvidenceItem) return;
    const isHoldActive = Boolean(currentEvidenceItem.legal_hold);
    const actionPrompt = isHoldActive
      ? 'Provide justification for releasing the legal hold:'
      : 'Provide justification for placing a preservation legal hold:';
    const reason = prompt(actionPrompt);
    if (!reason || !reason.trim()) return;

    try {
      const endpoint = isHoldActive
        ? `/api/evidence/${activeEvidenceId}/release-hold`
        : `/api/evidence/${activeEvidenceId}/legal-hold`;

      await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });

      await openEvidenceInspect(activeEvidenceId);
      await loadCaseEvidence(activeCaseId);
    } catch (err) {
      alert('Legal hold mutation failed: ' + err.message);
    }
  });

  // Deletion Request
  document.getElementById('inspectDeleteRequestBtn').addEventListener('click', async () => {
    if (!activeEvidenceId) return;
    const reason = prompt('Provide justification for requesting evidence deletion:');
    if (!reason || !reason.trim()) return;

    try {
      await apiRequest(`/api/evidence/${activeEvidenceId}/delete-request`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      await openEvidenceInspect(activeEvidenceId);
      await loadCaseEvidence(activeCaseId);
    } catch (err) {
      alert('Deletion request failed: ' + err.message);
    }
  });

  // Approve Deletion (Two-person rule)
  document.getElementById('inspectApproveDeleteBtn').addEventListener('click', async () => {
    if (!activeEvidenceId) return;
    const reason = prompt('As authorized counsel/owner, provide deletion confirmation:');
    if (!reason || !reason.trim()) return;

    try {
      await apiRequest(`/api/evidence/${activeEvidenceId}/approve-deletion`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      document.getElementById('evidenceInspectModal').classList.add('hidden');
      await loadCaseEvidence(activeCaseId);
      await loadReadinessInfo(activeCaseId);
    } catch (err) {
      alert('Deletion approval failed: ' + err.message);
    }
  });

  // New Structured Case Intake Modal Setup
  const newCaseModal = document.getElementById('newCaseModal');
  document.getElementById('openNewCaseModalBtn').addEventListener('click', () => {
    newCaseModal.classList.remove('hidden');
  });
  document.getElementById('closeNewCaseModalBtn').addEventListener('click', () => {
    newCaseModal.classList.add('hidden');
  });
  document.getElementById('cancelNewCaseBtn').addEventListener('click', () => {
    newCaseModal.classList.add('hidden');
  });

  // Court Order Checkbox Toggle
  document.getElementById('newHasCourtOrder').addEventListener('change', (e) => {
    const container = document.getElementById('courtOrderDetailsContainer');
    if (e.target.checked) {
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
  });

  document.getElementById('newCaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('newCaseError');

    const category = document.getElementById('newCategory').value;
    const factualBasis = document.getElementById('newFactualBasis').value.trim();
    const hasCourtOrder = document.getElementById('newHasCourtOrder').checked;
    const courtOrderDetails = document.getElementById('newCourtOrderDetails').value.trim();

    if (category === 'defamation_legal_escalation' && (!factualBasis || factualBasis.length < 15)) {
      errorDiv.textContent = 'Defamation claims require detailed factual basis narrative (min 15 characters).';
      errorDiv.classList.remove('hidden');
      return;
    }

    if (hasCourtOrder && (!courtOrderDetails || courtOrderDetails.length < 10)) {
      errorDiv.textContent = 'Must provide court/government order details (court name, case/order number, and date).';
      errorDiv.classList.remove('hidden');
      return;
    }

    const payload = {
      title: document.getElementById('newTitle').value.trim(),
      category: category,
      priority: document.getElementById('newPriority').value,
      target_entity: document.getElementById('newTargetEntity').value.trim(),
      target_entity_type: document.getElementById('newTargetEntityType').value,
      hosting_platform: document.getElementById('newPlatform').value.trim(),
      contested_url: document.getElementById('newContestedUrl').value.trim(),
      reported_by_name: document.getElementById('newReporterName').value.trim(),
      reported_by_email: document.getElementById('newReporterEmail').value.trim(),
      harm_type: document.getElementById('newHarmType').value,
      suspected_synthetic_media_type: document.getElementById('newSyntheticMediaType').value,
      impersonation_method: document.getElementById('newImpersonationMethod').value,
      involves_intimate_imagery: document.getElementById('newInvolvesIntimate').checked,
      has_court_or_government_order: hasCourtOrder,
      court_or_government_order_details: hasCourtOrder ? courtOrderDetails : null,
      factual_basis: factualBasis || null,
      declaration_confirmed: document.getElementById('newDeclarationConfirmed').checked,
      statutory_basis: [
        'IT Act 2000 Section 66D',
        'IT Rules 2021 Rule 3(1)(b)',
        'BNS 2023 Section 318(4)'
      ]
    };

    try {
      errorDiv.classList.add('hidden');
      await apiRequest('/api/cases', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      newCaseModal.classList.add('hidden');
      document.getElementById('newCaseForm').reset();
      await loadCases();
      await loadTasks();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // --------------------------------------------------------------------------
  // Phase 4 Modal & Control Listeners
  // --------------------------------------------------------------------------

  // Submission Draft Creation
  document.getElementById('btnCreateSubmissionDraft')?.addEventListener('click', async () => {
    if (!activeCaseId) return;
    const platformId = document.getElementById('newSubPlatformSelect')?.value;
    const playbookId = document.getElementById('newSubPlaybookSelect')?.value;
    if (!platformId) {
      alert('Please select a platform.');
      return;
    }
    try {
      const res = await apiRequest('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({
          case_id: activeCaseId,
          platform_id: platformId,
          playbook_id: playbookId || undefined
        })
      });
      activeSubmissionId = res.data.id;
      await loadCaseSubmissions(activeCaseId);
    } catch (err) {
      alert('Failed to create submission draft: ' + err.message);
    }
  });

  // Submission Selection Change
  document.getElementById('caseSubmissionsSelect')?.addEventListener('change', async (e) => {
    if (e.target.value) {
      await loadSubmissionDetail(e.target.value);
    }
  });

  // Dry-Run Simulation Dispatch
  document.getElementById('btnDispatchSimulation')?.addEventListener('click', async () => {
    if (!activeSubmissionId) return;
    try {
      const res = await apiRequest(`/api/submissions/${activeSubmissionId}/simulate`, {
        method: 'POST'
      });
      alert(`Simulated submission successful!\nPlatform Reference: ${res.data.platform_reference_number}`);
      await loadSubmissionDetail(activeSubmissionId);
      await loadCaseSubmissions(activeCaseId);
    } catch (err) {
      alert('Simulation dispatch failed: ' + err.message);
    }
  });

  // Facet Approval Modal
  const facetModal = document.getElementById('facetApprovalModal');
  document.getElementById('btnOpenFacetApprovalModal')?.addEventListener('click', () => {
    if (!activeSubmissionData || !activeSubmissionData.submission) return;
    document.getElementById('facetPacketHashBound').textContent = activeSubmissionData.submission.packet_hash || '--';
    document.getElementById('facetApprovalError')?.classList.add('hidden');
    facetModal.classList.remove('hidden');
  });
  document.getElementById('closeFacetApprovalModalBtn')?.addEventListener('click', () => {
    facetModal.classList.add('hidden');
  });
  document.getElementById('cancelFacetApprovalBtn')?.addEventListener('click', () => {
    facetModal.classList.add('hidden');
  });
  document.getElementById('facetApprovalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeSubmissionId || !activeSubmissionData?.submission) return;
    const errorDiv = document.getElementById('facetApprovalError');
    const payload = {
      approval_type: document.getElementById('facetApprovalType').value,
      decision: document.getElementById('facetDecision').value,
      justification: document.getElementById('facetDecisionReason').value.trim(),
      packet_hash_signed: activeSubmissionData.submission.packet_hash
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/submissions/${activeSubmissionId}/approve`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      facetModal.classList.add('hidden');
      document.getElementById('facetApprovalForm').reset();
      await loadSubmissionDetail(activeSubmissionId);
      await loadCaseSubmissions(activeCaseId);
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Record Platform Acknowledgement Modal
  const ackModal = document.getElementById('recordAckModal');
  document.getElementById('btnOpenRecordAckModal')?.addEventListener('click', () => {
    if (!activeSubmissionId) return;
    document.getElementById('recordAckError')?.classList.add('hidden');
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('ackReceivedAt').value = localIso;
    ackModal.classList.remove('hidden');
  });
  document.getElementById('closeRecordAckModalBtn')?.addEventListener('click', () => {
    ackModal.classList.add('hidden');
  });
  document.getElementById('cancelRecordAckBtn')?.addEventListener('click', () => {
    ackModal.classList.add('hidden');
  });
  document.getElementById('recordAckForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeSubmissionId) return;
    const errorDiv = document.getElementById('recordAckError');
    const receivedInput = document.getElementById('ackReceivedAt').value;
    const payload = {
      platform_reference_number: document.getElementById('ackPlatformRef').value.trim(),
      grievance_officer_name: document.getElementById('ackOfficerName').value.trim() || undefined,
      acknowledgement_received_at: new Date(receivedInput).toISOString(),
      notes: document.getElementById('ackNotes').value.trim() || undefined
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/submissions/${activeSubmissionId}/acknowledgement`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      ackModal.classList.add('hidden');
      document.getElementById('recordAckForm').reset();
      await loadSubmissionDetail(activeSubmissionId);
      await loadCaseSubmissions(activeCaseId);
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Record Platform Decision Modal
  const decModal = document.getElementById('recordDecisionModal');
  const decCatSelect = document.getElementById('decResponseCategory');
  const decResultSelect = document.getElementById('decTakedownResult');
  const decRejectionContainer = document.getElementById('decRejectionReasonContainer');

  const updateRejectionVisibility = () => {
    if (decCatSelect.value === 'request_rejected' || decResultSelect.value === 'rejected') {
      decRejectionContainer.classList.remove('hidden');
    } else {
      decRejectionContainer.classList.add('hidden');
    }
  };
  decCatSelect?.addEventListener('change', updateRejectionVisibility);
  decResultSelect?.addEventListener('change', updateRejectionVisibility);

  document.getElementById('btnOpenRecordDecisionModal')?.addEventListener('click', () => {
    if (!activeSubmissionId) return;
    document.getElementById('recordDecisionError')?.classList.add('hidden');
    updateRejectionVisibility();
    decModal.classList.remove('hidden');
  });
  document.getElementById('closeRecordDecisionModalBtn')?.addEventListener('click', () => {
    decModal.classList.add('hidden');
  });
  document.getElementById('cancelRecordDecisionBtn')?.addEventListener('click', () => {
    decModal.classList.add('hidden');
  });
  document.getElementById('recordDecisionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeSubmissionId) return;
    const errorDiv = document.getElementById('recordDecisionError');
    const payload = {
      response_category: decCatSelect.value,
      takedown_result: decResultSelect.value,
      platform_reference_number: document.getElementById('decPlatformRef').value.trim() || undefined,
      rejection_reason: document.getElementById('decRejectionReason').value.trim() || undefined,
      escalation_required: document.getElementById('decEscalationRequired').checked,
      notes: document.getElementById('decNotes').value.trim() || undefined
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/submissions/${activeSubmissionId}/decision`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      decModal.classList.add('hidden');
      document.getElementById('recordDecisionForm').reset();
      await loadSubmissionDetail(activeSubmissionId);
      await loadCaseSubmissions(activeCaseId);
      await loadEscalations();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Create Escalation Modal
  const escModal = document.getElementById('createEscalationModal');
  document.getElementById('openNewEscalationBtn')?.addEventListener('click', () => {
    const caseSelect = document.getElementById('escCaseSelect');
    if (allCases.length > 0) {
      caseSelect.innerHTML = allCases
        .map((c) => `<option value="${c.id}">${escapeHtml(c.case_number)} - ${escapeHtml(c.title)}</option>`)
        .join('');
      if (activeCaseId && allCases.some((c) => c.id === activeCaseId)) {
        caseSelect.value = activeCaseId;
      }
    } else {
      caseSelect.innerHTML = '<option value="">No cases available</option>';
    }
    document.getElementById('createEscalationError')?.classList.add('hidden');
    escModal.classList.remove('hidden');
  });
  document.getElementById('closeCreateEscalationModalBtn')?.addEventListener('click', () => {
    escModal.classList.add('hidden');
  });
  document.getElementById('cancelCreateEscalationBtn')?.addEventListener('click', () => {
    escModal.classList.add('hidden');
  });
  document.getElementById('createEscalationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('createEscalationError');
    const payload = {
      case_id: document.getElementById('escCaseSelect').value,
      severity: document.getElementById('escSeverity').value,
      escalation_trigger: document.getElementById('escTrigger').value,
      recommended_action: document.getElementById('escRecommendation').value,
      target_authority_or_court: document.getElementById('escTargetAuthority').value.trim() || undefined,
      factual_summary: document.getElementById('escFactualSummary').value.trim()
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest('/api/escalations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      escModal.classList.add('hidden');
      document.getElementById('createEscalationForm').reset();
      await loadEscalations();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Register Observation Modal
  const obsModal = document.getElementById('createObservationModal');
  document.getElementById('openNewObservationBtn')?.addEventListener('click', () => {
    const caseSelect = document.getElementById('obsCaseSelect');
    if (allCases.length > 0) {
      caseSelect.innerHTML = allCases
        .map((c) => `<option value="${c.id}">${escapeHtml(c.case_number)} - ${escapeHtml(c.title)}</option>`)
        .join('');
      if (activeCaseId && allCases.some((c) => c.id === activeCaseId)) {
        caseSelect.value = activeCaseId;
      }
    } else {
      caseSelect.innerHTML = '<option value="">No cases available</option>';
    }
    document.getElementById('createObservationError')?.classList.add('hidden');
    obsModal.classList.remove('hidden');
  });
  document.getElementById('closeCreateObservationModalBtn')?.addEventListener('click', () => {
    obsModal.classList.add('hidden');
  });
  document.getElementById('cancelCreateObservationBtn')?.addEventListener('click', () => {
    obsModal.classList.add('hidden');
  });
  document.getElementById('createObservationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('createObservationError');
    const payload = {
      case_id: document.getElementById('obsCaseSelect').value,
      observed_url: document.getElementById('obsUrl').value.trim(),
      platform_id: document.getElementById('obsPlatformSelect').value || undefined,
      relationship: document.getElementById('obsRelationship').value,
      target_entity: document.getElementById('obsTargetEntity').value.trim(),
      similarity_score: parseFloat(document.getElementById('obsSimilarity').value) || 0.9,
      operator_notes: document.getElementById('obsNotes').value.trim() || undefined
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest('/api/re-uploads', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      obsModal.classList.add('hidden');
      document.getElementById('createObservationForm').reset();
      await loadReuploads();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Record Policy Version Modal
  const polModal = document.getElementById('addPolicyVersionModal');
  document.getElementById('openNewPolicyVersionBtn')?.addEventListener('click', () => {
    document.getElementById('policyEffectiveDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('addPolicyVersionError')?.classList.add('hidden');
    polModal.classList.remove('hidden');
  });
  document.getElementById('closeAddPolicyVersionModalBtn')?.addEventListener('click', () => {
    polModal.classList.add('hidden');
  });
  document.getElementById('cancelAddPolicyVersionBtn')?.addEventListener('click', () => {
    polModal.classList.add('hidden');
  });
  document.getElementById('addPolicyVersionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('addPolicyVersionError');
    const platformId = document.getElementById('policyPlatformSelect').value;
    if (!platformId) return;
    const payload = {
      version_number: document.getElementById('policyVersionNumber').value.trim(),
      effective_date: document.getElementById('policyEffectiveDate').value,
      summary_of_changes: document.getElementById('policySummary').value.trim(),
      source_url: document.getElementById('policySourceUrl').value.trim() || undefined
    };
    try {
      errorDiv.classList.add('hidden');
      await apiRequest(`/api/platforms/${platformId}/policy-versions`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      polModal.classList.add('hidden');
      document.getElementById('addPolicyVersionForm').reset();
      await loadPlatformsAndPlaybooks();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });

  // Phase 5: Notification Bell & Drawer
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDrawer = document.getElementById('notifDrawer');
  notifBellBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDrawer?.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (notifDrawer && !notifDrawer.contains(e.target) && !notifBellBtn?.contains(e.target)) {
      notifDrawer.classList.add('hidden');
    }
  });
  document.getElementById('markAllNotifsReadBtn')?.addEventListener('click', markAllNotificationsRead);

  // Phase 5: Team Member Invitation Modal
  const inviteModal = document.getElementById('inviteUserModal');
  document.getElementById('openInviteUserModalBtn')?.addEventListener('click', () => {
    document.getElementById('inviteError')?.classList.add('hidden');
    document.getElementById('inviteResultBox')?.classList.add('hidden');
    document.getElementById('inviteUserForm')?.reset();
    inviteModal?.classList.remove('hidden');
  });
  document.getElementById('closeInviteUserModalBtn')?.addEventListener('click', () => {
    inviteModal?.classList.add('hidden');
  });
  document.getElementById('cancelInviteBtn')?.addEventListener('click', () => {
    inviteModal?.classList.add('hidden');
  });
  document.getElementById('inviteUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('inviteError');
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;
    try {
      errorDiv?.classList.add('hidden');
      const res = await apiRequest('/api/onboarding/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });
      const resultBox = document.getElementById('inviteResultBox');
      const tokenOutput = document.getElementById('inviteTokenOutput');
      if (resultBox && tokenOutput) {
        tokenOutput.textContent = res.data?.invitationToken || 'Token generated';
        resultBox.classList.remove('hidden');
      }
      await loadInvitations();
    } catch (err) {
      if (errorDiv) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
      }
    }
  });

  // Phase 5: Simulated Invoice Preview Modal
  const invModal = document.getElementById('invoicePreviewModal');
  document.getElementById('previewInvoiceBtn')?.addEventListener('click', previewSimulatedInvoice);
  document.getElementById('closeInvoicePreviewModalBtn')?.addEventListener('click', () => {
    invModal?.classList.add('hidden');
  });
  document.getElementById('closeInvoiceModalBottomBtn')?.addEventListener('click', () => {
    invModal?.classList.add('hidden');
  });

  // Phase 5: Usage Exports
  document.getElementById('exportUsageCsvBtn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/usage/export?format=csv', {
        headers: {
          'x-organization-id': currentOrgId,
          'x-user-id': currentUserId
        }
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-export-${currentOrgId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to export usage CSV: ' + err.message);
    }
  });
  document.getElementById('exportUsageJsonBtn')?.addEventListener('click', async () => {
    try {
      const res = await apiRequest('/api/usage/export?format=json');
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-export-${currentOrgId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Usage export failed: ' + err.message);
    }
  });

  // Phase 5: Operational Reports Execution
  document.getElementById('btnExecuteReport')?.addEventListener('click', executeReport);
  document.getElementById('downloadReportCsvBtn')?.addEventListener('click', () => {
    if (currentReportResult?.csvContent) {
      const blob = new Blob([currentReportResult.csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentReportResult.reportType}-${currentOrgId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      executeReport();
    }
  });

  // Phase 6: Monitoring & Candidate Review Modals Setup
  setupMonitoringModals();

  // Phase 8: Controlled Read-Only Integrations Setup
  setupIntegrationModals();
}

// ----------------------------------------------------------------------------
// Phase 5 Pilot Operations Functions
// ----------------------------------------------------------------------------

async function loadNotifications() {
  try {
    const res = await apiRequest('/api/notifications');
    allNotifications = res.data || [];
    const unreadCount = allNotifications.filter((n) => !n.is_read).length;
    const badge = document.getElementById('notifBadge');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    const container = document.getElementById('notifListContainer');
    if (!container) return;
    if (allNotifications.length === 0) {
      container.innerHTML = '<div class="p-4 text-center text-slate-500">No notifications</div>';
      return;
    }
    container.innerHTML = allNotifications
      .map((n) => {
        const isUnread = !n.is_read;
        const timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <div class="p-3 ${isUnread ? 'bg-indigo-950/30' : 'bg-slate-900'} hover:bg-slate-800/60 transition-colors">
            <div class="flex items-start justify-between gap-2">
              <span class="font-medium text-slate-200 text-xs">${escapeHtml(n.title)}</span>
              <span class="text-[10px] text-slate-500 whitespace-nowrap">${timeStr}</span>
            </div>
            <p class="text-[11px] text-slate-400 mt-1">${escapeHtml(n.body)}</p>
            <div class="flex items-center justify-between mt-2 pt-1 border-t border-slate-800/40">
              <span class="text-[9px] font-mono uppercase px-1 rounded bg-slate-800 text-slate-400">${escapeHtml(n.notification_type)}</span>
              ${
                isUnread
                  ? `<button onclick="markNotificationRead('${n.id}')" class="text-[10px] text-indigo-400 hover:text-indigo-300">Mark read</button>`
                  : '<span class="text-[10px] text-slate-500">Read</span>'
              }
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

async function markNotificationRead(id) {
  try {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
    await loadNotifications();
  } catch (err) {
    console.error('Failed to mark notification read:', err);
  }
}

async function markAllNotificationsRead() {
  try {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  } catch (err) {
    console.error('Failed to mark all notifications read:', err);
  }
}

async function loadOnboarding() {
  try {
    const checkRes = await apiRequest('/api/onboarding/checklist');
    const checkData = checkRes.data;
    const pct = checkData.completion_percentage || 0;

    const pctEl = document.getElementById('onboardingProgressPct');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const barEl = document.getElementById('onboardingProgressBar');
    if (barEl) barEl.style.width = `${pct}%`;

    const badgeEl = document.getElementById('onboardingStatusBadge');
    if (badgeEl) {
      if (checkData.ready_for_cases) {
        badgeEl.textContent = 'READY FOR CASES';
        badgeEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-700 bg-emerald-950 text-emerald-300';
      } else {
        badgeEl.textContent = 'IN PROGRESS';
        badgeEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded border border-amber-700 bg-amber-950 text-amber-300';
      }
    }

    const checklistContainer = document.getElementById('checklistItemsContainer');
    if (checklistContainer && checkData.checklist) {
      const steps = [
        { key: 'profile_complete', altKey: 'primary_org_profile', title: '1. Primary Org Profile', desc: 'Organization legal name, jurisdiction, and contact domain registered.' },
        { key: 'owner_assigned', altKey: 'designated_grievance_officer', title: '2. Designated Grievance Officer', desc: 'Named Indian Grievance Officer & contact details specified.' },
        { key: 'legal_reviewer_assigned', altKey: 'legal_reviewer_assigned', title: '3. Legal Reviewer Assigned', desc: 'Qualified in-house or retained counsel assigned for takedown sign-offs.' },
        { key: 'terms_accepted', altKey: 'escalation_authority_contact', title: '4. Escalation Authority Contact & Terms', desc: 'Appellate counsel or senior executive contact & pilot terms accepted.', action: 'terms' },
        { key: 'retention_configured', altKey: 'evidence_retention_policy_selected', title: '5. Retention Policy Selected', desc: 'Statutory evidentiary retention schedule configured (e.g. 180-day audit).' },
        { key: 'playbook_acknowledged', altKey: 'default_playbook_configured', title: '6. Default Playbook Configured', desc: 'Platform playbook mapped for primary impersonation threat surface.', action: 'playbook' },
        { key: 'test_case_completed', altKey: 'initial_simulation_drill_completed', title: '7. Initial Simulation Drill', desc: 'Test incident simulated through intake, readiness, and dry-run packeter.' }
      ];

      checklistContainer.innerHTML = steps
        .map((s) => {
          const isDone = Boolean(checkData.checklist[s.key] !== undefined ? checkData.checklist[s.key] : checkData.checklist[s.altKey]);
          let actionBtn = '';
          if (!isDone && s.action === 'terms') {
            actionBtn = `<button onclick="acceptPilotTerms()" class="mt-1 text-[10px] bg-indigo-700 hover:bg-indigo-600 text-white px-2 py-0.5 rounded shadow">Accept Terms</button>`;
          } else if (!isDone && s.action === 'playbook') {
            actionBtn = `<button onclick="acknowledgePilotPlaybook()" class="mt-1 text-[10px] bg-indigo-700 hover:bg-indigo-600 text-white px-2 py-0.5 rounded shadow">Acknowledge Playbook</button>`;
          }

          return `
            <div class="p-3 bg-slate-950 rounded border ${isDone ? 'border-emerald-900/60 bg-emerald-950/10' : 'border-slate-800'} flex items-start justify-between">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm">${isDone ? '✅' : '⏳'}</span>
                  <span class="font-semibold text-xs ${isDone ? 'text-emerald-300' : 'text-slate-300'}">${escapeHtml(s.title)}</span>
                </div>
                <p class="text-[11px] text-slate-400">${escapeHtml(s.desc)}</p>
                ${actionBtn}
              </div>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isDone
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }">
                ${isDone ? 'COMPLETE' : 'PENDING'}
              </span>
            </div>
          `;
        })
        .join('');
    }

    await loadInvitations();
  } catch (err) {
    console.error('Failed to load onboarding checklist:', err);
  }
}

window.acceptPilotTerms = async function() {
  try {
    await apiRequest('/api/onboarding/settings', {
      method: 'PATCH',
      body: JSON.stringify({ terms_accepted: true })
    });
    showToast('Pilot terms and escalation protocols accepted.', 'success');
    await loadOnboarding();
  } catch (err) {
    showToast(`Failed to accept terms: ${err.message}`, 'error');
  }
};

window.acknowledgePilotPlaybook = async function() {
  try {
    await apiRequest('/api/onboarding/settings', {
      method: 'PATCH',
      body: JSON.stringify({ playbook_acknowledged: true })
    });
    showToast('Platform playbook configuration acknowledged.', 'success');
    await loadOnboarding();
  } catch (err) {
    showToast(`Failed to acknowledge playbook: ${err.message}`, 'error');
  }
};

async function loadInvitations() {
  try {
    const res = await apiRequest('/api/onboarding/invitations');
    const invitations = res.data || [];
    const tbody = document.getElementById('invitationsTableBody');
    if (!tbody) return;
    if (invitations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">No team invitations recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = invitations
      .map((inv) => {
        const isPending = inv.status === 'pending';
        const statusColor = isPending
          ? 'bg-amber-950 text-amber-300 border-amber-800'
          : inv.status === 'accepted'
          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
          : 'bg-rose-950 text-rose-300 border-rose-800';
        const expiresStr = inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '--';
        return `
          <tr class="hover:bg-slate-800/30">
            <td class="py-2.5 px-3 font-mono text-slate-200">${escapeHtml(inv.email)}</td>
            <td class="py-2.5 px-3 capitalize text-slate-300">${escapeHtml(formatCategory(inv.role))}</td>
            <td class="py-2.5 px-3">
              <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${statusColor}">${inv.status}</span>
            </td>
            <td class="py-2.5 px-3 text-slate-400">${expiresStr}</td>
            <td class="py-2.5 px-3 text-right">
              ${
                isPending
                  ? `<button onclick="revokeInvitation('${inv.id}')" class="text-xs text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded bg-rose-950/40 border border-rose-900/60">Revoke</button>`
                  : '<span class="text-slate-600 text-xs">--</span>'
              }
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load invitations:', err);
  }
}

async function revokeInvitation(invId) {
  if (!confirm('Are you sure you want to revoke this invitation?')) return;
  try {
    await apiRequest(`/api/onboarding/invitations/${invId}/revoke`, { method: 'POST' });
    await loadInvitations();
  } catch (err) {
    alert('Failed to revoke invitation: ' + err.message);
  }
}

async function loadUsage() {
  try {
    const res = await apiRequest('/api/usage/summary');
    const summary = res.data;
    const metersGrid = document.getElementById('quotaMetersGrid');
    if (metersGrid && summary) {
      const meters = [
        {
          title: 'Active Cases',
          current: summary.cases?.current || 0,
          limit: summary.cases?.limit ?? 50,
          pct: Math.min(100, Math.round(((summary.cases?.current || 0) / (summary.cases?.limit || 50)) * 100))
        },
        {
          title: 'Storage (MB)',
          current: Math.round((summary.storage_mb?.current || 0) * 10) / 10,
          limit: summary.storage_mb?.limit ?? 5120,
          pct: Math.min(100, Math.round(((summary.storage_mb?.current || 0) / (summary.storage_mb?.limit || 5120)) * 100))
        },
        {
          title: 'Submission Simulations',
          current: summary.submissions?.current || 0,
          limit: summary.submissions?.limit ?? 100,
          pct: Math.min(100, Math.round(((summary.submissions?.current || 0) / (summary.submissions?.limit || 100)) * 100))
        },
        {
          title: 'Team Seats',
          current: summary.users?.current || 0,
          limit: summary.users?.limit ?? 5,
          pct: Math.min(100, Math.round(((summary.users?.current || 0) / (summary.users?.limit || 5)) * 100))
        }
      ];

      metersGrid.innerHTML = meters
        .map((m) => {
          const isWarning = m.pct >= 80;
          const isDanger = m.pct >= 100;
          const barColor = isDanger ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-indigo-600';
          const badgeColor = isDanger
            ? 'text-rose-400 bg-rose-950 border-rose-800'
            : isWarning
            ? 'text-amber-400 bg-amber-950 border-amber-800'
            : 'text-emerald-400 bg-emerald-950 border-emerald-800';
          return `
            <div class="p-4 bg-slate-900 border border-slate-800 rounded space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-400 font-medium">${escapeHtml(m.title)}</span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded border ${badgeColor}">${m.pct}%</span>
              </div>
              <div class="text-xl font-bold font-mono-num text-slate-100">
                ${m.current} <span class="text-xs font-normal text-slate-500">/ ${m.limit}</span>
              </div>
              <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                <div class="${barColor} h-full rounded-full transition-all duration-300" style="width: ${m.pct}%"></div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    const tbody = document.getElementById('usageTableBody');
    if (tbody && summary?.daily_aggregates) {
      if (summary.daily_aggregates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">No daily usage aggregates recorded yet.</td></tr>';
      } else {
        tbody.innerHTML = summary.daily_aggregates
          .map(
            (agg) => `
          <tr class="hover:bg-slate-800/30">
            <td class="py-2.5 px-3 font-mono text-slate-200">${escapeHtml(agg.usage_date)}</td>
            <td class="py-2.5 px-3 font-mono uppercase text-slate-300 text-xs">${escapeHtml(formatCategory(agg.event_type))}</td>
            <td class="py-2.5 px-3 font-mono text-indigo-400 font-semibold">${agg.total_quantity}</td>
            <td class="py-2.5 px-3 text-slate-400 text-xs">${new Date(agg.updated_at).toLocaleTimeString()}</td>
          </tr>
        `
          )
          .join('');
      }
    }
  } catch (err) {
    console.error('Failed to load usage data:', err);
  }
}

async function loadBilling() {
  try {
    const res = await apiRequest('/api/billing/plans');
    const plans = res.data || [];
    const container = document.getElementById('planCardsGrid');
    if (!container) return;

    container.innerHTML = plans
      .map((p) => {
        const isPilot = p.id === 'pilot';
        return `
          <div class="bg-slate-900 border ${isPilot ? 'border-indigo-600 ring-1 ring-indigo-500/50' : 'border-slate-800'} rounded p-5 flex flex-col justify-between space-y-4">
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wider font-bold text-indigo-400 font-mono">${escapeHtml(p.name)}</span>
                ${isPilot ? '<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold">CURRENT PILOT</span>' : ''}
              </div>
              <p class="text-xs text-slate-400">${escapeHtml(p.description)}</p>
              <div class="pt-2 border-t border-slate-800">
                <div class="text-2xl font-bold font-mono text-slate-100">₹${p.baseFeeINR.toLocaleString('en-IN')}<span class="text-xs font-normal text-slate-400">/mo</span></div>
                <div class="text-[11px] text-slate-500">+ 18% GST (dry-run simulation)</div>
              </div>
              <div class="space-y-1.5 pt-2 text-xs">
                <div class="text-[11px] font-semibold text-slate-300">Included Limits:</div>
                <div class="text-slate-400 flex justify-between"><span>Active Cases:</span> <span class="font-mono text-slate-200">${p.limits.maxActiveCases}</span></div>
                <div class="text-slate-400 flex justify-between"><span>Storage:</span> <span class="font-mono text-slate-200">${p.limits.maxStorageMB / 1024} GB</span></div>
                <div class="text-slate-400 flex justify-between"><span>Team Seats:</span> <span class="font-mono text-slate-200">${p.limits.maxUsers}</span></div>
                <div class="text-slate-400 flex justify-between"><span>Simulations / Mo:</span> <span class="font-mono text-slate-200">${p.limits.maxSimulatedSubmissionsPerMonth}</span></div>
              </div>
              <div class="space-y-1 pt-2 text-[11px]">
                <div class="font-semibold text-slate-300">Overage Rates:</div>
                <div class="text-slate-400 flex justify-between"><span>Additional Case:</span> <span class="font-mono text-slate-200">₹${p.overageRates.caseOverageINR}</span></div>
                <div class="text-slate-400 flex justify-between"><span>Additional GB:</span> <span class="font-mono text-slate-200">₹${p.overageRates.storagePerGbOverageINR}</span></div>
                <div class="text-slate-400 flex justify-between"><span>Additional Simulation:</span> <span class="font-mono text-slate-200">₹${p.overageRates.submissionOverageINR}</span></div>
              </div>
            </div>
            <button disabled class="w-full py-2 rounded text-xs font-semibold ${isPilot ? 'bg-indigo-600 text-white cursor-default' : 'bg-slate-800 text-slate-400 cursor-not-allowed'}">
              ${isPilot ? 'Active Pilot Plan' : 'Tier Upgrade (Simulated)'}
            </button>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load billing plans:', err);
  }
}

async function previewSimulatedInvoice() {
  try {
    const res = await apiRequest('/api/billing/preview');
    const inv = res.data;
    if (!inv) return;

    document.getElementById('invNumberDisplay').textContent = inv.invoiceNumber || 'INV-SIM-XXXX';
    document.getElementById('invPlanDisplay').textContent = (inv.planName || 'Pilot') + ' Plan';
    document.getElementById('invPeriodDisplay').textContent = `${inv.periodStart} to ${inv.periodEnd}`;
    document.getElementById('invSubtotalDisplay').textContent = `₹${(inv.subtotalINR || 0).toLocaleString('en-IN')}`;
    document.getElementById('invGstDisplay').textContent = `₹${(inv.gstINR || 0).toLocaleString('en-IN')}`;
    document.getElementById('invTotalDisplay').textContent = `₹${(inv.totalINR || 0).toLocaleString('en-IN')}`;

    const tbody = document.getElementById('invoiceLineItemsBody');
    if (tbody && inv.lineItems) {
      tbody.innerHTML = inv.lineItems
        .map(
          (item) => `
        <tr class="hover:bg-slate-800/30">
          <td class="py-2 px-3 text-slate-200">${escapeHtml(item.description)}</td>
          <td class="py-2 px-3 text-center text-slate-400">${item.quantity}</td>
          <td class="py-2 px-3 text-right text-slate-400">₹${item.unitPriceINR?.toLocaleString('en-IN') ?? '--'}</td>
          <td class="py-2 px-3 text-right font-bold text-slate-200">₹${(item.amountINR || 0).toLocaleString('en-IN')}</td>
        </tr>
      `
        )
        .join('');
    }

    document.getElementById('invoicePreviewModal').classList.remove('hidden');
  } catch (err) {
    alert('Failed to preview invoice: ' + err.message);
  }
}

async function loadReports() {
  try {
    const res = await apiRequest('/api/reports/types');
    currentReportTypes = res.data || [];
    const select = document.getElementById('reportTypeSelect');
    if (select) {
      select.innerHTML = currentReportTypes
        .map(
          (r) => `
        <option value="${r.type}">${escapeHtml(r.title)}</option>
      `
        )
        .join('');
    }
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    if (startInput && !startInput.value) startInput.value = firstOfMonth;
    if (endInput && !endInput.value) endInput.value = today;
  } catch (err) {
    console.error('Failed to load report types:', err);
  }
}

async function executeReport() {
  const reportType = document.getElementById('reportTypeSelect').value;
  const startDate = document.getElementById('reportStartDate').value || undefined;
  const endDate = document.getElementById('reportEndDate').value || undefined;
  const format = document.getElementById('reportFormatSelect').value;

  if (format === 'csv') {
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': currentOrgId,
          'x-user-id': currentUserId
        },
        body: JSON.stringify({
          report_type: reportType,
          format: 'csv',
          start_date: startDate,
          end_date: endDate
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to generate CSV report');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}-${currentOrgId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Report generation failed: ' + err.message);
    }
    return;
  }

  try {
    const res = await apiRequest('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify({
        report_type: reportType,
        format: 'json',
        start_date: startDate,
        end_date: endDate
      })
    });
    currentReportResult = res.data;
    renderReportResults(currentReportResult);
  } catch (err) {
    alert('Report generation failed: ' + err.message);
  }
}

function renderReportResults(result) {
  const box = document.getElementById('reportResultsBox');
  if (!box || !result) return;
  box.classList.remove('hidden');

  const titleEl = document.getElementById('reportTitleDisplay');
  const countEl = document.getElementById('reportRowCountBadge');
  const meta = currentReportTypes.find((t) => t.type === result.reportType);
  if (titleEl) titleEl.textContent = meta ? meta.title : result.reportType;
  if (countEl) countEl.textContent = `${result.rowCount} rows`;

  const thead = document.getElementById('reportTableHead');
  const tbody = document.getElementById('reportTableBody');

  if (!result.data || result.data.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td class="p-4 text-center text-slate-500">No records found matching report criteria.</td></tr>';
    return;
  }

  const keys = Object.keys(result.data[0]);
  thead.innerHTML = `<tr>${keys.map((k) => `<th class="py-2 px-3">${escapeHtml(k.replace(/_/g, ' '))}</th>`).join('')}</tr>`;
  tbody.innerHTML = result.data
    .map(
      (row) => `
    <tr class="hover:bg-slate-800/30">
      ${keys
        .map((k) => {
          const val = row[k];
          const displayVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '--');
          return `<td class="py-2 px-3 text-slate-300 max-w-xs truncate" title="${escapeHtml(displayVal)}">${escapeHtml(displayVal)}</td>`;
        })
        .join('')}
    </tr>
  `
    )
    .join('');
}

async function loadWorkers() {
  try {
    let workers = [];
    try {
      const res = await apiRequest('/api/admin/workers');
      workers = res.data || [];
    } catch {
      const metricsRes = await fetch('/health/metrics');
      const metrics = await metricsRes.json();
      workers = metrics.metrics?.workers || [];
    }

    const tbody = document.getElementById('workersTableBody');
    if (!tbody) return;

    if (workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-500">No worker heartbeats registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = workers
      .map((w) => {
        const isHealthy = w.status === 'healthy' || w.status === 'idle' || w.status === 'running';
        const statusStyle = isHealthy ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-rose-950 text-rose-300 border-rose-800 font-bold';
        const lastSeen = w.last_heartbeat_at ? new Date(w.last_heartbeat_at).toLocaleTimeString() : '--';
        const durationMs = w.last_run_duration_ms ? `${w.last_run_duration_ms}ms` : '--';
        const runs = w.total_runs_count ?? w.runs_count ?? 0;
        const errors = w.consecutive_failure_count ?? w.consecutive_errors ?? 0;
        return `
          <tr class="hover:bg-slate-800/30">
            <td class="py-2.5 px-3 font-semibold text-slate-200 font-mono text-xs">${escapeHtml(w.worker_name)}</td>
            <td class="py-2.5 px-3">
              <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${statusStyle}">${w.status}</span>
            </td>
            <td class="py-2.5 px-3 text-slate-400">${lastSeen}</td>
            <td class="py-2.5 px-3 text-slate-400 font-mono">${durationMs}</td>
            <td class="py-2.5 px-3 text-indigo-400 font-mono">${runs}</td>
            <td class="py-2.5 px-3 font-mono ${errors > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">${errors}</td>
            <td class="py-2.5 px-3 text-right">
              <button onclick="triggerWorkerRun('${w.worker_name}')" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded border border-slate-700 font-medium">
                Execute Now
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load workers health:', err);
  }
}

async function triggerWorkerRun(workerName) {
  try {
    await apiRequest(`/api/admin/workers/${workerName}/run`, { method: 'POST' });
    alert(`Worker '${workerName}' execution initiated successfully.`);
    await loadWorkers();
  } catch (err) {
    alert('Worker run failed: ' + err.message);
  }
}

// ----------------------------------------------------------------------------
// Phase 6 Detection Intake, Candidate Correlation & Human Review Functions
// ----------------------------------------------------------------------------

async function loadMonitoring() {
  await Promise.all([
    loadMonitoringQuota(),
    loadCandidateReviews(),
    loadMonitoredSubjects(),
    loadMonitoringPolicies()
  ]);
}

async function loadMonitoringQuota() {
  try {
    const res = await apiRequest('/api/monitoring/quota');
    const data = res.data;
    if (!data) return;

    const subCur = data.subjects?.current ?? 0;
    const subMax = data.subjects?.max ?? 5;
    const sigCur = data.signals?.current_month ?? 0;
    const sigMax = data.signals?.max_monthly ?? 500;

    const elSubCount = document.getElementById('monSubjectsCount');
    const elSubMax = document.getElementById('monSubjectsMax');
    const elSubBar = document.getElementById('monSubjectsBar');
    if (elSubCount) elSubCount.textContent = subCur;
    if (elSubMax) elSubMax.textContent = subMax;
    if (elSubBar) {
      const pct = Math.min(100, Math.round((subCur / Math.max(1, subMax)) * 100));
      elSubBar.style.width = `${pct}%`;
      elSubBar.className = pct >= 90 ? 'bg-rose-500 h-1.5 rounded-full' : 'bg-indigo-500 h-1.5 rounded-full';
    }

    const elSigCount = document.getElementById('monSignalsCount');
    const elSigMax = document.getElementById('monSignalsMax');
    const elSigBar = document.getElementById('monSignalsBar');
    if (elSigCount) elSigCount.textContent = sigCur;
    if (elSigMax) elSigMax.textContent = sigMax;
    if (elSigBar) {
      const pct = Math.min(100, Math.round((sigCur / Math.max(1, sigMax)) * 100));
      elSigBar.style.width = `${pct}%`;
      elSigBar.className = pct >= 90 ? 'bg-rose-500 h-1.5 rounded-full' : 'bg-emerald-500 h-1.5 rounded-full';
    }
  } catch (err) {
    console.error('Failed to load monitoring quota:', err);
  }
}

async function loadMonitoringBadge() {
  try {
    const res = await apiRequest('/api/monitoring/reviews?status=pending');
    const items = res.data || [];
    const pendingCount = items.length;
    const sidebarBadge = document.getElementById('sidebarReviewCount');
    if (sidebarBadge) {
      sidebarBadge.textContent = pendingCount;
      if (pendingCount > 0) {
        sidebarBadge.className = 'px-1.5 py-0.2 rounded bg-amber-950/90 text-[10px] text-amber-400 border border-amber-800/80 font-mono font-bold animate-pulse';
      } else {
        sidebarBadge.className = 'px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700 font-mono';
      }
    }
    const tabBadge = document.getElementById('monReviewBadgeCount');
    if (tabBadge) tabBadge.textContent = pendingCount;
  } catch (err) {
    console.error('Failed to load monitoring badge:', err);
  }
}

async function loadCandidateReviews() {
  try {
    const statusFilter = document.getElementById('filterReviewStatus')?.value || '';
    const priorityFilter = document.getElementById('filterReviewPriority')?.value || '';

    let url = '/api/monitoring/reviews?limit=100';
    if (statusFilter) url += `&status=${statusFilter}`;
    if (priorityFilter) url += `&priority=${priorityFilter}`;

    const res = await apiRequest(url);
    allCandidateReviews = res.data || [];

    const pendingReviews = allCandidateReviews.filter((r) => r.review?.status === 'pending');
    const highPriorityReviews = allCandidateReviews.filter(
      (r) => (r.review?.priority === 'p1' || r.review?.priority === 'p2') || (r.risk_score?.score >= 70)
    );

    const pendingEl = document.getElementById('monPendingReviewsCount');
    if (pendingEl) pendingEl.textContent = pendingReviews.length;

    const highEl = document.getElementById('monHighPriorityCount');
    if (highEl) highEl.textContent = highPriorityReviews.length;

    const sidebarBadge = document.getElementById('sidebarReviewCount');
    if (sidebarBadge) {
      sidebarBadge.textContent = pendingReviews.length;
      if (pendingReviews.length > 0) {
        sidebarBadge.className = 'px-1.5 py-0.2 rounded bg-amber-950/90 text-[10px] text-amber-400 border border-amber-800/80 font-mono font-bold animate-pulse';
      } else {
        sidebarBadge.className = 'px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700 font-mono';
      }
    }

    const tabBadge = document.getElementById('monReviewBadgeCount');
    if (tabBadge) tabBadge.textContent = pendingReviews.length;

    const tbody = document.getElementById('candidateReviewsTableBody');
    if (!tbody) return;

    if (allCandidateReviews.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-6 text-center text-slate-500">
            No candidates match the selected filters. Use "Ingest Candidate" or "Replay Fixtures" to populate.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = allCandidateReviews
      .map((item) => {
        const rev = item.review;
        const sig = item.signal;
        const subj = item.subject;
        const risk = item.risk_score;
        const scoreVal = risk?.score ?? 0;

        let riskBadgeClass = 'bg-slate-800 text-slate-300 border-slate-700';
        if (scoreVal >= 80) {
          riskBadgeClass = 'bg-rose-950/80 text-rose-400 border-rose-800 font-bold';
        } else if (scoreVal >= 60) {
          riskBadgeClass = 'bg-amber-950/80 text-amber-400 border-amber-800 font-bold';
        } else if (scoreVal >= 40) {
          riskBadgeClass = 'bg-blue-950/80 text-blue-400 border-blue-800';
        }

        const statusBadges = {
          pending: 'bg-amber-950 text-amber-300 border-amber-800',
          confirmed: 'bg-emerald-950 text-emerald-300 border-emerald-800',
          dismissed: 'bg-slate-800 text-slate-400 border-slate-700',
          quarantined: 'bg-purple-950 text-purple-300 border-purple-800'
        };
        const statusBadgeClass = statusBadges[rev.status] || 'bg-slate-800 text-slate-300 border-slate-700';

        const dupWarning = item.duplicate_url_warning?.hasDuplicate
          ? `<span class="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] ml-1" title="Duplicate of Case ${item.duplicate_url_warning.duplicateCaseNumber || ''}">⚠️ Duplicate</span>`
          : '';

        const obsDate = sig.observed_at ? new Date(sig.observed_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
        const isYouTubeProvider = sig.adapter_name === 'youtube_readonly_adapter' || (sig.platform === 'youtube' && sig.source_type === 'external_provider');
        const providerBadge = isYouTubeProvider
          ? '<span class="inline-flex items-center px-1 py-0.2 rounded text-[9px] bg-red-950/90 text-red-300 border border-red-800/80 font-mono ml-1 font-semibold">YouTube Data API v3 (Read-Only)</span>'
          : '';

        return `
          <tr class="hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-3 max-w-xs">
              <a href="${escapeHtml(sig.observed_url)}" target="_blank" class="text-indigo-400 hover:underline truncate block font-mono text-[11px]" title="${escapeHtml(sig.observed_url)}">
                ${escapeHtml(sig.observed_url)}
              </a>
              <div class="text-[10px] text-slate-500 truncate mt-0.5 flex items-center flex-wrap gap-1">
                <span>${escapeHtml(sig.content_type)} via ${escapeHtml(sig.adapter_name)}</span>
                ${providerBadge}
              </div>
            </td>
            <td class="py-2.5 px-3">
              <div class="font-medium text-slate-200 text-xs">${escapeHtml(subj.canonical_name)}</div>
              <div class="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <span>Ref: ${escapeHtml(subj.authorization_reference)}</span>
                <span class="text-emerald-400">✓ Mandated</span>
              </div>
            </td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 uppercase font-mono">
                ${escapeHtml(sig.platform)}
              </span>
            </td>
            <td class="py-2.5 px-3">
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded text-xs border font-mono ${riskBadgeClass}">
                  ${scoreVal}/100
                </span>
                ${dupWarning}
              </div>
              <div class="text-[10px] text-slate-500 mt-0.5 capitalize">
                ${item.correlation?.confidence_category || 'evaluated'} confidence
              </div>
            </td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded text-[10px] border capitalize ${statusBadgeClass}">
                ${rev.status.replace('_', ' ')}
              </span>
            </td>
            <td class="py-2.5 px-3 text-slate-400 text-[11px]">
              ${obsDate}
            </td>
            <td class="py-2.5 px-3 text-right">
              <button onclick="openCandidateReview('${rev.id}')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors">
                ${rev.status === 'pending' ? 'Review & Decide' : 'View Decision'}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load candidate reviews:', err);
  }
}

async function loadMonitoredSubjects() {
  try {
    const res = await apiRequest('/api/monitoring/subjects');
    allMonitoredSubjects = res.data || [];

    const badge = document.getElementById('monSubjectsBadgeCount');
    if (badge) badge.textContent = allMonitoredSubjects.length;

    const select = document.getElementById('ingestSubjectSelect');
    if (select) {
      const activeSubjects = allMonitoredSubjects.filter((s) => s.monitoring_status === 'active');
      select.innerHTML = '<option value="">Select an active subject...</option>' +
        activeSubjects.map((s) => `
          <option value="${s.id}">${escapeHtml(s.canonical_name)} (${formatCategory(s.subject_type)} - Ref: ${escapeHtml(s.authorization_reference)})</option>
        `).join('');
    }

    const tbody = document.getElementById('monitoredSubjectsTableBody');
    if (!tbody) return;

    if (allMonitoredSubjects.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-6 text-center text-slate-500">
            No monitored subjects registered. Click "+ Register Subject" to establish a lawful mandate.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = allMonitoredSubjects
      .map((s) => {
        const domains = (s.official_domains || []).concat(s.handles || []).join(', ') || 'None registered';
        const statusColors = {
          active: 'bg-emerald-950 text-emerald-300 border-emerald-800',
          paused: 'bg-amber-950 text-amber-300 border-amber-800',
          draft: 'bg-slate-800 text-slate-400 border-slate-700',
          suspended: 'bg-rose-950 text-rose-300 border-rose-800',
          archived: 'bg-slate-900 text-slate-500 border-slate-800 line-through'
        };
        const statusBadge = statusColors[s.monitoring_status] || 'bg-slate-800 text-slate-300 border-slate-700';

        const toggleBtnLabel = s.monitoring_status === 'active' ? 'Pause' : 'Activate';
        const toggleBtnColor = s.monitoring_status === 'active' ? 'text-amber-400 hover:bg-amber-950/40' : 'text-emerald-400 hover:bg-emerald-950/40';

        return `
          <tr class="hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-3">
              <div class="font-medium text-slate-200 text-xs">${escapeHtml(s.canonical_name)}</div>
              <div class="text-[10px] text-slate-500 capitalize">${formatCategory(s.subject_type)}</div>
            </td>
            <td class="py-2.5 px-3 capitalize text-slate-300 text-xs">
              ${formatCategory(s.subject_type)}
            </td>
            <td class="py-2.5 px-3">
              <div class="font-mono text-[11px] text-indigo-300">${escapeHtml(s.authorization_reference)}</div>
              <div class="text-[10px] text-slate-500">${formatCategory(s.authorization_basis)}</div>
            </td>
            <td class="py-2.5 px-3 max-w-xs truncate text-[11px] text-slate-400" title="${escapeHtml(domains)}">
              ${escapeHtml(domains)}
            </td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded text-[10px] border uppercase font-mono ${statusBadge}">
                ${s.monitoring_status}
              </span>
            </td>
            <td class="py-2.5 px-3">
              <span class="px-1.5 py-0.2 rounded text-[10px] border uppercase font-mono bg-slate-800 text-slate-300 border-slate-700">
                ${s.sensitivity}
              </span>
            </td>
            <td class="py-2.5 px-3 text-right">
              <button onclick="toggleSubjectStatus('${s.id}', '${s.monitoring_status}')" class="px-2 py-1 rounded border border-slate-700 text-xs font-medium transition-colors ${toggleBtnColor}">
                ${toggleBtnLabel}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load monitored subjects:', err);
  }
}

async function toggleSubjectStatus(subjectId, currentStatus) {
  try {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active';
    await apiRequest(`/api/monitoring/subjects/${subjectId}`, {
      method: 'PUT',
      body: JSON.stringify({ monitoring_status: nextStatus })
    });
    await loadMonitoredSubjects();
    await loadMonitoringQuota();
  } catch (err) {
    alert('Failed to update subject status: ' + err.message);
  }
}

async function loadMonitoringPolicies() {
  try {
    const res = await apiRequest('/api/monitoring/policies');
    allMonitoringPolicies = res.data || [];

    const tbody = document.getElementById('monitoringPoliciesTableBody');
    if (!tbody) return;

    if (allMonitoringPolicies.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-slate-500">
            No detection policies found. Policies are automatically initialized per subject.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = allMonitoringPolicies
      .map((p) => {
        return `
          <tr class="hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-3 font-medium text-slate-200 text-xs">
              ${escapeHtml(p.name)}
            </td>
            <td class="py-2.5 px-3 font-mono text-[10px] text-slate-400">
              ${escapeHtml(p.subject_id)}
            </td>
            <td class="py-2.5 px-3 text-slate-300 capitalize text-xs">
              ${p.scan_schedule}
            </td>
            <td class="py-2.5 px-3 font-mono text-xs text-amber-400">
              Score ≥ ${p.alert_threshold}
            </td>
            <td class="py-2.5 px-3 font-mono text-xs text-indigo-400">
              Score ≥ ${p.human_review_threshold}
            </td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-mono uppercase ${p.is_active ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400 border border-slate-700'}">
                ${p.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load monitoring policies:', err);
  }
}

function openCandidateReview(reviewId) {
  const item = allCandidateReviews.find((r) => r.review?.id === reviewId);
  if (!item) return;

  activeReviewItem = item;
  const rev = item.review;
  const sig = item.signal;
  const subj = item.subject;
  const risk = item.risk_score;
  const factors = risk?.factors || {};

  const elUrl = document.getElementById('revContestedUrl');
  if (elUrl) {
    elUrl.textContent = sig.observed_url;
    elUrl.href = sig.observed_url;
  }
  const isYouTubeProvider = sig.adapter_name === 'youtube_readonly_adapter' || (sig.platform === 'youtube' && sig.source_type === 'external_provider');
  document.getElementById('revPlatform').textContent = isYouTubeProvider ? 'YOUTUBE (READ-ONLY PROVIDER API)' : (sig.platform?.toUpperCase() || '--');
  document.getElementById('revContentType').textContent = sig.content_type?.toUpperCase() || '--';
  document.getElementById('revSubjectName').textContent = subj.canonical_name;
  document.getElementById('revMandateRef').textContent = subj.authorization_reference;
  document.getElementById('revNormalizedUrl').textContent = sig.normalized_url || '--';

  const dupBanner = document.getElementById('revDuplicateWarning');
  const dupCaseNum = document.getElementById('revDuplicateCaseNum');
  if (item.duplicate_url_warning?.hasDuplicate) {
    if (dupBanner) dupBanner.classList.remove('hidden');
    if (dupCaseNum) dupCaseNum.textContent = item.duplicate_url_warning.duplicateCaseNumber || 'Active Case';
    const linkBtn = document.getElementById('revLinkExistingBtn');
    if (linkBtn) {
      linkBtn.onclick = () => {
        const linkRadio = document.querySelector('input[name="caseMode"][value="link_existing"]');
        if (linkRadio) {
          linkRadio.checked = true;
          linkRadio.dispatchEvent(new Event('change'));
        }
        if (item.duplicate_url_warning?.duplicateCaseId) {
          const sel = document.getElementById('revLinkCaseSelect');
          if (sel) sel.value = item.duplicate_url_warning.duplicateCaseId;
        }
      };
    }
  } else {
    if (dupBanner) dupBanner.classList.add('hidden');
  }

  const scoreVal = risk?.score ?? 0;
  const elRiskBadge = document.getElementById('revRiskBadge');
  if (elRiskBadge) {
    elRiskBadge.textContent = `RISK SCORE: ${scoreVal}/100`;
    if (scoreVal >= 80) {
      elRiskBadge.className = 'text-xs font-bold font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800';
    } else if (scoreVal >= 60) {
      elRiskBadge.className = 'text-xs font-bold font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800';
    } else {
      elRiskBadge.className = 'text-xs font-bold font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800';
    }
  }
  const confBadge = document.getElementById('revConfidenceBadge');
  if (confBadge) confBadge.textContent = `${item.correlation?.confidence_category || 'evaluated'} confidence`;

  document.getElementById('revFactorIdentity').textContent = factors.identity_match_score ?? 0;
  document.getElementById('revFactorDomain').textContent = factors.domain_similarity_score ?? 0;
  document.getElementById('revFactorKeywords').textContent = factors.scam_keyword_score ?? 0;
  document.getElementById('revFactorAsset').textContent = factors.brand_asset_abuse_score ?? 0;
  document.getElementById('revFactorHistory').textContent = `${factors.prior_history_multiplier ?? 1.0}x`;
  document.getElementById('revFactorParody').textContent = `-${factors.parody_satire_discount ?? 0}`;

  const rulesList = document.getElementById('revMatchedRulesList');
  if (rulesList) {
    const rules = item.correlation?.matched_rules || [];
    if (rules.length === 0) {
      rulesList.innerHTML = '<span class="text-[10px] text-slate-500">No specific deterministic rules matched</span>';
    } else {
      rulesList.innerHTML = rules
        .map((r) => `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-indigo-300">${escapeHtml(r)}</span>`)
        .join('');
    }
  }

  const linkCaseSelect = document.getElementById('revLinkCaseSelect');
  if (linkCaseSelect) {
    linkCaseSelect.innerHTML = '<option value="">Choose an active case...</option>' +
      allCases.map((c) => `<option value="${c.id}">${c.case_number} - ${escapeHtml(c.title)} [${c.status}]</option>`).join('');
  }

  const defaultTitle = `Impersonation Incident - ${subj.canonical_name} on ${sig.platform}`;
  const titleInput = document.getElementById('revCaseTitle');
  if (titleInput) titleInput.value = defaultTitle;

  document.getElementById('candidateDecisionForm').reset();
  if (titleInput) titleInput.value = defaultTitle;
  document.getElementById('revDecisionError')?.classList.add('hidden');

  document.getElementById('confirmCaseOptions')?.classList.remove('hidden');
  document.getElementById('falsePositiveOptions')?.classList.add('hidden');
  document.getElementById('spawnNewCaseFields')?.classList.remove('hidden');
  document.getElementById('linkExistingCaseFields')?.classList.add('hidden');

  document.getElementById('candidateReviewModal')?.classList.remove('hidden');
}

function setupMonitoringModals() {
  const btnSubQueue = document.getElementById('subtabReviewQueueBtn');
  const btnSubSubjects = document.getElementById('subtabSubjectsBtn');
  const btnSubPolicies = document.getElementById('subtabPoliciesBtn');
  const paneQueue = document.getElementById('monReviewQueuePane');
  const paneSubjects = document.getElementById('monSubjectsPane');
  const panePolicies = document.getElementById('monPoliciesPane');

  function switchMonSubTab(tab) {
    const subtabs = [
      { id: 'queue', btn: btnSubQueue, pane: paneQueue },
      { id: 'subjects', btn: btnSubSubjects, pane: paneSubjects },
      { id: 'policies', btn: btnSubPolicies, pane: panePolicies }
    ];
    subtabs.forEach((st) => {
      if (st.id === tab) {
        st.pane?.classList.remove('hidden');
        st.btn?.classList.remove('border-transparent', 'text-slate-400');
        st.btn?.classList.add('border-indigo-500', 'text-indigo-400');
      } else {
        st.pane?.classList.add('hidden');
        st.btn?.classList.remove('border-indigo-500', 'text-indigo-400');
        st.btn?.classList.add('border-transparent', 'text-slate-400');
      }
    });
  }

  btnSubQueue?.addEventListener('click', () => switchMonSubTab('queue'));
  btnSubSubjects?.addEventListener('click', () => switchMonSubTab('subjects'));
  btnSubPolicies?.addEventListener('click', () => switchMonSubTab('policies'));

  document.getElementById('filterReviewStatus')?.addEventListener('change', loadCandidateReviews);
  document.getElementById('filterReviewPriority')?.addEventListener('change', loadCandidateReviews);

  const subModal = document.getElementById('newSubjectModal');
  document.getElementById('openNewSubjectModalBtn')?.addEventListener('click', () => {
    document.getElementById('newSubjectForm')?.reset();
    document.getElementById('newSubjectError')?.classList.add('hidden');
    subModal?.classList.remove('hidden');
  });
  document.getElementById('closeNewSubjectModalBtn')?.addEventListener('click', () => subModal?.classList.add('hidden'));
  document.getElementById('cancelNewSubjectBtn')?.addEventListener('click', () => subModal?.classList.add('hidden'));

  document.getElementById('newSubjectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('newSubjectError');
    errDiv?.classList.add('hidden');

    const canonical_name = document.getElementById('subjCanonicalName').value.trim();
    const subject_type = document.getElementById('subjType').value;
    const sensitivity = document.getElementById('subjSensitivity').value;
    const authorization_basis = document.getElementById('subjAuthBasis').value;
    const authorization_reference = document.getElementById('subjAuthRef').value.trim();
    const domainsStr = document.getElementById('subjDomains').value;
    const socialUrlsStr = document.getElementById('subjSocialUrls').value;
    const handlesStr = document.getElementById('subjHandles').value;
    const monitoring_status = document.getElementById('subjStatus').value;

    const official_domains = domainsStr.split(',').map((s) => s.trim()).filter(Boolean);
    const official_social_urls = socialUrlsStr.split(',').map((s) => s.trim()).filter(Boolean);
    const handles = handlesStr.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      await apiRequest('/api/monitoring/subjects', {
        method: 'POST',
        body: JSON.stringify({
          canonical_name,
          subject_type,
          sensitivity,
          authorization_basis,
          authorization_reference,
          official_domains,
          official_social_urls,
          handles,
          monitoring_status,
          retention_policy_days: 90
        })
      });

      subModal?.classList.add('hidden');
      await loadMonitoredSubjects();
      await loadMonitoringQuota();
      alert(`Monitored subject '${canonical_name}' registered and lawful mandate verified.`);
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });

  const ingestModal = document.getElementById('ingestSignalModal');
  document.getElementById('openIngestModalBtn')?.addEventListener('click', () => {
    document.getElementById('ingestSignalForm')?.reset();
    document.getElementById('ingestSignalError')?.classList.add('hidden');
    ingestModal?.classList.remove('hidden');
  });
  document.getElementById('closeIngestModalBtn')?.addEventListener('click', () => ingestModal?.classList.add('hidden'));
  document.getElementById('cancelIngestBtn')?.addEventListener('click', () => ingestModal?.classList.add('hidden'));

  document.getElementById('ingestSignalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('ingestSignalError');
    errDiv?.classList.add('hidden');

    const subject_id = document.getElementById('ingestSubjectSelect').value;
    const observed_url = document.getElementById('ingestObservedUrl').value.trim();
    const platform = document.getElementById('ingestPlatform').value;
    const content_type = document.getElementById('ingestContentType').value;
    const snippet = document.getElementById('ingestSnippet').value.trim();

    try {
      const res = await apiRequest('/api/monitoring/signals/ingest', {
        method: 'POST',
        body: JSON.stringify({
          subject_id,
          adapter_name: 'manual_intake',
          source_type: 'manual_input',
          observed_url,
          platform,
          content_type,
          raw_payload: snippet ? { text: snippet } : {}
        })
      });

      ingestModal?.classList.add('hidden');
      await loadCandidateReviews();
      await loadMonitoringQuota();
      const statusMsg = res.data?.isDuplicate ? 'Duplicate candidate acknowledged.' : 'Candidate ingested into human review queue.';
      alert(`Success: ${statusMsg}`);
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });

  document.getElementById('btnReplayFixtures')?.addEventListener('click', async () => {
    if (allMonitoredSubjects.length === 0) {
      alert('Please register at least one monitored subject before replaying fixtures.');
      return;
    }
    const activeSubj = allMonitoredSubjects.find((s) => s.monitoring_status === 'active') || allMonitoredSubjects[0];
    if (!confirm(`Replay seed fixtures for subject '${activeSubj.canonical_name}'?`)) return;

    try {
      const res = await apiRequest('/api/monitoring/signals/replay', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: activeSubj.id,
          file_path: 'seeds/monitoring-fixtures.json'
        })
      });
      alert(`Fixture replay complete: ${res.data?.replayed_count || 0} candidate signals ingested.`);
      await loadCandidateReviews();
      await loadMonitoringQuota();
    } catch (err) {
      alert('Failed to replay fixtures: ' + err.message);
    }
  });

  document.getElementById('btnRunSimulationSweep')?.addEventListener('click', async () => {
    try {
      const res = await apiRequest('/api/monitoring/simulate-cycle', { method: 'POST' });
      const ingCount = res.data?.ingestion?.signals_ingested ?? 0;
      const evalCount = res.data?.evaluation?.candidates_evaluated ?? 0;
      alert(`Simulation sweep completed:\n- Ingestion worker processed ${ingCount} items\n- Candidate evaluation worker evaluated ${evalCount} items`);
      await loadCandidateReviews();
      await loadMonitoringQuota();
    } catch (err) {
      alert('Simulation sweep failed: ' + err.message);
    }
  });

  const revModal = document.getElementById('candidateReviewModal');
  document.getElementById('closeCandidateReviewModalBtn')?.addEventListener('click', () => revModal?.classList.add('hidden'));
  document.getElementById('cancelCandidateReviewBtn')?.addEventListener('click', () => revModal?.classList.add('hidden'));

  document.querySelectorAll('input[name="analystDecision"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      const confirmOpts = document.getElementById('confirmCaseOptions');
      const fpOpts = document.getElementById('falsePositiveOptions');
      if (val === 'confirm_impersonation') {
        confirmOpts?.classList.remove('hidden');
        fpOpts?.classList.add('hidden');
      } else if (val === 'dismiss_false_positive') {
        confirmOpts?.classList.add('hidden');
        fpOpts?.classList.remove('hidden');
      } else {
        confirmOpts?.classList.add('hidden');
        fpOpts?.classList.add('hidden');
      }
    });
  });

  document.querySelectorAll('input[name="caseMode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      const spawnFields = document.getElementById('spawnNewCaseFields');
      const linkFields = document.getElementById('linkExistingCaseFields');
      if (val === 'spawn_new') {
        spawnFields?.classList.remove('hidden');
        linkFields?.classList.add('hidden');
      } else {
        spawnFields?.classList.add('hidden');
        linkFields?.classList.remove('hidden');
      }
    });
  });

  document.getElementById('candidateDecisionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeReviewItem) return;

    const errDiv = document.getElementById('revDecisionError');
    errDiv?.classList.add('hidden');

    const decision = document.querySelector('input[name="analystDecision"]:checked')?.value;
    const decision_reason = document.getElementById('revDecisionReason').value.trim();

    if (!decision_reason || decision_reason.length < 5) {
      if (errDiv) {
        errDiv.textContent = 'Analyst determination justification must be at least 5 characters.';
        errDiv.classList.remove('hidden');
      }
      return;
    }

    let backendDecision = 'confirm_candidate';
    if (decision === 'confirm_impersonation') {
      backendDecision = 'confirm_candidate';
    } else if (decision === 'dismiss_false_positive') {
      const fpCat = document.getElementById('revFpCategory').value;
      if (fpCat === 'satire_parody') backendDecision = 'dismiss_parody';
      else if (fpCat === 'authorized_affiliate') backendDecision = 'dismiss_authorized';
      else if (fpCat === 'unrelated_same_name') backendDecision = 'dismiss_unrelated';
      else backendDecision = 'dismiss_benign';
    } else if (decision === 'quarantine_abuse') {
      backendDecision = 'quarantine_insufficient_evidence';
    }

    const payload = {
      decision: backendDecision,
      decision_reason
    };

    if (decision === 'confirm_impersonation') {
      const caseMode = document.querySelector('input[name="caseMode"]:checked')?.value;
      payload.priority = document.getElementById('revPrioritySelect').value;
      if (caseMode === 'spawn_new') {
        payload.create_new_case = true;
        payload.case_title = document.getElementById('revCaseTitle').value.trim() || undefined;
        payload.case_category = document.getElementById('revCaseCategory').value;
      } else {
        const linkCaseId = document.getElementById('revLinkCaseSelect').value;
        if (!linkCaseId) {
          if (errDiv) {
            errDiv.textContent = 'Please select an existing case to link this candidate.';
            errDiv.classList.remove('hidden');
          }
          return;
        }
        payload.link_to_existing_case_id = linkCaseId;
      }
    } else if (decision === 'dismiss_false_positive') {
      payload.false_positive_category = document.getElementById('revFpCategory').value;
    }

    try {
      await apiRequest(`/api/monitoring/reviews/${activeReviewItem.review.id}/decision`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      revModal?.classList.add('hidden');
      await loadCandidateReviews();
      await loadCases();
      alert(`Analyst decision recorded: ${decision.replace('_', ' ')}.`);
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });
}

// ============================================================================
// Phase 7: Evaluation, Red-Team Benchmarks, Suppression & Intelligence Governance
// ============================================================================

let allEvaluationRuns = [];
let allEvaluationDatasets = [];
let allEvaluationFixtures = [];
let allRulesetVersions = [];
let allSuppressionRules = [];
let currentEvalSubTab = 'runs';

function setupEvaluationNavigation() {
  document.getElementById('evalTabRunsBtn')?.addEventListener('click', () => switchEvalSubTab('runs'));
  document.getElementById('evalTabDatasetsBtn')?.addEventListener('click', () => switchEvalSubTab('datasets'));
  document.getElementById('evalTabRulesetsBtn')?.addEventListener('click', () => switchEvalSubTab('rulesets'));
  document.getElementById('evalTabSuppressionBtn')?.addEventListener('click', () => switchEvalSubTab('suppression'));
  document.getElementById('evalTabReviewersBtn')?.addEventListener('click', () => switchEvalSubTab('reviewers'));

  document.getElementById('loadSeedCatalogBtn')?.addEventListener('click', handleLoadSeedCatalog);
  document.getElementById('btnOpenNewEvalModal')?.addEventListener('click', openNewEvalRunModal);
  document.getElementById('closeNewEvalRunModalBtn')?.addEventListener('click', closeNewEvalRunModal);
  document.getElementById('cancelNewEvalRunBtn')?.addEventListener('click', closeNewEvalRunModal);
  document.getElementById('newEvalRunForm')?.addEventListener('submit', handleNewEvalRunSubmit);

  document.getElementById('btnOpenNewRulesetModal')?.addEventListener('click', openNewRulesetModal);
  document.getElementById('closeNewRulesetModalBtn')?.addEventListener('click', closeNewRulesetModal);
  document.getElementById('cancelNewRulesetBtn')?.addEventListener('click', closeNewRulesetModal);
  document.getElementById('newRulesetForm')?.addEventListener('submit', handleNewRulesetSubmit);

  document.getElementById('btnOpenNewSuppressionModal')?.addEventListener('click', openNewSuppressionModal);
  document.getElementById('closeNewSuppressionModalBtn')?.addEventListener('click', closeNewSuppressionModal);
  document.getElementById('cancelNewSuppressionBtn')?.addEventListener('click', closeNewSuppressionModal);
  document.getElementById('newSuppressionForm')?.addEventListener('submit', handleNewSuppressionSubmit);

  document.getElementById('closeAdjudicateModalBtn')?.addEventListener('click', closeAdjudicateModal);
  document.getElementById('cancelAdjudicateBtn')?.addEventListener('click', closeAdjudicateModal);
  document.getElementById('adjudicateForm')?.addEventListener('submit', handleAdjudicateSubmit);

  document.getElementById('btnRunWhatIfSim')?.addEventListener('click', handleWhatIfSimulation);
  document.getElementById('simAlertThreshold')?.addEventListener('input', (e) => {
    document.getElementById('lblAlertThresholdVal').textContent = e.target.value;
  });
  document.getElementById('simAutoLinkThreshold')?.addEventListener('input', (e) => {
    document.getElementById('lblAutoLinkVal').textContent = e.target.value;
  });

  document.getElementById('btnTestSuppression')?.addEventListener('click', handleTestSuppression);
  document.getElementById('closeSliceViewBtn')?.addEventListener('click', () => {
    document.getElementById('evalSlicesContainer')?.classList.add('hidden');
  });
  document.getElementById('fixtureCategoryFilter')?.addEventListener('change', filterFixtures);
}

function switchEvalSubTab(tab) {
  currentEvalSubTab = tab;
  const tabs = ['runs', 'datasets', 'rulesets', 'suppression', 'reviewers'];
  tabs.forEach((t) => {
    const pane = document.getElementById(`eval${t.charAt(0).toUpperCase() + t.slice(1)}Pane`);
    const btn = document.getElementById(`evalTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    if (t === tab) {
      pane?.classList.remove('hidden');
      btn?.classList.add('border-indigo-500', 'text-indigo-400');
      btn?.classList.remove('border-transparent', 'text-slate-400');
    } else {
      pane?.classList.add('hidden');
      btn?.classList.remove('border-indigo-500', 'text-indigo-400');
      btn?.classList.add('border-transparent', 'text-slate-400');
    }
  });
}

async function loadEvaluation() {
  try {
    await Promise.all([
      loadEvaluationRuns(),
      loadEvaluationDatasets(),
      loadRulesetVersions(),
      loadSuppressionRules(),
      loadEvaluationConflicts(),
      loadReviewerQuality(),
      loadFeedbackProposals(),
      loadPrivacyAudits()
    ]);
  } catch (err) {
    console.error('Failed to load evaluation data:', err);
  }
}

async function loadEvaluationRuns() {
  try {
    const res = await apiRequest('/api/evaluation/runs');
    allEvaluationRuns = res.data || [];

    if (allEvaluationRuns.length > 0) {
      const latest = allEvaluationRuns[0];
      const m = latest.summary_metrics || {};
      document.getElementById('statEvalPrecision').textContent = m.precision !== undefined ? `${(m.precision * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalRecall').textContent = m.recall !== undefined ? `${(m.recall * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalFpr').textContent = m.fpr !== undefined ? `${(m.fpr * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalFnr').textContent = m.fnr !== undefined ? `${(m.fnr * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalPAtK').textContent = m.precision_at_k !== undefined ? `${(m.precision_at_k * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalYield').textContent = m.queue_yield !== undefined ? `${(m.queue_yield * 100).toFixed(1)}%` : '--';
      document.getElementById('statEvalBrier').textContent = m.brier_score !== undefined ? m.brier_score.toFixed(3) : '--';
      document.getElementById('statEvalP95').textContent = m.p95_latency_ms !== undefined ? `${m.p95_latency_ms.toFixed(1)}ms` : '--';
      document.getElementById('statEvalCost').textContent = m.cost_inr !== undefined ? `₹${m.cost_inr.toFixed(3)}` : '₹0.00';
    }

    renderEvaluationRunsTable();
  } catch (err) {
    console.error('Failed to load evaluation runs:', err);
  }
}

function renderEvaluationRunsTable() {
  const tbody = document.getElementById('evalRunsTableBody');
  if (!tbody) return;

  if (allEvaluationRuns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="p-4 text-center text-slate-500 font-sans">No evaluation runs recorded. Click "New Evaluation Run" to evaluate against a ruleset.</td></tr>';
    return;
  }

  tbody.innerHTML = allEvaluationRuns
    .map((r) => {
      const m = r.summary_metrics || {};
      return `
        <tr class="hover:bg-slate-800/40">
          <td class="py-2.5 px-3 font-mono text-[11px] text-indigo-400">${r.id}</td>
          <td class="py-2.5 px-3 font-mono text-[11px] text-slate-200">${escapeHtml(r.ruleset_version_tag)}</td>
          <td class="py-2.5 px-3 text-slate-300">${r.total_fixtures || 0}</td>
          <td class="py-2.5 px-3 text-slate-200 font-semibold">${m.precision !== undefined ? `${(m.precision * 100).toFixed(1)}%` : '--'}</td>
          <td class="py-2.5 px-3 text-slate-200">${m.recall !== undefined ? `${(m.recall * 100).toFixed(1)}%` : '--'}</td>
          <td class="py-2.5 px-3 text-emerald-400">${m.fpr !== undefined ? `${(m.fpr * 100).toFixed(1)}%` : '--'}</td>
          <td class="py-2.5 px-3 text-rose-400">${m.fnr !== undefined ? `${(m.fnr * 100).toFixed(1)}%` : '--'}</td>
          <td class="py-2.5 px-3 text-purple-400">${m.brier_score !== undefined ? m.brier_score.toFixed(3) : '--'}</td>
          <td class="py-2.5 px-3 text-amber-400">${m.queue_yield !== undefined ? `${(m.queue_yield * 100).toFixed(1)}%` : '--'}</td>
          <td class="py-2.5 px-3 text-slate-400">${m.p95_latency_ms !== undefined ? `${m.p95_latency_ms.toFixed(1)}ms` : '--'}</td>
          <td class="py-2.5 px-3 text-[10px] text-slate-500">${new Date(r.created_at).toLocaleDateString()}</td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="viewRunSlices('${r.id}')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] border border-slate-700">
              View Slices
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function viewRunSlices(runId) {
  try {
    const res = await apiRequest(`/api/evaluation/runs/${runId}`);
    const run = res.data;
    const slices = run.sliced_metrics || {};

    document.getElementById('activeSliceRunId').textContent = `${run.id} (${run.ruleset_version_tag})`;

    // Platform Slices
    const platformContainer = document.getElementById('platformSlicesList');
    const platforms = slices.by_platform || {};
    if (Object.keys(platforms).length === 0) {
      platformContainer.innerHTML = '<div class="text-slate-500 text-[11px]">No platform slices recorded.</div>';
    } else {
      platformContainer.innerHTML = Object.keys(platforms)
        .map((p) => {
          const s = platforms[p];
          return `
            <div class="pt-1.5 pb-1 flex items-center justify-between text-[11px]">
              <span class="capitalize text-slate-300">${escapeHtml(p)}</span>
              <span class="text-slate-400 font-mono">P: ${(s.precision * 100).toFixed(0)}% | R: ${(s.recall * 100).toFixed(0)}% | N: ${s.count}</span>
            </div>
          `;
        })
        .join('');
    }

    // Score Band Slices
    const scoreContainer = document.getElementById('scoreBandSlicesList');
    const bands = slices.by_score_band || {};
    if (Object.keys(bands).length === 0) {
      scoreContainer.innerHTML = '<div class="text-slate-500 text-[11px]">No score band slices recorded.</div>';
    } else {
      scoreContainer.innerHTML = Object.keys(bands)
        .map((b) => {
          const s = bands[b];
          return `
            <div class="pt-1.5 pb-1 flex items-center justify-between text-[11px]">
              <span class="capitalize text-slate-300">${escapeHtml(b)}</span>
              <span class="text-slate-400 font-mono">P: ${(s.precision * 100).toFixed(0)}% | Count: ${s.count}</span>
            </div>
          `;
        })
        .join('');
    }

    // Category Slices
    const catContainer = document.getElementById('categorySlicesList');
    const cats = slices.by_category || {};
    if (Object.keys(cats).length === 0) {
      catContainer.innerHTML = '<div class="text-slate-500 text-[11px]">No category slices recorded.</div>';
    } else {
      catContainer.innerHTML = Object.keys(cats)
        .map((c) => {
          const s = cats[c];
          return `
            <div class="pt-1.5 pb-1 flex items-center justify-between text-[11px]">
              <span class="text-slate-300 truncate max-w-[140px]" title="${escapeHtml(c)}">${formatCategory(c)}</span>
              <span class="text-slate-400 font-mono">P: ${(s.precision * 100).toFixed(0)}% | R: ${(s.recall * 100).toFixed(0)}%</span>
            </div>
          `;
        })
        .join('');
    }

    document.getElementById('evalSlicesContainer').classList.remove('hidden');
  } catch (err) {
    alert('Failed to load run slices: ' + err.message);
  }
}

async function loadEvaluationDatasets() {
  try {
    const res = await apiRequest('/api/evaluation/datasets');
    allEvaluationDatasets = res.data || [];

    const datasetsContainer = document.getElementById('evalDatasetsList');
    if (allEvaluationDatasets.length === 0) {
      datasetsContainer.innerHTML = '<div class="text-slate-500 text-xs">No datasets found. Load the seed catalog to initialize.</div>';
    } else {
      datasetsContainer.innerHTML = allEvaluationDatasets
        .map(
          (d) => `
          <div class="p-2.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-semibold text-slate-200">${escapeHtml(d.name)}</div>
              <div class="text-[10px] text-slate-500 font-mono">Version: ${escapeHtml(d.version)} | Items: ${d.fixture_count || 0}</div>
            </div>
            <button onclick="loadFixturesForDataset('${d.id}')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 text-[10px]">
              Inspect
            </button>
          </div>
        `
        )
        .join('');

      // Populate run dataset dropdown
      const runDsSelect = document.getElementById('evalRunDatasetSelect');
      if (runDsSelect) {
        runDsSelect.innerHTML = allEvaluationDatasets
          .map((d) => `<option value="${d.id}">${escapeHtml(d.name)} (${d.version})</option>`)
          .join('');
      }

      // Load fixtures for first dataset automatically
      if (allEvaluationDatasets.length > 0) {
        await loadFixturesForDataset(allEvaluationDatasets[0].id);
      }
    }
  } catch (err) {
    console.error('Failed to load evaluation datasets:', err);
  }
}

async function loadFixturesForDataset(datasetId) {
  try {
    const res = await apiRequest(`/api/evaluation/datasets/${datasetId}/fixtures`);
    allEvaluationFixtures = res.data || [];
    renderFixturesTable(allEvaluationFixtures);
  } catch (err) {
    console.error('Failed to load fixtures:', err);
  }
}

function renderFixturesTable(fixtures) {
  const tbody = document.getElementById('evalFixturesTableBody');
  if (!tbody) return;

  if (!fixtures || fixtures.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500 font-sans">No fixtures found matching filter.</td></tr>';
    return;
  }

  tbody.innerHTML = fixtures
    .map(
      (f) => `
      <tr class="hover:bg-slate-800/40">
        <td class="py-2 px-3">
          <div class="font-medium text-slate-200 text-xs">${escapeHtml(f.synthetic_subject?.canonical_name || 'Subject')}</div>
          <div class="font-mono text-[10px] text-slate-500 truncate max-w-xs" title="${escapeHtml(f.normalized_url)}">${escapeHtml(f.normalized_url)}</div>
        </td>
        <td class="py-2 px-3 capitalize text-slate-400">${escapeHtml(f.synthetic_platform || 'web')}</td>
        <td class="py-2 px-3 text-slate-300 text-[11px]">${formatCategory(f.scenario_category || '')}</td>
        <td class="py-2 px-3">
          <span class="px-1.5 py-0.2 rounded text-[10px] font-mono ${
            f.expected_label === 'impersonation'
              ? 'bg-rose-950 text-rose-400 border border-rose-800'
              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
          }">
            ${f.expected_label}
          </span>
        </td>
        <td class="py-2 px-3 font-mono text-[11px] capitalize text-slate-400">${f.expected_score_band || '--'}</td>
        <td class="py-2 px-3 text-right">
          <button onclick="openAdjudicateConflict('${f.id}')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]">
            Adjudicate
          </button>
        </td>
      </tr>
    `
    )
    .join('');
}

function filterFixtures() {
  const selectedCat = document.getElementById('fixtureCategoryFilter').value;
  if (!selectedCat) {
    renderFixturesTable(allEvaluationFixtures);
  } else {
    const filtered = allEvaluationFixtures.filter((f) => f.scenario_category === selectedCat);
    renderFixturesTable(filtered);
  }
}

async function loadEvaluationConflicts() {
  try {
    const res = await apiRequest('/api/evaluation/fixtures/conflicts');
    const conflicts = res.data || [];
    const container = document.getElementById('conflictsListContainer');
    const badge = document.getElementById('conflictCountBadge');
    badge.textContent = conflicts.length;

    if (conflicts.length === 0) {
      container.innerHTML = '<div class="text-slate-500 text-xs">No pending adjudication conflicts. All fixtures in gold consensus.</div>';
      return;
    }

    container.innerHTML = conflicts
      .map(
        (c) => `
        <div class="p-2.5 rounded bg-slate-900 border border-amber-900/50 flex items-center justify-between">
          <div class="space-y-0.5 max-w-lg">
            <div class="font-mono text-[11px] text-amber-300 break-all">${escapeHtml(c.normalized_url)}</div>
            <div class="text-[10px] text-slate-400">Total Labels: ${c.total_labels} | Concordance Rate: ${(c.concordance_rate * 100).toFixed(0)}%</div>
          </div>
          <button onclick="openAdjudicateConflict('${c.fixture_id}')" class="px-3 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white font-medium text-xs">
            Resolve Conflict
          </button>
        </div>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load evaluation conflicts:', err);
  }
}

async function openAdjudicateConflict(fixtureId) {
  try {
    const res = await apiRequest(`/api/evaluation/fixtures/${fixtureId}/consensus`);
    const fix = res.data;
    document.getElementById('adjFixtureId').value = fixtureId;
    document.getElementById('adjFixtureUrl').textContent = fix.normalized_url || fixtureId;
    document.getElementById('adjudicateConflictModal').classList.remove('hidden');
  } catch (err) {
    document.getElementById('adjFixtureId').value = fixtureId;
    document.getElementById('adjFixtureUrl').textContent = fixtureId;
    document.getElementById('adjudicateConflictModal').classList.remove('hidden');
  }
}

function closeAdjudicateModal() {
  document.getElementById('adjudicateConflictModal').classList.add('hidden');
}

async function handleAdjudicateSubmit(e) {
  e.preventDefault();
  const fixtureId = document.getElementById('adjFixtureId').value;
  const label = document.getElementById('adjFinalLabel').value;
  const rationale = document.getElementById('adjRationale').value;
  const errDiv = document.getElementById('adjudicateError');

  try {
    await apiRequest(`/api/evaluation/fixtures/${fixtureId}/adjudicate`, {
      method: 'POST',
      body: JSON.stringify({
        adjudicated_label: label,
        rationale
      })
    });

    closeAdjudicateModal();
    alert('Fixture consensus adjudication recorded successfully.');
    await loadEvaluationConflicts();
    await loadEvaluationDatasets();
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  }
}

async function handleLoadSeedCatalog() {
  if (!confirm('Load the 20-category synthetic evaluation fixture catalog with RFC 2606 reserved domains?')) {
    return;
  }

  try {
    const res = await apiRequest('/api/evaluation/seed-catalog', { method: 'POST' });
    alert(`Seed catalog loaded successfully! ${res.data?.fixtures_loaded || 20} fixtures registered across 20 scenario categories.`);
    await loadEvaluation();
  } catch (err) {
    alert('Failed to load seed catalog: ' + err.message);
  }
}

async function loadRulesetVersions() {
  try {
    const res = await apiRequest('/api/evaluation/rulesets');
    allRulesetVersions = res.data || [];

    const simSelect = document.getElementById('simRulesetSelect');
    const runRulesetSelect = document.getElementById('evalRunRulesetSelect');

    const optionsHtml = allRulesetVersions
      .map((r) => `<option value="${r.id}">${escapeHtml(r.version_tag)} - ${escapeHtml(r.name)} [${r.status}]</option>`)
      .join('');

    if (simSelect) simSelect.innerHTML = optionsHtml;
    if (runRulesetSelect) runRulesetSelect.innerHTML = optionsHtml;

    renderRulesetsTable();
  } catch (err) {
    console.error('Failed to load ruleset versions:', err);
  }
}

function renderRulesetsTable() {
  const tbody = document.getElementById('evalRulesetsTableBody');
  if (!tbody) return;

  if (allRulesetVersions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-500 font-sans">No rulesets found. Create a draft ruleset to get started.</td></tr>';
    return;
  }

  tbody.innerHTML = allRulesetVersions
    .map((r) => {
      const presets = r.threshold_presets || {};
      const statusBadge =
        r.status === 'active'
          ? '<span class="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-mono">ACTIVE</span>'
          : r.status === 'approved'
          ? '<span class="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-400 border border-indigo-800 text-[10px] font-mono">APPROVED</span>'
          : '<span class="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px] font-mono">DRAFT</span>';

      return `
        <tr class="hover:bg-slate-800/40">
          <td class="py-2.5 px-3 font-mono text-[11px] text-indigo-400 font-semibold">${escapeHtml(r.version_tag)}</td>
          <td class="py-2.5 px-3 text-slate-200">${escapeHtml(r.name)}</td>
          <td class="py-2.5 px-3">${statusBadge}</td>
          <td class="py-2.5 px-3 font-mono text-[10px] text-slate-400 max-w-[120px] truncate" title="${r.checksum}">${r.checksum ? r.checksum.slice(0, 12) + '...' : '--'}</td>
          <td class="py-2.5 px-3 text-slate-300">${presets.alert_threshold || 0.70}</td>
          <td class="py-2.5 px-3 text-slate-300">${presets.auto_link_threshold || 0.85}</td>
          <td class="py-2.5 px-3 text-[10px] text-slate-500">${r.activated_at ? new Date(r.activated_at).toLocaleDateString() : 'Not Active'}</td>
          <td class="py-2.5 px-3 text-right space-x-1">
            ${
              r.status === 'draft'
                ? `<button onclick="approveRuleset('${r.id}')" class="px-2 py-0.5 rounded bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-[10px]">Approve</button>`
                : ''
            }
            ${
              r.status === 'approved'
                ? `<button onclick="activateRuleset('${r.id}')" class="px-2 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px]">Activate</button>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

async function approveRuleset(rulesetId) {
  try {
    await apiRequest(`/api/evaluation/rulesets/${rulesetId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ justification: 'Approved via operational dashboard' })
    });
    alert('Ruleset version approved.');
    await loadRulesetVersions();
  } catch (err) {
    alert('Approval failed: ' + err.message);
  }
}

async function activateRuleset(rulesetId) {
  try {
    await apiRequest(`/api/evaluation/rulesets/${rulesetId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Activated via operational dashboard' })
    });
    alert('Ruleset version activated for production scoring.');
    await loadRulesetVersions();
  } catch (err) {
    alert('Activation failed: ' + err.message);
  }
}

async function handleWhatIfSimulation() {
  const rulesetId = document.getElementById('simRulesetSelect').value;
  const alertThresh = parseFloat(document.getElementById('simAlertThreshold').value);
  const autoLinkThresh = parseFloat(document.getElementById('simAutoLinkThreshold').value);
  if (!rulesetId) {
    alert('Please select a ruleset version first.');
    return;
  }

  try {
    const res = await apiRequest(`/api/evaluation/rulesets/${rulesetId}/simulate`, {
      method: 'POST',
      body: JSON.stringify({
        alert_threshold: alertThresh,
        auto_link_threshold: autoLinkThresh
      })
    });

    const sim = res.data;
    document.getElementById('simTotalEval').textContent = sim.total_evaluated || 0;
    document.getElementById('simAlerts').textContent = sim.simulated_alerts || 0;
    document.getElementById('simCases').textContent = sim.simulated_cases || 0;
    document.getElementById('simSuppressions').textContent = sim.simulated_false_positive_suppressions || 0;
    document.getElementById('simYield').textContent = `${((sim.projected_queue_yield || 0) * 100).toFixed(1)}%`;
    document.getElementById('simAvgScore').textContent = sim.average_simulated_score || 0;

    document.getElementById('whatIfResultBox').classList.remove('hidden');
  } catch (err) {
    alert('Simulation failed: ' + err.message);
  }
}

async function loadSuppressionRules() {
  try {
    const res = await apiRequest('/api/evaluation/suppression-rules');
    allSuppressionRules = res.data || [];
    renderSuppressionTable();
  } catch (err) {
    console.error('Failed to load suppression rules:', err);
  }
}

function renderSuppressionTable() {
  const tbody = document.getElementById('evalSuppressionTableBody');
  if (!tbody) return;

  if (allSuppressionRules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-500 font-sans">No suppression rules registered. Click "+ New Suppression Rule" to suppress known false positives.</td></tr>';
    return;
  }

  tbody.innerHTML = allSuppressionRules
    .map(
      (r) => `
      <tr class="hover:bg-slate-800/40">
        <td class="py-2.5 px-3 font-semibold text-slate-200">${escapeHtml(r.name)}</td>
        <td class="py-2.5 px-3 capitalize text-slate-300 text-[11px]">${formatCategory(r.rule_type || '')}</td>
        <td class="py-2.5 px-3 font-mono text-[10px] text-slate-400">${r.pattern_type}</td>
        <td class="py-2.5 px-3 font-mono text-[11px] text-indigo-300 break-all">${escapeHtml(r.pattern)}</td>
        <td class="py-2.5 px-3 text-slate-400 text-xs max-w-xs truncate" title="${escapeHtml(r.justification)}">${escapeHtml(r.justification)}</td>
        <td class="py-2.5 px-3 text-[10px] text-slate-500">${new Date(r.expires_at).toLocaleDateString()}</td>
        <td class="py-2.5 px-3 text-center font-mono ${r.human_override_count > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}">${r.human_override_count || 0}</td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="expireSuppressionRule('${r.id}')" class="px-2 py-0.5 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 text-[10px] border border-rose-800">
            Expire
          </button>
        </td>
      </tr>
    `
    )
    .join('');
}

async function expireSuppressionRule(ruleId) {
  if (!confirm('Immediately expire this suppression rule?')) return;
  try {
    await apiRequest(`/api/evaluation/suppression-rules/${ruleId}`, { method: 'DELETE' });
    alert('Suppression rule expired.');
    await loadSuppressionRules();
  } catch (err) {
    alert('Failed to expire rule: ' + err.message);
  }
}

async function handleTestSuppression() {
  const url = document.getElementById('suppressTestUrl').value.trim();
  const rawPayload = document.getElementById('suppressTestPayload').value.trim();
  const sensitivity = document.getElementById('suppressTestSensitivity').value;
  const resultBox = document.getElementById('suppressTestResultBox');

  if (!url) {
    alert('Please enter a target URL to test.');
    return;
  }

  try {
    const res = await apiRequest('/api/evaluation/suppression-rules/test', {
      method: 'POST',
      body: JSON.stringify({
        url,
        raw_payload: rawPayload ? { content: rawPayload } : {},
        subject_sensitivity: sensitivity
      })
    });

    const result = res.data;
    resultBox.classList.remove('hidden');

    if (result.isSuppressed) {
      resultBox.className = 'p-3 bg-emerald-950/60 border border-emerald-800 rounded text-xs font-mono text-emerald-300';
      resultBox.innerHTML = `
        <div class="font-bold">✅ SIGNAL WOULD BE SUPPRESSED</div>
        <div class="mt-1 text-slate-300">Reason: ${escapeHtml(result.reason || 'Matched suppression pattern')}</div>
        <div class="text-slate-400">Rule Type: ${result.suppressionCategory || 'N/A'}</div>
      `;
    } else {
      const isFailClosed = (result.reason || '').includes('FAIL_CLOSED');
      resultBox.className = isFailClosed
        ? 'p-3 bg-rose-950/60 border border-rose-800 rounded text-xs font-mono text-rose-300'
        : 'p-3 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-slate-300';
      resultBox.innerHTML = `
        <div class="font-bold">${isFailClosed ? '🛡️ FAIL-CLOSED SAFEGUARD TRIGGERED' : 'ℹ️ SIGNAL NOT SUPPRESSED'}</div>
        <div class="mt-1 text-slate-300">Reason: ${escapeHtml(result.reason || 'No suppression rule matched this signal')}</div>
      `;
    }
  } catch (err) {
    alert('Suppression test failed: ' + err.message);
  }
}

async function loadReviewerQuality() {
  try {
    const res = await apiRequest('/api/evaluation/reviewers');
    const reviewers = res.data || [];
    const tbody = document.getElementById('evalReviewersTableBody');
    if (!tbody) return;

    if (reviewers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 font-sans">No reviewer labels recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = reviewers
      .map(
        (r) => `
        <tr class="hover:bg-slate-800/40">
          <td class="py-2 px-3 font-mono text-[11px] text-slate-200">${escapeHtml(r.reviewer_id)}</td>
          <td class="py-2 px-3 text-slate-300">${r.total_labels_submitted}</td>
          <td class="py-2 px-3 text-slate-200 font-semibold">${(r.concordance_rate * 100).toFixed(1)}%</td>
          <td class="py-2 px-3 text-slate-300 font-mono">${(r.inter_rater_reliability || 0).toFixed(3)}</td>
          <td class="py-2 px-3">
            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono ${
              r.drift_detected
                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
            }">
              ${r.drift_detected ? 'DRIFT DETECTED' : 'CALIBRATED'}
            </span>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load reviewer quality:', err);
  }
}

async function loadFeedbackProposals() {
  try {
    const res = await apiRequest('/api/evaluation/feedback-proposals');
    const proposals = res.data || [];
    const container = document.getElementById('evalFeedbackProposalsList');
    if (!container) return;

    if (proposals.length === 0) {
      container.innerHTML = '<div class="text-slate-500 text-xs">No pending feedback proposals.</div>';
      return;
    }

    container.innerHTML = proposals
      .map(
        (p) => `
        <div class="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-200">${escapeHtml(p.proposed_rule_name)}</span>
            <span class="text-[10px] font-mono text-indigo-400 uppercase">${p.proposed_category}</span>
          </div>
          <div class="font-mono text-[10px] text-slate-400 break-all">Pattern: ${escapeHtml(p.proposed_pattern)}</div>
          <p class="text-[11px] text-slate-500">${escapeHtml(p.justification)}</p>
        </div>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load feedback proposals:', err);
  }
}

async function loadPrivacyAudits() {
  try {
    const res = await apiRequest('/api/evaluation/privacy-audits');
    const audits = res.data || [];
    const tbody = document.getElementById('evalPrivacyAuditTableBody');
    if (!tbody) return;

    if (audits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500 font-sans">No privacy audits recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = audits
      .map(
        (a) => `
        <tr class="hover:bg-slate-800/40">
          <td class="py-2 px-3 font-mono text-[10px] text-indigo-400">${a.id}</td>
          <td class="py-2 px-3 text-slate-300">${escapeHtml(a.target_entity)}</td>
          <td class="py-2 px-3 text-emerald-400 font-semibold">${a.pii_scan_clean ? 'Clean (0 PII)' : 'Violations Found'}</td>
          <td class="py-2 px-3 text-emerald-400">${a.rfc_2606_compliant ? 'RFC 2606 Compliant' : 'Non-Compliant'}</td>
          <td class="py-2 px-3 font-mono text-[10px] text-slate-400">${a.audited_by}</td>
          <td class="py-2 px-3 text-[10px] text-slate-500">${new Date(a.created_at).toLocaleDateString()}</td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load privacy audits:', err);
  }
}

// Modal Handlers
function openNewEvalRunModal() {
  document.getElementById('newEvalRunModal').classList.remove('hidden');
}
function closeNewEvalRunModal() {
  document.getElementById('newEvalRunModal').classList.add('hidden');
}
async function handleNewEvalRunSubmit(e) {
  e.preventDefault();
  const datasetId = document.getElementById('evalRunDatasetSelect').value;
  const rulesetId = document.getElementById('evalRunRulesetSelect').value;
  const runName = document.getElementById('evalRunNameInput').value;
  const errDiv = document.getElementById('newEvalRunError');

  try {
    await apiRequest('/api/evaluation/runs', {
      method: 'POST',
      body: JSON.stringify({
        dataset_id: datasetId,
        ruleset_id: rulesetId,
        run_name: runName || undefined
      })
    });

    closeNewEvalRunModal();
    alert('Evaluation run completed successfully!');
    await loadEvaluationRuns();
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  }
}

function openNewRulesetModal() {
  document.getElementById('newRulesetModal').classList.remove('hidden');
}
function closeNewRulesetModal() {
  document.getElementById('newRulesetModal').classList.add('hidden');
}
async function handleNewRulesetSubmit(e) {
  e.preventDefault();
  const versionTag = document.getElementById('rulesetVersionTag').value;
  const name = document.getElementById('rulesetName').value;
  const description = document.getElementById('rulesetDescription').value;
  const errDiv = document.getElementById('newRulesetError');

  const factorWeights = {
    exact_handle_weight: parseInt(document.getElementById('weightHandle').value, 10),
    name_alias_weight: parseInt(document.getElementById('weightName').value, 10),
    domain_similarity_weight: parseInt(document.getElementById('weightDomain').value, 10),
    scam_keywords_weight: parseInt(document.getElementById('weightKeywords').value, 10),
    brand_asset_weight: parseInt(document.getElementById('weightAsset').value, 10),
    prior_violation_multiplier: 1.25,
    parody_discount_multiplier: parseFloat(document.getElementById('weightParody').value)
  };

  const thresholdPresets = {
    alert_threshold: parseFloat(document.getElementById('threshAlert').value),
    auto_link_threshold: parseFloat(document.getElementById('threshAutoLink').value),
    human_review_threshold: parseFloat(document.getElementById('threshHuman').value)
  };

  try {
    await apiRequest('/api/evaluation/rulesets', {
      method: 'POST',
      body: JSON.stringify({
        version_tag: versionTag,
        name,
        description,
        factor_weights: factorWeights,
        threshold_presets: thresholdPresets
      })
    });

    closeNewRulesetModal();
    alert('Draft ruleset created successfully.');
    await loadRulesetVersions();
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  }
}

function openNewSuppressionModal() {
  document.getElementById('newSuppressionModal').classList.remove('hidden');
}
function closeNewSuppressionModal() {
  document.getElementById('newSuppressionModal').classList.add('hidden');
}
async function handleNewSuppressionSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('suppRuleName').value;
  const ruleType = document.getElementById('suppRuleType').value;
  const patternType = document.getElementById('suppPatternType').value;
  const pattern = document.getElementById('suppPattern').value;
  const justification = document.getElementById('suppJustification').value;
  const expiresInDays = parseInt(document.getElementById('suppExpiresDays').value, 10);
  const rulesetVersion = document.getElementById('suppRulesetVersion').value;
  const errDiv = document.getElementById('newSuppressionError');

  try {
    await apiRequest('/api/evaluation/suppression-rules', {
      method: 'POST',
      body: JSON.stringify({
        name,
        rule_type: ruleType,
        pattern_type: patternType,
        pattern,
        justification,
        expires_in_days: expiresInDays,
        ruleset_version: rulesetVersion
      })
    });

    closeNewSuppressionModal();
    alert('Suppression rule registered successfully.');
    await loadSuppressionRules();
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  }
}

// ----------------------------------------------------------------------------
// Phase 8: Controlled Read-Only Integrations Functions
// ----------------------------------------------------------------------------

async function loadIntegrations() {
  try {
    let statusData = null;
    let canaryEnabled = false;
    let killSwitchActive = false;

    try {
      const statusRes = await apiRequest('/api/integrations/status');
      statusData = statusRes.data;
      canaryEnabled = statusData.canary_enabled === true;
      killSwitchActive = statusData.kill_switch_active === true;
    } catch (e) {
      console.warn('Status check warning:', e);
    }

    const canaryBadge = document.getElementById('integrationsCanaryBadge');
    const connectBtn = document.getElementById('btnOpenConnectIntegrationModal');
    if (canaryBadge) {
      if (canaryEnabled) {
        canaryBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono';
        canaryBadge.textContent = 'Canary Pilot: ENABLED';
        if (connectBtn) {
          connectBtn.disabled = false;
          connectBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          connectBtn.title = 'Add authorized read-only YouTube connection';
        }
      } else {
        canaryBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono';
        canaryBadge.textContent = 'Canary Pilot: RESTRICTED';
        if (connectBtn) {
          connectBtn.disabled = true;
          connectBtn.classList.add('opacity-50', 'cursor-not-allowed');
          connectBtn.title = 'Tenant is not enrolled in Phase 8 canary pilot';
        }
      }
    }

    updateKillSwitchUI(killSwitchActive, statusData);

    if (canaryEnabled) {
      await loadProviderConnections();
    } else {
      renderNonCanaryNotice();
    }

    await loadIntegrationSignals();
  } catch (err) {
    console.error('Failed to load integrations view:', err);
  }
}

function renderNonCanaryNotice() {
  const tbody = document.getElementById('integrationsTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center bg-slate-950/40">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-amber-950/80 border border-amber-800 text-amber-300 text-xs font-semibold mb-2">
            <span>🔒 Canary Pilot Gated Feature</span>
          </div>
          <p class="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Controlled Read-Only Integrations are currently restricted to pilot canary organizations (<code class="text-slate-300">is_integration_canary_enabled = 1</code>).
            Contact your system administrator to enroll this tenant into the canary evaluation ring.
          </p>
        </td>
      </tr>
    `;
  }
}

function updateKillSwitchUI(isActive, statusData) {
  activeKillSwitchState = { is_active: isActive };
  const btn = document.getElementById('toggleKillSwitchBtn');
  const indicator = document.getElementById('killSwitchIndicator');
  const label = document.getElementById('killSwitchStatusLabel');
  const hud = document.getElementById('statKillSwitchHUD');
  const hudDetail = document.getElementById('statKillSwitchDetail');

  if (isActive) {
    if (btn) {
      btn.className = 'bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors animate-pulse';
    }
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-rose-400';
    if (label) label.textContent = 'Kill Switch: ARMED (HALTED)';
    if (hud) {
      hud.textContent = 'ARMED (Suspended)';
      hud.className = 'text-sm font-bold text-rose-400 mt-1 font-mono';
    }
    if (hudDetail) hudDetail.textContent = 'All ingestion & webhooks rejected';
  } else {
    if (btn) {
      btn.className = 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors';
    }
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-emerald-400';
    if (label) label.textContent = 'Kill Switch: Operational';
    if (hud) {
      hud.textContent = 'DISARMED (Normal)';
      hud.className = 'text-sm font-bold text-emerald-400 mt-1 font-mono';
    }
    if (hudDetail) hudDetail.textContent = 'Ingestion pipeline active';
  }
}

async function loadProviderConnections() {
  const tbody = document.getElementById('integrationsTableBody');
  if (!tbody) return;

  try {
    const res = await apiRequest('/api/integrations/connections');
    allProviderConnections = res.data || [];

    const statConnStatus = document.getElementById('statConnectionStatus');
    const statConnDetail = document.getElementById('statConnectionDetail');
    const statCircuit = document.getElementById('statCircuitState');
    const statCircuitFailures = document.getElementById('statCircuitFailures');

    if (allProviderConnections.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-6 text-center text-slate-500">
            No active provider connections. Click "+ Connect YouTube Channel" to initiate canary pilot onboarding.
          </td>
        </tr>
      `;
      if (statConnStatus) {
        statConnStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>Not Connected</span>';
        statConnStatus.className = 'text-sm font-bold text-slate-400 mt-1 flex items-center gap-1.5 font-mono';
      }
      if (statConnDetail) statConnDetail.textContent = '0 active accounts';
      if (statCircuit) {
        statCircuit.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>CLOSED (Healthy)</span>';
        statCircuit.className = 'text-sm font-bold text-emerald-400 mt-1 flex items-center gap-1.5 font-mono';
      }
      if (statCircuitFailures) statCircuitFailures.textContent = '0 consecutive errors';
      return;
    }

    const firstConn = allProviderConnections[0];
    const circuit = firstConn.circuit_state || { state: 'closed', failure_count: 0 };

    if (statConnStatus) {
      const isOnline = firstConn.status === 'active';
      const color = isOnline ? 'emerald' : firstConn.status === 'paused' ? 'amber' : 'rose';
      statConnStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-${color}-400"></span><span class="capitalize">${firstConn.status}</span>`;
      statConnStatus.className = `text-sm font-bold text-${color}-400 mt-1 flex items-center gap-1.5 font-mono`;
    }
    if (statConnDetail) {
      statConnDetail.textContent = `${firstConn.account_identifier} (${firstConn.account_metadata?.title || 'YouTube Channel'})`;
    }

    if (statCircuit) {
      const cState = circuit.state || 'closed';
      const cColor = cState === 'closed' ? 'emerald' : cState === 'half_open' ? 'amber' : 'rose';
      statCircuit.innerHTML = `<span class="w-2 h-2 rounded-full bg-${cColor}-400"></span><span>${cState.toUpperCase()}</span>`;
      statCircuit.className = `text-sm font-bold text-${cColor}-400 mt-1 flex items-center gap-1.5 font-mono`;
    }
    if (statCircuitFailures) {
      statCircuitFailures.textContent = `${circuit.failure_count || 0} consecutive failures`;
    }

    tbody.innerHTML = allProviderConnections.map((conn) => {
      const meta = conn.account_metadata || {};
      const cState = conn.circuit_state?.state || 'closed';
      const cColor = cState === 'closed' ? 'text-emerald-400' : cState === 'half_open' ? 'text-amber-400' : 'text-rose-400';
      const subjects = (conn.subjects || []).map((s) => s.canonical_name).join(', ') || 'No subject linked';
      const lastSync = conn.last_sync_at ? new Date(conn.last_sync_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';

      const statusBadge = conn.status === 'active'
        ? '<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-semibold">Active</span>'
        : conn.status === 'paused'
        ? '<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-mono font-semibold">Paused</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 border border-rose-800 font-mono font-semibold">Error</span>';

      return `
        <tr class="hover:bg-slate-800/40 transition-colors">
          <td class="py-2.5 px-3">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 bg-red-950 text-red-400 border border-red-800 rounded font-mono text-[10px] font-bold">YouTube</span>
              <div>
                <div class="font-medium text-slate-200">${escapeHtml(meta.title || conn.account_identifier)}</div>
                <div class="text-[10px] text-slate-500 font-mono">${escapeHtml(conn.account_identifier)}</div>
              </div>
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="text-slate-200 text-xs font-medium">${escapeHtml(subjects)}</div>
            <button onclick="window.openMapSubjectsModal('${conn.id}')" class="text-[10px] text-indigo-400 hover:underline">Edit Mappings</button>
          </td>
          <td class="py-2.5 px-3">
            <span class="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/60">youtube.readonly</span>
          </td>
          <td class="py-2.5 px-3">
            ${statusBadge}
          </td>
          <td class="py-2.5 px-3">
            <span class="font-mono text-[10px] font-semibold ${cColor}">
              ${cState.toUpperCase()} (${conn.circuit_state?.failure_count || 0}/5)
            </span>
          </td>
          <td class="py-2.5 px-3 text-slate-400 text-[11px]">
            <div>Last: ${lastSync}</div>
          </td>
          <td class="py-2.5 px-3 text-right space-x-1 whitespace-nowrap">
            <button onclick="window.handleSyncConnection('${conn.id}')" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium" title="Trigger incremental sync">
              Sync Now
            </button>
            <button onclick="window.handleTogglePauseConnection('${conn.id}', '${conn.status}')" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700">
              ${conn.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button onclick="window.handleDisconnectConnection('${conn.id}')" class="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-[10px] border border-rose-800" title="Disconnect and wipe credentials">
              Disconnect
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load provider connections:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-rose-400">
          Failed to load provider connections: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

async function loadIntegrationSignals() {
  const tbody = document.getElementById('integrationSignalsTableBody');
  const countEl = document.getElementById('statExternalSignalsCount');
  if (!tbody) return;

  try {
    const res = await apiRequest('/api/monitoring/reviews?limit=50');
    const reviews = res.data || [];
    const ytReviews = reviews.filter((r) => r.signal?.adapter_name === 'youtube_readonly_adapter' || r.signal?.platform === 'youtube');
    allIntegrationSignals = ytReviews;

    if (countEl) countEl.textContent = ytReviews.length;

    if (ytReviews.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-slate-500">
            No external YouTube signals ingested yet. Trigger a sync or publish a video to receive WebSub pushes.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = ytReviews.map((item) => {
      const sig = item.signal;
      const subj = item.subject;
      const rev = item.review;
      const obsDate = sig.observed_at ? new Date(sig.observed_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';

      const statusBadge = rev.status === 'pending'
        ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-medium">Pending Review</span>'
        : rev.status === 'confirmed'
        ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-medium">Confirmed Incident</span>'
        : '<span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">Dismissed</span>';

      const isPush = sig.raw_payload?.source === 'websub_push' || sig.raw_payload?.delivery_mode === 'websub_push';

      return `
        <tr class="hover:bg-slate-800/40 transition-colors">
          <td class="py-2.5 px-3 max-w-xs">
            <a href="${escapeHtml(sig.observed_url)}" target="_blank" class="text-indigo-400 hover:underline truncate block font-mono text-[11px]" title="${escapeHtml(sig.observed_url)}">
              ${escapeHtml(sig.observed_url)}
            </a>
            <div class="text-[10px] text-slate-500 truncate mt-0.5">
              ${escapeHtml(sig.raw_payload?.title || sig.content_type || 'Video Item')}
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="text-slate-200 text-xs font-medium">${escapeHtml(subj.canonical_name)}</div>
            <div class="text-[10px] text-slate-500 font-mono">${escapeHtml(subj.authorization_reference)}</div>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              ${isPush ? 'WebSub Webhook' : 'Incremental Polling'}
            </span>
          </td>
          <td class="py-2.5 px-3 text-slate-400 text-[11px]">
            ${obsDate}
          </td>
          <td class="py-2.5 px-3">
            ${statusBadge}
          </td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="window.openCandidateReview('${rev.id}')" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors">
              Review
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load integration signals:', err);
  }
}

async function handleSyncConnection(connectionId) {
  try {
    const res = await apiRequest(`/api/integrations/connections/${connectionId}/sync`, { method: 'POST' });
    const stats = res.data?.stats || {};
    alert(`Sync completed successfully.\nVideos processed: ${stats.videos_synced || 0}\nLookalikes discovered: ${stats.lookalikes_synced || 0}`);
    await loadIntegrations();
    await loadCandidateReviews();
  } catch (err) {
    alert('Sync failed: ' + err.message);
  }
}

async function handleTogglePauseConnection(connectionId, currentStatus) {
  try {
    const action = currentStatus === 'paused' ? 'resume' : 'pause';
    await apiRequest(`/api/integrations/connections/${connectionId}/${action}`, { method: 'POST' });
    await loadIntegrations();
  } catch (err) {
    alert(`Failed to ${currentStatus === 'paused' ? 'resume' : 'pause'} connection: ` + err.message);
  }
}

async function handleDisconnectConnection(connectionId) {
  if (!confirm('Are you sure you want to disconnect this YouTube channel? All stored OAuth credentials will be securely wiped and WebSub subscriptions revoked.')) {
    return;
  }
  try {
    await apiRequest(`/api/integrations/connections/${connectionId}/disconnect`, { method: 'POST' });
    alert('Connection disconnected and credentials purged.');
    await loadIntegrations();
  } catch (err) {
    alert('Failed to disconnect: ' + err.message);
  }
}

async function openConnectIntegrationModal() {
  const modal = document.getElementById('connectIntegrationModal');
  const select = document.getElementById('connectIntegrationSubjectSelect');
  const errDiv = document.getElementById('connectIntegrationError');
  if (errDiv) errDiv.classList.add('hidden');

  try {
    const res = await apiRequest('/api/monitoring/subjects');
    const subjects = (res.data || []).filter((s) => s.monitoring_status === 'active');

    if (select) {
      if (subjects.length === 0) {
        select.innerHTML = '<option value="">No active monitored subjects found. Create an active subject mandate first.</option>';
      } else {
        select.innerHTML = '<option value="">Select an authorized monitored subject...</option>' +
          subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.canonical_name)} (${escapeHtml(s.authorization_reference)})</option>`).join('');
      }
    }

    if (modal) modal.classList.remove('hidden');
  } catch (err) {
    alert('Failed to prepare connection modal: ' + err.message);
  }
}

function closeConnectIntegrationModal() {
  const modal = document.getElementById('connectIntegrationModal');
  if (modal) modal.classList.add('hidden');
}

async function openKillSwitchModal() {
  const modal = document.getElementById('killSwitchModal');
  const errDiv = document.getElementById('killSwitchError');
  if (errDiv) errDiv.classList.add('hidden');
  const actionSel = document.getElementById('killSwitchTargetAction');
  if (actionSel) actionSel.value = activeKillSwitchState?.is_active ? 'disengage' : 'engage';
  const reasonEl = document.getElementById('killSwitchReason');
  if (reasonEl) reasonEl.value = '';
  if (modal) modal.classList.remove('hidden');
}

function closeKillSwitchModal() {
  const modal = document.getElementById('killSwitchModal');
  if (modal) modal.classList.add('hidden');
}

async function openMapSubjectsModal(connectionId) {
  const modal = document.getElementById('mapSubjectsModal');
  const connInput = document.getElementById('mapConnectionId');
  const select = document.getElementById('mapSubjectSelect');
  const errDiv = document.getElementById('mapSubjectsError');
  if (errDiv) errDiv.classList.add('hidden');
  if (connInput) connInput.value = connectionId;

  try {
    const res = await apiRequest('/api/monitoring/subjects');
    const subjects = (res.data || []).filter((s) => s.monitoring_status === 'active');

    if (select) {
      select.innerHTML = '<option value="">Select an authorized monitored subject...</option>' +
        subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.canonical_name)} (${escapeHtml(s.authorization_reference)})</option>`).join('');
    }

    if (modal) modal.classList.remove('hidden');
  } catch (err) {
    alert('Failed to load subjects for mapping: ' + err.message);
  }
}

function closeMapSubjectsModal() {
  const modal = document.getElementById('mapSubjectsModal');
  if (modal) modal.classList.add('hidden');
}

function setupIntegrationModals() {
  // Open / Close Connect Modal
  document.getElementById('btnOpenConnectIntegrationModal')?.addEventListener('click', openConnectIntegrationModal);
  document.getElementById('closeConnectIntegrationModalBtn')?.addEventListener('click', closeConnectIntegrationModal);
  document.getElementById('cancelConnectIntegrationBtn')?.addEventListener('click', closeConnectIntegrationModal);

  // Radio button switch for connect mode
  document.querySelectorAll('input[name="connectAuthMode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const isDirect = e.target.value === 'direct_code';
      const box = document.getElementById('connectDirectCodeBox');
      const submitBtn = document.getElementById('submitConnectIntegrationBtn');
      if (box) box.classList.toggle('hidden', !isDirect);
      if (submitBtn) submitBtn.textContent = isDirect ? 'Complete Code Exchange' : 'Initiate Authorization';
    });
  });

  // Generate test state button
  document.getElementById('btnGenTestState')?.addEventListener('click', async () => {
    const subjId = document.getElementById('connectIntegrationSubjectSelect')?.value;
    if (!subjId) {
      alert('Please select a monitored subject first.');
      return;
    }
    try {
      const res = await apiRequest('/api/integrations/oauth/initiate', {
        method: 'POST',
        body: JSON.stringify({ provider: 'youtube', subject_ids: [subjId] })
      });
      const stateInput = document.getElementById('connectDirectStateInput');
      if (stateInput) stateInput.value = res.data.state;
      alert(`State nonce generated:\n${res.data.state}\n\nAuth URL:\n${res.data.auth_url}`);
    } catch (err) {
      alert('Failed to generate state: ' + err.message);
    }
  });

  // Connect form submit
  document.getElementById('connectIntegrationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('connectIntegrationError');
    if (errDiv) errDiv.classList.add('hidden');

    const subjectId = document.getElementById('connectIntegrationSubjectSelect')?.value;
    if (!subjectId) {
      if (errDiv) {
        errDiv.textContent = 'Please select a monitored subject with an active mandate.';
        errDiv.classList.remove('hidden');
      }
      return;
    }

    const authMode = document.querySelector('input[name="connectAuthMode"]:checked')?.value || 'oauth_redirect';

    try {
      if (authMode === 'direct_code') {
        const code = document.getElementById('connectDirectCodeInput')?.value?.trim();
        const state = document.getElementById('connectDirectStateInput')?.value?.trim();
        if (!code || !state) {
          throw new Error('Both authorization code and state nonce are required for direct code exchange.');
        }
        await apiRequest('/api/integrations/oauth/callback', {
          method: 'POST',
          body: JSON.stringify({ code, state })
        });
        closeConnectIntegrationModal();
        alert('YouTube channel successfully connected and verified via OAuth 2.0.');
        await loadIntegrations();
        await loadCandidateReviews();
      } else {
        const res = await apiRequest('/api/integrations/oauth/initiate', {
          method: 'POST',
          body: JSON.stringify({ provider: 'youtube', subject_ids: [subjectId] })
        });
        closeConnectIntegrationModal();
        const consentUrl = res.data.auth_url;
        const proceed = confirm(`Initiating Google OAuth 2.0 flow for YouTube Data API v3 (Read-Only).\n\nState Nonce: ${res.data.state}\n\nClick OK to open the Google OAuth Consent page in a new window, or Cancel to finish manually.`);
        if (proceed) {
          window.open(consentUrl, '_blank');
        }
      }
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });

  // Open / Close Kill Switch Modal
  document.getElementById('toggleKillSwitchBtn')?.addEventListener('click', openKillSwitchModal);
  document.getElementById('closeKillSwitchModalBtn')?.addEventListener('click', closeKillSwitchModal);
  document.getElementById('cancelKillSwitchBtn')?.addEventListener('click', closeKillSwitchModal);

  // Kill Switch Form Submit
  document.getElementById('killSwitchForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('killSwitchError');
    if (errDiv) errDiv.classList.add('hidden');

    const targetAction = document.getElementById('killSwitchTargetAction')?.value;
    const reason = document.getElementById('killSwitchReason')?.value?.trim();
    if (!reason || reason.length < 5) {
      if (errDiv) {
        errDiv.textContent = 'Operational reason must be at least 5 characters.';
        errDiv.classList.remove('hidden');
      }
      return;
    }

    try {
      const isActive = targetAction === 'engage';
      await apiRequest('/api/integrations/kill-switch', {
        method: 'POST',
        body: JSON.stringify({ active: isActive, reason })
      });
      closeKillSwitchModal();
      alert(`Emergency kill switch successfully ${isActive ? 'ARMED' : 'DISARMED'}.`);
      await loadIntegrations();
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });

  // Open / Close Map Subjects Modal
  document.getElementById('closeMapSubjectsModalBtn')?.addEventListener('click', closeMapSubjectsModal);
  document.getElementById('cancelMapSubjectsBtn')?.addEventListener('click', closeMapSubjectsModal);

  // Map Subjects Form Submit
  document.getElementById('mapSubjectsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('mapSubjectsError');
    if (errDiv) errDiv.classList.add('hidden');

    const connectionId = document.getElementById('mapConnectionId')?.value;
    const subjectId = document.getElementById('mapSubjectSelect')?.value;
    if (!connectionId || !subjectId) {
      if (errDiv) {
        errDiv.textContent = 'Please select a subject to associate.';
        errDiv.classList.remove('hidden');
      }
      return;
    }

    try {
      await apiRequest(`/api/integrations/connections/${connectionId}/subjects`, {
        method: 'PUT',
        body: JSON.stringify({ subject_ids: [subjectId] })
      });
      closeMapSubjectsModal();
      alert('Subject mapping successfully updated.');
      await loadIntegrations();
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('hidden');
      }
    }
  });

  // Refresh button
  document.getElementById('refreshIntegrationsBtn')?.addEventListener('click', loadIntegrations);
}

// Global exposure for inline events
window.markNotificationRead = markNotificationRead;
window.revokeInvitation = revokeInvitation;
window.triggerWorkerRun = triggerWorkerRun;
window.openCandidateReview = openCandidateReview;
window.toggleSubjectStatus = toggleSubjectStatus;
window.viewRunSlices = viewRunSlices;
window.openAdjudicateConflict = openAdjudicateConflict;
window.approveRuleset = approveRuleset;
window.activateRuleset = activateRuleset;
window.expireSuppressionRule = expireSuppressionRule;
window.loadFixturesForDataset = loadFixturesForDataset;

// Phase 8 Global exposure
window.loadIntegrations = loadIntegrations;
window.handleSyncConnection = handleSyncConnection;
window.handleTogglePauseConnection = handleTogglePauseConnection;
window.handleDisconnectConnection = handleDisconnectConnection;
window.openMapSubjectsModal = openMapSubjectsModal;
window.openConnectIntegrationModal = openConnectIntegrationModal;
window.openKillSwitchModal = openKillSwitchModal;

// Helpers
function formatCategory(cat) {
  return cat
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', init);
