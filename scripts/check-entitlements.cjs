const baseUrl = 'http://127.0.0.1:4000';
const orgId = 'org_apex_health_01';
const headers = {
  'Content-Type': 'application/json',
  'x-organization-id': orgId,
  'x-user-id': 'usr_apex_mgr_02'
};

async function testCandidateReplay() {
  const subjectId = 'sbj_ba7b4ab8bd6644d5';

  // 1. Replay signals from seeds/monitoring-fixtures.json
  const replayRes = await fetch(baseUrl + '/api/monitoring/signals/replay', {
    method: 'POST',
    headers,
    body: JSON.stringify({ subject_id: subjectId })
  });
  console.log('1. Replay status:', replayRes.status, await replayRes.json());

  // 2. Trigger evaluation cycle
  const cycleRes = await fetch(baseUrl + '/api/monitoring/simulate-cycle', {
    method: 'POST',
    headers
  });
  console.log('2. Evaluation cycle status:', cycleRes.status, await cycleRes.json());

  // 3. Fetch candidate reviews
  const reviewsRes = await fetch(baseUrl + '/api/monitoring/reviews', { headers });
  const reviews = (await reviewsRes.json()).data;
  console.log('3. Candidate Reviews Count:', reviews.length);

  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    console.log('Candidate [' + (i+1) + ']:', {
      reviewId: r.review.id,
      status: r.review.status,
      observedUrl: r.signal.observed_url,
      riskScore: r.risk_score?.score,
      confidenceScore: r.correlation?.confidence_score,
      recommendedAction: r.correlation?.recommended_action,
      humanReviewMandatory: r.correlation?.human_review_mandatory,
      caseId: r.review.case_id
    });
  }

  if (reviews.length >= 2) {
    // 4. Test Analyst Rejection on Candidate 1
    const cand1 = reviews[0];
    const rejRes = await fetch(baseUrl + '/api/monitoring/reviews/' + cand1.review.id + '/decision', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'dismiss_parody',
        decision_reason: 'Identified as parody meme page per Section 79 satire guidelines',
        false_positive_category: 'satire_parody'
      })
    });
    const rejData = (await rejRes.json()).data;
    console.log('4. Rejection Decision Status:', rejRes.status, 'Review status:', rejData?.status, 'Case ID created (must be null):', rejData?.case_id);

    // 5. Test Affirmative Confirmation on Candidate 2
    const cand2 = reviews[1];
    const confRes = await fetch(baseUrl + '/api/monitoring/reviews/' + cand2.review.id + '/decision', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: 'confirm_candidate',
        decision_reason: 'Confirmed fraudulent deepfake impersonation soliciting money',
        create_new_case: true,
        case_title: 'Confirmed Impersonation Video: ' + cand2.signal.observed_url,
        case_category: 'brand_impersonation',
        priority: 'critical'
      })
    });
    const confData = (await confRes.json()).data;
    console.log('5. Confirmation Decision Status:', confRes.status, 'Review Status:', confData?.status, 'Spawned Case:', confData?.case_id);
  }
}
testCandidateReplay();
