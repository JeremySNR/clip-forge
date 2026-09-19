/* global document, window, navigator */
'use strict';

document.documentElement.classList.add('js-enabled');

const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('#main-nav');
if (menuToggle && mainNav) {
  menuToggle.hidden = false;
  const closeMenu = () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
  };
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    mainNav.classList.toggle('is-open', open);
  });
  mainNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuToggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nav-inner')) closeMenu();
  });
}

// Deterministic decorative waveform: no animation loop or external dependency.
const waveform = document.querySelector('.wave-bars');
if (waveform) {
  const bars = document.createDocumentFragment();
  for (let i = 0; i < 95; i++) {
    const bar = document.createElement('i');
    bar.style.height = `${18 + Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.3)) * 82}%`;
    bars.append(bar);
  }
  waveform.append(bars);
}

const demoDescriptions = {
  moments: 'AI finds self-contained moments with a hook, a story and a payoff.',
  captions: 'Style the words, highlight each beat and make the captions your own.',
  reframe: 'Speaker-aware reframing keeps the person talking in the vertical crop.'
};
const demoButtons = [...document.querySelectorAll('[data-demo-button]')];
demoButtons.forEach((button) => button.addEventListener('click', () => {
  const mode = button.dataset.demoButton;
  document.querySelector('.showcase-stage').dataset.demo = mode;
  document.querySelector('.demo-description').textContent = demoDescriptions[mode];
  demoButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
}));

const tabs = [...document.querySelectorAll('.product-tabs [role="tab"]')];
function selectTab(tab, focus = false) {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      selectTab(tabs[next], true);
    }
  });
});

const platforms = {
  windows: { name: 'Windows', help: 'Choose the .exe installer on GitHub Releases.' },
  mac: { name: 'macOS', help: 'Choose the .dmg on GitHub Releases. Builds are currently unsigned.' },
  linux: { name: 'Linux', help: 'Choose the .AppImage on GitHub Releases and make it executable.' }
};
const platformButtons = [...document.querySelectorAll('[data-platform]')];
function selectPlatform(platform) {
  const data = platforms[platform];
  if (!data || !platformButtons.length) return;
  platformButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.platform === platform)));
  const cta = document.querySelector('.download-cta');
  cta.firstChild.textContent = `Get Cutawan for ${data.name} `;
  document.querySelector('.download-help').textContent = data.help;
}
platformButtons.forEach((button) => button.addEventListener('click', () => selectPlatform(button.dataset.platform)));
// Keep mobile browsers generic: their users need a desktop installer.
if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) {
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) selectPlatform('mac');
  else if (/Linux/i.test(navigator.userAgent)) selectPlatform('linux');
}

// Site interactions never gate access to the static content or release links.
window.addEventListener('pageshow', () => {
  if (menuToggle && mainNav) {
    menuToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
  }
});
