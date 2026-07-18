const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const addressBar = document.getElementById('address-bar');
const settingsBtn = document.getElementById('settings-btn');

function applyTheme(dark) {
  document.documentElement.classList.toggle('light-theme', !dark);
}
window.api.getTheme().then(applyTheme);
window.api.onThemeChanged(applyTheme);

function applyAccent(color) {
  document.documentElement.style.setProperty('--lymo-accent', color);
}
window.api.getAccentColor().then(applyAccent);
window.api.onAccentColorChanged(applyAccent);

// Ambient mode: the chrome panel matches the active page's top color; dark
// text on light backgrounds, light text on dark backgrounds. Lime accents
// stay fixed in styles.css.
window.api.onChromeColor(({ bg, dark }) => {
  const root = document.documentElement.style;
  root.setProperty('--chrome-bg', bg);
  root.setProperty('--chrome-fg', dark ? '#e0e0e0' : '#1a1a1a');
  root.setProperty('--chrome-border', dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.2)');
  root.setProperty('--chrome-input-bg', dark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.5)');
});

const tabState = new Map();
let activeTabId = null;

function isNewTabUrl(url) {
  return !url || url === 'about:blank' || url.endsWith('/newtab.html');
}

function updateToolbar() {
  const tab = tabState.get(activeTabId);
  if (!tab) return;
  addressBar.value = isNewTabUrl(tab.url) ? '' : tab.url;
  backBtn.disabled = !tab.canGoBack;
  forwardBtn.disabled = !tab.canGoForward;
}

window.api.onTabCreated(({ id, url }) => {
  tabState.set(id, { url, canGoBack: false, canGoForward: false });
});

window.api.onTabUpdate((data) => {
  tabState.set(data.id, data);
  if (data.id === activeTabId) {
    updateToolbar();
  }
});

window.api.onTabClosed(({ id }) => {
  tabState.delete(id);
});

window.api.onTabActive(({ id }) => {
  activeTabId = id;
  updateToolbar();
});

backBtn.addEventListener('click', () => window.api.back(activeTabId));
forwardBtn.addEventListener('click', () => window.api.forward(activeTabId));
reloadBtn.addEventListener('click', () => window.api.reload(activeTabId));

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.api.go(activeTabId, addressBar.value);
  }
});

settingsBtn.addEventListener('click', () => window.api.showSettings());

const lymochatNotifyDot = document.getElementById('lymochat-notify-dot');
window.api.onLymoChatNotify(() => lymochatNotifyDot.classList.remove('hidden'));
document.getElementById('lymochat-btn').addEventListener('click', () => {
  lymochatNotifyDot.classList.add('hidden');
  window.api.toggleLymoChat();
});
document.getElementById('downloads-btn').addEventListener('click', () => window.api.showDownloads());
document.getElementById('history-btn').addEventListener('click', () => window.api.showHistory());
