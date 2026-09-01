const layers = ['./portal-brazil-pitch.css', './portal-final-polish.css'];

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

function applyPortalArtDirection() {
  promoteBrazilPitchStyles();
  compactFixtureMasthead();
}

applyPortalArtDirection();
window.addEventListener('tbg:portal-rendered', applyPortalArtDirection);
document.addEventListener('tbg:view-changed', applyPortalArtDirection);

export { promoteBrazilPitchStyles, compactFixtureMasthead };
