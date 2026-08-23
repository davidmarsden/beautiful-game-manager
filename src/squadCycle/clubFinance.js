const text = (value) => String(value ?? '').trim();
const wholeMoney = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;
const cashMoney = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100) / 100) : fallback;
const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

export const CLUB_FINANCE_VERSION = 'tbg-club-finance-v0.1';
export const DEFAULT_OPENING_CASH_BALANCE = 100_000_000;
export const DEFAULT_WAGE_HEADROOM_RATIO = 1.20;
export const DEFAULT_MINIMUM_WAGE_BUDGET = 1_000;

function activeContractStats(state, clubId) {
  return Object.values(state?.contracts || {}).reduce((stats, contract) => {
    if (contract?.status !== 'active' || text(contract?.club_id) !== text(clubId)) return stats;
    const wage = wholeMoney(contract?.wage, 0);
    stats.total += wage;
    stats.highest = Math.max(stats.highest, wage);
    return stats;
  }, { total: 0, highest: 0 });
}

function bootstrapCash(state, clubId, configuredDefault) {
  const club = state?.clubs?.[clubId] || {};
  return cashMoney(
    club?.finance?.cash_balance
      ?? club?.cash_balance
      ?? club?.finances?.cash_balance,
    configuredDefault
  );
}

function configuredWageBudget(state, clubId, existing) {
  if (hasValue(existing?.wage_budget)) return wholeMoney(existing.wage_budget, 0);
  const club = state?.clubs?.[clubId] || {};
  const legacy = club?.finance?.wage_budget ?? club?.wage_budget ?? club?.finances?.wage_budget;
  return hasValue(legacy) ? wholeMoney(legacy, 0) : null;
}

function bootstrapWageBudget(wageBill, highestWage) {
  // Alpha bootstrap only: retain 20% proportional headroom, guarantee enough room for
  // one ordinary incumbent-level incoming player, and give an otherwise empty club enough
  // budget for one default-wage signing rather than bootstrapping permanently to zero.
  return Math.max(
    DEFAULT_MINIMUM_WAGE_BUDGET,
    wageBill,
    Math.ceil(wageBill * DEFAULT_WAGE_HEADROOM_RATIO),
    wageBill + highestWage
  );
}

function projectedFinanceState(state, {
  openingCashBalance = DEFAULT_OPENING_CASH_BALANCE
} = {}) {
  if (!state || typeof state !== 'object') throw new Error('Squad-cycle state is required for club finances');
  const current = state.finances && typeof state.finances === 'object' ? state.finances : {};
  const currentClubs = current.clubs && typeof current.clubs === 'object' ? current.clubs : {};
  const clubs = Object.create(null);

  for (const clubId of Object.keys(state.clubs || {}).sort()) {
    const wages = activeContractStats(state, clubId);
    const existing = currentClubs[clubId] || {};
    const configuredBudget = configuredWageBudget(state, clubId, existing);
    clubs[clubId] = {
      club_id: clubId,
      currency: text(existing.currency) || 'GBP',
      cash_balance: cashMoney(existing.cash_balance, bootstrapCash(state, clubId, openingCashBalance)),
      // An explicit budget is a fixed constraint, even when a legacy/imported club is already
      // over it. Only a missing budget is bootstrapped from the current contract book.
      wage_budget: configuredBudget === null
        ? bootstrapWageBudget(wages.total, wages.highest)
        : configuredBudget
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

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
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
  const wageBill = activeContractStats(state, id).total;
  return Object.freeze({
    club_id: id,
    currency: finance.currency,
    cash_balance: cashMoney(finance.cash_balance, 0),
    wage_bill: wageBill,
    wage_budget: wholeMoney(finance.wage_budget, 0),
    wage_headroom: Math.max(0, wholeMoney(finance.wage_budget, 0) - wageBill)
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
      const pennies = Math.round(rawAmount * 100);
      if (Math.abs(rawAmount * 100 - pennies) > 1e-7) {
        throw new Error(`Cash leg ${index + 1} supports at most two decimal places`);
      }
      return { fromClubId, toClubId, amountPennies: pennies, amount: pennies / 100 };
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
  const atIso = iso(at);

  const projected = projectedFinanceState(state);
  const netPennies = Object.create(null);
  for (const clubId of Object.keys(state.clubs || {})) netPennies[clubId] = 0;
  for (const leg of normalized) {
    netPennies[leg.fromClubId] -= leg.amountPennies;
    netPennies[leg.toClubId] += leg.amountPennies;
  }

  for (const [clubId, deltaPennies] of Object.entries(netPennies)) {
    if (!deltaPennies) continue;
    const openingPennies = Math.round(cashMoney(projected.clubs[clubId]?.cash_balance, 0) * 100);
    const closingPennies = openingPennies + deltaPennies;
    if (closingPennies < 0) {
      throw new Error(`${clubId} has insufficient cash for deal (${openingPennies / 100} available, ${Math.abs(deltaPennies) / 100} net required)`);
    }
  }

  for (const [clubId, deltaPennies] of Object.entries(netPennies)) {
    if (!deltaPennies) continue;
    const openingPennies = Math.round(cashMoney(projected.clubs[clubId].cash_balance, 0) * 100);
    projected.clubs[clubId].cash_balance = (openingPennies + deltaPennies) / 100;
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
