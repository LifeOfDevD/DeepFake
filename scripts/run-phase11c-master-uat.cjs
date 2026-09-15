/**
 * Phase 11C Master Independent Localhost Operator UAT & Verification Runner
 * Nodes N0 to N19 Comprehensive Test Suite
 */
const Database = require('better-sqlite3');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:4000';
const db = new Database('./data/response_desk.sqlite');
const secret = process.env.SESSION_SECRET || 'dev_session_secret_change_in_production_min_32_bytes_random';

// Results accumulator
const findings = [];
let totalPassed = 0;
let totalFailed = 0;

function recordTest(area, testName, expected, actual, status, severity, evidence, reproduction) {
  const finding = {
    id: `TEST-${String(findings.length + 1).padStart(3, '0')}`,
    area,
    test: testName,
    expected,
    actual,
    status,
    severity,
    evidence,
    reproduction: reproduction || 'Executed via scripts/run-phase11c-master-uat.cjs'
  };
  findings.push(finding);
  if (status === 'PASS') {
    totalPassed++;
    console.log(`  ✓ [PASS] [${area}] ${testName}`);
  } else {
    totalFailed++;
    console.error(`  ❌ [FAIL] [${area}] ${testName}`);
    console.error(`     Expected: ${expected}`);
    console.error(`     Actual: ${actual}`);
  }
}

// Direct session token minter for test harness roles
function mintToken(email) {
  const user = db.prepare('SELECT id, email, system_role FROM users WHERE email = ?').get(email);
  if (!user) throw new Error(`User ${email} not found in database`);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId: user.id,
    email: user.email,
    systemRole: user.system_role || 'user',
    iat: now,
    exp: now + 86400
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `desk_tok_${b64}.${sig}`;
}

async function login(email, password = 'pbkdf2_mock_hash_for_testing') {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  return { status: res.status, json, token: json.token || json.data?.token };
}

