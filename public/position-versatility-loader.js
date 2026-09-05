if (!document.querySelector('link[data-tbg-position-versatility]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/position-versatility.css';
  link.dataset.tbgPositionVersatility = 'true';
  document.head.appendChild(link);
}

import './position-versatility.js';
