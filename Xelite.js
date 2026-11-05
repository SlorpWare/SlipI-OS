import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isReadOnlyPath, normalizeFilesystemPath } from './filesystem.js';

const h = React.createElement;
const iconRoot = './WebOS filesystem/Icons/nuvola/32x32';
const quickLocations = [
  { name: 'Root', path: '/', icon: 'places/desktop.png' },
  { name: 'Public', path: '/Public', icon: 'places/user-home.png' },
  { name: 'Applications', path: '/Applications', icon: 'apps/applications-accessories.png' },
  { name: 'Dock', path: '/Dock', icon: 'places/folder.png' },
  { name: 'Application files', path: '/Application files', icon: 'places/folder.png' },
  { name: 'Linux files', path: '/Linux files', icon: 'devices/drive-harddisk.png' },
];
const textExtensions = new Set(['.txt', '.md', '.html', '.htm', '.js', '.css', '.json', '.xml', '.csv', '.log', '.sh', '.ini', '.cfg', '.yaml', '.yml']);

function joinPath(base, name) {
  return `${base === '/' ? '' : base}/${name}`.replace(/\/{2,}/g, '/');
}

function parentPath(path) {
  if (path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

function fileType(name, isDirectory) {
  if (isDirectory) return 'Folder';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return extension ? `${extension.slice(1).toUpperCase()} file` : 'File';
}

function fileIcon(entry) {
  if (entry.isDirectory) return `${iconRoot}/places/folder.png`;
  const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase() : '';
  const names = {
    '.html': 'text-html.png', '.htm': 'text-html.png', '.js': 'application-javascript.png',
    '.css': 'text-css.png', '.json': 'application-json.png', '.pdf': 'application-pdf.png',
    '.png': 'image-png.png', '.jpg': 'image-jpeg.png', '.jpeg': 'image-jpeg.png',
    '.svg': 'image-svg+xml.png', '.zip': 'application-zip.png', '.gz': 'application-gzip.png',
    '.txt': 'text-plain.png', '.md': 'text-markdown.png',
  };
  return `${iconRoot}/mimetypes/${names[extension] || 'application-octet-stream.png'}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ToolButton({ icon, label, onClick, disabled }) {
  return h('button', { className: 'xelite-tool', type: 'button', title: label, 'aria-label': label, onClick, disabled },
    h('img', {
      src: `${iconRoot}/actions/${icon}.png`,
      alt: '',
      onError: (event) => { event.currentTarget.src = `${iconRoot}/actions/help-contents.png`; },
    }));
}

export default function Xelite({ fs, initialPath = '/' }) {
  const [path, setPath] = useState(initialPath);
  const [pathDraft, setPathDraft] = useState(initialPath);
  const [entries, setEntries] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [filter, setFilter] = useState('');
  const [editor, setEditor] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [history, setHistory] = useState([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [sort, setSort] = useState({ key: 'name', direction: 1 });
  const filesInput = useRef(null);
  const folderInput = useRef(null);

  function refresh(nextPath = path) {
    try {
      const directory = nextPath === '/' ? '/' : nextPath.replace(/\/$/, '');
      const items = fs.readdirSync(directory).filter((name) => !(directory === '/' && name.startsWith('.webos-filesystem-seeded-v'))).map((name) => {
        const fullPath = joinPath(directory, name);
        const info = fs.statSync(fullPath);
        return { name, path: fullPath, isDirectory: info.isDirectory(), size: Number(info.size) || 0, mtime: Number(info.mtimeMs) || 0 };
      });
      setEntries(items);
      setPath(directory);
      setPathDraft(directory);
      setSelectedPath((selected) => items.some((item) => item.path === selected) ? selected : null);
      setStatus(`${items.length} item${items.length === 1 ? '' : 's'}`);
    } catch (error) {
      setStatus(error.message || 'Unable to open folder');
    }
  }

  function navigate(nextPath, addHistory = true) {
    const normalized = normalizeFilesystemPath(nextPath);
    refresh(normalized);
    if (addHistory && normalized !== path) {
      setHistory((current) => [...current.slice(0, historyIndex + 1), normalized]);
      setHistoryIndex((current) => current + 1);
    }
  }

  useEffect(() => { refresh(initialPath); }, []);

  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return entries
      .filter((entry) => !query || entry.name.toLowerCase().includes(query))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
        const result = sort.key === 'size' ? left.size - right.size : left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
        return result * sort.direction;
      });
  }, [entries, filter, sort]);

  function selectedEntry() {
    return entries.find((entry) => entry.path === selectedPath) || null;
  }

  async function createFile() {
    if (isReadOnlyPath(path)) { setStatus('This system folder is read-only'); return; }
    const name = window.prompt('New file name');
    if (!name || name.includes('/') || name === '.' || name === '..') return;
    const target = joinPath(path, name);
    try {
      fs.writeFileSync(target, '');
      await fs.promises.flush();
      refresh();
      setSelectedPath(target);
      setEditor({ path: target, name, content: '' });
    } catch (error) { window.alert(error.message); }
  }

  async function createFolder() {
    if (isReadOnlyPath(path)) { setStatus('This system folder is read-only'); return; }
    const name = window.prompt('New folder name');
    if (!name || name.includes('/') || name === '.' || name === '..') return;
    try { fs.mkdirSync(joinPath(path, name)); await fs.promises.flush(); refresh(); }
    catch (error) { window.alert(error.message); }
  }

  async function renameSelected() {
    const item = selectedEntry();
    if (!item || isReadOnlyPath(item.path)) { setStatus('This system item is read-only'); return; }
    const name = window.prompt('Rename item', item.name);
    if (!name || name.includes('/') || name === item.name) return;
    try { fs.renameSync(item.path, joinPath(path, name)); await fs.promises.flush(); refresh(); }
    catch (error) { window.alert(error.message); }
  }

  async function deleteSelected() {
    const item = selectedEntry();
    if (!item) return;
    if (isReadOnlyPath(item.path)) { setStatus('This system item is read-only'); return; }
    if (!window.confirm(`Permanently delete ${item.name}?`)) return;
    try {
      fs.rmSync(item.path, { recursive: true, force: true });
      await fs.promises.flush();
      refresh();
    } catch (error) { window.alert(error.message); }
  }

  async function openSelected(item) {
    if (item.isDirectory) {
      navigate(item.path);
      return;
    }
    const extension = item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')).toLowerCase() : '';
    if (extension === '.html' && item.path.startsWith('/Applications/')) {
      const source = new URL(`./WebOS filesystem${item.path}`, window.location.href);
      try {
        const response = await fetch(source, { method: 'HEAD' });
        if (response.ok && window.WebOS?.openApp) {
          window.WebOS.openApp(source.href, { title: item.name });
          return;
        }
      } catch { }
    }
    if (!textExtensions.has(extension)) {
      setStatus(`${item.name} is not a supported text document`);
      return;
    }
    try { setEditor({ path: item.path, name: item.name, content: fs.readFileSync(item.path, 'utf8') }); }
    catch (error) { window.alert(error.message); }
  }

  function navigateHistory(direction) {
    const nextIndex = historyIndex + direction;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    setHistoryIndex(nextIndex);
    refresh(history[nextIndex]);
  }

  async function saveEditor() {
    if (isReadOnlyPath(editor.path)) { setStatus('This system file is read-only'); return; }
    try {
      fs.writeFileSync(editor.path, editor.content, 'utf8');
      await fs.promises.flush();
      setEditor(null);
      refresh();
      setStatus(`Saved ${editor.name}`);
    } catch (error) { window.alert(error.message); }
  }

  async function importFiles(event, isFolder) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (!isFolder && isReadOnlyPath(path)) {
      setStatus('Import into Public or Trash; system folders are read-only');
      event.target.value = '';
      return;
    }
    setStatus(`Importing ${files.length} files...`);
    let imported = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const file = files[cursor++];
        const relative = isFolder && file.webkitRelativePath
          ? file.webkitRelativePath.split('/').slice(1).join('/')
          : file.name;
        const parts = relative.split('/').filter((part) => part && part !== '.');
        if (!parts.length || parts.includes('..')) continue;
        const target = isFolder ? joinPath('/Public', parts.join('/')) : joinPath(path, parts.join('/'));
        try {
          fs.mkdirSync(parentPath(target), { recursive: true });
          await fs.promises.writeFile(target, fs.Buffer.from(await file.arrayBuffer()));
          imported++;
        } catch (error) {
          setStatus(`Could not import ${file.name}: ${error.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(12, files.length) }, worker));
    await fs.promises.flush();
    event.target.value = '';
    refresh(isFolder ? '/Public' : path);
    setStatus(`Imported ${imported} of ${files.length} files`);
  }

  function downloadSelected() {
    const item = selectedEntry();
    if (!item || item.isDirectory) return;
    try {
      const content = fs.readFileSync(item.path);
      const url = URL.createObjectURL(new Blob([content]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { window.alert(error.message); }
  }

  function sortBy(key) {
    setSort((current) => ({ key, direction: current.key === key ? -current.direction : 1 }));
  }

  function locationButton(location) {
    return h('button', {
      key: location.path,
      className: `xelite-location${path === location.path ? ' is-current' : ''}`,
      type: 'button',
      onClick: () => navigate(location.path),
    }, h('img', { src: `${iconRoot}/${location.icon}`, alt: '' }), h('span', null, location.name));
  }

  const directoryReadOnly = isReadOnlyPath(path);
  const selection = selectedEntry();
  const selectionReadOnly = !selection || isReadOnlyPath(selection.path);

  const toolbar = h('div', { className: 'xelite-toolbar' },
    h(ToolButton, { icon: 'go-previous', label: 'Back', onClick: () => navigateHistory(-1), disabled: historyIndex === 0 }),
    h(ToolButton, { icon: 'go-next', label: 'Forward', onClick: () => navigateHistory(1), disabled: historyIndex >= history.length - 1 }),
    h(ToolButton, { icon: 'go-home', label: 'Home', onClick: () => navigate('/') }),
    h(ToolButton, { icon: 'go-up', label: 'Up one folder', onClick: () => navigate(parentPath(path)) }),
    h(ToolButton, { icon: 'view-refresh', label: 'Refresh', onClick: () => refresh() }),
    h('span', { className: 'xelite-toolbar-divider' }),
    h(ToolButton, { icon: 'document-new', label: 'New file', onClick: createFile, disabled: directoryReadOnly }),
    h(ToolButton, { icon: 'folder-new', label: 'New folder', onClick: createFolder, disabled: directoryReadOnly }),
    h(ToolButton, { icon: 'document-open', label: 'Import files', onClick: () => filesInput.current.click(), disabled: directoryReadOnly }),
    h(ToolButton, { icon: 'folder-new', label: 'Import folder to Public', onClick: () => folderInput.current.click() }),
    h(ToolButton, { icon: 'document-save', label: 'Download selected file', onClick: downloadSelected, disabled: !selection || selection.isDirectory }),
    h(ToolButton, { icon: 'document-save-as', label: 'Rename selected item', onClick: renameSelected, disabled: selectionReadOnly }),
    h(ToolButton, { icon: 'window-close', label: 'Delete selected item', onClick: deleteSelected, disabled: selectionReadOnly }),
    h('input', { ref: filesInput, className: 'xelite-file-input', type: 'file', multiple: true, onChange: (event) => importFiles(event, false) }),
    h('input', { ref: folderInput, className: 'xelite-file-input', type: 'file', multiple: true, webkitdirectory: '', onChange: (event) => importFiles(event, true) }));

  const address = h('form', { className: 'xelite-address', onSubmit: (event) => { event.preventDefault(); navigate(pathDraft); } },
    h('label', { htmlFor: 'xelite-path' }, 'Location:'),
    h('input', { id: 'xelite-path', value: pathDraft, onChange: (event) => setPathDraft(event.target.value), spellCheck: false }),
    h('button', { type: 'submit' }, 'Go'),
    h('input', { className: 'xelite-search', value: filter, onChange: (event) => setFilter(event.target.value), placeholder: 'Filter files', 'aria-label': 'Filter files' }));

  const sidebar = h('aside', { className: 'xelite-sidebar' },
    h('h2', null, 'Devices'),
    h('div', { className: 'xelite-location-list' }, quickLocations.map(locationButton)),
    h('h2', { className: 'xelite-actions-heading' }, 'Actions'),
    h('button', { className: 'xelite-action', type: 'button', onClick: createFile, disabled: directoryReadOnly }, 'New file'),
    h('button', { className: 'xelite-action', type: 'button', onClick: createFolder, disabled: directoryReadOnly }, 'New folder'),
    h('button', { className: 'xelite-action', type: 'button', onClick: () => folderInput.current.click() }, 'Import folder to Public'));

  const table = h('table', { className: 'xelite-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col', onClick: () => sortBy('name') }, 'File'),
      h('th', { scope: 'col' }, 'Type'),
      h('th', { scope: 'col', className: 'size-column', onClick: () => sortBy('size') }, 'Size'))),
    h('tbody', null, visibleEntries.map((entry) => h('tr', {
      key: entry.path,
      className: selectedPath === entry.path ? 'is-selected' : '',
      title: isReadOnlyPath(entry.path) ? 'Read-only system item' : entry.name,
      onClick: () => setSelectedPath(entry.path),
      onDoubleClick: () => openSelected(entry),
    },
    h('td', null, h('span', { className: 'xelite-file-name' }, h('img', {
      src: fileIcon(entry),
      alt: '',
      onError: (event) => { event.currentTarget.src = `${iconRoot}/mimetypes/application-octet-stream.png`; },
    }), h('span', null, entry.name))),
    h('td', null, fileType(entry.name, entry.isDirectory)),
    h('td', { className: 'size-column' }, entry.isDirectory ? '<DIR>' : formatSize(entry.size))))));

  const body = h('div', { className: 'xelite-body' }, sidebar, h('div', { className: 'xelite-file-pane' }, table));
  const statusBar = h('div', { className: 'xelite-status' }, `${path}  |  ${status}${directoryReadOnly ? '  |  Read-only' : ''}`);
  const editorDialog = editor && h('div', { className: 'xelite-editor-backdrop' },
    h('section', { className: 'xelite-editor', role: 'dialog', 'aria-modal': true, 'aria-label': `Edit ${editor.name}` },
      h('header', null, h('span', null, editor.name), h('button', { type: 'button', onClick: () => setEditor(null), 'aria-label': 'Close editor' }, '×')),
      h('textarea', { value: editor.content, readOnly: isReadOnlyPath(editor.path), spellCheck: false, onChange: (event) => setEditor((current) => ({ ...current, content: event.target.value })) }),
      h('footer', null,
        h('button', { type: 'button', onClick: saveEditor, disabled: isReadOnlyPath(editor.path) }, 'Save'),
        h('button', { type: 'button', onClick: () => setEditor(null) }, 'Cancel'))));

  return h('div', { className: 'xelite', onKeyDown: (event) => {
    if (event.key === 'F5') { event.preventDefault(); refresh(); }
    if (event.key === 'Backspace' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') navigate(parentPath(path));
    if (event.key === 'Delete' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') deleteSelected();
  } }, toolbar, address, body, statusBar, editorDialog);
}