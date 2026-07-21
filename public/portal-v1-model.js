const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const POSITION_GROUPS = Object.freeze({
  goalkeeper: new Set(['gk', 'goalkeeper']),
  defender: new Set(['cb', 'rb', 'lb', 'lwb', 'rwb', 'def', 'defender', 'centre-back', 'center-back', 'left-back', 'right-back', 'left wing-back', 'right wing-back']),
  midfielder: new Set(['dm', 'cm', 'am', 'mid', 'midfielder', 'defensive midfield', 'central midfield', 'attacking midfield']),
  attacker: new Set(['lw', 'rw', 'ss', 'cf', 'st', 'att', 'attacker', 'forward', 'left winger', 'right winger', 'second striker', 'centre-forward', 'center-forward', 'striker'])
});

const GROUP_REQUIREMENTS = Object.freeze({ goalkeeper: 2, defender: 6, midfielder: 5, attacker: 3 });

export function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

export function playerName(player) {
  return text(player?.display_name || player?.player_name || player?.canonical_name || playerId(player) || 'Unknown player');
}

export function playerPosition(player) {
  return text(player?.specific_position || player?.position || player?.primary_position || player?.canonical_position || player?.position_group || 'Unknown');
}

export function positionGroup(value) {
  const raw = text(value).toLowerCase();
  for (const [group, aliases] of Object.entries(POSITION_GROUPS)) if (aliases.has(raw)) return group;
  if (raw.includes('goalkeeper')) return 'goalkeeper';
  if (raw.includes('back') || raw.includes('defender') || raw.includes('defence')) return 'defender';
  if (raw.includes('midfield')) return 'midfielder';
  return 'attacker';
}

function isRegistered(player) {
  return player?.registered !== false && player?.registration_status !== 'unregistered' && player?.squad_status !== 'youth_only';
}

function isAvailable(player) {
  const status = text(player?.injury_status || player?.availability || 'available').toLowerCase();
  return !['injured', 'suspended', 'unavailable'].some((word) => status.includes(word));
}

function contractDate(player) {
  const value = player?.contract_expiry || player?.contract_end_at || player?.contract?.end_at;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fixtureRows(data) {
  return data?.fixtures || data?.schedule || data?.fixture_history || data?.competition?.fixtures || [];
}

function standingsRows(data) {
  return data?.standings || data?.competition?.standings || data?.league_table || [];
}

function resultIsComplete(row) {
  return Boolean(row?.completed || row?.status === 'complete' || row?.status === 'played' || row?.score || row?.home_score !== undefined);
}

function fixtureDeadline(data) {
  const value = data?.next_fixture?.submission_deadline_at || data?.next_fixture?.deadline_at;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(date, now) {
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

export function buildPortalViewModel(data, { now = new Date() } = {}) {
  const squad = Array.isArray(data?.squad) ? data.squad : [];
  const registered = squad.filter(isRegistered);
  const available = registered.filter(isAvailable);
  const coverage = Object.entries(GROUP_REQUIREMENTS).map(([group, required]) => {
    const registeredCount = registered.filter((player) => positionGroup(playerPosition(player)) === group).length;
    const availableCount = available.filter((player) => positionGroup(playerPosition(player)) === group).length;
    return Object.freeze({
      group,
      required,
      registered: registeredCount,
      available: availableCount,
      gap: Math.max(0, required - registeredCount),
      temporary_gap: Math.max(0, required - availableCount)
    });
  });

  const contractRows = squad
    .map((player) => ({ player, end: contractDate(player) }))
    .filter((row) => row.end)
    .map((row) => ({ ...row, days: daysUntil(row.end, now) }))
    .filter((row) => row.days <= 365)
    .sort((a, b) => a.end - b.end || playerName(a.player).localeCompare(playerName(b.player)));

  const fixtures = fixtureRows(data);
  const played = fixtures.filter(resultIsComplete).length;
  const total = fixtures.length || number(data?.season?.fixture_count || data?.world?.fixture_count);
  const standings = standingsRows(data);
  const clubId = text(data?.club?.tbg_club_id || data?.club?.club_id || data?.club?.id);
  const tableRow = standings.find((row) => text(row.club_id || row.tbg_club_id || row.id) === clubId) || null;
  const deadline = fixtureDeadline(data);
  const submission = data?.current_submission || data?.submission || data?.next_fixture?.submission;

  const alerts = [];
  for (const row of coverage.filter((item) => item.gap > 0)) {
    alerts.push({ kind: 'critical', view: 'squad', title: `${row.group} depth below minimum`, detail: `${row.registered}/${row.required} registered` });
  }
  for (const row of coverage.filter((item) => item.gap === 0 && item.temporary_gap > 0)) {
    alerts.push({ kind: 'warning', view: 'squad', title: `${row.group} cover temporarily thin`, detail: `${row.available}/${row.required} available` });
  }
  if (registered.length < 18) alerts.push({ kind: 'critical', view: 'squad', title: 'Senior squad below playable minimum', detail: `${registered.length}/18 registered` });
  if (contractRows.some((row) => row.days <= 90)) alerts.push({ kind: 'warning', view: 'squad', title: 'Contract decisions required', detail: `${contractRows.filter((row) => row.days <= 90).length} expire within 90 days` });
  if (data?.next_fixture && !submission) alerts.push({ kind: 'action', view: 'tactics', title: 'Team selection not submitted', detail: deadline ? `Deadline ${deadline.toLocaleString()}` : 'Submit before kickoff' });
  if (!alerts.length) alerts.push({ kind: 'good', view: 'dashboard', title: 'No urgent club actions', detail: 'Squad and fixture preparation are in order' });

  const archive = data?.season_archive || data?.archive || null;
  const recentResults = fixtures.filter(resultIsComplete).slice(-5).reverse();

  return Object.freeze({
    summary: Object.freeze({
      registered: registered.length,
      available: available.length,
      table_position: tableRow?.position ?? data?.club?.table_position ?? null,
      points: tableRow?.points ?? null,
      played,
      total,
      progress_percent: total ? Math.round((played / total) * 100) : 0,
      next_opponent: text(data?.next_fixture?.opponent_name || data?.next_fixture?.opponent || 'No fixture scheduled'),
      deadline_at: deadline?.toISOString() || null,
      submitted: Boolean(submission)
    }),
    coverage: Object.freeze(coverage),
    contracts: Object.freeze(contractRows.map((row) => Object.freeze({
      player_id: playerId(row.player),
      player_name: playerName(row.player),
      position: playerPosition(row.player),
      end_at: row.end.toISOString(),
      days_remaining: row.days
    }))),
    alerts: Object.freeze(alerts.map(Object.freeze)),
    recent_results: Object.freeze(recentResults),
    archive: archive ? Object.freeze({
      champion: archive.awards?.champion || null,
      golden_boot: archive.awards?.golden_boot || null,
      assist_leader: archive.awards?.assist_leader || null,
      best_attack: archive.awards?.best_attack || null,
      best_defence: archive.awards?.best_defence || null
    }) : null
  });
}
