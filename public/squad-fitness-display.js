export function formatSquadFitness(value) {
  const numeric = Number.parseFloat(String(value ?? '').replace('%', ''));
  return Number.isFinite(numeric) ? `${Math.round(numeric)}%` : '100%';
}

let observer = null;
let applying = false;

export function roundSquadFitnessCells() {
  if (typeof document === 'undefined' || applying) return;
  const table = document.getElementById('squadTable');
  const body = document.getElementById('squadRows');
  if (!table || !body) return;
  const headers = [...table.querySelectorAll('thead th')];
  const fitnessIndex = headers.findIndex((header) => header.dataset.sort === 'fitness');
  if (fitnessIndex < 0) return;

  applying = true;
  observer?.disconnect();
  try {
    body.querySelectorAll('tr:not(.position-separator)').forEach((row) => {
      const cell = row.children[fitnessIndex];
      if (cell) cell.textContent = formatSquadFitness(cell.textContent);
    });
  } finally {
    applying = false;
    observer?.observe(body, { childList: true, subtree: true });
  }
}

function install() {
  if (typeof document === 'undefined') return;
  const body = document.getElementById('squadRows');
  if (!body) return;
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(roundSquadFitnessCells);
    observer.observe(body, { childList: true, subtree: true });
  }
  roundSquadFitnessCells();
}

if (typeof window !== 'undefined') {
  window.addEventListener('tbg:portal-rendered', install);
  window.addEventListener('load', () => setTimeout(install, 0));
}
