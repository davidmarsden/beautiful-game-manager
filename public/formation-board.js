const FORMATIONS = {
  '4-3-3-wide': [
    ['GK',50,91],['LB',16,72],['LCB',38,77],['RCB',62,77],['RB',84,72],
    ['LCM',31,51],['CM',50,56],['RCM',69,51],['LW',18,25],['CF',50,17],['RW',82,25]
  ],
  '4-2-3-1': [
    ['GK',50,91],['LB',16,72],['LCB',38,77],['RCB',62,77],['RB',84,72],
    ['LDM',38,57],['RDM',62,57],['LW',18,35],['AM',50,35],['RW',82,35],['CF',50,15]
  ],
  '4-4-2': [
    ['GK',50,91],['LB',16,72],['LCB',38,77],['RCB',62,77],['RB',84,72],
    ['LM',16,48],['LCM',39,52],['RCM',61,52],['RM',84,48],['LCF',40,19],['RCF',60,19]
  ],
  '3-5-2': [
    ['GK',50,91],['LCB',28,75],['CB',50,79],['RCB',72,75],['LWB',12,50],['LDM',37,56],['AM',50,40],['RDM',63,56],['RWB',88,50],['LCF',40,18],['RCF',60,18]
  ]
};

const ROLE_FAMILIES = {
  GK:['Goalkeeper'], CB:['Centre-Back'], LCB:['Centre-Back','Left-Back'], RCB:['Centre-Back','Right-Back'],
  LB:['Left-Back','Left Wing-Back'], RB:['Right-Back','Right Wing-Back'], LWB:['Left Wing-Back','Left-Back','Left Winger'], RWB:['Right Wing-Back','Right-Back','Right Winger'],
  LDM:['Defensive Midfield','Central Midfield'], RDM:['Defensive Midfield','Central Midfield'], CM:['Central Midfield','Defensive Midfield','Attacking Midfield'],
  LCM:['Central Midfield','Defensive Midfield','Attacking Midfield'], RCM:['Central Midfield','Defensive Midfield','Attacking Midfield'],
  LM:['Left Winger','Central Midfield','Left Wing-Back'], RM:['Right Winger','Central Midfield','Right Wing-Back'],
  LW:['Left Winger','Attacking Midfield'], RW:['Right Winger','Attacking Midfield'], AM:['Attacking Midfield','Central Midfield','Second Striker'],
  CF:['Centre-Forward','Second Striker'], LCF:['Centre-Forward','Second Striker'], RCF:['Centre-Forward','Second Striker']
};

let board;
let selected = null;
let assignments = [];
let benchAssignments = [];
let players = [];
let refreshTimer;
let syncingLegacy = false;

const byId = (id) => document.getElementById(id);
const norm = (value) => String(value ?? '');

function parsePlayer(label) {
  const input = label.querySelector('input');
  const text = label.querySelector('span')?.textContent || label.textContent || '';
  const parts = text.split('·').map((part) => part.trim());
  return { id:norm(input?.value), name:parts[0] || norm(input?.value), position:parts[1] || 'Unknown', rating:parts[2] || '—' };
}

function collectPlayers() {
  const labels = [...document.querySelectorAll('#startingXi .player-pick')];
  players = labels.map(parsePlayer);
  return labels.length > 0;
}

function currentChecked(zone) {
  return [...document.querySelectorAll(`input[data-zone="${zone}"]:checked`)].map((input) => norm(input.value));
}

function initialiseAssignments() {
  const checkedXi = currentChecked('xi');
  const checkedBench = currentChecked('bench');
  assignments = FORMATIONS[byId('formation')?.value || '4-3-3-wide'].map((_, index) => checkedXi[index] || null);
  benchAssignments = Array.from({length:7}, (_, index) => checkedBench[index] || null);
}

function token(player, role) {
  if (!player) return '';
  const allowed = ROLE_FAMILIES[role] || [];
  const warning = allowed.length && !allowed.includes(player.position) ? ' suitability-warning' : '';
  return `<div class="player-token${warning}" draggable="true" data-player-id="${player.id}"><span class="player-rating">${player.rating}</span><span><strong>${player.name}</strong><small>${player.position}</small></span></div>`;
}

