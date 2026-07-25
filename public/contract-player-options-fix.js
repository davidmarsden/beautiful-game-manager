let contractSquad = [];

const optionEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

function contractOptions() {
  return contractSquad.map((player) => {
    const id = String(player?.tbg_player_id || '').trim();
    const name = String(player?.display_name || id).trim();
    return `<option value="${optionEscape(id)}">${optionEscape(name)}</option>`;
  }).join('');
}

function populateContractPlayers() {
  const select = document.getElementById('contractPlayer');
  if (!select || !contractSquad.length) return;
  const previous = select.value;
  select.innerHTML = contractOptions();
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

window.addEventListener('tbg:portal-rendered', (event) => {
  contractSquad = Array.isArray(event.detail?.squad) ? event.detail.squad : [];
  populateContractPlayers();
  window.setTimeout(populateContractPlayers, 0);
  window.setTimeout(populateContractPlayers, 100);
});

const observer = new MutationObserver(() => {
  const select = document.getElementById('contractPlayer');
  if (select && select.options.length === 0) populateContractPlayers();
});

observer.observe(document.documentElement, { childList: true, subtree: true });
