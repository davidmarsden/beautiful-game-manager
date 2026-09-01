const layers = ['./portal-brazil-pitch.css', './portal-final-polish.css'];

const CLUB_COLOURS = new Map([
  ['real madrid', { primary:'#f5f5f5', secondary:'#243b7a', accent:'#d4af37', ink:'#102330' }],
  ['chelsea fc', { primary:'#034694', secondary:'#ffffff', accent:'#dba111', ink:'#ffffff' }],
  ['manchester united', { primary:'#da291c', secondary:'#fbe122', accent:'#000000', ink:'#ffffff' }],
  ['manchester city', { primary:'#6cabdd', secondary:'#ffffff', accent:'#1c2c5b', ink:'#102330' }],
  ['liverpool fc', { primary:'#c8102e', secondary:'#00b2a9', accent:'#f6eb61', ink:'#ffffff' }],
  ['arsenal fc', { primary:'#ef0107', secondary:'#063672', accent:'#ffffff', ink:'#ffffff' }],
  ['tottenham hotspur', { primary:'#132257', secondary:'#ffffff', accent:'#c8c8c8', ink:'#ffffff' }],
  ['newcastle united', { primary:'#241f20', secondary:'#ffffff', accent:'#41b6e6', ink:'#ffffff' }],
  ['aston villa', { primary:'#670e36', secondary:'#95bfe5', accent:'#f9c700', ink:'#ffffff' }],
  ['atalanta bc', { primary:'#1e71b8', secondary:'#000000', accent:'#ffffff', ink:'#ffffff' }],
  ['ssc napoli', { primary:'#12a0d7', secondary:'#ffffff', accent:'#0f4c81', ink:'#102330' }],
  ['borussia dortmund', { primary:'#fde100', secondary:'#000000', accent:'#ffffff', ink:'#111111' }],
  ['atlético de madrid', { primary:'#d71920', secondary:'#272e61', accent:'#ffffff', ink:'#ffffff' }],
  ['atletico de madrid', { primary:'#d71920', secondary:'#272e61', accent:'#ffffff', ink:'#ffffff' }],
  ['inter milan', { primary:'#00529f', secondary:'#000000', accent:'#d4af37', ink:'#ffffff' }],
  ['ac milan', { primary:'#fb090b', secondary:'#000000', accent:'#ffffff', ink:'#ffffff' }],
  ['paris saint-germain', { primary:'#004170', secondary:'#da291c', accent:'#ffffff', ink:'#ffffff' }],
  ['bayern munich', { primary:'#dc052d', secondary:'#0066b2', accent:'#ffffff', ink:'#ffffff' }],
  ['fc barcelona', { primary:'#004d98', secondary:'#a50044', accent:'#edbb00', ink:'#ffffff' }],
  ['barcelona', { primary:'#004d98', secondary:'#a50044', accent:'#edbb00', ink:'#ffffff' }],
  ['juventus fc', { primary:'#000000', secondary:'#ffffff', accent:'#d4af37', ink:'#ffffff' }],
  ['juventus', { primary:'#000000', secondary:'#ffffff', accent:'#d4af37', ink:'#ffffff' }],
  ['fenerbahce', { primary:'#ffed00', secondary:'#002d72', accent:'#ffffff', ink:'#111111' }],
  ['fenerbahçe', { primary:'#ffed00', secondary:'#002d72', accent:'#ffffff', ink:'#111111' }]
]);

let latestPortalData = null;

