const COMMUNITY_URL = 'https://chat.whatsapp.com/HCUCxUHAkfLEQkUvyu3VsF';
const COMMUNITY_QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKQAAACkAQAAAAAxzrjsAAABSElEQVR42u2XsZEdMQxDHz0/BztQ/2VtB2AFuEDrcWBHHl52yqQAoyWeQG6Fv9f84l/r5/S/Tquqp7roupslXSU0o7JpJWtfUY3wQ1OmekX385LFccDbVQ+e6ene0v0AoUeVSskdVnyrUKA/Tw3khfdGkiREiqK784quEgkgEjJbulEsJyEoSBu6H+hb4TlCoMmGbyRCFiFJbLRVB2w5BuRIXvPNOEgK3Bov3VeSTYzjRR4UG9txhJd4IJdeWbawlS1dgRN0ffMeD0Rg5GB7sw42iRUhdnyrMKg9HFx6ADFLPChEQcJoJ88+AE+5KVxpM9rKhyT2jWGzmA8yvxEGvMZDEi4MUrTDwzvvuBnE0Ev9+O1Db+js9Yt33hk4nCdTeHMu0THlA6ZWp8wHw4xZuu8773B4NAI4XvINLmBG4Kzlzs9/yzeefgF2dR5jGT1NKQAAAABJRU5ErkJggg==';

function loadStylesheet(href) {
  if (document.querySelector(`link[href$="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `./${href}`;
  document.head.append(link);
}
loadStylesheet('community-card.css');
loadStylesheet('manager-contact.css');
loadStylesheet('tbg-green-stock.css');

function communityCard() {
  const card = document.createElement('section');
  card.className = 'tbg-community-card';
  card.dataset.tbgCommunityCard = 'true';
  card.innerHTML = `<div><h3>💬 The Beautiful Game community</h3><p>Join the dedicated alpha testers WhatsApp community for matchday chat, feedback, bugs and transfer plotting.</p><div class="tbg-community-actions"><a class="tbg-community-link" href="${COMMUNITY_URL}" target="_blank" rel="noopener noreferrer">Join WhatsApp community</a></div><small class="tbg-community-small">During alpha this is the testers community. Later this space can point to the current world chat.</small></div><div class="tbg-community-qr-wrap"><img class="tbg-community-qr" src="${COMMUNITY_QR}" alt="QR code for The Beautiful Game WhatsApp community"></div>`;
  return card;
}

function mountCommunityCard() {
  const shell = document.querySelector('#feedView .world-feed-shell');
  if (!shell || shell.querySelector('[data-tbg-community-card]')) return;
  const heading = shell.querySelector('.world-feed-heading');
  const composer = shell.querySelector('.world-feed-composer');
  const card = communityCard();
  if (heading) heading.after(card);
  else if (composer) composer.before(card);
  else shell.prepend(card);
}

function simplifyUpdatesCopy(root = document) {
  const copy = root.querySelector?.('#updatesView .player-updates-hero p');
  if (!copy) return;
  copy.textContent = copy.textContent.replace(' Manager does not recalculate these ratings.', '');
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches?.('.world-feed-shell') || node.querySelector?.('.world-feed-shell')) {
        mountCommunityCard();
      }
      if (node.id === 'updatesView' || node.querySelector?.('#updatesView') || node.closest?.('#updatesView')) {
        simplifyUpdatesCopy(document);
      }
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'feed') mountCommunityCard();
  if (event.detail?.view === 'updates') simplifyUpdatesCopy(document);
});
window.addEventListener('tbg:portal-rendered', () => {
  mountCommunityCard();
  simplifyUpdatesCopy(document);
});

export { COMMUNITY_URL, COMMUNITY_QR, communityCard, mountCommunityCard, simplifyUpdatesCopy };
