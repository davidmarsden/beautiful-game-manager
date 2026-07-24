const $ = (id) => document.getElementById(id);

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

  const summary = $('worldControlSummary');
  if (summary) {
    const replaceInternalId = () => {
      const articles = [...summary.querySelectorAll('article')];
      const clubArticle = articles.find((article) => article.querySelector('span')?.textContent === 'Your club');
      const strong = clubArticle?.querySelector('strong');
      if (strong) strong.textContent = clubName;
    };
    replaceInternalId();
    new MutationObserver(replaceInternalId).observe(summary, { childList: true, subtree: true });
  }
}

window.addEventListener('tbg:portal-rendered', (event) => applyCanonicalDisplay(event.detail));
