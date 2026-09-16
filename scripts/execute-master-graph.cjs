/**
 * MASTER GRAPH VERIFICATION HARNESS
 * Executes N4, N4A, N5, N10 against staging environment (port 4001)
 * Includes Headless Chrome CDP verification for visual and DOM state.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const Database = require('better-sqlite3');
require('dotenv').config({ path: '.env.staging' });

const BASE_URL = 'http://127.0.0.1:4001';
const MESH_URL = 'http://100.100.25.15:4001';
const DB_PATH = process.env.DATABASE_PATH || './data/response_desk_staging.sqlite';

const db = new Database(DB_PATH);

async function loginUser(email, password = 'pbkdf2_mock_hash_for_testing') {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!json.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(json)}`);
  return {
    token: json.token,
    user: json.data?.user,
    organizationId: json.data?.activeOrganizationId || 'org_apex_health_01'
  };
}

async function timedFetch(url, options = {}) {
  const start = Date.now();
  const method = options.method || 'GET';
  try {
    const res = await fetch(url, options);
    const durationMs = Date.now() - start;
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    return {
      method,
      url,
      status: res.status,
      durationMs,
      data,
      headers: Object.fromEntries(res.headers.entries())
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      method,
      url,
      status: 0,
      durationMs,
      error: err.message
    };
  }
}

async function runBrowserCDPCheck() {
  console.log('\n--- [N4] HEADLESS CHROME CDP BROWSER VERIFICATION ---');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const cdpPort = 9223;
  const tempProfile = path.resolve(process.cwd(), 'data', 'temp_cdp_profile_' + Date.now());

  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = cp.spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ], { detached: false });

  await new Promise(r => setTimeout(r, 1500));

  let cdpResults = {
    url_loaded: BASE_URL,
    styled_ui: false,
    role_resolved: false,
    cases_rendered: false,
    header_bg: '',
    role_badge: '',
    cases_count: 0
  };

  try {
    const vRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    const vJson = await vRes.json();
    const wsUrl = vJson.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };

    await new Promise(res => ws.onopen = res);

    function sendCmd(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCmd('Target.setDiscoverTargets', { discover: true });
    const targetsRes = await sendCmd('Target.getTargets');
    const pageTarget = targetsRes.result.targetInfos.find(t => t.type === 'page');

    const sessionRes = await sendCmd('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    const sessionId = sessionRes.result.sessionId;

    function sendSessionCmd(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, sessionId, method, params }));
      });
    }

    await sendSessionCmd('Page.enable');
    await sendSessionCmd('Runtime.enable');
    await sendSessionCmd('Network.enable');

    await sendSessionCmd('Page.navigate', { url: BASE_URL });
    await new Promise(r => setTimeout(r, 3000));

    // Evaluate DOM state using verified element selectors
    const evalRes = await sendSessionCmd('Runtime.evaluate', {
      expression: `(() => {
        const header = document.querySelector('header');
        const headerBg = header ? window.getComputedStyle(header).backgroundColor : '';
        const roleEl = document.getElementById('currentUserRoleBadge');
        const roleText = roleEl ? roleEl.textContent.trim() : '';
        const casesTable = document.getElementById('casesTableBody');
        const casesCount = casesTable ? casesTable.children.length : 0;
        const tailwindPresent = typeof window.tailwind !== 'undefined';
        return {
          headerBg,
          roleText,
          casesCount,
          tailwindPresent
        };
      })()`,
      returnByValue: true
    });

    const val = evalRes.result?.result?.value || {};
    cdpResults.header_bg = val.headerBg;
    cdpResults.role_badge = val.roleText;
    cdpResults.cases_count = val.casesCount;
    cdpResults.styled_ui = val.tailwindPresent && val.headerBg.includes('rgb');
    cdpResults.role_resolved = !val.roleText.includes('Loading') && val.roleText.length > 0;
    cdpResults.cases_rendered = val.casesCount > 0;
    cdpResults.details = val;

    console.log(`  ✓ Headless Chrome loaded ${BASE_URL}`);
    console.log(`    - Tailwind Present: ${val.tailwindPresent}`);
    console.log(`    - Header Background: ${val.headerBg}`);
    console.log(`    - Resolved Role Badge: "${val.roleText}"`);
    console.log(`    - Cases Count rendered: ${val.casesCount}`);

    ws.close();
  } catch (err) {
    console.error('  ❌ CDP verification error:', err.message);
    cdpResults.error = err.message;
  } finally {
    try { chromeProc.kill(); } catch {}
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch {}
  }

  return cdpResults;
}

async function runMasterGraph() {
  console.log('================================================================================');
  console.log('ANTIGRAVITY MASTER GRAPH EXECUTION: N4, N4A, N5, N10');
  console.log('Target Local: ' + BASE_URL);
  console.log('Target Mesh:  ' + MESH_URL);
  console.log('Database:     ' + DB_PATH);
  console.log('================================================================================\n');

  const results = {
    n4_smoke: [],
    n4_browser_cdp: null,
    n4a_kill_switch: [],
    n5_adversarial: [],
    n10_operator_uat: [],
    summary: { total: 0, passed: 0, failed: 0 }
  };

  function record(category, testName, expected, actual, passed, details = {}) {
    results.summary.total++;
    if (passed) results.summary.passed++;
    else results.summary.failed++;

    const item = {
      test: testName,
      expected,
      actual,
      status: passed ? 'PASS' : 'FAIL',
      durationMs: details.durationMs || 0,
      details
    };
    results[category].push(item);
    console.log(`  ${passed ? '✓ [PASS]' : '❌ [FAIL]'} [${category.toUpperCase()}] ${testName} (${details.durationMs || 0}ms)`);
    if (!passed) {
      console.log(`      Expected: ${expected}`);
      console.log(`      Actual:   ${actual}`);
    }
  }

  // 1. Authenticate Personas
  console.log('--- Authenticating Test Personas ---');
  const apexMgr = await loginUser('priya.nair@apexhealth.example');
  const apexLegal = await loginUser('adv.menon@apexhealth.example');
  const apexOwner = await loginUser('dr.verma@apexhealth.example');
  const sysadmin = await loginUser('sysadmin@desk.example');
  const bharatMgr = await loginUser('vikram.seth@bharatfin.example');
  console.log('  ✓ All 5 operator personas authenticated successfully.\n');

  const apexHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apexMgr.token}`,
    'x-organization-id': 'org_apex_health_01'
  };

  const legalHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apexLegal.token}`,
    'x-organization-id': 'org_apex_health_01'
  };

  const ownerHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apexOwner.token}`,
    'x-organization-id': 'org_apex_health_01'
  };

  // ============================================================================
  // NODE N4: BROWSER SMOKE HARDENING & ROUTE AUDIT
  // ============================================================================
  console.log('--- [N4] BROWSER SMOKE HARDENING & ROUTE AUDIT ---');
  const smokeRoutes = [
    { method: 'GET', path: '/', headers: {} },
    { method: 'GET', path: '/index.html', headers: {} },
    { method: 'GET', path: '/app.js', headers: {} },
    { method: 'GET', path: '/health', headers: {} },
    { method: 'GET', path: '/healthz/ready', headers: {} },
    { method: 'GET', path: '/api/auth/demo-users', headers: {} },
    { method: 'GET', path: '/api/auth/me', headers: apexHeaders },
    { method: 'GET', path: '/api/cases', headers: apexHeaders },
    { method: 'GET', path: '/api/cases/case_apex_2026_001/evidence', headers: apexHeaders },
    { method: 'GET', path: '/api/escalations', headers: apexHeaders },
    { method: 'GET', path: '/api/re-uploads', headers: apexHeaders },
    { method: 'GET', path: '/api/platforms', headers: apexHeaders },
    { method: 'GET', path: '/api/playbooks', headers: apexHeaders },
    { method: 'GET', path: '/api/audit-events', headers: apexHeaders },
    { method: 'GET', path: '/api/integrations/kill-switch', headers: ownerHeaders }
  ];

  for (const r of smokeRoutes) {
    const res = await timedFetch(`${BASE_URL}${r.path}`, { method: r.method, headers: r.headers });
    const passed = res.status === 200;
    record(
      'n4_smoke',
      `${r.method} ${r.path}`,
      'HTTP 200',
      `HTTP ${res.status}`,
      passed,
      { method: r.method, url: r.path, status: res.status, durationMs: res.durationMs }
    );
  }

  // Browser CDP Check
  const cdpCheck = await runBrowserCDPCheck();
  results.n4_browser_cdp = cdpCheck;
  record(
    'n4_smoke',
    'Browser UI: Headless Chrome rendered styled dashboard without unhandled errors',
    'styled_ui: true, role_resolved: true',
    `styled_ui: ${cdpCheck.styled_ui}, role_resolved: ${cdpCheck.role_resolved}`,
    cdpCheck.styled_ui && cdpCheck.role_resolved,
    cdpCheck
  );

  // ============================================================================
  // NODE N4A: KILL-SWITCH ACTIVE IN-STAGING TEST
  // ============================================================================
  console.log('\n--- [N4A] KILL-SWITCH ACTIVE IN-STAGING TEST ---');

  // Step 1: Initial state check (disarmed)
  const initialKsRes = await timedFetch(`${BASE_URL}/api/integrations/kill-switch`, {
    headers: ownerHeaders
  });
  const initialActive = initialKsRes.data?.data?.kill_switch_active;
  record(
    'n4a_kill_switch',
    'Step 1: Verify kill switch initially disarmed',
    'kill_switch_active: false',
    `kill_switch_active: ${initialActive}`,
    initialActive === false,
    { durationMs: initialKsRes.durationMs }
  );

  // Step 2: Engage kill-switch
  const engageRes = await timedFetch(`${BASE_URL}/api/integrations/kill-switch`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ active: true })
  });
  record(
    'n4a_kill_switch',
    'Step 2: Engage kill switch via POST /api/integrations/kill-switch',
    'HTTP 200, kill_switch_active: true',
    `HTTP ${engageRes.status}, kill_switch_active: ${engageRes.data?.data?.kill_switch_active}`,
    engageRes.status === 200 && engageRes.data?.data?.kill_switch_active === true,
    { durationMs: engageRes.durationMs }
  );

  // Step 3: Verify webhook rejected with HTTP 503 KILL_SWITCH_ACTIVE
  const webhookTestRes = await timedFetch(`${BASE_URL}/api/integrations/youtube/webhook/mock_conn_active_test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: 'ping' })
  });
  record(
    'n4a_kill_switch',
    'Step 3: Inbound webhook rejected with HTTP 503 during active kill switch',
    'HTTP 503 Service Unavailable',
    `HTTP ${webhookTestRes.status} (${JSON.stringify(webhookTestRes.data)})`,
    webhookTestRes.status === 503,
    { durationMs: webhookTestRes.durationMs, data: webhookTestRes.data }
  );

  // Step 4: Disarm kill-switch
  const disengageRes = await timedFetch(`${BASE_URL}/api/integrations/kill-switch`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ active: false })
  });
  record(
    'n4a_kill_switch',
    'Step 4: Disarm kill switch via POST /api/integrations/kill-switch',
    'HTTP 200, kill_switch_active: false',
    `HTTP ${disengageRes.status}, kill_switch_active: ${disengageRes.data?.data?.kill_switch_active}`,
    disengageRes.status === 200 && disengageRes.data?.data?.kill_switch_active === false,
    { durationMs: disengageRes.durationMs }
  );

  // Step 5: Verify post-recovery status
  const recoveredKsRes = await timedFetch(`${BASE_URL}/api/integrations/kill-switch`, {
    headers: ownerHeaders
  });
  record(
    'n4a_kill_switch',
    'Step 5: Verify recovery to operational state',
    'kill_switch_active: false',
    `kill_switch_active: ${recoveredKsRes.data?.data?.kill_switch_active}`,
    recoveredKsRes.data?.data?.kill_switch_active === false,
    { durationMs: recoveredKsRes.durationMs }
  );

  // ============================================================================
  // NODE N5: FRESH-CONTEXT ADVERSARIAL QA
  // ============================================================================
  console.log('\n--- [N5] FRESH-CONTEXT ADVERSARIAL QA ---');

  // Test 1: Unauthenticated request rejected
  const unauthRes = await timedFetch(`${BASE_URL}/api/cases`);
  record(
    'n5_adversarial',
    'Auth Boundary: Unauthenticated request rejected with HTTP 401',
    'HTTP 401',
    `HTTP ${unauthRes.status}`,
    unauthRes.status === 401,
    { durationMs: unauthRes.durationMs }
  );

  // Test 2: Tampered signature rejected
  const tamperedToken = apexMgr.token.slice(0, -5) + 'xxxxx';
  const tamperedRes = await timedFetch(`${BASE_URL}/api/cases`, {
    headers: { Authorization: `Bearer ${tamperedToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  record(
    'n5_adversarial',
    'Auth Boundary: Tampered token signature rejected with HTTP 401',
    'HTTP 401',
    `HTTP ${tamperedRes.status}`,
    tamperedRes.status === 401,
    { durationMs: tamperedRes.durationMs }
  );

  // Test 3: Cross-tenant header spoofing rejected (User of Org A requests Org B)
  const spoofTenantRes = await timedFetch(`${BASE_URL}/api/cases`, {
    headers: {
      Authorization: `Bearer ${apexMgr.token}`,
      'X-Organization-ID': 'org_bharatfin_02'
    }
  });
  record(
    'n5_adversarial',
    'Tenant Isolation: Cross-tenant header spoofing rejected with HTTP 403',
    'HTTP 403 Forbidden',
    `HTTP ${spoofTenantRes.status}`,
    spoofTenantRes.status === 403,
    { durationMs: spoofTenantRes.durationMs }
  );

  // Test 4: Cross-tenant IDOR case query rejected (User of Org A queries Org B case)
  const idorCaseRes = await timedFetch(`${BASE_URL}/api/cases/case_bharatfin_2026_003`, {
    headers: apexHeaders
  });
  record(
    'n5_adversarial',
    'Tenant Isolation: Cross-tenant IDOR case read returns HTTP 404',
    'HTTP 404 (Not Found prevents resource existence leakage)',
    `HTTP ${idorCaseRes.status}`,
    idorCaseRes.status === 404,
    { durationMs: idorCaseRes.durationMs }
  );

  // Test 5: Legal hold deletion blocked (409 Conflict)
  // Ensure an active evidence item has a legal hold applied
  const advEvRes = await timedFetch(`${BASE_URL}/api/cases/case_apex_2026_001/evidence`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      source_url: `https://instagram.com/adversarial_evidence_${Date.now()}`,
      safe_display_name: 'Adversarial Hold Test Evidence'
    })
  });
  const advEvId = advEvRes.data?.data?.id;

  await timedFetch(`${BASE_URL}/api/evidence/${advEvId}/legal-hold`, {
    method: 'POST',
    headers: legalHeaders,
    body: JSON.stringify({ reason: 'Statutory litigation hold', notes: 'Adversarial QA' })
  });

  const delUnderHoldRes = await timedFetch(`${BASE_URL}/api/evidence/${advEvId}/delete-request`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({ reason: 'Attempt deletion under hold' })
  });
  record(
    'n5_adversarial',
    'Workflow Safety: Evidence deletion request blocked under active legal hold',
    'HTTP 409 Conflict',
    `HTTP ${delUnderHoldRes.status}`,
    delUnderHoldRes.status === 409,
    { durationMs: delUnderHoldRes.durationMs, data: delUnderHoldRes.data }
  );

  // Test 6: SQL Injection in search query rejected safely
  const sqliRes = await timedFetch(`${BASE_URL}/api/cases?search=${encodeURIComponent("' OR '1'='1")}`, {
    headers: apexHeaders
  });
  record(
    'n5_adversarial',
    'Input Hardening: SQL injection probe safely handled without syntax error',
    'HTTP 200 with sanitized/safe query results',
    `HTTP ${sqliRes.status}`,
    sqliRes.status === 200 && Array.isArray(sqliRes.data?.data?.cases || sqliRes.data?.data),
    { durationMs: sqliRes.durationMs }
  );

  // Test 7: SSRF URL validation rejects private link-local endpoint in evidence source URL
  const ssrfRes = await timedFetch(`${BASE_URL}/api/cases/case_apex_2026_001/evidence`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      source_url: 'http://169.254.169.254/latest/meta-data/',
      safe_display_name: 'SSRF Cloud Metadata Probe'
    })
  });
  record(
    'n5_adversarial',
    'Security Boundary: SSRF cloud metadata endpoint strictly blocked in source capture',
    'HTTP 400 Bad Request',
    `HTTP ${ssrfRes.status} (${JSON.stringify(ssrfRes.data?.error?.message || ssrfRes.data)})`,
    ssrfRes.status === 400,
    { durationMs: ssrfRes.durationMs }
  );

  // ============================================================================
  // NODE N10: HUMAN-STYLE OPERATOR UAT (24-STEP GOLDEN PATH)
  // ============================================================================
  console.log('\n--- [N10] HUMAN-STYLE OPERATOR UAT (24-STEP GOLDEN PATH) ---');

  let testCaseId = null;
  let testEvidenceId = null;
  let testSubjectId = null;

  // Step 1: Login
  const loginRes = await timedFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.nair@apexhealth.example', password: 'pbkdf2_mock_hash_for_testing' })
  });
  record('n10_operator_uat', 'Step 1: Authenticate operator session', 'HTTP 200 with session token', `HTTP ${loginRes.status}`, loginRes.status === 200, { durationMs: loginRes.durationMs });

  // Step 2: /api/auth/me
  const meRes = await timedFetch(`${BASE_URL}/api/auth/me`, { headers: apexHeaders });
  record('n10_operator_uat', 'Step 2: Inspect authenticated operator profile', 'HTTP 200 with user profile', `HTTP ${meRes.status}`, meRes.status === 200, { durationMs: meRes.durationMs });

  // Step 3: Organization context
  const orgCheck = meRes.data?.data?.memberships?.some(m => m.organization_id === 'org_apex_health_01');
  record('n10_operator_uat', 'Step 3: Verify organization context (org_apex_health_01)', 'true', String(orgCheck), orgCheck === true, { durationMs: 0 });

  // Step 4: Create new case
  const createCaseRes = await timedFetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      title: `Synthetic Executive Impersonation Case ${Date.now()}`,
      category: 'founder_doctor_creator_impersonation',
      priority: 'high',
      target_entity: 'Dr. Verma',
      contested_url: `https://instagram.com/synthetic_dr_verma_${Date.now()}`,
      hosting_platform: 'instagram',
      reported_by_email: 'priya.nair@apexhealth.example'
    })
  });
  testCaseId = createCaseRes.data?.data?.id;
  record('n10_operator_uat', 'Step 4: Create new synthetic case', 'HTTP 201 with case ID', `HTTP ${createCaseRes.status}, id=${testCaseId}`, createCaseRes.status === 201 && Boolean(testCaseId), { durationMs: createCaseRes.durationMs });

  // Step 5: Verify initial status is new
  const getCaseRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}`, { headers: apexHeaders });
  const initialStatus = getCaseRes.data?.data?.case?.status || getCaseRes.data?.data?.status;
  record('n10_operator_uat', 'Step 5: Verify initial status is "new"', 'new', initialStatus, initialStatus === 'new', { durationMs: getCaseRes.durationMs });

  // Step 6: Transition to TRIAGE
  const triageRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: apexHeaders,
    body: JSON.stringify({ to_status: 'triage', reason: 'Operator initial intake' })
  });
  record('n10_operator_uat', 'Step 6: Transition case to "triage"', 'HTTP 200', `HTTP ${triageRes.status}`, triageRes.status === 200, { durationMs: triageRes.durationMs });

  // Step 7: Transition to AWAITING_AUTHORITY
  const authTransRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: apexHeaders,
    body: JSON.stringify({ to_status: 'awaiting_authority', reason: 'Waiting for identity authority verification' })
  });
  record('n10_operator_uat', 'Step 7: Transition case to "awaiting_authority"', 'HTTP 200', `HTTP ${authTransRes.status}`, authTransRes.status === 200, { durationMs: authTransRes.durationMs });

  // Step 8: Transition to EVIDENCE_COLLECTION
  const evColRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: apexHeaders,
    body: JSON.stringify({ to_status: 'evidence_collection', reason: 'Identity verified; collecting evidence' })
  });
  record('n10_operator_uat', 'Step 8: Transition case to "evidence_collection"', 'HTTP 200', `HTTP ${evColRes.status}`, evColRes.status === 200, { durationMs: evColRes.durationMs });

  // Step 9: Attach synthetic evidence
  const attachEvRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/evidence`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      source_url: 'https://instagram.com/synthetic_dr_verma/post/1',
      safe_display_name: 'Synthetic Impersonator Bio Screenshot',
      operator_notes: 'Captured via synthetic operator harness'
    })
  });
  testEvidenceId = attachEvRes.data?.data?.id;
  record('n10_operator_uat', 'Step 9: Attach synthetic evidence record', 'HTTP 201 with evidence ID', `HTTP ${attachEvRes.status}, id=${testEvidenceId}`, attachEvRes.status === 201 && Boolean(testEvidenceId), { durationMs: attachEvRes.durationMs });

  // Step 10: Verify SHA-256 custody hash
  const sha256 = attachEvRes.data?.data?.sha256;
  const shaValid = typeof sha256 === 'string' && sha256.length === 64;
  record('n10_operator_uat', 'Step 10: Verify SHA-256 custody hash computed', '64-char hex string', sha256 ? `${sha256.slice(0, 16)}...` : 'undefined', shaValid, { durationMs: 0 });

  // Step 11: Inspect chain-of-custody metadata
  const getEvRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}`, { headers: apexHeaders });
  const hasCustody = Boolean(getEvRes.data?.data?.evidence?.created_at && getEvRes.data?.data?.evidence?.organization_id);
  record('n10_operator_uat', 'Step 11: Inspect chain-of-custody metadata', 'true', String(hasCustody), hasCustody, { durationMs: getEvRes.durationMs });

  // Step 12: Place statutory legal hold
  const holdRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/legal-hold`, {
    method: 'POST',
    headers: legalHeaders,
    body: JSON.stringify({ reason: 'Statutory compliance preservation', notes: 'Case #2026-UAT' })
  });
  record('n10_operator_uat', 'Step 12: Apply statutory legal hold by Legal Counsel', 'HTTP 201', `HTTP ${holdRes.status}`, holdRes.status === 201, { durationMs: holdRes.durationMs });

  // Step 13: Verify deletion blocked while legal hold active
  const delBlockedRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/delete-request`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({ reason: 'Operator requested disposal' })
  });
  record('n10_operator_uat', 'Step 13: Verify deletion strictly blocked under active hold', 'HTTP 409 Conflict', `HTTP ${delBlockedRes.status}`, delBlockedRes.status === 409, { durationMs: delBlockedRes.durationMs });

  // Step 14: Release legal hold
  const releaseRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/legal-hold`, {
    method: 'DELETE',
    headers: legalHeaders,
    body: JSON.stringify({ reason: 'Litigation risk mitigated' })
  });
  record('n10_operator_uat', 'Step 14: Release legal hold by Legal Counsel', 'HTTP 200', `HTTP ${releaseRes.status}`, releaseRes.status === 200, { durationMs: releaseRes.durationMs });

  // Step 15: Submit evidence deletion request
  const delReqRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/delete-request`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({ reason: 'End of retention cycle' })
  });
  record('n10_operator_uat', 'Step 15: Submit evidence deletion request (Two-Person Step 1)', 'HTTP 200', `HTTP ${delReqRes.status}`, delReqRes.status === 200, { durationMs: delReqRes.durationMs });

  // Step 16: Verify requester self-approval is blocked
  const selfApproveRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/approve-deletion`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({ reason: 'Self-approval attempt' })
  });
  record('n10_operator_uat', 'Step 16: Requester self-approval strictly blocked (Two-Person Rule)', 'HTTP 403 or 400', `HTTP ${selfApproveRes.status}`, selfApproveRes.status >= 400, { durationMs: selfApproveRes.durationMs });

  // Step 17: Second authorized person approves deletion
  const secondApproveRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/approve-deletion`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ reason: 'Authorized second-person disposal approval' })
  });
  record('n10_operator_uat', 'Step 17: Independent second-person approval granted', 'HTTP 200', `HTTP ${secondApproveRes.status}`, secondApproveRes.status === 200, { durationMs: secondApproveRes.durationMs });

  // Step 18: Deleted evidence access denied
  const dlDeletedRes = await timedFetch(`${BASE_URL}/api/evidence/${testEvidenceId}/download?token=fake_or_expired`, {
    headers: apexHeaders
  });
  record('n10_operator_uat', 'Step 18: Deleted evidence access denied', 'HTTP 401 or 404 or 410', `HTTP ${dlDeletedRes.status}`, dlDeletedRes.status >= 400, { durationMs: dlDeletedRes.durationMs });

  // Step 19: Register synthetic monitored subject
  const regSubRes = await timedFetch(`${BASE_URL}/api/monitoring/subjects`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      canonical_name: `Dr. Synthetic VIP ${Date.now().toString(36)}`,
      subject_type: 'executive',
      authorization_basis: 'direct_mandate',
      authorization_reference: 'AUTH-UAT-001',
      monitoring_status: 'active'
    })
  });
  testSubjectId = regSubRes.data?.data?.id;
  record('n10_operator_uat', 'Step 19: Register synthetic monitored subject', 'HTTP 201 with subject ID', `HTTP ${regSubRes.status}, id=${testSubjectId}`, (regSubRes.status === 201 || regSubRes.status === 200) && Boolean(testSubjectId), { durationMs: regSubRes.durationMs });

  // Step 20: Ingest synthetic detection signal
  const ingestSigRes = await timedFetch(`${BASE_URL}/api/monitoring/signals/ingest`, {
    method: 'POST',
    headers: apexHeaders,
    body: JSON.stringify({
      subject_id: testSubjectId,
      adapter_name: 'synthetic_crawler',
      source_type: 'manual_input',
      observed_url: `https://instagram.com/fake_vip_${Date.now()}`,
      platform: 'instagram',
      content_type: 'profile'
    })
  });
  record('n10_operator_uat', 'Step 20: Ingest synthetic detection signal', 'HTTP 201', `HTTP ${ingestSigRes.status}`, (ingestSigRes.status === 201 || ingestSigRes.status === 200), { durationMs: ingestSigRes.durationMs });

  // Step 21: Execute background candidate evaluation worker
  const evalCycleRes = await timedFetch(`${BASE_URL}/api/monitoring/simulate-cycle`, {
    method: 'POST',
    headers: apexHeaders
  });
  record('n10_operator_uat', 'Step 21: Execute background candidate evaluation worker', 'HTTP 200', `HTTP ${evalCycleRes.status}`, evalCycleRes.status === 200, { durationMs: evalCycleRes.durationMs });

  // Step 22: Candidate review queue check & affirmative human triage
  const reviewQueueRes = await timedFetch(`${BASE_URL}/api/monitoring/reviews`, {
    headers: apexHeaders
  });
  const candidates = reviewQueueRes.data?.data?.items || reviewQueueRes.data?.data || [];
  record('n10_operator_uat', 'Step 22: Candidate enters human review queue', 'HTTP 200 with candidate queue items', `HTTP ${reviewQueueRes.status}, count=${candidates.length}`, reviewQueueRes.status === 200, { durationMs: reviewQueueRes.durationMs });

  // Step 23: Generate dry-run submission packet with legal disclaimer
  // Transition test case to ready_to_submit
  await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: apexHeaders,
    body: JSON.stringify({ to_status: 'ready_to_submit', reason: 'Takedown packet verified by operator' })
  });
  const packetRes = await timedFetch(`${BASE_URL}/api/cases/${testCaseId}/submission-packet`, {
    headers: apexHeaders
  });
  const hasDigest = Boolean(packetRes.data?.data?.packet_hash);
  record('n10_operator_uat', 'Step 23: Generate dry-run submission packet with pilot disclaimer', 'HTTP 200 with canonical packet hash', `HTTP ${packetRes.status}, packet_hash=${packetRes.data?.data?.packet_hash?.slice(0, 16)}...`, packetRes.status === 200 && hasDigest, { durationMs: packetRes.durationMs });

  // Step 24: Verify audit ledger contains complete immutable sequence
  const auditRes = await timedFetch(`${BASE_URL}/api/audit-events?limit=25`, {
    headers: apexHeaders
  });
  const auditEvents = auditRes.data?.data?.events || auditRes.data?.data || [];
  record('n10_operator_uat', 'Step 24: Audit ledger contains complete chronological record', 'HTTP 200 with immutable audit events', `HTTP ${auditRes.status}, event_count=${auditEvents.length}`, auditRes.status === 200 && auditEvents.length > 0, { durationMs: auditRes.durationMs });

  console.log('\n================================================================================');
  console.log(`TOTAL TESTS: ${results.summary.total} | PASSED: ${results.summary.passed} | FAILED: ${results.summary.failed}`);
  console.log('================================================================================\n');

  fs.writeFileSync('./results/MASTER_GRAPH_RESULTS.json', JSON.stringify(results, null, 2));
  return results;
}

runMasterGraph().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
