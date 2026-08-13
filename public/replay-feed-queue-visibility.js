const revealedQueuedRows = new WeakSet();

const text = (value) => String(value ?? '').trim();

function activeSpotlightMinute(spotlight) {
  if (!spotlight || spotlight.hidden) return null;
  const marker = text(spotlight.querySelector?.('.spotlight-main strong')?.textContent);
  const match = marker.match(/^(\d+)'$/);
  return match ? Number(match[1]) : null;
}

function rowMinute(row) {
  const marker = text(row?.querySelector?.('time')?.textContent);
  const match = marker.match(/^(\d+)'$/);
  return match ? Number(match[1]) : null;
}

export function syncQueuedReplayFeedVisibility(root = document) {
  const feed = root.getElementById?.('replayFeed') || root.querySelector?.('#replayFeed');
  const spotlight = root.getElementById?.('replaySpotlight') || root.querySelector?.('#replaySpotlight');
  if (!feed) return;

  const majorRows = [...feed.querySelectorAll?.('.match-event.major-event') || []];
  const activeMinute = activeSpotlightMinute(spotlight);
  if (activeMinute === null) {
    majorRows.forEach((row) => { row.hidden = false; });
    return;
  }

  const sameMinuteRows = majorRows.filter((row) => rowMinute(row) === activeMinute);
  const unrevealed = sameMinuteRows.filter((row) => !revealedQueuedRows.has(row));

  // Replay rows are inserted with `afterbegin`, so DOM order is reverse canonical order.
  // Reveal the oldest unrevealed row for this minute: it corresponds to the active
  // queued spotlight. Later same-minute moments stay hidden until their own hold.
  const activeRow = unrevealed.at(-1) || sameMinuteRows.find((row) => !row.hidden) || null;
  if (activeRow) revealedQueuedRows.add(activeRow);

  sameMinuteRows.forEach((row) => {
    row.hidden = !revealedQueuedRows.has(row);
  });
}

const observer = new MutationObserver(() => queueMicrotask(() => syncQueuedReplayFeedVisibility()));
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

document.addEventListener('tbg:match-revealed', () => queueMicrotask(() => syncQueuedReplayFeedVisibility()));
