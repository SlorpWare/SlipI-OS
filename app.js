import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Xelite from './Xelite.js';
import { initializeFilesystem, isReadOnlyPath } from './filesystem.js';

const h = React.createElement;

function parseWindowSize(value) {
  const match = /^(\d{2,4})x(\d{2,4})$/i.exec(String(value || '').trim());
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function parseDesktopEntry(text) {
  const values = {};
  let inDesktopEntry = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inDesktopEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  if (!values.Name || !values.Exec) return null;
  return {
    name: values.Name,
    exec: values.Exec,
    icon: values.Icon || 'WebOS filesystem/Icons/nuvola/32x32/apps/applications-accessories.png',
    windowSize: values.WindowSize || undefined,
  };
}

function readDockEntries(fs) {
  try {
    return fs.readdirSync('/Dock')
      .filter((name) => name.toLowerCase().endsWith('.ini'))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .map((file) => ({ file, ...parseDesktopEntry(fs.readFileSync(`/Dock/${file}`, 'utf8')) }))
      .filter((entry) => entry.name && entry.exec);
  } catch {
    return [];
  }
}

function makeWindow(id, area, zIndex, options = {}) {
  const width = Math.min(area.width, Math.max(260, options.width || Math.min(580, area.width - 32)));
  const height = Math.min(area.height, Math.max(210, options.height || Math.min(380, area.height - 32)));
  const offset = (id - 1) * 24;
  return {
    id,
    title: options.title || `Window ${id}`,
    src: options.src || null,
    builtin: options.builtin || null,
    canvasWidth: options.canvasWidth || 1024,
    canvasHeight: options.canvasHeight || 768,
    initialPath: options.initialPath || '/',
    dockFile: options.dockFile || null,
    icon: options.icon || null,
    isWindowed: options.isWindowed !== false,
    x: Math.max(0, Math.min((area.width - width) / 2 + offset, area.width - Math.min(width, 120))),
    y: Math.max(0, Math.min((area.height - height) / 2 + offset, area.height - 44)),
    width,
    height,
    zIndex,
    minimized: false,
    maximized: false,
    restoreBounds: null,
  };
}

function App({ fs }) {
  const workspaceRef = useRef(null);
  const pointerAction = useRef(null);
  const nextId = useRef(1);
  const nextZ = useRef(1);
  const [windows, setWindows] = useState([]);
  const [dockEntries, setDockEntries] = useState(() => readDockEntries(fs));
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  function openWindow(options = {}) {
    const area = workspaceRef.current.getBoundingClientRect();
    const id = nextId.current++;
    let appUrl = null;
    let size = parseWindowSize(options.windowSize || (options.width && options.height ? `${options.width}x${options.height}` : ''));
    if (options.src) {
      appUrl = new URL(options.src, window.location.href);
      size = size || parseWindowSize(appUrl.searchParams.get('--window_size'));
      if (options.isWindowed === false) appUrl.searchParams.delete('--is_windowed');
      else appUrl.searchParams.set('--is_windowed', '');
      if (size) appUrl.searchParams.set('--window_size', `${size.width}x${size.height}`);
      else appUrl.searchParams.delete('--window_size');
      appUrl.searchParams.set('--window_id', String(id));
    }
    const segments = appUrl ? appUrl.pathname.split('/').filter(Boolean) : [];
    const file = segments[segments.length - 1] || '';
    const folder = segments[segments.length - 2] || '';
    const title = options.title || (file.toLowerCase() === 'index.html' ? folder : file.replace(/\.[^.]+$/, '')) || `Window ${id}`;
    const item = makeWindow(id, area, nextZ.current++, {
      width: size?.width,
      height: size?.height,
      title,
      src: appUrl?.href,
      builtin: options.builtin,
      canvasWidth: options.canvasWidth,
      canvasHeight: options.canvasHeight,
      initialPath: options.initialPath,
      dockFile: options.dockFile,
      icon: options.icon ? new URL(options.icon, window.location.href).href : null,
      isWindowed: options.isWindowed,
    });
    item.x = Math.max(0, Math.min(item.x, area.width - Math.min(item.width, 120)));
    item.y = Math.max(0, Math.min(item.y, area.height - 34));
    setWindows((current) => [...current, item]);
    return id;
  }

  function openApp(src, options = {}) {
    if (typeof src !== 'string' || !src.trim()) return null;
    return openWindow({ ...options, src: src.trim() });
  }

  function openFileManager(initialPath = '/', dockFile = 'file-manager.ini') {
    return openWindow({
      builtin: 'xelite',
      initialPath,
      dockFile,
      title: 'Xelite File Manager',
      icon: './WebOS filesystem/Icons/nuvola/32x32/apps/system-file-manager.png',
      width: 900,
      height: 560,
    });
  }

  function focusWindow(id) {
    const zIndex = nextZ.current++;
    setWindows((current) => current.map((item) => item.id === id ? { ...item, minimized: false, zIndex } : item));
  }

  function closeWindow(id) {
    setWindows((current) => current.filter((item) => item.id !== id));
  }

  function minimizeWindow(id) {
    setWindows((current) => current.map((item) => item.id === id ? { ...item, minimized: true } : item));
  }

  function toggleMaximize(id) {
    const area = workspaceRef.current.getBoundingClientRect();
    setWindows((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (item.maximized) {
        const bounds = item.restoreBounds;
        return { ...item, ...bounds, maximized: false, restoreBounds: null };
      }
      return {
        ...item,
        restoreBounds: { x: item.x, y: item.y, width: item.width, height: item.height },
        x: 0,
        y: 0,
        width: area.width,
        height: area.height,
        maximized: true,
        minimized: false,
      };
    }));
  }

  function resizeWindow(id, width, height) {
    const area = workspaceRef.current.getBoundingClientRect();
    const nextWidth = Number(width);
    const nextHeight = Number(height);
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return;
    setWindows((current) => current.map((item) => item.id === id ? {
      ...item,
      width: Math.min(area.width, Math.max(260, nextWidth)),
      height: Math.min(area.height, Math.max(210, nextHeight)),
      maximized: false,
      restoreBounds: null,
    } : item));
  }

  function startPointer(event, item, type) {
    if (event.button !== 0 || item.maximized) return;
    if (type === 'drag' && event.target.closest('button')) return;
    event.stopPropagation();
    focusWindow(item.id);
    pointerAction.current = {
      type,
      id: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event) {
    const action = pointerAction.current;
    const area = workspaceRef.current.getBoundingClientRect();
    if (!action || action.pointerId !== event.pointerId) return;
    setWindows((current) => current.map((item) => {
      if (item.id !== action.id) return item;
      if (action.type === 'drag') {
        return {
          ...item,
          x: Math.max(0, Math.min(area.width - 100, action.x + event.clientX - action.startX)),
          y: Math.max(0, Math.min(area.height - 34, action.y + event.clientY - action.startY)),
        };
      }
      return {
        ...item,
        width: Math.max(Math.min(300, area.width), Math.min(area.width - item.x, action.width + event.clientX - action.startX)),
        height: Math.max(Math.min(210, area.height), Math.min(area.height - item.y, action.height + event.clientY - action.startY)),
      };
    }));
  }

  function stopPointer(event) {
    if (pointerAction.current?.pointerId === event.pointerId) pointerAction.current = null;
  }

  useEffect(() => {
    openFileManager('/', 'file-manager.ini');
    const refreshDock = () => setDockEntries(readDockEntries(fs));
    const dockTimer = window.setInterval(refreshDock, 1000);
    function handleAppMessage(event) {
      const frame = Array.from(workspaceRef.current.querySelectorAll('iframe')).find((candidate) => candidate.contentWindow === event.source);
      if (!frame || event.data?.channel !== 'slipi-app') return;
      const id = Number(frame.dataset.windowId);
      const message = event.data;
      const owner = windowsRef.current.find((item) => item.id === id);
      if (message.type === 'open-app') openApp(message.src, { ...message.options, dockFile: owner?.dockFile });
      else if (message.type === 'open-kms-window' && typeof message.requestId === 'string') {
        const width = Math.min(1600, Math.max(320, Number(message.width) || 1024));
        const height = Math.min(1200, Math.max(240, Number(message.height) || 768));
        const windowId = openWindow({
          builtin: 'kms',
          title: typeof message.title === 'string' ? message.title : 'Linux Xorg Display',
          width,
          height,
          canvasWidth: width,
          canvasHeight: height,
          dockFile: owner?.dockFile,
        });
        event.source.postMessage({ channel: 'slipi-app', type: 'response', requestId: message.requestId, windowId }, '*');
      }
      else if (message.type === 'close') closeWindow(id);
      else if (message.type === 'minimize') minimizeWindow(id);
      else if (message.type === 'maximize') toggleMaximize(id);
      else if (message.type === 'resize') resizeWindow(id, message.width, message.height);
      else if (message.type === 'set-title' && typeof message.title === 'string') {
        setWindows((current) => current.map((item) => item.id === id ? { ...item, title: message.title.slice(0, 120) } : item));
      } else if (message.type === 'set-icon' && typeof message.icon === 'string') {
        setWindows((current) => current.map((item) => item.id === id ? { ...item, icon: message.icon } : item));
      }
    }
    function resizeWindows() {
      const area = workspaceRef.current.getBoundingClientRect();
      setWindows((current) => current.map((item) => item.maximized
        ? { ...item, x: 0, y: 0, width: area.width, height: area.height }
        : {
          ...item,
          x: Math.max(0, Math.min(item.x, area.width - 100)),
          y: Math.max(0, Math.min(item.y, area.height - 34)),
          width: Math.min(item.width, area.width),
          height: Math.min(item.height, area.height),
        }));
    }
    window.addEventListener('message', handleAppMessage);
    window.addEventListener('resize', resizeWindows);
    return () => {
      window.clearInterval(dockTimer);
      window.removeEventListener('message', handleAppMessage);
      window.removeEventListener('resize', resizeWindows);
    };
  }, []);

  function launchDockEntry(entry) {
    if (entry.exec === 'builtin:xelite') {
      openFileManager('/', entry.file);
      return;
    }
    const source = entry.exec.startsWith('/')
      ? `WebOS filesystem${entry.exec}`
      : entry.exec.startsWith('WebOS filesystem/') || /^https?:\/\//i.test(entry.exec)
        ? entry.exec
        : `WebOS filesystem/${entry.exec}`;
    openApp(source, { title: entry.name, icon: entry.icon, windowSize: entry.windowSize, dockFile: entry.file });
  }

  useEffect(() => {
    window.WebOS = {
      openApp,
      openWindow,
      openFileManager,
      getWindows: () => windowsRef.current.map(({ id, title, x, y, width, height, minimized, maximized }) => ({ id, title, x, y, width, height, minimized, maximized })),
      closeWindow,
      minimizeWindow,
      maximizeWindow: toggleMaximize,
      resizeWindow,
      filesystem: Object.freeze({
        readdir: (path = '/') => fs.promises.readdir(path),
        stat: (path) => fs.promises.stat(path),
        readFile: (path, encoding) => fs.promises.readFile(path, encoding),
        writeFile: (path, data) => isReadOnlyPath(path) ? Promise.reject(new Error('System files are read-only')) : fs.promises.writeFile(path, data),
        mkdir: (path, options) => isReadOnlyPath(path) ? Promise.reject(new Error('System folders are read-only')) : fs.promises.mkdir(path, options),
        rename: (from, to) => isReadOnlyPath(from) || isReadOnlyPath(to) ? Promise.reject(new Error('System files are read-only')) : fs.promises.rename(from, to),
        remove: (path) => isReadOnlyPath(path) ? Promise.reject(new Error('System files are read-only')) : fs.promises.rm(path, { recursive: true, force: true }),
        isReadOnly: isReadOnlyPath,
      }),
    };
    return () => { delete window.WebOS; };
  }, []);

  function controlButton(item, action, icon, label) {
    return h('button', {
      key: action,
      type: 'button',
      className: action === 'close' ? 'close-control' : '',
      title: label,
      'aria-label': `${label} ${item.title}`,
      onPointerDown: (event) => event.stopPropagation(),
      onClick: () => action === 'close' ? closeWindow(item.id) : minimizeWindow(item.id),
    }, h('span', { className: `control-icon icon-${icon}`, 'aria-hidden': true }));
  }

  function dockGroup(entry) {
    const minimizedWindows = windows.filter((item) => item.dockFile === entry.file && item.minimized);
    return h('div', { className: 'dock-group', key: entry.file },
      minimizedWindows.length > 0 && h('div', { className: 'dock-previews', 'aria-label': `Minimized ${entry.name} windows` }, minimizedWindows.map((item) => h('div', { className: 'dock-preview', key: item.id },
        h('button', { className: 'dock-preview-open', type: 'button', title: `Restore ${item.title}`, onClick: () => focusWindow(item.id) },
          h('img', { src: item.icon || new URL(entry.icon, window.location.href).href, alt: '' }),
          h('span', null, item.title)),
        h('button', { className: 'dock-preview-close', type: 'button', title: `Close ${item.title}`, 'aria-label': `Close ${item.title}`, onClick: () => closeWindow(item.id) }, '×')))),
      h('button', {
        className: 'dock-item',
        type: 'button',
        title: entry.name,
        'aria-label': `Launch ${entry.name}`,
        onClick: () => launchDockEntry(entry),
      }, h('img', {
        src: new URL(entry.icon, window.location.href).href,
        alt: '',
        onError: (event) => { event.currentTarget.src = './WebOS filesystem/Icons/nuvola/32x32/places/folder.png'; },
      })));
  }

  return h('main', { className: 'desktop' },
    h('section', { className: 'workspace', ref: workspaceRef, 'aria-label': 'Desktop workspace' },
      windows.map((item) => h('section', {
        key: item.id,
        className: `window${item.minimized ? ' window-hidden' : ''}`,
        style: { left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex },
        'aria-label': item.title,
        onPointerDown: () => focusWindow(item.id),
      },
      h('header', {
        className: 'window-titlebar',
        onPointerDown: (event) => startPointer(event, item, 'drag'),
        onPointerMove: movePointer,
        onPointerUp: stopPointer,
        onPointerCancel: stopPointer,
        onDoubleClick: () => toggleMaximize(item.id),
      },
      item.icon && h('img', { className: 'window-app-icon', src: item.icon, alt: '' }),
      h('span', { className: 'window-title' }, item.title),
      h('div', { className: 'window-controls' },
        controlButton(item, 'minimize', 'minimize', 'Minimize'),
        controlButton(item, 'close', 'close', 'Close'))),
      h('div', { className: 'window-content' },
        item.src && h('iframe', {
          className: 'app-frame',
          src: item.src,
          title: item.title,
          'data-window-id': item.id,
        }),
        item.builtin === 'xelite' && h(Xelite, { fs, initialPath: item.initialPath }),
        item.builtin === 'kms' && h('canvas', {
          className: 'kms-canvas',
          width: item.canvasWidth,
          height: item.canvasHeight,
          'data-kms-window-id': item.id,
        })),
      !item.maximized && h('div', {
        className: 'resize-handle',
        role: 'separator',
        'aria-label': `Resize ${item.title}`,
        onPointerDown: (event) => startPointer(event, item, 'resize'),
        onPointerMove: movePointer,
        onPointerUp: stopPointer,
        onPointerCancel: stopPointer,
      })))),
    h('nav', { className: 'app-dock', 'aria-label': 'Application dock' }, dockEntries.map(dockGroup)));
}

initializeFilesystem((complete, total, phase) => {
  const bootStatus = document.querySelector('.boot-status');
  if (bootStatus) bootStatus.textContent = `${phase}: ${Math.floor(complete / total * 100)}%`;
}).then((fs) => {
  createRoot(document.getElementById('root')).render(h(App, { fs }));
}).catch((error) => {
  document.getElementById('root').textContent = `Filesystem startup failed: ${error.message}`;
});