import './manager-participation.js';

if (!document.querySelector('link[href$="manager-participation.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './manager-participation.css';
  document.head.append(link);
}
