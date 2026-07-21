function applyTheme(dark) {
  document.documentElement.classList.toggle('light-theme', !dark);
  themeToggle.checked = dark;
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--lymo-accent', color);
  accentSwatches.forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === color.toLowerCase());
  });
}

function applyStyle(style) {
  document.documentElement.dataset.style = String(style);
  styleCards.forEach((card) => {
    card.classList.toggle('active', Number(card.dataset.style) === style);
  });
}

function setDownloadDirText(dir) {
  downloadDirPath.textContent = dir;
  downloadDirPath.title = dir;
}

const themeToggle = document.getElementById('theme-toggle');
const zoomSelect = document.getElementById('zoom-select');
const accentSwatches = document.querySelectorAll('.accent-swatch');
const styleCards = document.querySelectorAll('.style-card');
const downloadDirPath = document.getElementById('download-dir-path');
const downloadDirChange = document.getElementById('download-dir-change');

window.api.getTheme().then(applyTheme);
window.api.onThemeChanged(applyTheme);
themeToggle.addEventListener('change', () => {
  window.api.setTheme(themeToggle.checked);
});

window.api.getZoom().then((zoom) => {
  zoomSelect.value = String(zoom);
});
window.api.onZoomChanged((percent) => {
  zoomSelect.value = String(percent);
});
zoomSelect.addEventListener('change', () => {
  window.api.setZoom(Number(zoomSelect.value));
});

window.api.getAccentColor().then(applyAccent);
window.api.onAccentColorChanged(applyAccent);
accentSwatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    window.api.setAccentColor(swatch.dataset.color);
  });
});

window.api.getStyle().then(applyStyle);
window.api.onStyleChanged(applyStyle);
styleCards.forEach((card) => {
  card.addEventListener('click', () => {
    window.api.setStyle(Number(card.dataset.style));
  });
});

window.api.getDownloadDir().then(setDownloadDirText);
downloadDirChange.addEventListener('click', () => {
  window.api.chooseDownloadDir().then(setDownloadDirText);
});

// --- Shortcuts ---

const shortcutsList = document.getElementById('shortcuts-list');
const shortcutNameInput = document.getElementById('shortcut-name-input');
const shortcutUrlInput = document.getElementById('shortcut-url-input');
const shortcutAddBtn = document.getElementById('shortcut-add-btn');

function faviconUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return '';
  }
}

let draggedId = null;

function renderShortcuts(list) {
  shortcutsList.innerHTML = '';
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'shortcut-item';
    row.draggable = true;
    row.dataset.id = s.id;

    const handle = document.createElement('span');
    handle.className = 'shortcut-drag-handle';
    handle.textContent = '⋮⋮';
    handle.title = 'Drag to reorder';

    const favicon = document.createElement('img');
    favicon.className = 'shortcut-favicon';
    favicon.src = faviconUrl(s.url);
    favicon.alt = '';

    const name = document.createElement('span');
    name.className = 'shortcut-name';
    name.textContent = s.name;
    name.title = 'Click to rename';
    name.addEventListener('click', () => startEditField(row, s, 'name'));

    const url = document.createElement('span');
    url.className = 'shortcut-url';
    url.textContent = s.url;
    url.title = 'Click to edit URL';
    url.addEventListener('click', () => startEditField(row, s, 'url'));

    const del = document.createElement('button');
    del.className = 'shortcut-delete-btn';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', () => {
      window.api.deleteShortcut(s.id).then(renderShortcuts);
    });

    row.appendChild(handle);
    row.appendChild(favicon);
    row.appendChild(name);
    row.appendChild(url);
    row.appendChild(del);
    shortcutsList.appendChild(row);
  }
}

function startEditField(row, shortcut, field) {
  const displayEl = row.querySelector(field === 'name' ? '.shortcut-name' : '.shortcut-url');
  if (!displayEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = field === 'name' ? 'shortcut-name-input' : 'shortcut-url-input';
  input.value = field === 'name' ? shortcut.name : shortcut.url;
  displayEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const value = input.value.trim();
    if (value && value !== (field === 'name' ? shortcut.name : shortcut.url)) {
      const args = field === 'name' ? [shortcut.id, value, undefined] : [shortcut.id, undefined, value];
      window.api.updateShortcut(...args).then(renderShortcuts);
    } else {
      window.api.getShortcuts().then(renderShortcuts);
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      committed = true;
      window.api.getShortcuts().then(renderShortcuts);
    }
  });
}