function renderBoard() {
  if (!board) return;
  const formation = byId('formation')?.value || '4-3-3-wide';
  const slots = FORMATIONS[formation] || FORMATIONS['4-3-3-wide'];
  const pitch = byId('formationPitch');
  pitch.innerHTML = '<div class="centre-circle"></div><div class="penalty-box top"></div><div class="penalty-box bottom"></div>' + slots.map(([role,x,y], index) => {
    const player = players.find((p) => p.id === assignments[index]);
    const active = selected?.zone === 'xi' && selected.index === index ? ' selected' : '';
    return `<button type="button" class="formation-slot ${player ? '' : 'empty'}${active}" data-zone="xi" data-index="${index}" data-role="${role}" style="left:${x}%;top:${y}%">${token(player,role)}</button>`;
  }).join('');

  byId('formationBench').innerHTML = benchAssignments.map((id,index) => {
    const player = players.find((p) => p.id === id);
    const active = selected?.zone === 'bench' && selected.index === index ? ' selected' : '';
    return `<button type="button" class="bench-slot ${player ? '' : 'empty'}${active}" data-zone="bench" data-index="${index}">${token(player,'BENCH')}</button>`;
  }).join('');

  const assigned = new Set([...assignments,...benchAssignments].filter(Boolean));
  byId('formationSquadTray').innerHTML = players.map((player) => `<button type="button" class="tray-player ${assigned.has(player.id) ? 'assigned' : ''} ${selected?.playerId === player.id ? 'selected' : ''}" data-player-id="${player.id}" draggable="true"><span class="tray-rating">${player.rating}</span><span><strong>${player.name}</strong><small>${player.position}</small></span><span>${assigned.has(player.id) ? 'Selected' : 'Available'}</span></button>`).join('');
  byId('xiCount').textContent = `${assignments.filter(Boolean).length}/11 XI`;
  byId('benchCount').textContent = `${benchAssignments.filter(Boolean).length}/7 bench`;
  validateBoard();
}

function validateBoard() {
  const target = byId('formationValidation');
  const xi = assignments.filter(Boolean);
  const bench = benchAssignments.filter(Boolean);
  const duplicates = [...xi,...bench].filter((id,index,all) => all.indexOf(id) !== index);
  const goalkeeper = assignments[0] && players.find((p) => p.id === assignments[0])?.position === 'Goalkeeper';
  if (xi.length !== 11) { target.className='formation-validation error'; target.textContent=`Select ${11-xi.length} more starter${11-xi.length===1?'':'s'}.`; return false; }
  if (duplicates.length) { target.className='formation-validation error'; target.textContent='A player cannot appear twice.'; return false; }
  if (!goalkeeper) { target.className='formation-validation error'; target.textContent='The goalkeeper slot must contain a goalkeeper.'; return false; }
  target.className='formation-validation ok'; target.textContent=`Team ready · ${bench.length} substitute${bench.length===1?'':'s'}`; return true;
}

function removePlayer(id) {
  assignments = assignments.map((value) => value === id ? null : value);
  benchAssignments = benchAssignments.map((value) => value === id ? null : value);
}

function placePlayer(id, zone, index) {
  if (!id) return;
  const target = zone === 'xi' ? assignments : benchAssignments;
  const displaced = target[index];
  const previous = assignments.findIndex((value) => value === id);
  const previousBench = benchAssignments.findIndex((value) => value === id);
  removePlayer(id);
  target[index] = id;
  if (displaced && displaced !== id) {
    if (previous >= 0) assignments[previous] = displaced;
    else if (previousBench >= 0) benchAssignments[previousBench] = displaced;
  }
  selected = null;
  renderBoard();
}

function clickSlot(zone,index) {
  const target = zone === 'xi' ? assignments : benchAssignments;
  const occupant = target[index];
  if (selected?.playerId) return placePlayer(selected.playerId, zone, index);
  if (selected?.zone) {
    const source = selected.zone === 'xi' ? assignments : benchAssignments;
    const sourceId = source[selected.index];
    if (sourceId) return placePlayer(sourceId, zone, index);
  }
  selected = occupant ? { zone, index, playerId:occupant } : { zone, index, playerId:null };
  renderBoard();
}

function syncLegacyInputs() {
  syncingLegacy = true;
  document.querySelectorAll('input[data-zone="xi"]').forEach((input) => { input.checked = assignments.includes(norm(input.value)); });
  document.querySelectorAll('input[data-zone="bench"]').forEach((input) => { input.checked = benchAssignments.includes(norm(input.value)); });

  const xiContainer = byId('startingXi');
  const orderedIds = assignments.filter(Boolean);
  const labels = [...xiContainer.querySelectorAll('.player-pick')];
  orderedIds.forEach((id) => {
    const label = labels.find((item) => norm(item.querySelector('input')?.value) === id);
    if (label) xiContainer.appendChild(label);
  });
  labels.filter((label) => !orderedIds.includes(norm(label.querySelector('input')?.value))).forEach((label) => xiContainer.appendChild(label));

  const benchContainer = byId('bench');
  const benchLabels = [...benchContainer.querySelectorAll('.player-pick')];
  benchAssignments.filter(Boolean).forEach((id) => {
    const label = benchLabels.find((item) => norm(item.querySelector('input')?.value) === id);
    if (label) benchContainer.appendChild(label);
  });
  benchLabels.filter((label) => !benchAssignments.includes(norm(label.querySelector('input')?.value))).forEach((label) => benchContainer.appendChild(label));
  document.querySelector('input[data-zone="xi"]')?.dispatchEvent(new Event('change'));
  setTimeout(() => { syncingLegacy = false; }, 0);
}

