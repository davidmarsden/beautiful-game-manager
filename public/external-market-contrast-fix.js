const styleId = 'tbgExternalMarketContrastFix';

if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-select-external-player],
    [data-open-market-prepare-offer],
    [data-external-offer],
    .open-market-actions .primary-action {
      color: #fff !important;
    }
  `;
  document.head.append(style);
}
