const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const playerName = (player) => player.display_name || player.player_name || player.canonical_name || player.tbg_player_id || player.player_id || 'Unknown player';
const playerId = (player) => player.tbg_player_id || player.player_id || '';
const rating = (player) => player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? '—';
const position = (player) => player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';

function tabPanel(name, player) {
  if (name === 'selection') return `<div class="tbg-profile-grid"><div><span>Fitness</span><strong>${player.fitness ?? 100}%</strong></div><div><span>Morale</span><strong>${escapeHtml(player.morale || 'Good')}</strong></div><div><span>Availability</span><strong>${escapeHtml(player.injury_status || player.availability || 'Available')}</strong></div><div><span>Contract</span><strong>${escapeHtml(player.contract_expiry || player.contract_end_at || player.contract?.end_at || 'Open-ended')}</strong></div></div>`;
  if (name === 'transfers') return `<p class="portal-empty">No in-game transfer ledger has been projected for this player yet.</p>`;
  if (name === 'statistics') return `<div class="tbg-profile-grid"><div><span>Appearances</span><strong>${player.appearances ?? player.games_played ?? 0}</strong></div><div><span>Goals</span><strong>${player.goals ?? 0}</strong></div><div><span>Assists</span><strong>${player.assists ?? 0}</strong></div><div><span>Average rating</span><strong>${player.average_match_rating ?? '—'}</strong></div></div>`;
  return `<p class="portal-empty">Career history and honours will populate from the canonical world ledger as seasons are completed.</p>`;
}

export function openTbgPlayerProfile(root, player, club = {}) {
  if (!root || !player) return;
  root.querySelector('[data-tbg-player-profile-host]')?.remove();
  const host = document.createElement('div');
  host.dataset.tbgPlayerProfileHost = '';
  host.className = 'tbg-player-profile-host';
  const pinkFinalLink = player.profile_url || player.pink_final_profile_url;
  host.innerHTML = `<section class="competition-card tbg-player-profile" data-player-id="${escapeHtml(playerId(player))}">
    <div class="section-heading"><div><span class="status-label">TBG PLAYER PROFILE</span><h2>${escapeHtml(playerName(player))}</h2><p>${escapeHtml(position(player))} · ${escapeHtml(club.club_name || club.canonical_name || player.club_name || 'Current club unavailable')}</p></div><button type="button" data-close-player>Close</button></div>
    <div class="tbg-player-identity"><strong class="tbg-player-rating">${rating(player)}</strong><div><span>Age ${player.age ?? '—'}</span><span>${escapeHtml(player.nationality || player.country || '')}</span></div>${pinkFinalLink ? `<a class="club-public-profile-link" href="${escapeHtml(pinkFinalLink)}" target="_blank" rel="noopener">View real-world profile in The Pink Final</a>` : '<span class="player-link-unavailable">Pink Final profile not published yet</span>'}</div>
    <nav class="tbg-profile-tabs" aria-label="Player profile sections"><button class="active" data-player-tab="selection">Selection</button><button data-player-tab="transfers">Transfers</button><button data-player-tab="statistics">Statistics</button><button data-player-tab="history">History</button></nav>
    <div data-player-tab-panel>${tabPanel('selection', player)}</div>
  </section>`;
  root.prepend(host);
  host.querySelector('[data-close-player]').addEventListener('click', () => host.remove());
  host.querySelectorAll('[data-player-tab]').forEach((button) => button.addEventListener('click', () => {
    host.querySelectorAll('[data-player-tab]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    host.querySelector('[data-player-tab-panel]').innerHTML = tabPanel(button.dataset.playerTab, player);
  }));
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
