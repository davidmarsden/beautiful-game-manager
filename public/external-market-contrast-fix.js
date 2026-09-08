const styleId = 'tbgExternalMarketContrastFix';
const contrastSelector = '[data-select-external-player], [data-open-market-prepare-offer], [data-external-offer], .open-market-actions .primary-action';

function enforceTransferCtaContrast(root = document) {
  root.querySelectorAll?.(contrastSelector).forEach((button) => {
    button.style.setProperty('color', '#fff', 'important');
  });
}

if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `${contrastSelector} { color: #fff !important; }`;
  document.head.append(style);
}

enforceTransferCtaContrast();

new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(contrastSelector)) node.style.setProperty('color', '#fff', 'important');
      enforceTransferCtaContrast(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
