(() => {
  const nativeFetch = window.fetch.bind(window);
  const $ = (id) => document.getElementById(id);

  function authorization() {
    return String(window.tbgPortalAuthorization || '').trim();
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
    return result;
  }

  function playerIds(selector) {
    return [...document.querySelectorAll(selector)].map((slot) =>
      String(slot.querySelector('.player-token')?.dataset.playerId || '').trim()
    );
  }

  function visibleSelection() {
    const board = $('interactiveFormationBoard');
    if (!board) throw new Error('The visible team-selection board is not ready yet. Reload the portal and try again.');

    const startingXi = playerIds('#formationPitch .formation-slot');
    const bench = playerIds('#formationBench .bench-slot');
    const captainId = String($('captain')?.value || '').trim();

    if (startingXi.length !== 11 || startingXi.some((id) => !id)) {
      throw new Error('Select exactly 11 starters on the pitch before saving.');
    }
    if (bench.length !== 7 || bench.some((id) => !id)) {
      throw new Error('Select exactly 7 substitutes before saving.');
    }
    const allPlayers = [...startingXi, ...bench];
    if (new Set(allPlayers).size !== allPlayers.length) {
      throw new Error('A player cannot appear in both the starting XI and the substitutes.');
    }
    if (!captainId) throw new Error('Select a captain before saving.');
    if (!startingXi.includes(captainId)) throw new Error('The selected captain must be in the starting XI.');

    return { startingXi, bench, captainId };
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

  async function submitVisibleSelection(event) {
    if (event.target?.id !== 'decisionForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    installInlineStatus();

    const button = event.target.querySelector('button[type="submit"]');
    const previousLabel = button?.textContent || 'Save team and tactics';
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    setStatus('Saving…');

    try {
      const canonical = await bootstrapState();
      if (!canonical.next_fixture) throw new Error('There is no scheduled fixture available for this team submission.');
      if (canonical.next_fixture.locked) throw new Error('The team-selection deadline has passed and this fixture is locked.');

      const selection = visibleSelection();
      const payload = {
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
        }
      };

      const response = await nativeFetch('/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: authorization() },
        body: JSON.stringify(payload)
      });
      const result = await responseBody(response, 'Team selection could not be saved');
      if (!response.ok) {
        const validation = Array.isArray(result.validation_errors) ? result.validation_errors.filter(Boolean).join(' · ') : '';
        throw new Error(validation || result.error || result.message || `Team selection could not be saved (HTTP ${response.status})`);
      }

      const refreshed = await bootstrapState();
      renderCanonicalSubmission(refreshed);
      const savedAt = result.submitted_at || refreshed.current_submission?.submitted_at || refreshed.current_submission?.updated_at;
      setStatus(savedAt ? `Saved · ${new Date(savedAt).toLocaleString()}` : 'Team selection saved.', 'ok');
      window.dispatchEvent(new CustomEvent('tbg:team-submission-saved', { detail: { result, state: refreshed } }));
    } catch (error) {
      setStatus(error?.message || 'Team selection could not be saved.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousLabel;
      }
    }
  }

  document.addEventListener('submit', submitVisibleSelection, true);
  window.addEventListener('DOMContentLoaded', installInlineStatus);
  window.addEventListener('tbg:portal-rendered', installInlineStatus);
})();