window.api.getShortcuts().then(renderShortcuts);
window.api.onShortcutsChanged(renderShortcuts);

shortcutAddBtn.addEventListener('click', () => {
  const name = shortcutNameInput.value.trim();
  const url = shortcutUrlInput.value.trim();
  if (!name || !url) return;
  window.api.addShortcut(name, url).then((list) => {
    renderShortcuts(list);
    shortcutNameInput.value = '';
    shortcutUrlInput.value = '';
    shortcutNameInput.focus();
  });
});
[shortcutNameInput, shortcutUrlInput].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') shortcutAddBtn.click();
  });
});

shortcutsList.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.shortcut-item');
  if (!row) return;
  draggedId = Number(row.dataset.id);
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

shortcutsList.addEventListener('dragend', (e) => {
  const row = e.target.closest('.shortcut-item');
  if (row) row.classList.remove('dragging');
  shortcutsList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
});

shortcutsList.addEventListener('dragover', (e) => {
  e.preventDefault();
  const row = e.target.closest('.shortcut-item');
  shortcutsList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (row && Number(row.dataset.id) !== draggedId) row.classList.add('drag-over');
});

shortcutsList.addEventListener('drop', (e) => {
  e.preventDefault();
  const targetRow = e.target.closest('.shortcut-item');
  shortcutsList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (!targetRow || draggedId === null) return;
  const targetId = Number(targetRow.dataset.id);
  if (targetId === draggedId) return;

  const ids = Array.from(shortcutsList.querySelectorAll('.shortcut-item')).map((el) => Number(el.dataset.id));
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);
  ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, draggedId);
  window.api.reorderShortcuts(ids).then(renderShortcuts);
  draggedId = null;
});

// --- Bookmarks ---

const bookmarksList = document.getElementById('bookmarks-list');
const bookmarkNameInput = document.getElementById('bookmark-name-input');
const bookmarkUrlInput = document.getElementById('bookmark-url-input');
const bookmarkFolderSelect = document.getElementById('bookmark-folder-select');
const bookmarkAddBtn = document.getElementById('bookmark-add-btn');
const bookmarkFoldersList = document.getElementById('bookmark-folders-list');
const bookmarkNewFolderInput = document.getElementById('bookmark-new-folder-input');
const bookmarkNewFolderBtn = document.getElementById('bookmark-new-folder-btn');

let bookmarksState = { folders: [], bookmarks: [] };

function populateFolderSelect(selectEl, selectedId) {
  selectEl.innerHTML = '';
  for (const folder of bookmarksState.folders) {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    if (folder.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function renderBookmarks() {
  bookmarksList.innerHTML = '';
  for (const b of bookmarksState.bookmarks) {
    const row = document.createElement('div');
    row.className = 'bookmark-item';

    const favicon = document.createElement('img');
    favicon.className = 'bm-favicon';
    favicon.src = faviconUrl(b.url);
    favicon.alt = '';

    const name = document.createElement('span');
    name.className = 'bm-name';
    name.textContent = b.name;
    name.title = 'Click to rename';
    name.addEventListener('click', () => startEditBookmarkField(row, b, 'name'));

    const url = document.createElement('span');
    url.className = 'bm-url';
    url.textContent = b.url;
    url.title = 'Click to edit URL';
    url.addEventListener('click', () => startEditBookmarkField(row, b, 'url'));

    const folderSelect = document.createElement('select');
    folderSelect.className = 'bm-folder-select';
    populateFolderSelect(folderSelect, b.folderId);
    folderSelect.addEventListener('change', () => {
      window.api.updateBookmark(b.id, undefined, undefined, Number(folderSelect.value)).then((data) => {
        bookmarksState = data;
        renderBookmarks();
      });
    });

    const del = document.createElement('button');
    del.className = 'bm-delete-btn';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', () => {
      window.api.deleteBookmark(b.id).then((data) => {
        bookmarksState = data;
        renderBookmarks();
      });
    });

    row.appendChild(favicon);
    row.appendChild(name);
    row.appendChild(url);
    row.appendChild(folderSelect);
    row.appendChild(del);
    bookmarksList.appendChild(row);
  }
}

function startEditBookmarkField(row, bookmark, field) {
  const displayEl = row.querySelector(field === 'name' ? '.bm-name' : '.bm-url');
  if (!displayEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = field === 'name' ? 'bm-name-input' : 'bm-url-input';
  input.value = field === 'name' ? bookmark.name : bookmark.url;
  displayEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const value = input.value.trim();
    if (value && value !== (field === 'name' ? bookmark.name : bookmark.url)) {
      const args = field === 'name' ? [bookmark.id, value, undefined, undefined] : [bookmark.id, undefined, value, undefined];
      window.api.updateBookmark(...args).then((data) => {
        bookmarksState = data;
        renderBookmarks();
      });
    } else {
      renderBookmarks();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      committed = true;
      renderBookmarks();
    }
  });
}