function promoteBrazilPitchStyles() {
  for (const href of layers) {
    const fileName = href.split('/').pop();
    let link = document.querySelector(`link[href$="${fileName}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
    }
    document.head.append(link);
  }
}

function compactFixtureMasthead() {
  const masthead = document.querySelector('#portal .club-strip .next-fixture');
  const fixturePanel = document.querySelector('#portal .dashboard-grid .panel:nth-child(3)');
  if (!masthead || !fixturePanel) return;

  const teamButton = fixturePanel.querySelector('button[data-view="tactics"]');
  if (teamButton && !masthead.contains(teamButton)) {
    teamButton.classList.add('masthead-team-action');
    masthead.append(teamButton);
  }

  fixturePanel.setAttribute('aria-hidden', 'true');
  fixturePanel.classList.add('fixture-panel-retired');
  document.querySelector('#portal .dashboard-grid')?.classList.add('fixture-summary-three-up');
}

function applyClubIdentity() {
  const strip = document.querySelector('#portal .club-strip');
  const crest = document.querySelector('#portal .club-strip .crest');
  const clubName = document.getElementById('clubName')?.textContent?.trim();
  if (!strip || !crest || !clubName || clubName === 'Loading club…') return;

  const identity = CLUB_COLOURS.get(clubName.toLocaleLowerCase('en-GB'));
  if (!identity) {
    strip.classList.remove('club-colours-active');
    for (const property of ['--club-primary','--club-secondary','--club-accent','--club-ink']) strip.style.removeProperty(property);
    return;
  }

  strip.style.setProperty('--club-primary', identity.primary);
  strip.style.setProperty('--club-secondary', identity.secondary);
  strip.style.setProperty('--club-accent', identity.accent);
  strip.style.setProperty('--club-ink', identity.ink);
  strip.classList.add('club-colours-active');
  crest.setAttribute('aria-label', `${clubName} club colours`);
}

function divisionLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const match = raw.match(/(?:division[-\s]*|d)?(\d+)/i);
  return match ? `D${match[1]}` : raw.toUpperCase();
}

function isYouth(player) {
  if (player?.youth_eligible_at_season_start !== undefined) return Boolean(player.youth_eligible_at_season_start);
  return (Number(player?.season_start_age ?? player?.age) || 99) <= 21;
}

function isLoanedOut(player) {
  return Boolean(player?.loaned_out || String(player?.loan_status || '').toLowerCase() === 'loaned_out');
}

function registeredSeniorCount(squad = []) {
  return squad.filter((player) => !isYouth(player)
    && !isLoanedOut(player)
    && player?.registered !== false
    && String(player?.registration_status || '').toLowerCase() !== 'unregistered').length;
}

function standingsRow(data) {
  const rows = data?.standings || data?.competition?.standings || data?.league_table || [];
  const clubId = String(data?.club?.tbg_club_id || data?.club?.club_id || data?.club?.id || '');
  return rows.find((row) => String(row?.club_id || row?.tbg_club_id || row?.id || '') === clubId) || null;
}

function simplifyDashboard(data) {
  if (!data?.club) return;

  const division = divisionLabel(data.club.division_id);
  const clubMeta = document.getElementById('clubMeta');
  if (clubMeta) clubMeta.textContent = division;

  const fixtureMeta = document.getElementById('fixtureMeta');
  if (fixtureMeta && /^division\s*\d+$/i.test(fixtureMeta.textContent.trim())) {
    fixtureMeta.textContent = divisionLabel(fixtureMeta.textContent);
  }

  const overview = document.getElementById('portalOverview');
  const legacyLayout = document.querySelector('#dashboardView > .portal-layout');
  if (overview) {
    overview.hidden = true;
    overview.setAttribute('aria-hidden', 'true');
  }
  if (legacyLayout) {
    legacyLayout.hidden = true;
    legacyLayout.setAttribute('aria-hidden', 'true');
  }

  const panels = document.querySelectorAll('#portal .dashboard-grid > .panel');
  const leaguePanel = panels[0];
  const squadPanel = panels[3];
  const row = standingsRow(data);
  const position = row?.position ?? data.club.table_position ?? '—';
  const points = row?.points ?? data.club.points ?? '—';
  const owned = Array.isArray(data.squad) ? data.squad.length : 0;
  const registered = registeredSeniorCount(data.squad || []);

  if (leaguePanel) {
    const heading = leaguePanel.querySelector('h2');
    const value = leaguePanel.querySelector('#worldName');
    const detail = leaguePanel.querySelector('#worldStatus');
    if (heading) heading.textContent = 'League';
    if (value) value.textContent = position === '—' ? '—' : `${position}${Number(position) === 1 ? 'st' : Number(position) === 2 ? 'nd' : Number(position) === 3 ? 'rd' : 'th'}`;
    if (detail) {
      detail.hidden = false;
      detail.textContent = points === '—' ? 'Points unavailable' : `${points} pts`;
    }
  }

  if (squadPanel) {
    const heading = squadPanel.querySelector('h2');
    const list = squadPanel.querySelector('dl');
    if (heading) heading.textContent = 'Squad';
    if (list) list.innerHTML = `<dt>Registered</dt><dd>${registered}</dd><dt>Owned</dt><dd>${owned}</dd>`;
  }
}

function applyPortalArtDirection(data = latestPortalData) {
  if (data?.club) latestPortalData = data;
  promoteBrazilPitchStyles();
  compactFixtureMasthead();
  applyClubIdentity();
  if (latestPortalData) simplifyDashboard(latestPortalData);
}

applyPortalArtDirection();
window.addEventListener('tbg:portal-rendered', (event) => applyPortalArtDirection(event.detail));
window.addEventListener('tbg:portal-refreshed', (event) => applyPortalArtDirection(event.detail));
document.addEventListener('tbg:view-changed', () => applyPortalArtDirection());

export { CLUB_COLOURS, promoteBrazilPitchStyles, compactFixtureMasthead, applyClubIdentity, divisionLabel, simplifyDashboard };
