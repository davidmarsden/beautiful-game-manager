const text = (value) => String(value ?? "").trim();
export const MANAGER_DECISION_VERSION = "tbg-manager-decision-v0.1";
export const ALLOWED_FORMATIONS = new Set(["4-4-2","4-3-3-wide","4-2-3-1","4-1-4-1","3-5-2","3-4-3","5-3-2"]);
export const ALLOWED_TACTIC_VALUES = Object.freeze({
  mentality:new Set(["defensive","cautious","balanced","positive","attacking"]),
  pressing:new Set(["low","mid","high"]),
  tempo:new Set(["slow","normal","fast"]),
  width:new Set(["narrow","balanced","wide"]),
  defensive_line:new Set(["deep","standard","high"])
});
const unique = (values) => [...new Set((values || []).map(text).filter(Boolean))];

export function validateManagerDecision(decision, world) {
  const errors=[];
  const managerId=text(decision?.manager_id), clubId=text(decision?.club_id), fixtureId=text(decision?.fixture_id), formation=text(decision?.formation);
  const startingXi=unique(decision?.starting_xi), bench=unique(decision?.bench), captainId=text(decision?.captain_id);
  const tactics=decision?.tactics||{}, setPieceTakers=decision?.set_piece_takers||{};
  const club=world?.clubs?.find((row)=>row.tbg_club_id===clubId);
  const squadIds=new Set(club?.squad?.player_ids||[]);
  if(!managerId) errors.push("manager_id is required");
  if(!clubId) errors.push("club_id is required");
  if(!fixtureId) errors.push("fixture_id is required");
  if(!ALLOWED_FORMATIONS.has(formation)) errors.push(`unsupported formation: ${formation||"blank"}`);
  if(startingXi.length!==11) errors.push(`starting_xi must contain 11 unique players; received ${startingXi.length}`);
  if(bench.length>9) errors.push(`bench may contain at most 9 unique players; received ${bench.length}`);
  const overlap=startingXi.filter((id)=>bench.includes(id));
  if(overlap.length) errors.push(`players cannot appear in both starting XI and bench: ${overlap.join(", ")}`);
  if(!club) errors.push(`club not found: ${clubId||"blank"}`);
  const invalid=[...startingXi,...bench].filter((id)=>!squadIds.has(id));
  if(invalid.length) errors.push(`players are not registered to this club: ${invalid.join(", ")}`);
  if(captainId&&!startingXi.includes(captainId)) errors.push("captain_id must be in the starting XI");
  for(const [key,allowed] of Object.entries(ALLOWED_TACTIC_VALUES)){
    const value=text(tactics[key]); if(!allowed.has(value)) errors.push(`invalid tactics.${key}: ${value||"blank"}`);
  }
  for(const [role,playerId] of Object.entries(setPieceTakers)) if(playerId&&!startingXi.includes(text(playerId))) errors.push(`set-piece taker ${role} must be in the starting XI`);
  return {valid:errors.length===0,errors,normalised:{version:MANAGER_DECISION_VERSION,manager_id:managerId,club_id:clubId,fixture_id:fixtureId,formation,starting_xi:startingXi,bench,captain_id:captainId||null,set_piece_takers:{penalties:text(setPieceTakers.penalties)||null,free_kicks:text(setPieceTakers.free_kicks)||null,corners_left:text(setPieceTakers.corners_left)||null,corners_right:text(setPieceTakers.corners_right)||null},tactics:{mentality:text(tactics.mentality),pressing:text(tactics.pressing),tempo:text(tactics.tempo),width:text(tactics.width),defensive_line:text(tactics.defensive_line)}}};
}

export function acceptManagerDecision(decision, world, submittedAt=new Date().toISOString()){
  const result=validateManagerDecision(decision,world);
  if(!result.valid){const error=new Error(`Invalid manager decision: ${result.errors[0]}`);error.validationErrors=result.errors;throw error;}
  return {...result.normalised,submission_id:`submission-${result.normalised.fixture_id}-${result.normalised.club_id}`,submitted_at:submittedAt,status:"submitted",source:"human_manager"};
}