function renderBookmarkFolders() {
  bookmarkFoldersList.innerHTML = '';
  const onlyOneFolder = bookmarksState.folders.length <= 1;
  for (const folder of bookmarksState.folders) {
    const row = document.createElement('div');
    row.className = 'folder-item';

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.name;
    name.title = 'Click to rename';
    name.addEventListener('click', () => startEditFolderName(row, folder));

    const del = document.createElement('button');
    del.className = 'folder-delete-btn';
    del.textContent = '✕';
    del.title = onlyOneFolder ? 'At least one folder is required' : 'Delete folder (bookmarks move to the first folder)';
    del.disabled = onlyOneFolder;
    del.addEventListener('click', () => {
      window.api.deleteBookmarkFolder(folder.id).then((data) => {
        bookmarksState = data;
        renderBookmarks();
        renderBookmarkFolders();
        populateFolderSelect(bookmarkFolderSelect, bookmarksState.folders[0] && bookmarksState.folders[0].id);
      });
    });

    row.appendChild(name);
    row.appendChild(del);
    bookmarkFoldersList.appendChild(row);
  }
}

function startEditFolderName(row, folder) {
  const displayEl = row.querySelector('.folder-name');
  if (!displayEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-name-input';
  input.value = folder.name;
  displayEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const value = input.value.trim();
    if (value && value !== folder.name) {
      window.api.renameBookmarkFolder(folder.id, value).then((data) => {
        bookmarksState = data;
        renderBookmarks();
        renderBookmarkFolders();
        populateFolderSelect(bookmarkFolderSelect, bookmarkFolderSelect.value ? Number(bookmarkFolderSelect.value) : undefined);
      });
    } else {
      renderBookmarkFolders();
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      committed = true;
      renderBookmarkFolders();
    }
  });
}

window.api.getBookmarks().then((data) => {
  bookmarksState = data;
  renderBookmarks();
  renderBookmarkFolders();
  populateFolderSelect(bookmarkFolderSelect);
});

window.api.onBookmarksChanged((data) => {
  bookmarksState = data;
  renderBookmarks();
  renderBookmarkFolders();
  const selected = bookmarkFolderSelect.value ? Number(bookmarkFolderSelect.value) : undefined;
  populateFolderSelect(bookmarkFolderSelect, selected);
});

bookmarkAddBtn.addEventListener('click', () => {
  const name = bookmarkNameInput.value.trim();
  const url = bookmarkUrlInput.value.trim();
  const folderId = Number(bookmarkFolderSelect.value);
  if (!name || !url) return;
  window.api.addBookmark(name, url, folderId).then((data) => {
    bookmarksState = data;
    renderBookmarks();
    bookmarkNameInput.value = '';
    bookmarkUrlInput.value = '';
    bookmarkNameInput.focus();
  });
});
[bookmarkNameInput, bookmarkUrlInput].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') bookmarkAddBtn.click();
  });
});

bookmarkNewFolderBtn.addEventListener('click', () => {
  const name = bookmarkNewFolderInput.value.trim();
  if (!name) return;
  window.api.addBookmarkFolder(name).then((data) => {
    bookmarksState = { folders: data.folders, bookmarks: data.bookmarks };
    renderBookmarkFolders();
    populateFolderSelect(bookmarkFolderSelect, data.folder && data.folder.id);
    bookmarkNewFolderInput.value = '';
  });
});
bookmarkNewFolderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') bookmarkNewFolderBtn.click();
});

document.querySelectorAll('.settings-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const section = document.getElementById(btn.dataset.section);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
