(() => {
  const nativeFetch = window.fetch.bind(window);
  const $ = (id) => document.getElementById(id);
  let captainObserver = null;
  let observedPitch = null;
  let cachedPortalState = window.tbgPortalState || null;

  function authorization() {
    return String(window.tbgPortalAuthorization || '').trim();
  }

  function cachePortalState(state) {
    if (!state || typeof state !== 'object') return state;
    cachedPortalState = state;
    window.tbgPortalState = state;
    return state;
  }

  function invalidatePortalState() {
    cachedPortalState = null;
    window.tbgPortalState = null;
    window.tbgInvalidateBootstrapCache?.();
  }

  function statusTarget() {
    return $('submissionStatus');
  }

  function setStatus(message, kind = '') {
    const target = statusTarget();
    if (!target) return;
    target.className = kind;
    target.textContent = message;
  }

  function installInlineStatus() {
    const form = $('decisionForm');
    const button = form?.querySelector('button[type="submit"]');
    const status = statusTarget();
    if (!form || !button || !status || button.closest('.team-submission-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'team-submission-actions';
    button.before(actions);
    actions.append(button, status);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
  }

  async function responseBody(response, fallbackMessage) {
    const text = await response.text();
    if (!text.trim()) {
      if (response.ok) return {};
      throw new Error(`${fallbackMessage} (HTTP ${response.status}; empty response)`);
    }
    try {
      return JSON.parse(text);
    } catch {
      const excerpt = text.trim().replace(/\s+/g, ' ').slice(0, 500);
      throw new Error(`${fallbackMessage} (HTTP ${response.status}; invalid response${excerpt ? ` · ${excerpt}` : ''})`);
    }
  }

  async function bootstrapState() {
    const auth = authorization();
    if (!auth) throw new Error('Portal session is not ready. Reload the portal and try again.');
    const response = await nativeFetch('/api/bootstrap', {
      headers: { authorization: auth },
      cache: 'no-store'
    });
    const result = await responseBody(response, 'Could not refresh the canonical manager state');
    if (!response.ok) throw new Error(result.error || result.message || `Could not refresh the canonical manager state (HTTP ${response.status})`);
    return cachePortalState(result);
  }

  function playerIds(selector) {
    return [...document.querySelectorAll(selector)].map((slot) =>
      String(slot.querySelector('.player-token')?.dataset.playerId || '').trim()
    );
  }

  function legacyPlayerIds(zone) {
    return [...document.querySelectorAll(`input[data-zone="${zone}"]:checked`)]
      .map((input) => String(input.value || '').trim());
  }

  function playerName(playerId) {
    const visibleToken = [...document.querySelectorAll('#formationPitch .formation-slot .player-token')]
      .find((item) => String(item.dataset.playerId || '').trim() === playerId);
    const visibleName = visibleToken?.querySelector('strong')?.textContent;
    if (visibleName) return String(visibleName).trim();
    const legacyInput = [...document.querySelectorAll('input[data-zone="xi"]')]
      .find((input) => String(input.value || '').trim() === playerId);
    const legacyText = legacyInput?.closest('.player-pick')?.querySelector('span')?.textContent || '';
    return String(legacyText.split('·')[0] || playerId).trim();
  }

  function synchronizeCaptainChoices(startingXi) {
    const captain = $('captain');
    if (!captain) return '';
    const orderedXi = (startingXi || (boardAvailable() ? playerIds('#formationPitch .formation-slot') : legacyPlayerIds('xi'))).filter(Boolean);
    const previousCaptain = String(captain.value || '').trim();
    captain.replaceChildren(...orderedXi.map((playerId) => {
      const option = document.createElement('option');
      option.value = playerId;
      option.textContent = playerName(playerId);
      return option;
    }));
    captain.value = orderedXi.includes(previousCaptain) ? previousCaptain : (orderedXi[0] || '');
    return String(captain.value || '').trim();
  }

  function boardAvailable() {
    return Boolean(
      $('interactiveFormationBoard')
      && $('formationPitch')?.querySelectorAll('.formation-slot').length === 11
      && $('formationBench')?.querySelectorAll('.bench-slot').length === 7
    );
  }

  function installCaptainSynchronization() {
    const pitch = $('formationPitch');
    if (!pitch || pitch === observedPitch) return;
    captainObserver?.disconnect();
    observedPitch = pitch;
    captainObserver = new MutationObserver(() => synchronizeCaptainChoices());
    captainObserver.observe(pitch, { childList: true, subtree: true });
    synchronizeCaptainChoices();
  }

  function selectedTeam() {
    const usingBoard = boardAvailable();
    const startingXi = usingBoard ? playerIds('#formationPitch .formation-slot') : legacyPlayerIds('xi');
    const bench = usingBoard ? playerIds('#formationBench .bench-slot') : legacyPlayerIds('bench');
    const captainId = synchronizeCaptainChoices(startingXi);
    if (startingXi.length !== 11 || startingXi.some((id) => !id)) {
      throw new Error(`Select exactly 11 starters before saving${usingBoard ? '.' : ' using the checkboxes shown.'}`);
    }
    if (bench.length !== 7 || bench.some((id) => !id)) {
      throw new Error(`Select exactly 7 substitutes before saving${usingBoard ? '.' : ' using the checkboxes shown.'}`);
    }
    const allPlayers = [...startingXi, ...bench];
    if (new Set(allPlayers).size !== allPlayers.length) throw new Error('A player cannot appear in both the starting XI and the substitutes.');
    if (!captainId) throw new Error('Select a captain before saving.');
    if (!startingXi.includes(captainId)) throw new Error('The selected captain must be in the starting XI.');
    return { startingXi, bench, captainId, usingBoard };
  }

  function presetMatchPlans() {
    const reader = window.tbgPresetSubstitutions?.readPlans;
    if (typeof reader !== 'function') return [];
    const plans = reader();
    return Array.isArray(plans) ? plans : [];
  }

  const sameIds = (left, right) => {
    const a = (left || []).map(String);
    const b = (right || []).map(String);
    return a.length === b.length && a.every((id, index) => id === b[index]);
  };

  const normalizedPlan = (plan = {}) => ({
    plan_id: String(plan.plan_id || ''),
    minute: Number(plan.minute),
    player_out_id: String(plan.player_out_id || ''),
    player_in_id: String(plan.player_in_id || ''),
    score_state: String(plan.score_state || 'always')
  });

  function sameMatchPlans(left, right) {
    const a = (left || []).map(normalizedPlan);
    const b = (right || []).map(normalizedPlan);
    return a.length === b.length && a.every((plan, index) => JSON.stringify(plan) === JSON.stringify(b[index]));
  }

  function canonicalMatchesPayload(state, payload) {
    const submission = state?.current_submission;
    if (!submission || !payload) return false;
    const tactics = submission.tactics || {};
    const matchPlans = submission.match_plans || submission.instruction?.match_plans || [];
    return String(submission.fixture_id || '') === String(payload.fixture_id || '')
      && String(submission.formation || '') === String(payload.formation || '')
      && sameIds(submission.starting_xi, payload.starting_xi)
      && sameIds(submission.bench, payload.bench)
      && String(submission.captain_id || '') === String(payload.captain_id || '')
      && sameMatchPlans(matchPlans, payload.match_plans)
      && ['mentality', 'pressing', 'tempo', 'width', 'defensive_line']
        .every((key) => String(tactics[key] || '') === String(payload.tactics?.[key] || ''));
  }

  function ambiguousSaveFailure(error) {
    return error?.ambiguousSave === true;
  }

  function ambiguousStatus(status) {
    return status === 408 || status === 429 || status >= 500;
  }

  function markAmbiguous(error, detail = {}) {
    const marked = error instanceof Error ? error : new Error(String(error || 'Team selection request failed.'));
    marked.ambiguousSave = true;
    Object.assign(marked, detail);
    return marked;
  }

  function renderCanonicalSubmission(state) {
    const submission = state?.current_submission;
    const summary = $('submissionSummary');
    const panel = $('currentSubmissionPanel');
    if (summary) summary.textContent = submission ? `Submitted · version ${submission.version}` : 'No team submitted';
    if (!panel) return;
    panel.hidden = !submission;
    if (!submission) return;
    panel.innerHTML = `<strong>Current submission</strong><span>Version ${submission.version}</span><span>${submission.formation}</span><span>${new Date(submission.updated_at || submission.submitted_at).toLocaleString()}</span><span class="badge ${submission.status === 'locked' ? 'injured' : 'fit'}">${submission.status}</span>`;
  }

  async function refreshCanonicalState() {
    invalidatePortalState();
    const refreshed = await bootstrapState();
    renderCanonicalSubmission(refreshed);
    return refreshed;
  }

  async function refreshAfterCanonicalRejection() {
    try {
      const refreshed = await refreshCanonicalState();
      window.dispatchEvent(new CustomEvent('tbg:portal-rendered', { detail: refreshed }));
      return true;
    } catch {
      return false;
    }
  }

  async function submitVisibleSelection(event) {
    if (event.target?.id !== 'decisionForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    installInlineStatus();
    installCaptainSynchronization();
    const button = event.target.querySelector('button[type="submit"]');
    const previousLabel = button?.textContent || 'Save team and tactics';
    let payload = null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    setStatus('Saving…');

    try {
      const selection = selectedTeam();
      const canonical = cachedPortalState || window.tbgPortalState || await bootstrapState();
      if (!canonical?.next_fixture) throw new Error('There is no scheduled fixture available for this team submission.');
      if (canonical.next_fixture.locked) throw new Error('The team-selection deadline has passed and this fixture is locked.');
      payload = {
        manager_id: canonical.manager.id,
        club_id: canonical.club.tbg_club_id,
        fixture_id: canonical.next_fixture.fixture_id,
        formation: $('formation').value,
        starting_xi: selection.startingXi,
        bench: selection.bench,
        captain_id: selection.captainId,
        set_piece_takers: {
          penalties: selection.captainId,
          free_kicks: selection.captainId,
          corners_left: selection.captainId,
          corners_right: selection.captainId
        },
        tactics: {
          mentality: $('mentality').value,
          pressing: $('pressing').value,
          tempo: $('tempo').value,
          width: $('width').value,
          defensive_line: $('defensiveLine').value
        },
        match_plans: presetMatchPlans()
      };

      let response;
      try {
        response = await nativeFetch('/api/decisions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: authorization() },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        throw markAmbiguous(error, { transportFailure: true });
      }

      let result;
      try {
        result = await responseBody(response, 'Team selection could not be saved');
      } catch (error) {
        if (ambiguousStatus(response.status)) throw markAmbiguous(error, { responseStatus: response.status });
        throw error;
      }

      if (!response.ok) {
        const validation = Array.isArray(result.validation_errors)
          ? result.validation_errors.map((item) => typeof item === 'string' ? item : item?.message || item?.code).filter(Boolean).join(' · ')
          : '';
        const baseMessage = validation || result.error || result.message || `Team selection could not be saved (HTTP ${response.status})`;
        if (response.status === 409) {
          const refreshed = await refreshAfterCanonicalRejection();
          throw new Error(refreshed ? `${baseMessage} The fixture state has been refreshed; review the team and save again.` : baseMessage);
        }
        const responseError = new Error(baseMessage);
        if (ambiguousStatus(response.status)) throw markAmbiguous(responseError, { responseStatus: response.status });
        throw responseError;
      }

      const submittedAt = result.submitted_at || result.updated_at || null;
      setStatus(submittedAt ? `Saved · ${new Date(submittedAt).toLocaleString()}` : 'Team selection saved.', 'ok');
      let refreshed = null;
      let refreshError = null;
      try {
        refreshed = await refreshCanonicalState();
        if (!canonicalMatchesPayload(refreshed, payload)) {
          throw new Error('Canonical read-back did not match the team just submitted.');
        }
        const canonicalSavedAt = refreshed.current_submission?.submitted_at || refreshed.current_submission?.updated_at;
        if (canonicalSavedAt) setStatus(`Saved · ${new Date(canonicalSavedAt).toLocaleString()}`, 'ok');
      } catch (error) {
        refreshError = error;
        setStatus('Team selection was accepted, but canonical read-back could not yet confirm the exact team. Reload before making further changes.', 'error');
      }
      window.dispatchEvent(new CustomEvent('tbg:team-submission-saved', {
        detail: { result, state: refreshed, refresh_error: refreshError?.message || null }
      }));
    } catch (error) {
      if (payload && ambiguousSaveFailure(error)) {
        try {
          const refreshed = await refreshCanonicalState();
          if (canonicalMatchesPayload(refreshed, payload)) {
            const canonicalSavedAt = refreshed.current_submission?.submitted_at || refreshed.current_submission?.updated_at;
            setStatus(canonicalSavedAt
              ? `Saved · ${new Date(canonicalSavedAt).toLocaleString()} · confirmed after timeout`
              : 'Team selection saved · confirmed after timeout', 'ok');
            window.dispatchEvent(new CustomEvent('tbg:team-submission-saved', {
              detail: { result: null, state: refreshed, recovered_after_timeout: true }
            }));
            return;
          }
        } catch {
          // Keep the original transport error when canonical verification also fails.
        }
      }
      setStatus(error?.message || 'Team selection could not be saved.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousLabel;
      }
    }
  }

  function installEnhancements() {
    installInlineStatus();
    installCaptainSynchronization();
  }

  document.addEventListener('submit', submitVisibleSelection, true);
  document.addEventListener('change', (event) => {
    if (event.target?.matches('input[data-zone="xi"]')) synchronizeCaptainChoices(legacyPlayerIds('xi'));
  }, true);
  window.addEventListener('DOMContentLoaded', installEnhancements);
  window.addEventListener('load', installEnhancements);
  window.addEventListener('tbg:portal-rendered', installEnhancements);
})();