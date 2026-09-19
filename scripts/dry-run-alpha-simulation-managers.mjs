import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadPersistentWorld } from '../src/world/persistentSeasonLoop.js';
import {
  ALPHA_SIMULATION_SOURCE,
  buildScheduledTurnPlan,
  executeScheduledTurn
} from '../src/world/sharedWorldScheduler.js';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const WORLD_ID = String(process.env.TBG_DRY_RUN_WORLD_ID || 'tbg-world-1').trim();
const OUTPUT_DIR = String(process.env.TBG_DRY_RUN_OUTPUT_DIR || 'artifacts/alpha-simulation-dry-run');

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function serviceHeaders() {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    accept: 'application/json'
  };
  if (SERVICE_ROLE_KEY.split('.').length === 3) headers.authorization = `Bearer ${SERVICE_ROLE_KEY}`;
  return headers;
}

async function read(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: serviceHeaders() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(2));
}

function currentResults(world, matchday) {
  const rows = [];
  for (const [divisionId, runtime] of Object.entries(world.matchday_cycle?.runtimes || {})) {
    for (const result of runtime.results || []) {
      if (Number(result.fixture?.matchday) !== Number(matchday)) continue;
      rows.push({
        division_id: divisionId,
        fixture_id: result.fixture.fixture_id,
        home_club_id: result.fixture.home_club_id,
        away_club_id: result.fixture.away_club_id,
        score: { ...result.score },
        home: {
          starting_xi: [...(result.teams?.home?.starting_xi || [])],
          formation: result.teams?.home?.formation || null,
          instruction_source: result.teams?.home?.instruction_source || null
        },
        away: {
          starting_xi: [...(result.teams?.away?.starting_xi || [])],
          formation: result.teams?.away?.formation || null,
          instruction_source: result.teams?.away?.instruction_source || null
        }
      });
    }
  }
  return rows.sort((a, b) => String(a.fixture_id).localeCompare(String(b.fixture_id)));
}

function fixtureComparison(offRows, onRows) {
  const off = new Map(offRows.map((row) => [row.fixture_id, row]));
  const on = new Map(onRows.map((row) => [row.fixture_id, row]));
  const allIds = [...new Set([...off.keys(), ...on.keys()])].sort();
  const mismatches = [];
  for (const id of allIds) {
    const left = off.get(id);
    const right = on.get(id);
    if (!left || !right) {
      mismatches.push({ fixture_id: id, reason: 'fixture_missing_from_one_run' });
      continue;
    }
    if (JSON.stringify(left.score) !== JSON.stringify(right.score)) {
      mismatches.push({ fixture_id: id, reason: 'score_changed', off: left.score, on: right.score });
    }
  }
  return { compared: allIds.length, score_mismatches: mismatches };
}

function humanControlChecks({ appointments, onPlan, onRows, offRows }) {
  const humanClubIds = [...new Set(appointments
    .filter((row) => !row.control_type || String(row.control_type).toLowerCase() === 'human')
    .map((row) => String(row.club_id))
    .filter(Boolean))].sort();
  const simulationSet = new Set(onPlan.simulation_club_ids || []);
  const simulatedHumans = humanClubIds.filter((clubId) => simulationSet.has(clubId));

  const teamByClub = (rows) => {
    const out = new Map();
    for (const row of rows) {
      out.set(row.home_club_id, row.home);
      out.set(row.away_club_id, row.away);
    }
    return out;
  };
  const offTeams = teamByClub(offRows);
  const onTeams = teamByClub(onRows);
  const changedHumanTeams = [];
  for (const clubId of humanClubIds) {
    const left = offTeams.get(clubId);
    const right = onTeams.get(clubId);
    if (!left || !right) continue;
    if (JSON.stringify(left.starting_xi) !== JSON.stringify(right.starting_xi) || left.formation !== right.formation) {
      changedHumanTeams.push({ club_id: clubId, off: left, on: right });
    }
  }

  return {
    human_club_ids: humanClubIds,
    simulated_human_club_ids: simulatedHumans,
    changed_human_team_selections: changedHumanTeams
  };
}

