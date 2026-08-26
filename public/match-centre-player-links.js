import './match-centre-runtime-guard.js';
import './replay-feed-queue-visibility.js';

const linkedFetch = window.fetch.bind(window);
let latestMatchCentrePayload = null;

const text = (value) => String(value ?? '').trim();

function requestUrl(input) {
  return typeof input === 'string' ? input : input instanceof Request ? input.url : '';
}

function linkedMatchCentreUrl(url) {
  if (!url.includes('/api/match-centre?') || url.includes('/api/match-centre-linked?')) return url;
  return url.replace('/api/match-centre?', '/api/match-centre-linked?');
}

window.fetch = async (input, init) => {
  const originalUrl = requestUrl(input);
  const redirectedUrl = linkedMatchCentreUrl(originalUrl);
  const redirectedInput = redirectedUrl === originalUrl
    ? input
    : input instanceof Request
      ? new Request(redirectedUrl, input)
      : redirectedUrl;
  const response = await linkedFetch(redirectedInput, init);
  if (redirectedUrl.includes('/api/match-centre-linked?') && response.ok) {
    response.clone().json().then((payload) => {
      latestMatchCentrePayload = payload;
      queueMicrotask(decorateVisibleMatchCentre);
    }).catch(() => {});
  }
  return response;
};

function wrapPlayerName(element, player, className = '') {
  if (!element || !player || element.querySelector?.('a.match-centre-player-link')) return;
  const url = text(player.profile_url);
  if (!url) {
    element.classList?.add('match-centre-player-unavailable');
    element.title = 'Pink Final profile not published yet';
    return;
  }
  const anchor = document.createElement('a');
  anchor.className = `match-centre-player-link ${className}`.trim();
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.textContent = element.textContent;
  anchor.title = 'Open Pink Final player profile';
  element.replaceChildren(anchor);
}

function appendPlayerLinks(element, players = [], className = '') {
  if (!element || element.querySelector?.(`.${className}`)) return;
  const published = players.filter((player) => text(player?.profile_url));
  if (!published.length) return;
  const group = document.createElement('small');
  group.className = className;
  for (const [index, player] of published.entries()) {
    if (index) group.append(' · ');
    const anchor = document.createElement('a');
    anchor.className = 'match-centre-player-link';
    anchor.href = player.profile_url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.textContent = player.player_name || player.name || 'Player profile';
    group.append(anchor);
  }
  element.append(group);
}

function decorateLineups(content, payload) {
  const fixture = payload.fixture || {};
  const submissions = payload.submissions || [];
  const ordered = [
    submissions.find((row) => row.club_id === fixture.home_club_id) || {},
    submissions.find((row) => row.club_id === fixture.away_club_id) || {}
  ];
  content.querySelectorAll('.lineups-grid article').forEach((article, sideIndex) => {
    const submission = ordered[sideIndex] || {};
    const lists = article.querySelectorAll('.lineup-list');
    const groups = [submission.starting_xi || [], submission.bench || []];
    lists.forEach((list, groupIndex) => {
      list.querySelectorAll('li').forEach((row, playerIndex) => {
        wrapPlayerName(row.querySelector('.lineup-name'), groups[groupIndex]?.[playerIndex]);
      });
    });
  });
}

function decorateSummary(content, payload) {
  const summary = payload.summary || {};
  const articles = content.querySelectorAll('.match-summary-grid > article');
  const scorerGroups = [summary.scorers?.home || [], summary.scorers?.away || []];
  [articles[0], articles[2]].forEach((article, sideIndex) => {
    article?.querySelectorAll('ul li').forEach((row, index) => {
      const scorer = scorerGroups[sideIndex]?.[index];
      wrapPlayerName(row.querySelector('strong'), scorer);
      if (scorer?.assist_player_name) appendPlayerLinks(row, [{ player_name: scorer.assist_player_name, profile_url: scorer.assist_profile_url }], 'scorer-assist-profile');
    });
    const cards = sideIndex === 0 ? summary.cards?.home || [] : summary.cards?.away || [];
    appendPlayerLinks(article?.querySelector('p'), cards, 'cards-profile-links');
  });
  wrapPlayerName(content.querySelector('.potm strong'), summary.player_of_the_match);
  content.querySelectorAll('.top-ratings li').forEach((row, index) => {
    wrapPlayerName(row.querySelector('strong'), summary.top_ratings?.[index]);
  });
}

function decorateEvents(content, payload) {
  content.querySelectorAll('.event-list .match-event').forEach((row, index) => {
    const event = payload.events?.[index];
    if (!event) return;
    appendPlayerLinks(row.querySelector('.event-copy'), [
      { player_name: event.player_name, profile_url: event.profile_url },
      { player_name: event.assist_player_name, profile_url: event.assist_profile_url }
    ], 'event-player-profiles');
  });
}

function decorateVisibleMatchCentre() {
  const content = document.getElementById('matchCentreContent');
  if (!content || !latestMatchCentrePayload || !content.querySelector('.teletext-scoreboard')) return;
  decorateSummary(content, latestMatchCentrePayload);
  decorateEvents(content, latestMatchCentrePayload);
  decorateLineups(content, latestMatchCentrePayload);
}

new MutationObserver(decorateVisibleMatchCentre).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('tbg:match-revealed', () => queueMicrotask(decorateVisibleMatchCentre));

export { decorateVisibleMatchCentre };
