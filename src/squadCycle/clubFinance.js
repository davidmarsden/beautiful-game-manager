const text = (value) => String(value ?? '').trim();
const money = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;

export const CLUB_FINANCE_VERSION = 'tbg-club-finance-v0.1';
export const DEFAULT_OPENING_CASH_BALANCE = 100_000_000;
export const DEFAULT_WAGE_HEADROOM_RATIO = 1.20;

function activeContractWages(state, clubId) {
  return Object.values(state?.contracts || {}).reduce((total, contract) => {
    if (contract?.status !== 'active' || text(contract?.club_id) !== text(clubId)) return total;
    return total + money(contract?.wage, 0);
  }, 0);
}

function bootstrapCash(state, clubId, configuredDefault) {
  const club = state?.clubs?.[clubId] || {};
  return money(
    club?.finance?.cash_balance
      ?? club?.cash_balance
      ?? club?.finances?.cash_balance,
    configuredDefault
  );
}

function bootstrapWageBudget(state, clubId, wageBill) {
  const club = state?.clubs?.[clubId] || {};
  const explicit = money(
    club?.finance?.wage_budget
      ?? club?.wage_budget
      ?? club?.finances?.wage_budget,
    0
  );
  if (explicit > 0) return explicit;
  return Math.max(wageBill, Math.ceil(wageBill * DEFAULT_WAGE_HEADROOM_RATIO));
}

function projectedFinanceState(state, {
  openingCashBalance = DEFAULT_OPENING_CASH_BALANCE
} = {}) {
  if (!state || typeof state !== 'object') throw new Error('Squad-cycle state is required for club finances');
  const current = state.finances && typeof state.finances === 'object' ? state.finances : {};
  const currentClubs = current.clubs && typeof current.clubs === 'object' ? current.clubs : {};
  const clubs = Object.create(null);

  for (const clubId of Object.keys(state.clubs || {}).sort()) {
    const wageBill = activeContractWages(state, clubId);
    const existing = currentClubs[clubId] || {};
    clubs[clubId] = {
      club_id: clubId,
      currency: text(existing.currency) || 'GBP',
      cash_balance: money(existing.cash_balance, bootstrapCash(state, clubId, openingCashBalance)),
      wage_budget: Math.max(
        wageBill,
        money(existing.wage_budget, bootstrapWageBudget(state, clubId, wageBill))
      )
    };
  }
  return { version: CLUB_FINANCE_VERSION, clubs };
}

function financeEvent(state, type, at, payload = {}) {
  if (!Array.isArray(state.events)) state.events = [];
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at: new Date(at).toISOString(),
    ...payload
  });
  state.events.push(row);
  return row;
}

/**
 * Backward-compatible alpha bootstrap for canonical worlds created before finances existed.
 * The bootstrap values are deliberately simple and separately calibratable: this module is
 * a transaction-safety spine, not the full Scouting & Finance Constitution economy.
 */
export function ensureClubFinanceState(state, options = {}) {
  state.finances = projectedFinanceState(state, options);
  return state.finances;
}

export function clubFinanceSummary(state, clubId) {
  const id = text(clubId);
  const finances = projectedFinanceState(state);
  const finance = finances.clubs[id];
  if (!finance) throw new Error(`Unknown club: ${clubId}`);
  const wageBill = activeContractWages(state, id);
  return Object.freeze({
    club_id: id,
    currency: finance.currency,
    cash_balance: money(finance.cash_balance, 0),
    wage_bill: wageBill,
    wage_budget: money(finance.wage_budget, wageBill),
    wage_headroom: Math.max(0, money(finance.wage_budget, wageBill) - wageBill)
  });
}

export function clubFinanceReadModel(state) {
  return Object.fromEntries(Object.keys(state?.clubs || {}).sort().map((clubId) => [clubId, clubFinanceSummary(state, clubId)]));
}

export function assertFinalWageBudgets(state, wageDeltasByClub = {}) {
  for (const [clubId, delta] of Object.entries(wageDeltasByClub || {})) {
    const summary = clubFinanceSummary(state, clubId);
    const finalBill = summary.wage_bill + Number(delta || 0);
    if (finalBill > summary.wage_budget) {
      throw new Error(`${clubId} wage budget exceeded (${finalBill} > ${summary.wage_budget})`);
    }
    if (finalBill < 0) throw new Error(`${clubId} final wage bill cannot be negative`);
  }
}

function normaliseCashLegs(state, legs = []) {
  return (Array.isArray(legs) ? legs : [])
    .filter((leg) => String(leg?.leg_type || '') === 'cash' || leg?.amount != null)
    .map((leg, index) => {
      const fromClubId = text(leg?.from_club_id ?? leg?.fromClubId);
      const toClubId = text(leg?.to_club_id ?? leg?.toClubId);
      const rawAmount = Number(leg?.amount);
      if (!fromClubId || !state.clubs?.[fromClubId]) throw new Error(`Cash leg ${index + 1} has unknown paying club`);
      if (!toClubId || !state.clubs?.[toClubId]) throw new Error(`Cash leg ${index + 1} has unknown receiving club`);
      if (fromClubId === toClubId) throw new Error('Cash transfer requires two different clubs');
      if (!Number.isFinite(rawAmount) || rawAmount < 0) throw new Error(`Cash leg ${index + 1} requires a non-negative amount`);
      return { fromClubId, toClubId, amount: Math.trunc(rawAmount) };
    });
}

/**
 * Validate every cash leg against the final net deal position before mutating a balance.
 * Incoming cash in the same atomic deal can fund outgoing cash; arbitrary leg order cannot
 * create a transient insufficient-funds failure. Rejected deals do not even lazily attach a
 * finance object to legacy states: all projections and validation are side-effect free.
 */
export function applyCashLegsAtomically(state, { legs = [], at } = {}) {
  const normalized = normaliseCashLegs(state, legs);
  if (!normalized.length) return [];
  const atIso = new Date(at).toISOString();
  if (atIso === 'Invalid Date') throw new Error(`Invalid date: ${at}`);

  const projected = projectedFinanceState(state);
  const net = Object.create(null);
  for (const clubId of Object.keys(state.clubs || {})) net[clubId] = 0;
  for (const leg of normalized) {
    net[leg.fromClubId] -= leg.amount;
    net[leg.toClubId] += leg.amount;
  }

  for (const [clubId, delta] of Object.entries(net)) {
    if (!delta) continue;
    const opening = money(projected.clubs[clubId]?.cash_balance, 0);
    const closing = opening + delta;
    if (closing < 0) {
      throw new Error(`${clubId} has insufficient cash for deal (${opening} available, ${Math.abs(delta)} net required)`);
    }
  }

  for (const [clubId, delta] of Object.entries(net)) {
    if (!delta) continue;
    projected.clubs[clubId].cash_balance = money(projected.clubs[clubId].cash_balance, 0) + delta;
  }
  state.finances = projected;

  for (const leg of normalized) {
    financeEvent(state, 'cash_transferred', atIso, {
      from_club_id: leg.fromClubId,
      to_club_id: leg.toClubId,
      amount: leg.amount,
      currency: state.finances.clubs[leg.fromClubId]?.currency || 'GBP'
    });
  }
  return normalized;
}
