if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/tbg-sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  });
}
