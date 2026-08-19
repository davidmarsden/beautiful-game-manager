function updateSplitSquadCaps(snapshot = null) {
  const squad = Array.isArray(snapshot?.squad) ? snapshot.squad : null;
  const isYouth = (player) => Boolean(player?.youth_eligible_at_season_start ?? ((Number(player?.season_start_age ?? player?.age) || 99) <= 21));
  if (squad) {
    const firstTeam = squad.filter((player) => !isYouth(player) && !(player.loaned_out || String(player.loan_status || '').toLowerCase() === 'loaned_out')).length;
    const youth = squad.filter((player) => isYouth(player) && !(player.loaned_out || String(player.loan_status || '').toLowerCase() === 'loaned_out')).length;
    const first = document.getElementById('firstTeamSummary');
    const youthNode = document.getElementById('youthTeamSummary');
    if (first) first.textContent = `${firstTeam} / 25`;
    if (youthNode) youthNode.textContent = `${youth} / 25`;
    return;
  }
  const youthNode = document.getElementById('youthTeamSummary');
  if (youthNode?.textContent?.match(/\/\s*20\s*$/)) youthNode.textContent = youthNode.textContent.replace(/\/\s*20\s*$/, '/ 25');
}

window.addEventListener('tbg:portal-rendered', (event) => updateSplitSquadCaps(event.detail || null));
const observer = new MutationObserver(() => updateSplitSquadCaps());
observer.observe(document.documentElement, { childList: true, subtree: true });
updateSplitSquadCaps();
