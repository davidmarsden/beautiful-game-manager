const $ = (id) => document.getElementById(id);
let contractDateInteractionsBound = false;

function applyContractDateDisplay() {
  document.querySelectorAll('#squadRows tr').forEach((row) => {
    const contractCell = row.children?.[8];
    if (!contractCell) return;
    const value = String(contractCell.textContent || '').trim();
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (match) contractCell.textContent = match[1];
  });
}

function scheduleContractDateDisplay() {
  window.setTimeout(applyContractDateDisplay, 0);
}

function bindContractDateInteractions() {
  if (contractDateInteractionsBound) return;
  contractDateInteractionsBound = true;

  for (const id of ['registrationFilter', 'squadSearch', 'positionFilter', 'availabilityFilter']) {
    const control = $(id);
    if (!control) continue;
    control.addEventListener(id === 'squadSearch' ? 'input' : 'change', scheduleContractDateDisplay);
  }

  document.querySelectorAll('#squadTable th[data-sort]').forEach((header) => {
    header.addEventListener('click', scheduleContractDateDisplay);
  });
}

function applyCanonicalDisplay(data) {
  if (!data?.club || !data?.world) return;
  const clubName = data.club.canonical_name || data.club.club_name;
  const divisionName = data.club.division_name || (data.club.division_id ? data.club.division_id.replace(/^d(\d+)$/, 'Division $1').replace('division-', 'Division ') : 'Unseeded');
  if ($('clubName')) $('clubName').textContent = clubName;
  if ($('clubMeta')) $('clubMeta').textContent = `${divisionName} · World rank ${data.club.strength?.world_rank || '—'}`;
  if ($('division')) $('division').textContent = divisionName;
  if ($('worldName')) $('worldName').textContent = data.world.display_name || 'The Beautiful Game';
  if ($('worldStatus')) $('worldStatus').textContent = data.world.status || data.world.phase || '';

  const fixture = data.next_fixture;
  if ($('nextOpponent')) $('nextOpponent').textContent = fixture?.opponent_name || 'No fixture scheduled';
  if ($('fixtureMeta')) $('fixtureMeta').textContent = fixture?.competition || (data.preseason ? 'Preseason' : '');
  if ($('nextFixtureCard')) $('nextFixtureCard').textContent = fixture ? `${fixture.opponent_name} · ${fixture.venue}` : 'Preseason — fixtures have not been generated yet';

  const last = data.last_fixture;
  if ($('lastFixtureCard') && !last) $('lastFixtureCard').innerHTML = '<div class="placeholder">No canonical matches have been played yet</div>';
  bindContractDateInteractions();
  applyContractDateDisplay();
}

window.addEventListener('tbg:portal-rendered', (event) => applyCanonicalDisplay(event.detail));
