import test from "node:test";
import assert from "node:assert/strict";
import { acceptManagerDecision, validateManagerDecision } from "../src/decisionSubmission.js";

const squad=Array.from({length:20},(_,index)=>({tbg_player_id:`p-${index+1}`}));
const world={clubs:[{tbg_club_id:"club-1",squad:{player_ids:squad.map((player)=>player.tbg_player_id)}}]};
const valid={manager_id:"manager-1",club_id:"club-1",fixture_id:"fixture-1",formation:"4-3-3-wide",starting_xi:squad.slice(0,11).map((p)=>p.tbg_player_id),bench:squad.slice(11,18).map((p)=>p.tbg_player_id),captain_id:"p-1",set_piece_takers:{penalties:"p-1",free_kicks:"p-2",corners_left:"p-3",corners_right:"p-4"},tactics:{mentality:"balanced",pressing:"high",tempo:"fast",width:"wide",defensive_line:"standard"}};

test("accepts valid human decisions",()=>{const accepted=acceptManagerDecision(valid,world,"2026-07-14T20:00:00.000Z");assert.equal(accepted.status,"submitted");assert.equal(accepted.starting_xi.length,11);});
test("rejects invalid squad selections",()=>{const result=validateManagerDecision({...valid,starting_xi:["p-1","outsider"]},world);assert.equal(result.valid,false);assert.ok(result.errors.some((error)=>error.includes("11 unique players")));assert.ok(result.errors.some((error)=>error.includes("not registered")));});
