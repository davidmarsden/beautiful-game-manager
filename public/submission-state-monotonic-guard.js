(() => {
  let newestSubmissionTime = 0;
  let newestSubmissionFingerprint = '';

  const norm = (value) => String(value ?? '');

  function submissionFromState(state) {
    const raw = state?.current_submission;
    if (!raw) return null;
    const instruction = raw.instruction || {};
    return {
      ...raw,
      ...instruction,
      tactics: instruction.tactics || raw.tactics || {}
    };
  }

  function submissionTime(submission) {
    const value = submission?.updated_at || submission?.submitted_at || '';
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fingerprint(submission) {
    if (!submission) return '';
    return JSON.stringify({
      fixture_id: norm(submission.fixture_id),
      formation: norm(submission.formation),
      starting_xi: (submission.starting_xi || []).map(norm),
      bench: (submission.bench || []).map(norm),
      captain_id: norm(submission.captain_id),
      tactics: submission.tactics || {}
    });
  }

  function remember(state) {
    const submission = submissionFromState(state);
    if (!submission) return true;
    const time = submissionTime(submission);
    const nextFingerprint = fingerprint(submission);

    if (newestSubmissionTime && time && time < newestSubmissionTime) return false;
    if (newestSubmissionTime && !time && newestSubmissionFingerprint && nextFingerprint !== newestSubmissionFingerprint) return false;

    if (time > newestSubmissionTime || !newestSubmissionFingerprint) {
      newestSubmissionTime = time;
      newestSubmissionFingerprint = nextFingerprint;
    }
    return true;
  }

  function guardPortalState(event) {
    if (remember(event.detail)) {
      if (event.detail?.current_submission) window.tbgPortalState = event.detail;
      return;
    }
    event.stopImmediatePropagation();
    console.warn('Ignored stale portal state carrying an older team submission');
  }

  ['tbg:portal-rendered', 'tbg:portal-refreshed'].forEach((eventName) => {
    window.addEventListener(eventName, guardPortalState, true);
  });

  window.addEventListener('tbg:team-submission-saved', (event) => {
    const state = event.detail?.state;
    if (state?.current_submission) {
      remember(state);
      window.tbgPortalState = state;
    }
  }, true);
})();
