const styleId = 'tbgExternalMarketContrastFix';

if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    [data-select-external-player] {
      color: #fff;
    }
  `;
  document.head.append(style);
}