function sourceCounts(rows) {
  const counts = {};
  for (const row of rows) {
    for (const team of [row.home, row.away]) {
      const type = team.instruction_source?.type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

function markdown(report) {
  const checks = report.checks;
  const lines = [
    '# TBG alpha simulation-manager dry run',
    '',
    `World: **${report.world_id}**`,
    `Canonical checksum read: \`${report.canonical_checksum}\``,
    `Season: **${report.season_id}** · Matchday **${report.matchday}**`,
    `Canonical turn status at read: **${report.turn_status}**`,
    '',
    '## Population',
    '',
    `- Clubs in world: **${report.club_count}**`,
    `- Active human-appointed clubs: **${report.human_appointment_count}**`,
    `- Human submissions for this turn: **${report.submission_count}**`,
    `- Simulation-controlled clubs with switch ON: **${report.simulation_count}**`,
    `- Human missed-deadline fallbacks with switch ON: **${report.human_fallback_count}**`,
    '',
    '## Dry-run result',
    '',
    `- Fixtures completed (simulation OFF): **${report.off.fixture_count}**`,
    `- Fixtures completed (simulation ON): **${report.on.fixture_count}**`,
    `- OFF execution: **${report.timings_ms.execute_off} ms**`,
    `- ON execution: **${report.timings_ms.execute_on} ms**`,
    `- Score mismatches OFF vs ON: **${checks.score_mismatch_count}**`,
    `- Human clubs incorrectly classified as simulation: **${checks.simulated_human_count}**`,
    `- Human team selections changed by enabling simulation: **${checks.changed_human_team_count}**`,
    `- ON instruction sources: \`${JSON.stringify(report.on.instruction_source_counts)}\``,
    '',
    '## Safety',
    '',
    '**This diagnostic performs GET requests only. It does not POST, PATCH, DELETE, invoke a write RPC, or replace the canonical checkpoint. Both turns are executed solely against deserialised in-memory copies of the canonical save.**',
    '',
    checks.accepted ? '## ✅ Accepted' : '## ❌ Review required',
    '',
    checks.accepted
      ? 'The current canonical alpha checkpoint completed an 80-club-equivalent in-memory turn with simulation enabled and no detected human-control or score regressions.'
      : 'One or more acceptance checks failed. Do not enable the production simulation-manager switch until the JSON report is reviewed.',
    ''
  ];
  return lines.join('\n');
}

async function main() {
  required('SUPABASE_URL', SUPABASE_URL);
  required('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY);
  required('TBG_DRY_RUN_WORLD_ID', WORLD_ID);

  const timings = {};
  let started = performance.now();
  const canonicalRows = await read(
    `/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(WORLD_ID)}&select=world_id,save_checksum,save_envelope,season_id,matchday,next_turn_at,turn_status,updated_at&limit=1`
  );
  timings.read_canonical = elapsed(started);
  const canonical = canonicalRows[0];
  if (!canonical?.save_envelope) throw new Error(`Canonical world ${WORLD_ID} was not found`);
  if (canonical.turn_status !== 'open') throw new Error(`Canonical world must be open for a representative dry run; current status is ${canonical.turn_status}`);

  const world = loadPersistentWorld(JSON.stringify(canonical.save_envelope));
  const seasonId = world.squad_cycle.season_id;
  const matchday = world.matchday_cycle?.current_matchday || 1;

  started = performance.now();
  const [appointments, submissions] = await Promise.all([
    read(`/rest/v1/manager_appointments?world_id=eq.${encodeURIComponent(WORLD_ID)}&status=eq.active&select=world_id,manager_id,club_id,status,control_type`),
    read(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(WORLD_ID)}&season_id=eq.${encodeURIComponent(seasonId)}&matchday=eq.${matchday}&status=eq.submitted&select=*&order=submitted_at.asc,id.asc`)
  ]);
  timings.read_inputs = elapsed(started);

  const scheduledFor = canonical.next_turn_at || new Date().toISOString();
  const nextTurnAt = canonical.next_turn_at || null;

  started = performance.now();
  const offPlan = buildScheduledTurnPlan(world, submissions, {
    appointments,
    scheduledFor,
    nextTurnAt,
    simulationEnabled: false
  });
  timings.plan_off = elapsed(started);

  started = performance.now();
  const off = executeScheduledTurn(world, offPlan);
  timings.execute_off = elapsed(started);

  started = performance.now();
  const onPlan = buildScheduledTurnPlan(world, submissions, {
    appointments,
    scheduledFor,
    nextTurnAt,
    simulationEnabled: true
  });
  timings.plan_on = elapsed(started);

  started = performance.now();
  const on = executeScheduledTurn(world, onPlan);
  timings.execute_on = elapsed(started);

  const offRows = currentResults(off.world, matchday);
  const onRows = currentResults(on.world, matchday);
  const comparison = fixtureComparison(offRows, onRows);
  const humanChecks = humanControlChecks({ appointments, onPlan, onRows, offRows });
  const humanAppointmentCount = humanChecks.human_club_ids.length;
  const clubCount = Object.keys(world.squad_cycle?.clubs || {}).length;

  const checks = {
    all_clubs_accounted_for: onPlan.simulation_count + humanAppointmentCount === clubCount,
    no_human_club_simulated: humanChecks.simulated_human_club_ids.length === 0,
    human_team_selections_unchanged: humanChecks.changed_human_team_selections.length === 0,
    same_fixture_count: offRows.length === onRows.length,
    scores_unchanged_by_control_labelling: comparison.score_mismatches.length === 0,
    simulation_sources_match_plan: (sourceCounts(onRows)[ALPHA_SIMULATION_SOURCE] || 0) === onPlan.simulation_count,
    both_runs_accepted: Boolean(off.accepted && on.accepted)
  };
  checks.accepted = Object.values(checks).every(Boolean);

  const report = {
    version: 'tbg-alpha-simulation-real-world-dry-run-v0.1',
    generated_at: new Date().toISOString(),
    read_only: true,
    world_id: WORLD_ID,
    canonical_checksum: canonical.save_checksum,
    canonical_updated_at: canonical.updated_at,
    turn_status: canonical.turn_status,
    season_id: seasonId,
    matchday,
    club_count: clubCount,
    human_appointment_count: humanAppointmentCount,
    submission_count: submissions.length,
    simulation_count: onPlan.simulation_count,
    human_fallback_count: onPlan.human_fallback_count,
    timings_ms: timings,
    off: {
      accepted: off.accepted,
      fixture_count: offRows.length,
      output_checksum: JSON.parse(off.saved_world).checksum,
      instruction_source_counts: sourceCounts(offRows)
    },
    on: {
      accepted: on.accepted,
      fixture_count: onRows.length,
      output_checksum: JSON.parse(on.saved_world).checksum,
      instruction_source_counts: sourceCounts(onRows)
    },
    comparison,
    human_control: humanChecks,
    checks: {
      ...checks,
      score_mismatch_count: comparison.score_mismatches.length,
      simulated_human_count: humanChecks.simulated_human_club_ids.length,
      changed_human_team_count: humanChecks.changed_human_team_selections.length
    }
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = `${OUTPUT_DIR}/report.json`;
  const mdPath = `${OUTPUT_DIR}/report.md`;
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(mdPath, markdown(report) + '\n');

  process.stdout.write(markdown(report) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown(report) + '\n');
  }

  if (!checks.accepted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
