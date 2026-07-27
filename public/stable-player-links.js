const INVALID_PROFILE_HREFS = new Set(['', 'null', 'undefined', '#']);

function makeUnavailable(link) {
  const replacement = document.createElement('span');
  replacement.className = 'player-link player-link-unavailable';
  replacement.textContent = link.textContent;
  replacement.title = 'Pink Final profile not published yet';
  replacement.setAttribute('aria-label', `${link.textContent} — Pink Final profile not published yet`);
  link.replaceWith(replacement);
}

function stabilizePlayerLinks(root = document) {
  root.querySelectorAll?.('#squadTable a.player-link').forEach((link) => {
    const rawHref = String(link.getAttribute('href') || '').trim().toLowerCase();
    if (INVALID_PROFILE_HREFS.has(rawHref)) makeUnavailable(link);
  });
}

const squadRows = document.getElementById('squadRows');
if (squadRows) {
  new MutationObserver(() => stabilizePlayerLinks(squadRows)).observe(squadRows, { childList: true, subtree: true });
  stabilizePlayerLinks(squadRows);
}

export { stabilizePlayerLinks };