function buildBoard() {
  if (board || !collectPlayers()) return;
  initialiseAssignments();
  const legacyXi = byId('startingXi');
  const legacyBench = byId('bench');
  const xiHeading = legacyXi.previousElementSibling;
  const benchHeading = legacyBench.previousElementSibling;
  legacyXi.classList.add('legacy-team-selectors');
  legacyBench.classList.add('legacy-team-selectors');
  xiHeading?.classList.add('legacy-team-selectors');
  benchHeading?.classList.add('legacy-team-selectors');

  board = document.createElement('section');
  board.id='interactiveFormationBoard';
  board.className='formation-board-shell';
  board.innerHTML=`<div class="pitch-panel"><div class="pitch-toolbar"><div><strong>Interactive formation</strong><div class="pitch-help">Drag players, or tap a player then tap a slot. Tap two occupied slots to swap.</div></div><div class="selection-counts"><span id="xiCount"></span><span id="benchCount"></span></div></div><div id="formationPitch" class="football-pitch"></div><h3>Substitutes</h3><div id="formationBench" class="bench-board"></div><div id="formationValidation" class="formation-validation"></div><div class="board-actions"><button id="clearFormation" type="button">Clear team</button><button id="autoPickFormation" type="button">Auto-pick strongest XI</button></div></div><aside class="squad-tray-panel"><h3>Squad</h3><div class="pitch-help">Selected players are faded. Tap any player to move them.</div><div id="formationSquadTray" class="squad-tray"></div></aside>`;
  legacyXi.parentElement.insertBefore(board, xiHeading || legacyXi);
  renderBoard();

  board.addEventListener('click',(event)=>{
    const slot=event.target.closest('[data-zone][data-index]');
    if(slot) return clickSlot(slot.dataset.zone,Number(slot.dataset.index));
    const player=event.target.closest('[data-player-id]');
    if(player){ selected={playerId:norm(player.dataset.playerId)}; renderBoard(); }
  });
  board.addEventListener('dragstart',(event)=>{ const player=event.target.closest('[data-player-id]'); if(player) event.dataTransfer.setData('text/plain',norm(player.dataset.playerId)); });
  board.addEventListener('dragover',(event)=>{ if(event.target.closest('[data-zone][data-index]')) event.preventDefault(); });
  board.addEventListener('drop',(event)=>{ const slot=event.target.closest('[data-zone][data-index]'); if(!slot)return; event.preventDefault(); placePlayer(event.dataTransfer.getData('text/plain'),slot.dataset.zone,Number(slot.dataset.index)); });
  byId('clearFormation').addEventListener('click',()=>{assignments=Array(11).fill(null);benchAssignments=Array(7).fill(null);selected=null;renderBoard();});
  byId('autoPickFormation').addEventListener('click',()=>{ const sorted=[...players].sort((a,b)=>Number(b.rating)-Number(a.rating)); const gk=sorted.find((p)=>p.position==='Goalkeeper'); const rest=sorted.filter((p)=>p.id!==gk?.id); assignments=[gk?.id||null,...rest.slice(0,10).map((p)=>p.id)]; benchAssignments=rest.slice(10,17).map((p)=>p.id); while(benchAssignments.length<7)benchAssignments.push(null);renderBoard(); });

  const scheduleRefresh = () => {
    if (syncingLegacy) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshFromPersistedInputs, 180);
  };
  new MutationObserver(scheduleRefresh).observe(legacyXi,{childList:true,subtree:true});
  new MutationObserver(scheduleRefresh).observe(legacyBench,{childList:true,subtree:true});
}

function refreshFromPersistedInputs() {
  if (!board || syncingLegacy || !collectPlayers()) return;
  const checkedXi=currentChecked('xi');
  const checkedBench=currentChecked('bench');
  assignments=FORMATIONS[byId('formation')?.value || '4-3-3-wide'].map((_,index)=>checkedXi[index]||null);
  benchAssignments=Array.from({length:7},(_,index)=>checkedBench[index]||null);
  renderBoard();
}

function waitForTeamLists(attempt=0) {
  if (buildBoard() !== false && board) return;
  if (attempt < 60) setTimeout(() => waitForTeamLists(attempt+1), 150);
}

window.addEventListener('load',()=>setTimeout(waitForTeamLists,500));
byId('formation')?.addEventListener('change',()=>{ const next=FORMATIONS[byId('formation').value]||FORMATIONS['4-3-3-wide']; assignments=next.map((_,index)=>assignments[index]||null); renderBoard(); });
document.addEventListener('submit',(event)=>{ if(event.target?.id==='decisionForm'){ syncLegacyInputs(); if(!validateBoard()){ event.preventDefault(); event.stopImmediatePropagation(); } } },true);
