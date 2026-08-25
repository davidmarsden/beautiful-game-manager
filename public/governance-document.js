const container = document.getElementById('governanceDocument');
const status = document.getElementById('governanceSourceStatus');
const sourceUrl = document.body.dataset.governanceSource;
const sourcePage = document.body.dataset.governancePage;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return html;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const cards = [];
  let card = null;
  let paragraph = [];
  let list = null;
  let skippedTitle = false;

  const ensureCard = () => {
    if (!card) card = { title: '', body: [] };
    return card;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    ensureCard().body.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    ensureCard().body.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  const flushCard = () => {
    flushParagraph();
    flushList();
    if (card && (card.title || card.body.length)) cards.push(card);
    card = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line === '---') {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('# ')) {
      if (!skippedTitle) {
        skippedTitle = true;
        continue;
      }
      flushCard();
      card = { title: line.slice(2).trim(), body: [] };
      continue;
    }

    if (line.startsWith('## ')) {
      flushCard();
      card = { title: line.slice(3).trim(), body: [] };
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      flushList();
      ensureCard().body.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushCard();

  return cards.map((section, index) => {
    const number = section.title.match(/^(\d+)\.\s*/)?.[1];
    const title = section.title.replace(/^\d+\.\s*/, '');
    const numberMarkup = number ? `<span class="governance-number">${String(number).padStart(2, '0')}</span>` : '';
    const wide = index === 0 || !number ? ' wide' : '';
    return `<article class="governance-card${wide}">${numberMarkup}${title ? `<h2>${inlineMarkdown(title)}</h2>` : ''}${section.body.join('')}</article>`;
  }).join('');
}

async function loadCanonicalGovernance() {
  if (!container || !sourceUrl) return;
  try {
    const response = await fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    if (!markdown.trim()) throw new Error('empty governance document');
    container.innerHTML = renderMarkdown(markdown);
    if (status) status.innerHTML = `Live content loaded from <a href="${sourcePage}" target="_blank" rel="noopener">canonical governance on GitHub</a>.`;
  } catch (error) {
    console.error('Could not load canonical governance document:', error);
    container.innerHTML = '<article class="governance-card wide"><h2>Rulebook temporarily unavailable</h2><p>TBG could not load the canonical governance document. We will not show a potentially stale local copy.</p></article>';
    if (status) status.innerHTML = `Open the <a href="${sourcePage}" target="_blank" rel="noopener">canonical governance source</a> directly.`;
  }
}

void loadCanonicalGovernance();
