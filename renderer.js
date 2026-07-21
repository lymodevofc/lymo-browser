const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const addressBar = document.getElementById('address-bar');
const settingsBtn = document.getElementById('settings-btn');
const starBtn = document.getElementById('star-btn');

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

function applyStyle(style) {
  document.documentElement.dataset.style = String(style);
}
window.api.getStyle().then(applyStyle);
window.api.onStyleChanged(applyStyle);

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
  updateStar();
  setLoading(!!tab.isLoading);
  updateAddressBarHighlight();
}

// --- Address bar domain highlighting ---
// Native <input> can't render multiple colors in one run of text, so the
// visible text actually lives in #address-bar-highlight (a div sitting
// behind the input); the input's own text is transparent (color: transparent
// in styles.css) and only shows its caret. Updated on every navigation (via
// updateToolbar above) and while typing (the 'input' listener below).

const addressBarHighlight = document.getElementById('address-bar-highlight');

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateAddressBarHighlight() {
  const value = addressBar.value;
  let html = '';
  if (value) {
    try {
      const parsed = new URL(value);
      const idx = value.indexOf(parsed.hostname);
      if (idx !== -1) {
        const before = value.slice(0, idx);
        const after = value.slice(idx + parsed.hostname.length);
        html = '<span class="ab-rest">' + escHtml(before) + '</span>' +
          '<span class="ab-host">' + escHtml(parsed.hostname) + '</span>' +
          '<span class="ab-rest">' + escHtml(after) + '</span>';
      } else {
        html = '<span class="ab-rest">' + escHtml(value) + '</span>';
      }
    } catch {
      html = '<span class="ab-rest">' + escHtml(value) + '</span>'; // plain search text
    }
  }
  addressBarHighlight.innerHTML = html;
}

// --- Loading progress bar (driven by did-start-loading/did-stop-loading,
// forwarded to the toolbar via tab:update's isLoading field) ---

const loadingBar = document.getElementById('loading-bar');
let loadingResetTimer = null;

function setLoading(isLoading) {
  clearTimeout(loadingResetTimer);
  if (isLoading) {
    loadingBar.classList.remove('complete');
    // Force a reflow so a load that starts again right after finishing still
    // re-triggers the width transition instead of silently no-opping.
    void loadingBar.offsetWidth;
    loadingBar.classList.add('loading');
  } else {
    if (!loadingBar.classList.contains('loading')) return;
    loadingBar.classList.remove('loading');
    loadingBar.classList.add('complete');
    loadingResetTimer = setTimeout(() => {
      loadingBar.classList.remove('complete');
    }, 550);
  }
}

// --- Bookmark star button ---

let bookmarksState = { folders: [], bookmarks: [] };

function updateStar() {
  const tab = tabState.get(activeTabId);
  const bookmarked = !!tab && !isNewTabUrl(tab.url) &&
    bookmarksState.bookmarks.some((b) => b.url === tab.url);
  starBtn.textContent = bookmarked ? '★' : '☆';
  starBtn.classList.toggle('bookmarked', bookmarked);
  starBtn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this page';
}

window.api.getBookmarks().then((data) => {
  bookmarksState = data;
  updateStar();
});
window.api.onBookmarksChanged((data) => {
  bookmarksState = data;
  updateStar();
});

starBtn.addEventListener('click', () => {
  const tab = tabState.get(activeTabId);
  if (!tab || isNewTabUrl(tab.url)) return;
  const existing = bookmarksState.bookmarks.find((b) => b.url === tab.url);
  if (existing) {
    window.api.deleteBookmarkByUrl(tab.url);
  } else {
    window.api.showBookmarkPicker(tab.url, tab.title || tab.url);
  }
});

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
  closeAutocomplete();
});

backBtn.addEventListener('click', () => window.api.back(activeTabId));
forwardBtn.addEventListener('click', () => window.api.forward(activeTabId));
reloadBtn.addEventListener('click', () => window.api.reload(activeTabId));

// --- Address bar autocomplete (history suggestions) ---

let autocompleteResults = [];
let autocompleteIndex = -1;
let autocompleteOpen = false;

function closeAutocomplete() {
  if (!autocompleteOpen) return;
  autocompleteOpen = false;
  autocompleteResults = [];
  autocompleteIndex = -1;
  window.api.hideAutocomplete();
}

addressBar.addEventListener('input', () => {
  updateAddressBarHighlight();
  const value = addressBar.value.trim();
  if (!value) {
    closeAutocomplete();
    return;
  }
  const rect = addressBar.getBoundingClientRect();
  window.api.showAutocomplete(value, { x: rect.left, y: rect.bottom, width: rect.width }).then((results) => {
    // The address bar may have changed (or emptied) while the lookup was in flight.
    if (addressBar.value.trim() !== value) return;
    autocompleteResults = results;
    autocompleteIndex = -1;
    autocompleteOpen = results.length > 0;
    if (!autocompleteOpen) window.api.hideAutocomplete();
  });
});

addressBar.addEventListener('keydown', (e) => {
  if (autocompleteOpen && e.key === 'ArrowDown') {
    e.preventDefault();
    autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteResults.length - 1);
    window.api.highlightAutocomplete(autocompleteIndex);
    return;
  }
  if (autocompleteOpen && e.key === 'ArrowUp') {
    e.preventDefault();
    autocompleteIndex = Math.max(autocompleteIndex - 1, -1);
    window.api.highlightAutocomplete(autocompleteIndex);
    return;
  }
  if (e.key === 'Escape') {
    if (autocompleteOpen) {
      e.preventDefault();
      closeAutocomplete();
    }
    return;
  }
  if (e.key === 'Enter') {
    if (autocompleteOpen && autocompleteIndex >= 0) {
      window.api.go(activeTabId, autocompleteResults[autocompleteIndex].url);
    } else {
      window.api.go(activeTabId, addressBar.value);
    }
    closeAutocomplete();
  }
});

// Clicking anywhere in the toolbar other than the address bar itself closes
// the dropdown (clicking into the page is handled from the main process,
// since the page is a separate webContents this document never sees).
document.addEventListener('mousedown', (e) => {
  if (autocompleteOpen && e.target !== addressBar) closeAutocomplete();
});

window.api.onAddressBarFocus(() => {
  addressBar.focus();
  addressBar.select();
});

settingsBtn.addEventListener('click', () => window.api.showSettings());

const lymochatNotifyDot = document.getElementById('lymochat-notify-dot');
window.api.onLymoChatNotify(() => lymochatNotifyDot.classList.remove('hidden'));
document.getElementById('lymochat-btn').addEventListener('click', () => {
  lymochatNotifyDot.classList.add('hidden');
  window.api.toggleLymoChat();
});
document.getElementById('downloads-btn').addEventListener('click', () => window.api.showDownloads());

// Pulsing dot on the downloads button while at least one download is in progress.
const downloadsActiveDot = document.getElementById('downloads-active-dot');
const activeDownloadIds = new Set();
window.api.onDownloadUpdate((d) => {
  if (d.state === 'progressing') {
    activeDownloadIds.add(d.id);
  } else {
    activeDownloadIds.delete(d.id);
  }
  downloadsActiveDot.classList.toggle('hidden', activeDownloadIds.size === 0);
});
document.getElementById('history-btn').addEventListener('click', () => window.api.showHistory());

// --- Split view close button ---

const exitSplitBtn = document.getElementById('exit-split-btn');
window.api.onSplitChanged(({ active }) => {
  exitSplitBtn.classList.toggle('hidden', !active);
});
exitSplitBtn.addEventListener('click', () => window.api.exitSplitView());
