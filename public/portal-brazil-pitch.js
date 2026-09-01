const layers = ['./portal-brazil-pitch.css', './portal-final-polish.css'];

function promoteBrazilPitchStyles() {
  for (const href of layers) {
    const fileName = href.split('/').pop();
    let link = document.querySelector(`link[href$="${fileName}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
    }
    document.head.append(link);
  }
}

promoteBrazilPitchStyles();
window.addEventListener('tbg:portal-rendered', promoteBrazilPitchStyles);
document.addEventListener('tbg:view-changed', promoteBrazilPitchStyles);

export { promoteBrazilPitchStyles };
