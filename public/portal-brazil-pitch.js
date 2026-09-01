const href = './portal-brazil-pitch.css';

function promoteBrazilPitchStyles() {
  let link = document.querySelector('link[href$="portal-brazil-pitch.css"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
  }
  document.head.append(link);
}

promoteBrazilPitchStyles();
window.addEventListener('tbg:portal-rendered', promoteBrazilPitchStyles);
document.addEventListener('tbg:view-changed', promoteBrazilPitchStyles);

export { promoteBrazilPitchStyles };