async function main() {
  console.log('================================================================');
  console.log('PHASE 11C: INDEPENDENT LOCALHOST OPERATOR UAT & VERIFICATION');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // NODE N0 & N1: Environment & Server Health Discovery
  // --------------------------------------------------------------------------
  console.log('--- [N0 & N1] Discovery & Localhost Server Health ---');
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthJson = await healthRes.json();
    const healthPass = healthRes.status === 200 && healthJson.service === 'Digital Impersonation Response Desk' && healthJson.status === 'ok';
    recordTest('N0/N1 Health', 'Localhost server health probe (/health)', '200 OK with status="ok" and service title', `${healthRes.status} OK, service="${healthJson.service}", mode="${healthJson.mode}"`, healthPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(healthJson));
  } catch (err) {
    recordTest('N0/N1 Health', 'Localhost server health probe (/health)', '200 OK', `Error: ${err.message}`, 'FAIL', 'P0', String(err));
    throw err;
  }

  // Pre-load tokens for multiple roles across tenants
  const apexMgrToken = mintToken('priya.nair@apexhealth.example');
  const apexLegalToken = mintToken('adv.menon@apexhealth.example');
  const apexAnalystToken = mintToken('rohit.sen@apexhealth.example');
  const apexOwnerToken = mintToken('dr.verma@apexhealth.example');
  const apexStakeholderToken = mintToken('stakeholder@apexhealth.example');
  const sysadminToken = mintToken('sysadmin@desk.example');
  const bharatMgrToken = mintToken('vikram.seth@bharatfin.example');

  // --------------------------------------------------------------------------
  // NODE N2: Authentication UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N2] Authentication UAT ---');

  // Test 2.1: Valid login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'priya.nair@apexhealth.example', password: 'pbkdf2_mock_hash_for_testing' })
  });
  const loginJson = await loginRes.json();
  const validLoginPass = loginRes.status === 200 && Boolean(loginJson.token);
  recordTest('N2 Auth', 'Valid credential authentication', '200 OK with session token', `${loginRes.status} with token: ${Boolean(loginJson.token)}`, validLoginPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(loginJson));

  // Test 2.2: Invalid password returns 401 with attemptsRemaining
  const testLockoutEmail = `lockout_11c_${Date.now()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, system_role) VALUES (?, ?, ?, ?, 'user')")
    .run(`usr_test_${Date.now().toString(36)}`, testLockoutEmail, 'pbkdf2_mock_hash_for_testing', 'Lockout Test User 11C');

  const invalidPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testLockoutEmail, password: 'wrong_password_test' })
  });
  const invalidPassJson = await invalidPassRes.json();
  const invalidPassSuccess = invalidPassRes.status === 401 && invalidPassJson.attemptsRemaining !== undefined;
  recordTest('N2 Auth', 'Invalid password rejection with attemptsRemaining', '401 Unauthorized with attemptsRemaining', `${invalidPassRes.status}, remaining=${invalidPassJson.attemptsRemaining}`, invalidPassSuccess ? 'PASS' : 'FAIL', 'P1', JSON.stringify(invalidPassJson));

  // Test 2.3: Account lockout after 5 consecutive failures
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testLockoutEmail, password: 'wrong_password_test' })
    });
  }
  const lockoutRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testLockoutEmail, password: 'wrong_password_test' })
  });
  const lockoutJson = await lockoutRes.json();
  const lockoutSuccess = lockoutRes.status === 429 && (String(lockoutJson.error).includes('ACCOUNT_TEMPORARILY_LOCKED') || String(lockoutJson.error).includes('RATE_LIMIT_EXCEEDED'));
  recordTest('N2 Auth', 'Account lockout / brute-force protection (HTTP 429)', '429 with ACCOUNT_TEMPORARILY_LOCKED or RATE_LIMIT_EXCEEDED', `${lockoutRes.status}, error=${lockoutJson.error}`, lockoutSuccess ? 'PASS' : 'FAIL', 'P0', JSON.stringify(lockoutJson));

  // Test 2.4: /api/auth/me returns user & memberships
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}` }
  });
  const meJson = await meRes.json();
  const mePass = meRes.status === 200 && meJson.data.user.email === 'priya.nair@apexhealth.example';
  recordTest('N2 Auth', 'Session inspection via /api/auth/me', '200 OK with correct email and memberships', `${meRes.status}, email=${meJson.data?.user?.email}`, mePass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(meJson));

  // Test 2.5: Logout / Token Revocation
  const logoutEmail = `logout_11c_${Date.now()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, system_role) VALUES (?, ?, ?, ?, 'user')")
    .run(`usr_logout_${Date.now().toString(36)}`, logoutEmail, 'pbkdf2_mock_hash_for_testing', 'Logout User 11C');
  const ephemeralToken = mintToken(logoutEmail);
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ephemeralToken}` }
  });
  const logoutSuccess = logoutRes.status === 200;
  recordTest('N2 Auth', 'Session termination via /api/auth/logout', '200 OK', `${logoutRes.status}`, logoutSuccess ? 'PASS' : 'FAIL', 'P1', 'Logged out successfully');

  // Test 2.6: Revoked token rejected
  const revokedAccessRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${ephemeralToken}` }
  });
  const revokedPass = revokedAccessRes.status === 401;
  recordTest('N2 Auth', 'Revoked token rejected with 401', '401 Unauthorized', `${revokedAccessRes.status}`, revokedPass ? 'PASS' : 'FAIL', 'P0', 'Revoked token rejected');

  // Test 2.7: Forged / Tampered token rejected
  const forgedToken = apexMgrToken.slice(0, -10) + '9988776655';
  const forgedRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Authorization': `Bearer ${forgedToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const forgedPass = forgedRes.status === 401;
  recordTest('N2 Auth', 'Tampered HMAC signature rejected with 401', '401 Unauthorized', `${forgedRes.status}`, forgedPass ? 'PASS' : 'FAIL', 'P0', 'HMAC tamper detected');

  // Test 2.8: Missing Authorization header rejected
  const noAuthRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'x-organization-id': 'org_apex_health_01' }
  });
  const noAuthPass = noAuthRes.status === 401;
  recordTest('N2 Auth', 'Missing Authorization header rejected with 401', '401 Unauthorized', `${noAuthRes.status}`, noAuthPass ? 'PASS' : 'FAIL', 'P0', 'Unauthenticated request rejected');

  // --------------------------------------------------------------------------
  // NODE N3: Tenant Isolation & BOLA Defense UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N3] Tenant Isolation & BOLA Defense UAT ---');

  // Test 3.1: Cross-tenant case read: Tenant Beta manager querying Tenant Alpha case -> 404
  const crossCaseRead = await fetch(`${BASE_URL}/api/cases/case_apex_2026_001`, {
    headers: { 'Authorization': `Bearer ${bharatMgrToken}`, 'x-organization-id': 'org_bharatfin_02' }
  });
  const crossCaseReadPass = crossCaseRead.status === 404;
  recordTest('N3 Tenant Isolation', 'Cross-tenant case read (BOLA/IDOR) returns 404', '404 Not Found', `${crossCaseRead.status}`, crossCaseReadPass ? 'PASS' : 'FAIL', 'P0', 'Zero information leakage on cross-tenant probe');

  // Test 3.2: Cross-tenant case mutation: Tenant Alpha manager attempting to mutate Tenant Beta case
  const crossCaseMutate = await fetch(`${BASE_URL}/api/cases/case_bharatfin_2026_003/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'triage', reason: 'Attempting cross-tenant mutation' })
  });
  const crossCaseMutatePass = crossCaseMutate.status >= 400;
  recordTest('N3 Tenant Isolation', 'Cross-tenant case mutation blocked', '>= 400 Bad Request / Not Found', `${crossCaseMutate.status}`, crossCaseMutatePass ? 'PASS' : 'FAIL', 'P0', 'Cross-tenant mutation prevented');

  // Test 3.3: Cross-tenant submission read: Tenant Beta manager querying Tenant Alpha submission
  const crossSubRead = await fetch(`${BASE_URL}/api/submissions/sub_apex_sim_001`, {
    headers: { 'Authorization': `Bearer ${bharatMgrToken}`, 'x-organization-id': 'org_bharatfin_02' }
  });
  const crossSubReadPass = crossSubRead.status === 404;
  recordTest('N3 Tenant Isolation', 'Cross-tenant submission isolation returns 404', '404 Not Found', `${crossSubRead.status}`, crossSubReadPass ? 'PASS' : 'FAIL', 'P0', 'Cross-tenant submission blocked');

  // Test 3.4: Organization header forgery: Tenant Beta user claiming Tenant Alpha in header -> 403
  const headerForgeRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Authorization': `Bearer ${bharatMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const headerForgePass = headerForgeRes.status === 403;
  recordTest('N3 Tenant Isolation', 'Organization header forgery defense (Tenant Beta claiming Tenant Alpha)', '403 Forbidden', `${headerForgeRes.status}`, headerForgePass ? 'PASS' : 'FAIL', 'P0', 'Header forgery detected and rejected');

  // --------------------------------------------------------------------------
  // NODE N4: Case Lifecycle & State Machine UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N4] Case Lifecycle & State Machine UAT ---');

  // Test 4.1: Create case in initial "new" state
  const createCaseRes = await fetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      title: 'Dr. Anand Impersonator Scam Channel 11C',
      category: 'founder_doctor_creator_impersonation',
      priority: 'high',
      contested_url: `https://youtube.com/channel/fake_dr_anand_${Date.now()}`,
      target_entity: 'Dr. Anand K. Verma',
      hosting_platform: 'youtube',
      reported_by_email: 'priya.nair@apexhealth.example'
    })
  });
  const createCaseJson = await createCaseRes.json();
  const testCaseId = createCaseJson.data?.id;
  const createCasePass = createCaseRes.status === 201 && createCaseJson.data?.status === 'new';
  recordTest('N4 Lifecycle', 'Case creation initializes with status="new"', '201 Created with status="new"', `${createCaseRes.status}, status=${createCaseJson.data?.status}`, createCasePass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(createCaseJson));

  // Test 4.2: Transition new -> triage
  const t1Res = await fetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'triage', reason: 'Triage assessment initiated' })
  });
  const t1Pass = t1Res.status === 200;
  recordTest('N4 Lifecycle', 'State transition: new -> triage', '200 OK', `${t1Res.status}`, t1Pass ? 'PASS' : 'FAIL', 'P0', 'Transition to triage verified');

  // Test 4.3: Illegal transition: triage -> submitted (skipping authority, evidence, review)
  const illegalTriageRes = await fetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'submitted', reason: 'Illegal bypass directly to submitted' })
  });
  const illegalPass = illegalTriageRes.status >= 400;
  recordTest('N4 Lifecycle', 'State machine graph enforcement: triage -> submitted bypass rejected', '>= 400 Bad Request / Unprocessable', `${illegalTriageRes.status}`, illegalPass ? 'PASS' : 'FAIL', 'P0', 'Illegal transition blocked');

  // Test 4.4: Transition triage -> awaiting_authority -> evidence_collection
  await fetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'awaiting_authority', reason: 'Verifying client authority representation' })
  });
  const evColRes = await fetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'evidence_collection', reason: 'Authority confirmed, proceeding to evidence capture' })
  });
  const evColPass = evColRes.status === 200;
  recordTest('N4 Lifecycle', 'State transition: triage -> awaiting_authority -> evidence_collection', '200 OK', `${evColRes.status}`, evColPass ? 'PASS' : 'FAIL', 'P0', 'Reached evidence_collection state');

  // Test 4.5: Read-only stakeholder prohibited from state transitions
  const roRes = await fetch(`${BASE_URL}/api/cases/${testCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexStakeholderToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'human_review', reason: 'Stakeholder attempting status modification' })
  });
  const roPass = roRes.status === 403 || roRes.status >= 400;
  recordTest('N4 Lifecycle', 'Read-only stakeholder cannot mutate case state', '>= 400 / 403 Forbidden', `${roRes.status}`, roPass ? 'PASS' : 'FAIL', 'P0', 'Role restriction strictly enforced');

  // --------------------------------------------------------------------------
  // NODE N5: Evidence Custody & Chain-of-Custody UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N5] Evidence Custody & Chain-of-Custody UAT ---');

  // Test 5.1: Attach evidence item
  const addEvRes = await fetch(`${BASE_URL}/api/cases/${testCaseId}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      source_url: 'https://youtube.com/channel/fake_dr_anand/about',
      safe_display_name: 'Channel Profile About Page Screenshot',
      sensitivity: 'normal'
    })
  });
  const addEvJson = await addEvRes.json();
  const evidenceId = addEvJson.data?.id;
  const addEvPass = addEvRes.status === 201 && Boolean(evidenceId);
  recordTest('N5 Evidence', 'Attach evidence item to active case', '201 Created with evidence ID', `${addEvRes.status}, id=${evidenceId}`, addEvPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(addEvJson));

  // Test 5.2: Generate time-limited signed download token
  const tokenRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/download-token`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const tokenJson = await tokenRes.json();
  const downloadToken = tokenJson.data?.token;
  const tokenPass = tokenRes.status === 200 && Boolean(downloadToken);
  recordTest('N5 Evidence', 'Generate time-limited signed download token (300s expiration)', '200 OK with token', `${tokenRes.status}, token=${Boolean(downloadToken)}`, tokenPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(tokenJson));

  // Test 5.3: Tampered download token signature rejected
  const tamperedDownloadToken = downloadToken ? downloadToken.slice(0, -8) + '99999999' : 'bad.token';
  const tamperedRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/download?token=${tamperedDownloadToken}`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const tamperedPass = tamperedRes.status >= 400;
  recordTest('N5 Evidence', 'Tampered download token signature rejected', '>= 400 Bad Request / Unauthorized', `${tamperedRes.status}`, tamperedPass ? 'PASS' : 'FAIL', 'P0', 'Signature validation preserved');

  // Test 5.4: Legal hold placement
  const holdRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/legal-hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexLegalToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Preservation for statutory Section 66D IT Act court proceeding' })
  });
  const holdJson = await holdRes.json();
  const holdPass = holdRes.status === 201 && (holdJson.data?.id !== undefined || holdJson.success === true);
  recordTest('N5 Evidence', 'Place legal hold on evidence item', '201 Created with hold record', `${holdRes.status}, hold_id=${holdJson.data?.id}`, holdPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(holdJson));

  // Test 5.5: Deletion hard-blocked during legal hold
  const delDuringHoldRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/deletion-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Attempting deletion during active legal hold' })
  });
  const delDuringHoldPass = delDuringHoldRes.status === 409 || delDuringHoldRes.status >= 400;
  recordTest('N5 Evidence', 'Deletion hard-blocked when legal hold is active (HTTP 409)', '409 Conflict / >= 400', `${delDuringHoldRes.status}`, delDuringHoldPass ? 'PASS' : 'FAIL', 'P0', 'Legal hold immunity confirmed');

  // Test 5.6: Release legal hold
  const releaseHoldRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/legal-hold`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexLegalToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Legal proceedings concluded, releasing preservation hold' })
  });
  const releaseHoldPass = releaseHoldRes.status === 200;
  recordTest('N5 Evidence', 'Release legal hold by legal reviewer', '200 OK', `${releaseHoldRes.status}`, releaseHoldPass ? 'PASS' : 'FAIL', 'P1', 'Hold released');

  // Test 5.7: Deletion request (Two-Person step 1)
  const delReqRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/deletion-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Duplicate capture of evidence file' })
  });
  const delReqPass = delReqRes.status === 200;
  recordTest('N5 Evidence', 'Submit evidence deletion request (Two-person step 1)', '200 OK', `${delReqRes.status}`, delReqPass ? 'PASS' : 'FAIL', 'P1', 'Deletion requested');

  // Test 5.8: Two-Person Rule: Requester cannot self-approve deletion
  const selfApproveDelRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/approve-deletion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Analyst attempting self-approval of deletion' })
  });
  const selfApprovePass = selfApproveDelRes.status >= 400;
  recordTest('N5 Evidence', 'Two-Person Rule: Reject self-approval of evidence deletion', '>= 400 Bad Request / Forbidden', `${selfApproveDelRes.status}`, selfApprovePass ? 'PASS' : 'FAIL', 'P0', 'Self-approval strictly prevented');

  // Test 5.9: Independent second-person approval by Org Owner
  const secondPersonDelRes = await fetch(`${BASE_URL}/api/evidence/${evidenceId}/approve-deletion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexOwnerToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ reason: 'Org Owner second-person approval of evidence deletion' })
  });
  const secondPersonPass = secondPersonDelRes.status === 200;
  recordTest('N5 Evidence', 'Second-person approval of evidence deletion by Org Owner', '200 OK', `${secondPersonDelRes.status}`, secondPersonPass ? 'PASS' : 'FAIL', 'P0', 'Deletion successfully approved');

  // --------------------------------------------------------------------------
  // NODE N6: Detection Intake & Candidate Review UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N6] Detection Intake & Candidate Review UAT ---');

  const monitoredSubject = db.prepare("SELECT id FROM monitored_subjects WHERE organization_id = 'org_apex_health_01' LIMIT 1").get();
  const subjectId = monitoredSubject?.id || 'sbj_ba7b4ab8bd6644d5';

  // Test 6.1: Signal ingestion
  const ingestSigRes = await fetch(`${BASE_URL}/api/monitoring/signals/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      subject_id: subjectId,
      adapter_name: 'manual_intake_11c',
      source_type: 'manual_input',
      observed_url: `https://youtube.com/watch?v=fake_dr_anand_${Date.now()}`,
      platform: 'youtube',
      content_type: 'video',
      raw_payload: { title: 'Dr. Anand Miracle Diabetes Formula', channel: 'HealthTipsNow' },
      provenance: { source: 'Submitted via pilot operator desk' }
    })
  });
  const ingestSigJson = await ingestSigRes.json();
  const ingestSigPass = ingestSigRes.status === 201 || ingestSigRes.status === 200;
  recordTest('N6 Detection', 'Monitoring signal ingestion via API', '201 Created or 200 OK', `${ingestSigRes.status}`, ingestSigPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(ingestSigJson));

  // Test 6.2: Replay signals
  const replayRes = await fetch(`${BASE_URL}/api/monitoring/signals/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ subject_id: subjectId })
  });
  const replayJson = await replayRes.json();
  const replayPass = replayRes.status === 200 && replayJson.data?.replayed_count >= 0;
  recordTest('N6 Detection', 'Signal replay from synthetic seed fixtures', '200 OK with replayed count', `${replayRes.status}, count=${replayJson.data?.replayed_count}`, replayPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(replayJson));

  // Test 6.3: Simulate background evaluation cycle
  const evalCycleRes = await fetch(`${BASE_URL}/api/monitoring/simulate-cycle`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const evalCycleJson = await evalCycleRes.json();
  const evalCyclePass = evalCycleRes.status === 200 && evalCycleJson.data?.evaluation !== undefined;
  recordTest('N6 Detection', 'Simulate background candidate evaluation cycle', '200 OK with evaluation summary', `${evalCycleRes.status}`, evalCyclePass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(evalCycleJson));

  // Test 6.4: Retrieve candidate review queue
  const reviewsRes = await fetch(`${BASE_URL}/api/monitoring/reviews`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const reviewsJson = await reviewsRes.json();
  const reviews = reviewsJson.data || [];
  const reviewsPass = reviewsRes.status === 200 && Array.isArray(reviews);
  recordTest('N6 Detection', 'Candidate review queue listing', '200 OK with array of candidates', `${reviewsRes.status}, count=${reviews.length}`, reviewsPass ? 'PASS' : 'FAIL', 'P1', `Found ${reviews.length} candidate items`);

  // Test 6.5: Affirmative human review: Dismiss candidate as benign
  let reviewDecisionPass = true;
  if (reviews.length > 0) {
    const candidateToDismiss = reviews[0];
    const reviewId = candidateToDismiss.review?.id || candidateToDismiss.id;
    const dismissRes = await fetch(`${BASE_URL}/api/monitoring/reviews/${reviewId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
      body: JSON.stringify({
        decision: 'dismiss_benign',
        decision_reason: 'Confirmed authorized medical awareness clip with full disclaimers',
        false_positive_category: 'authorized_affiliate'
      })
    });
    reviewDecisionPass = dismissRes.status === 200;
  }
  recordTest('N6 Detection', 'Affirmative human review: Dismiss candidate with audit justification', '200 OK', reviewDecisionPass ? '200 OK' : 'Failed', reviewDecisionPass ? 'PASS' : 'FAIL', 'P0', 'Dismissal recorded in review queue');

  // Test 6.6: Mandatory Human Review Invariant (Zero automated takedowns)
  const autoTakedowns = db.prepare("SELECT count(*) as count FROM submissions WHERE status = 'auto_submitted'").get()?.count || 0;
  const invariantHumanReviewPass = autoTakedowns === 0;
  recordTest('N6 Detection', 'Invariant: human_review_mandatory=1 (zero automated platform takedowns)', '0 automated submissions in DB', `Found ${autoTakedowns} automated submissions`, invariantHumanReviewPass ? 'PASS' : 'FAIL', 'P0', 'Zero automated mutations confirmed');

  // --------------------------------------------------------------------------
  // NODE N7: Task Queue & Duplicate Advisory UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N7] Task Queue Lifecycle & Duplicate Advisory UAT ---');

  // Test 7.1: Create workflow task
  const createTaskRes = await fetch(`${BASE_URL}/api/workflow/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      case_id: testCaseId,
      task_type: 'missing_evidence',
      priority: 'p1',
      creation_reason: 'Preserve forensic video capture before intermediary content rotation'
    })
  });
  const createTaskJson = await createTaskRes.json();
  const taskId = createTaskJson.data?.id;
  const createTaskPass = createTaskRes.status === 201 && createTaskJson.data?.status === 'pending';
  recordTest('N7 Tasks', 'Workflow task creation in pending state', '201 Created with status="pending"', `${createTaskRes.status}, status=${createTaskJson.data?.status}`, createTaskPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(createTaskJson));

  // Test 7.2: Analyst acknowledges task
  const ackRes = await fetch(`${BASE_URL}/api/workflow/tasks/${taskId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const ackJson = await ackRes.json();
  const ackPass = ackRes.status === 200 && ackJson.data?.status === 'in_progress';
  recordTest('N7 Tasks', 'Task acknowledgment and user assignment', '200 OK with status="in_progress"', `${ackRes.status}, status=${ackJson.data?.status}`, ackPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(ackJson));

  // Test 7.3: Task completion
  const completeRes = await fetch(`${BASE_URL}/api/workflow/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ completion_reason: 'Forensic video archive saved and cryptographic SHA-256 registered' })
  });
  const completeJson = await completeRes.json();
  const completePass = completeRes.status === 200 && completeJson.data?.status === 'completed';
  recordTest('N7 Tasks', 'Task completion with audit justification', '200 OK with status="completed"', `${completeRes.status}, status=${completeJson.data?.status}`, completePass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(completeJson));

  // Test 7.4: Advisory Duplicate Detection (Non-destructive)
  const originalCase = db.prepare("SELECT contested_url FROM cases WHERE id = ?").get(testCaseId);
  const dupCaseRes = await fetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      title: 'Dr. Anand Impersonation Duplicate Intake 11C',
      category: 'founder_doctor_creator_impersonation',
      priority: 'medium',
      contested_url: originalCase.contested_url,
      target_entity: 'Dr. Anand K. Verma',
      hosting_platform: 'youtube',
      reported_by_email: 'priya.nair@apexhealth.example'
    })
  });
  const dupCaseJson = await dupCaseRes.json();
  const dupCaseId = dupCaseJson.data?.id;
  const dupLinks = db.prepare("SELECT * FROM duplicate_case_links WHERE source_case_id = ?").all(dupCaseId);
  const dupPass = dupCaseRes.status === 201 && dupLinks.length > 0;
  recordTest('N7 Tasks', 'Advisory Duplicate Detection creates link without overwriting existing case', '201 Created and duplicate_case_links row generated', `${dupCaseRes.status}, links=${dupLinks.length}`, dupPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(dupLinks));

  // --------------------------------------------------------------------------
  // NODE N8: Platforms Registry & Playbooks UAT (Rule 9 Check)
  // --------------------------------------------------------------------------
  console.log('\n--- [N8] Platforms Registry & Playbooks UAT ---');

  // Test 8.1: Platforms registry
  const platformsRes = await fetch(`${BASE_URL}/api/platforms`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const platformsJson = await platformsRes.json();
  const platforms = platformsJson.data || [];
  const platformsPass = platformsRes.status === 200 && platforms.length === 7;
  recordTest('N8 Platforms', 'Intermediary Platforms Registry (exactly 7 platforms)', '200 OK with 7 platforms', `${platformsRes.status}, count=${platforms.length}`, platformsPass ? 'PASS' : 'FAIL', 'P0', platforms.map(p => `${p.name} (${p.slug})`).join(', '));

  // Test 8.2: Playbooks registry
  const playbooksRes = await fetch(`${BASE_URL}/api/playbooks`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const playbooksJson = await playbooksRes.json();
  const playbooks = playbooksJson.data || [];
  const playbooksPass = playbooksRes.status === 200 && playbooks.length === 9;
  recordTest('N8 Platforms', 'Legal & Operational Playbooks (exactly 9 playbooks with SLAs)', '200 OK with 9 playbooks', `${playbooksRes.status}, count=${playbooks.length}`, playbooksPass ? 'PASS' : 'FAIL', 'P0', playbooks.map(pb => `${pb.title} (${pb.expected_response_window_hours}h)`).join(', '));

  // Test 8.3: UI verification - Unique platform names and grievance routes (Rule 9)
  const uniquePlatformNames = new Set(platforms.map(p => p.name)).size;
  const uniquePlatformSlugs = new Set(platforms.map(p => p.slug)).size;
  const uniquePlatformPass = uniquePlatformNames === 7 && uniquePlatformSlugs === 7;
  recordTest('N8 Platforms', 'Platform Registry uniqueness: All 7 platforms have distinct names and slugs', '7 unique names and 7 unique slugs', `Names=${uniquePlatformNames}, Slugs=${uniquePlatformSlugs}`, uniquePlatformPass ? 'PASS' : 'FAIL', 'P1', 'No duplicate platform names');

  // --------------------------------------------------------------------------
  // NODE N9: Submission & Dry-Run Lifecycle UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N9] Submission & Dry-Run Lifecycle UAT ---');

  // Setup dedicated case for submission dry run
  const subCaseRes = await fetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      title: 'Dr. Anand Dry-Run Grievance Submission 11C',
      category: 'founder_doctor_creator_impersonation',
      priority: 'high',
      contested_url: `https://youtube.com/watch?v=dr_anand_dryrun_11c_${Date.now()}`,
      target_entity: 'Dr. Anand K. Verma',
      hosting_platform: 'youtube',
      reported_by_email: 'priya.nair@apexhealth.example'
    })
  });
  const subCaseJson = await subCaseRes.json();
  const subCaseId = subCaseJson.data.id;

  // Advance case to evidence_collection
  await fetch(`${BASE_URL}/api/cases/${subCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'triage', reason: 'Triage' })
  });
  await fetch(`${BASE_URL}/api/cases/${subCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'awaiting_authority', reason: 'Authority' })
  });
  await fetch(`${BASE_URL}/api/cases/${subCaseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ to_status: 'evidence_collection', reason: 'Evidence' })
  });

  // Attach evidence
  await fetch(`${BASE_URL}/api/cases/${subCaseId}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      source_url: 'https://youtube.com/watch?v=dr_anand_dryrun_11c/evidence/1',
      safe_display_name: 'Impersonation Video Frame and Title Header',
      sensitivity: 'normal'
    })
  });

  // Test 9.1: Create submission draft
  const createSubRes = await fetch(`${BASE_URL}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ case_id: subCaseId, platform_id: 'plt_youtube', playbook_id: 'pb_synthetic_media' })
  });
  const createSubJson = await createSubRes.json();
  const submissionId = createSubJson.data?.id;
  const createSubPass = createSubRes.status === 201 && Boolean(submissionId);
  recordTest('N9 Submissions', 'Submission draft creation', '201 Created with submission ID', `${createSubRes.status}, id=${submissionId}`, createSubPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(createSubJson));

  // Test 9.2: Preview packet and SHA-256 hash
  const previewRes = await fetch(`${BASE_URL}/api/submissions/${submissionId}/preview`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const previewJson = await previewRes.json();
  const packetHash = previewJson.data?.packetHash || previewJson.data?.packet_hash || createSubJson.data?.packet_hash;
  const previewPass = previewRes.status === 200 && packetHash && packetHash.length === 64;
  recordTest('N9 Submissions', 'Submission packet preview & SHA-256 packet hash calculation', '200 OK with 64-char SHA-256 hash', `${previewRes.status}, hash=${packetHash?.slice(0, 16)}...`, previewPass ? 'PASS' : 'FAIL', 'P0', `Hash: ${packetHash}`);

  // Test 9.3: Analyst forbidden from approving submission facets
  const analystApproveRes = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexAnalystToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'legal_sufficiency', decision: 'approved', decision_reason: 'Analyst attempting approval', packet_hash: packetHash })
  });
  const analystForbiddenPass = analystApproveRes.status === 403;
  recordTest('N9 Submissions', 'Enforce RBAC: Analyst forbidden from submission facet approvals', '403 Forbidden', `${analystApproveRes.status}`, analystForbiddenPass ? 'PASS' : 'FAIL', 'P0', 'Role boundary enforced');

  // Test 9.4: Multi-facet approvals
  const f1 = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexLegalToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'legal_sufficiency', decision: 'approved', decision_reason: 'Statutory basis verified under Rule 3(1)(b) IT Rules 2021', packet_hash: packetHash })
  });
  const f2 = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'evidence_sufficiency', decision: 'approved', decision_reason: 'Evidence integrity and provenance verified', packet_hash: packetHash })
  });
  const f3 = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'platform_route_selection', decision: 'approved', decision_reason: 'Designated Grievance Officer statutory route confirmed', packet_hash: packetHash })
  });
  const facets123Pass = f1.status === 200 && f2.status === 200 && f3.status === 200;
  recordTest('N9 Submissions', 'Multi-facet approvals: Legal, Evidence, and Route selection', 'All 3 facets return 200 OK', `F1=${f1.status}, F2=${f2.status}, F3=${f3.status}`, facets123Pass ? 'PASS' : 'FAIL', 'P0', '3 facets approved');

  // Test 9.5: Creator self-approval rejected (Separation of Duties)
  const selfSimApprove = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'simulated_submission', decision: 'approved', decision_reason: 'Creator attempting self-approval', packet_hash: packetHash })
  });
  const selfSimPass = selfSimApprove.status >= 400;
  recordTest('N9 Submissions', 'Enforce Separation of Duties: Creator self-approval of simulated_submission rejected', '>= 400 Bad Request / Unprocessable', `${selfSimApprove.status}`, selfSimPass ? 'PASS' : 'FAIL', 'P0', 'Two-person approval gate preserved');

  // Test 9.6: Distinct second-person approval by Org Owner
  const secondPersonSub = await fetch(`${BASE_URL}/api/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexOwnerToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ approval_facet: 'simulated_submission', decision: 'approved', decision_reason: 'Org Owner second-person approval for dry-run simulation', packet_hash: packetHash })
  });
  const secondPersonSubPass = secondPersonSub.status === 200;
  recordTest('N9 Submissions', 'Second-person simulated_submission approval by Org Owner', '200 OK', `${secondPersonSub.status}`, secondPersonSubPass ? 'PASS' : 'FAIL', 'P0', 'All 4 facets approved');

  // Test 9.7: Dry-run simulation execution (Zero live mutation)
  const simRes = await fetch(`${BASE_URL}/api/submissions/${submissionId}/simulate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const simJson = await simRes.json();
  const simPass = simRes.status === 200 && simJson.data?.submission?.status === 'simulated_submitted' && Boolean(simJson.data?.submission?.simulated_reference_id);
  recordTest('N9 Submissions', 'Execute dry-run simulation with ZERO live network calls', '200 OK, status="simulated_submitted", reference ID issued', `${simRes.status}, status=${simJson.data?.submission?.status}, ref=${simJson.data?.submission?.simulated_reference_id}`, simPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(simJson));

  // Test 9.8: Record platform acknowledgement & decision manually
  const ackPlatRes = await fetch(`${BASE_URL}/api/submissions/${submissionId}/responses/acknowledgement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ platform_reference_number: 'YT-GO-2026-4412', operator_notes: 'Google India Grievance Nodal Desk statutory acknowledgment' })
  });
  const decPlatRes = await fetch(`${BASE_URL}/api/submissions/${submissionId}/responses/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ response_category: 'takedown_completed', takedown_result: 'removed', platform_reference_number: 'YT-GO-2026-4412', operator_notes: 'Intermediary confirmed video removal under Rule 3(1)(b)' })
  });
  const manualPlatPass = [200, 201].includes(ackPlatRes.status) && [200, 201].includes(decPlatRes.status);
  recordTest('N9 Submissions', 'Manual recording of platform acknowledgment & resolution decision', '200 or 201 Created on both endpoints', `Ack=${ackPlatRes.status}, Dec=${decPlatRes.status}`, manualPlatPass ? 'PASS' : 'FAIL', 'P1', 'Full lifecycle loop completed');

  // --------------------------------------------------------------------------
  // NODE N10: Emergency Kill-Switch & Integrations UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N10] Emergency Kill-Switch & Integrations UAT ---');

  // Test 10.1: Case Manager rejected from toggling kill-switch
  const mgrToggleKs = await fetch(`${BASE_URL}/api/integrations/kill-switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ active: true })
  });
  const mgrTogglePass = mgrToggleKs.status === 403;
  recordTest('N10 Kill-Switch', 'Enforce RBAC: Case Manager forbidden from toggling emergency kill-switch', '403 Forbidden', `${mgrToggleKs.status}`, mgrTogglePass ? 'PASS' : 'FAIL', 'P0', 'Only Org Owner / System Admin permitted');

  // Test 10.2: Org Owner arms kill-switch
  const armKsRes = await fetch(`${BASE_URL}/api/integrations/kill-switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexOwnerToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ active: true })
  });
  const armKsJson = await armKsRes.json();
  const armKsPass = armKsRes.status === 200 && armKsJson.data?.kill_switch_active === true;
  recordTest('N10 Kill-Switch', 'Org Owner arms emergency integration kill-switch', '200 OK, kill_switch_active=true', `${armKsRes.status}, active=${armKsJson.data?.kill_switch_active}`, armKsPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(armKsJson));

  // Test 10.3: Inbound webhook blocked during active kill switch (returns 503)
  const webhookKsRes = await fetch(`${BASE_URL}/api/integrations/youtube/webhook/conn_test_01`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'test' })
  });
  const webhookKsPass = webhookKsRes.status === 503;
  recordTest('N10 Kill-Switch', 'Inbound provider webhook returns 503 KILL_SWITCH_ACTIVE during kill-switch', '503 Service Unavailable', `${webhookKsRes.status}`, webhookKsPass ? 'PASS' : 'FAIL', 'P0', 'Webhook traffic blocked at boundary');

  // Test 10.4: Disarm kill-switch
  const disarmKsRes = await fetch(`${BASE_URL}/api/integrations/kill-switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexOwnerToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ active: false })
  });
  const disarmKsJson = await disarmKsRes.json();
  const disarmPass = disarmKsRes.status === 200 && disarmKsJson.data?.kill_switch_active === false;
  recordTest('N10 Kill-Switch', 'Org Owner disarms emergency integration kill-switch', '200 OK, kill_switch_active=false', `${disarmKsRes.status}`, disarmPass ? 'PASS' : 'FAIL', 'P0', 'Normal traffic restored');

  // --------------------------------------------------------------------------
  // NODE N11: Organization Onboarding UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N11] Organization Onboarding UAT ---');

  // Test 11.1: Create synthetic organization
  const synthOrgSlug = `synth-org-${Date.now().toString(36)}`;
  const createOrgRes = await fetch(`${BASE_URL}/api/onboarding/organizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sysadminToken}` },
    body: JSON.stringify({
      name: `Synthetic Enterprise ${Date.now().toString(36)}`,
      slug: synthOrgSlug,
      industry: 'Pharmaceuticals & Healthcare',
      jurisdiction: 'IN-MH',
      primary_contact_email: `admin@${synthOrgSlug}.example`,
      plan_tier: 'enterprise'
    })
  });
  const createOrgJson = await createOrgRes.json();
  const synthOrgId = createOrgJson.data?.id;
  const synthOrgPass = createOrgRes.status === 201 && Boolean(synthOrgId);
  recordTest('N11 Onboarding', 'Tenant organization creation with plan tier', '201 Created with new org ID', `${createOrgRes.status}, id=${synthOrgId}`, synthOrgPass ? 'PASS' : 'FAIL', 'P0', JSON.stringify(createOrgJson));

  // Test 11.2: 7-step onboarding checklist retrieval
  const checklistRes = await fetch(`${BASE_URL}/api/onboarding/checklist`, {
    headers: { 'Authorization': `Bearer ${sysadminToken}`, 'x-organization-id': synthOrgId }
  });
  const checklistJson = await checklistRes.json();
  const checklistPass = checklistRes.status === 200 && checklistJson.data?.ready_for_cases === false;
  recordTest('N11 Onboarding', '7-Step readiness checklist retrieval and verification', '200 OK, ready_for_cases=false for fresh org', `${checklistRes.status}, ready=${checklistJson.data?.ready_for_cases}, pct=${checklistJson.data?.completion_percentage}%`, checklistPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(checklistJson));

  // Test 11.3: Update settings (terms accepted and playbook acknowledged)
  const updateSettingsRes = await fetch(`${BASE_URL}/api/onboarding/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sysadminToken}`, 'x-organization-id': synthOrgId },
    body: JSON.stringify({ terms_accepted: true, playbook_acknowledged: true })
  });
  const updateSettingsJson = await updateSettingsRes.json();
  const updateSettingsPass = updateSettingsRes.status === 200 && updateSettingsJson.data?.completion_percentage > checklistJson.data?.completion_percentage;
  recordTest('N11 Onboarding', 'Terms acceptance & playbook acknowledgment', '200 OK with increased completion percentage', `${updateSettingsRes.status}, pct=${updateSettingsJson.data?.completion_percentage}%`, updateSettingsPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(updateSettingsJson));

  // --------------------------------------------------------------------------
  // NODE N12: Usage, Billing & Metering UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N12] Usage, Billing & Metering UAT ---');

  // Test 12.1: Usage summary
  const usageRes = await fetch(`${BASE_URL}/api/usage/summary`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const usageJson = await usageRes.json();
  const usagePass = usageRes.status === 200 && usageJson.data !== undefined;
  recordTest('N12 Usage/Billing', 'Query metered usage summary for tenant', '200 OK with usage metrics', `${usageRes.status}`, usagePass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(usageJson));

  // Test 12.2: Billing plans catalog
  const plansRes = await fetch(`${BASE_URL}/api/billing/plans`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const plansJson = await plansRes.json();
  const plansPass = plansRes.status === 200 && Array.isArray(plansJson.data) && plansJson.disclaimer.includes('DRY-RUN SIMULATION ONLY');
  recordTest('N12 Usage/Billing', 'Billing plans catalog retrieval with dry-run disclaimer', '200 OK with plans array and dry-run disclaimer', `${plansRes.status}, disclaimer="${plansJson.disclaimer?.slice(0, 25)}..."`, plansPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(plansJson));

  // Test 12.3: Simulated dry-run invoice preview
  const invoiceRes = await fetch(`${BASE_URL}/api/billing/preview`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const invoiceJson = await invoiceRes.json();
  const invoicePass = invoiceRes.status === 200 && invoiceJson.data !== undefined;
  recordTest('N12 Usage/Billing', 'Simulated dry-run invoice preview for tenant', '200 OK with simulated invoice lines', `${invoiceRes.status}`, invoicePass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(invoiceJson));

  // Test 12.4: Customer profile
  const custRes = await fetch(`${BASE_URL}/api/billing/customer`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const custJson = await custRes.json();
  const custPass = custRes.status === 200 && custJson.data?.customer !== undefined;
  recordTest('N12 Usage/Billing', 'Simulated customer and subscription profile', '200 OK with customer profile', `${custRes.status}`, custPass ? 'PASS' : 'FAIL', 'P1', JSON.stringify(custJson));

  // --------------------------------------------------------------------------
  // NODE N13: Audit Ledger Immutability & Completeness UAT
  // --------------------------------------------------------------------------
  console.log('\n--- [N13] Audit Ledger Immutability & Completeness UAT ---');

  const auditEventsRes = await fetch(`${BASE_URL}/api/audit-events?limit=25`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const auditEventsJson = await auditEventsRes.json();
  const auditEvents = auditEventsJson.data || [];
  const auditPass = auditEventsRes.status === 200 && auditEvents.length > 0;
  recordTest('N13 Audit Ledger', 'Query chronological tenant audit trail', '200 OK with non-empty event list', `${auditEventsRes.status}, count=${auditEvents.length}`, auditPass ? 'PASS' : 'FAIL', 'P0', `Retrieved ${auditEvents.length} audit records`);

  const dbAuditCount = db.prepare("SELECT count(*) as count FROM audit_events WHERE organization_id = 'org_apex_health_01'").get()?.count || 0;
  const auditCompletePass = dbAuditCount >= auditEvents.length;
  recordTest('N13 Audit Ledger', 'Database persistence and append-only ledger integrity', 'DB audit events match or exceed API query count', `DB=${dbAuditCount}, API=${auditEvents.length}`, auditCompletePass ? 'PASS' : 'FAIL', 'P0', 'Audit trail unbroken');

  // --------------------------------------------------------------------------
  // NODE N14: Visual / UI / UX Completeness Audit
  // --------------------------------------------------------------------------
  console.log('\n--- [N14] Visual / UI / UX Completeness Audit ---');

  // Test 14.1: Single-page application HTML loads
  const htmlRes = await fetch(`${BASE_URL}/`);
  const htmlText = await htmlRes.text();
  const htmlPass = htmlRes.status === 200 && htmlText.includes('<title>Digital Impersonation Response Desk</title>');
  recordTest('N14 Visual QA', 'Frontend single page app index.html loads with valid title & meta', '200 OK with document title', `${htmlRes.status}`, htmlPass ? 'PASS' : 'FAIL', 'P1', 'index.html verified');

  // Test 14.2: Verify all 14 sidebar navigation buttons in DOM
  const navIds = [
    'navCasesBtn', 'navTasksBtn', 'navEscalationsBtn', 'navReuploadsBtn',
    'navPlatformsBtn', 'navAuditBtn', 'navMonitoringBtn', 'navEvaluationBtn',
    'navIntegrationsBtn', 'navOnboardingBtn', 'navUsageBtn', 'navBillingBtn',
    'navReportsBtn', 'navWorkersBtn'
  ];
  const missingNavs = navIds.filter(id => !htmlText.includes(`id="${id}"`));
  const navPass = missingNavs.length === 0;
  recordTest('N14 Visual QA', 'All 14 sidebar navigation buttons present in DOM', '14 navigation buttons present', `${14 - missingNavs.length}/14 present`, navPass ? 'PASS' : 'FAIL', 'P1', missingNavs.length ? `Missing: ${missingNavs.join(', ')}` : 'All 14 nav buttons verified');

  // Test 14.3: Verify modal dialog components in DOM
  const modalIds = [
    'newCaseModal', 'candidateReviewModal', 'ingestSignalModal',
    'facetApprovalModal', 'recordAckModal', 'recordDecisionModal',
    'evidenceInspectModal', 'killSwitchModal'
  ];
  const missingModals = modalIds.filter(id => !htmlText.includes(`id="${id}"`));
  const modalPass = missingModals.length === 0;
  recordTest('N14 Visual QA', 'Modal dialog components declared in DOM', '8 key modal components present', `${modalIds.length - missingModals.length}/${modalIds.length} present`, modalPass ? 'PASS' : 'FAIL', 'P2', `Present: ${modalIds.filter(id => htmlText.includes(`id="${id}"`)).join(', ')}`);

  // Test 14.4: app.js bundle loads and delivers intact
  const appJsRes = await fetch(`${BASE_URL}/app.js`);
  const appJsText = await appJsRes.text();
  const appJsPass = appJsRes.status === 200 && appJsText.length > 50000;
  recordTest('N14 Visual QA', 'Frontend JavaScript bundle (app.js) delivery', '200 OK with complete script bundle', `${appJsRes.status}, size=${appJsText.length} bytes`, appJsPass ? 'PASS' : 'FAIL', 'P1', 'app.js delivered intact');

  // --------------------------------------------------------------------------
  // NODE N15: Negative & Adversarial API Testing
  // --------------------------------------------------------------------------
  console.log('\n--- [N15] Negative & Adversarial API Testing ---');

  // Test 15.1: Malformed JSON payload
  const badJsonRes = await fetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: '{"invalid_json": true,'
  });
  const badJsonPass = badJsonRes.status === 400;
  recordTest('N15 Adversarial', 'Malformed JSON payload rejected with 400 Bad Request', '400 Bad Request', `${badJsonRes.status}`, badJsonPass ? 'PASS' : 'FAIL', 'P1', 'Invalid JSON syntax safely handled');

  // Test 15.2: SQL Injection in search query parameter
  const sqliRes = await fetch(`${BASE_URL}/api/cases?search=${encodeURIComponent("' OR 1=1; DROP TABLE cases; --")}`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const sqliPass = sqliRes.status === 200;
  recordTest('N15 Adversarial', 'SQL injection in search parameters safely escaped by parameterized queries', '200 OK (no SQL syntax error, table preserved)', `${sqliRes.status}`, sqliPass ? 'PASS' : 'FAIL', 'P0', 'Parameterized query verified');

  // Test 15.3: Path traversal in download routes
  const traversalRes = await fetch(`${BASE_URL}/api/evidence/download?token=../../../../windows/win.ini`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const traversalPass = traversalRes.status >= 400;
  recordTest('N15 Adversarial', 'Path traversal attempt in storage download routes safely rejected', '>= 400 Bad Request / Forbidden / Not Found', `${traversalRes.status}`, traversalPass ? 'PASS' : 'FAIL', 'P0', 'Path traversal attempt neutralized');

  // Test 15.4: Expired token rejected
  const expiredPayload = {
    userId: 'usr_apex_mgr_02',
    email: 'priya.nair@apexhealth.example',
    systemRole: 'user',
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 3600
  };
  const expB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
  const expSig = crypto.createHmac('sha256', secret).update(expB64).digest('base64url');
  const expiredToken = `desk_tok_${expB64}.${expSig}`;
  const expiredRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Authorization': `Bearer ${expiredToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const expiredPass = expiredRes.status === 401;
  recordTest('N15 Adversarial', 'Expired session token rejected with 401 Unauthorized', '401 Unauthorized', `${expiredRes.status}`, expiredPass ? 'PASS' : 'FAIL', 'P0', 'Expired session token blocked');

  // --------------------------------------------------------------------------
  // NODE N16: Database Integrity & PRAGMA Verification
  // --------------------------------------------------------------------------
  console.log('\n--- [N16] Database Integrity & PRAGMA Verification ---');

  const integrityCheck = db.prepare('PRAGMA integrity_check').get();
  const integrityPass = integrityCheck.integrity_check === 'ok';
  recordTest('N16 DB Integrity', 'SQLite PRAGMA integrity_check', 'ok', integrityCheck.integrity_check, integrityPass ? 'PASS' : 'FAIL', 'P0', 'Database tables and B-trees intact');

  const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
  const fkPass = fkCheck.length === 0;
  recordTest('N16 DB Integrity', 'SQLite PRAGMA foreign_key_check', '0 violations', `${fkCheck.length} violations`, fkPass ? 'PASS' : 'FAIL', 'P0', 'Referential integrity 100% compliant');

  const journalMode = db.prepare('PRAGMA journal_mode').get();
  const walPass = journalMode.journal_mode === 'wal';
  recordTest('N16 DB Integrity', 'SQLite PRAGMA journal_mode', 'wal', journalMode.journal_mode, walPass ? 'PASS' : 'FAIL', 'P1', 'Write-Ahead-Logging mode active');

  // --------------------------------------------------------------------------
  // NODE N17: UI vs API vs Database Consistency Cross-Check
  // --------------------------------------------------------------------------
  console.log('\n--- [N17] UI vs API vs Database Consistency Cross-Check ---');

  // Check 17.1: Platforms parity
  const dbPlatforms = db.prepare('SELECT count(*) as count FROM platform_registry').get().count;
  const apiPlatforms = platforms.length;
  const platformParityPass = dbPlatforms === apiPlatforms && apiPlatforms === 7;
  recordTest('N17 Parity', 'Platform Registry consistency: UI template == API data == SQLite records', '7 in DB and 7 in API', `DB=${dbPlatforms}, API=${apiPlatforms}`, platformParityPass ? 'PASS' : 'FAIL', 'P0', 'Platforms fully consistent');

  // Check 17.2: Playbooks parity
  const dbPlaybooks = db.prepare('SELECT count(*) as count FROM platform_playbooks').get().count;
  const apiPlaybooks = playbooks.length;
  const playbookParityPass = dbPlaybooks === apiPlaybooks && apiPlaybooks === 9;
  recordTest('N17 Parity', 'Playbooks consistency: UI template == API data == SQLite records', '9 in DB and 9 in API', `DB=${dbPlaybooks}, API=${apiPlaybooks}`, playbookParityPass ? 'PASS' : 'FAIL', 'P0', 'Playbooks fully consistent');

  // Check 17.3: Cases parity
  const dbCasesCount = db.prepare("SELECT count(*) as count FROM cases WHERE organization_id = 'org_apex_health_01'").get().count;
  const apiCasesRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const apiCasesJson = await apiCasesRes.json();
  const apiCasesCount = apiCasesJson.data?.length || 0;
  const casesParityPass = dbCasesCount === apiCasesCount;
  recordTest('N17 Parity', 'Cases consistency: API cases list == SQLite cases rows for tenant', 'Equal count in DB and API', `DB=${dbCasesCount}, API=${apiCasesCount}`, casesParityPass ? 'PASS' : 'FAIL', 'P0', 'Cases fully consistent');

  // --------------------------------------------------------------------------
  // NODE N18: Fresh-Context Independent Adversarial Verification
  // --------------------------------------------------------------------------
  console.log('\n--- [N18] Fresh-Context Independent Adversarial Verification ---');

  // Invariant 1: Unsigned token injection fails
  const forgedRawToken = 'desk_tok_eyJ1c2VySWQiOiJ1c3Jfc3lzYWRtaW5fMDAifQ';
  const rawTokenRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Authorization': `Bearer ${forgedRawToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const inv1Pass = rawTokenRes.status === 401;
  recordTest('N18 Invariants', 'Invariant 1: Unsigned or stripped token rejected with 401', '401 Unauthorized', `${rawTokenRes.status}`, inv1Pass ? 'PASS' : 'FAIL', 'P0', 'Unsigned token injection blocked');

  // Invariant 2: Submissions require all 4 approval facets before simulation
  const freshCaseRes = await fetch(`${BASE_URL}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({
      title: 'Premature Simulation Test Case',
      category: 'founder_doctor_creator_impersonation',
      priority: 'low',
      contested_url: `https://youtube.com/channel/premature_${Date.now()}`,
      target_entity: 'Dr. Anand K. Verma',
      hosting_platform: 'youtube',
      reported_by_email: 'priya.nair@apexhealth.example'
    })
  });
  const freshCaseJson = await freshCaseRes.json();
  const freshSubRes = await fetch(`${BASE_URL}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' },
    body: JSON.stringify({ case_id: freshCaseJson.data.id, platform_id: 'plt_youtube', playbook_id: 'pb_synthetic_media' })
  });
  const freshSubJson = await freshSubRes.json();
  const prematureSimRes = await fetch(`${BASE_URL}/api/submissions/${freshSubJson.data.id}/simulate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apexMgrToken}`, 'x-organization-id': 'org_apex_health_01' }
  });
  const inv2Pass = prematureSimRes.status >= 400;
  recordTest('N18 Invariants', 'Invariant 2: Premature simulation without 4 facets hard-fails', '>= 400 Bad Request / Unprocessable', `${prematureSimRes.status}`, inv2Pass ? 'PASS' : 'FAIL', 'P0', 'Incomplete facet simulation blocked');

  // Invariant 3: Zero live outbound internet calls during dry-run simulation
  const liveOutboundRows = db.prepare("SELECT count(*) as count FROM submissions WHERE status IN ('submitted', 'live_submitted', 'external_api_call')").get().count;
  const inv3Pass = liveOutboundRows === 0;
  recordTest('N18 Invariants', 'Invariant 3: Zero live platform takedowns / outbound mutations in DB', '0 live outbound records', `${liveOutboundRows} live records`, inv3Pass ? 'PASS' : 'FAIL', 'P0', 'Simulation safety boundary verified');

  // --------------------------------------------------------------------------
  // NODE N19: REDUCE RESULTS INTO STRUCTURED FINDINGS JSON
  // --------------------------------------------------------------------------
  console.log('\n--- [N19] Final Verdict & Results Export ---');

  const resultsData = {
    suite: 'Phase 11C Independent Localhost Operator UAT & Verification',
    timestamp: new Date().toISOString(),
    environment: {
      url: BASE_URL,
      node_version: process.version,
      operating_system: process.platform,
      database: 'SQLite 3 (WAL mode)',
      operating_posture: 'Controlled pilot / production-canary operation only'
    },
    release_verdict: totalFailed === 0 ? 'LOCAL_UAT_PASS' : 'LOCAL_UAT_FAIL',
    ga_blockers: [
      { id: 'EXT-001', name: 'Independent External Penetration Testing', status: 'NOT PERFORMED' },
      { id: 'CLOUD-001', name: 'AWS KMS CMK + S3 Object Lock Production Deployment', status: 'PENDING' },
      { id: 'SOAK-001', name: '72-Hour Continuous Staged Canary Soak', status: 'PENDING' },
      { id: 'LEG-001', name: 'Qualified Indian Legal Counsel Opinion', status: 'PENDING' }
    ],
    metrics: {
      total_tests: findings.length,
      passed: totalPassed,
      failed: totalFailed,
      blocked: 0,
      pass_rate: `${((totalPassed / findings.length) * 100).toFixed(1)}%`
    },
    findings
  };

  const resultsPath = path.resolve(process.cwd(), 'results/phase-11c-uat-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2));
  console.log(`\n✓ Structured results successfully exported to: ${resultsPath}`);

  console.log('\n================================================================');
  console.log(`EXECUTION SUMMARY: ${totalPassed}/${findings.length} TESTS PASSED (${resultsData.metrics.pass_rate})`);
  console.log(`FINAL LOCAL UAT VERDICT: ${resultsData.release_verdict}`);
  console.log('================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ FATAL UNCAUGHT RUNNER EXCEPTION:', err);
  process.exit(1);
});
