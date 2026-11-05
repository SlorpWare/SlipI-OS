const systemDirectories = [
  '/Application files',
  '/Applications',
  '/Dock',
  '/Linux files',
  '/Public',
  '/Trash',
];
const readOnlyRoots = ['/Application files', '/Applications', '/Icons', '/Linux files'];
const previousSeedMarkers = ['/.webos-filesystem-seeded-v1', '/.webos-filesystem-seeded-v2'];
const seedMarker = '/.webos-filesystem-seeded-v3';

let initialization;

export function normalizeFilesystemPath(path) {
  const parts = [];
  for (const part of String(path).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export function isReadOnlyPath(path) {
  const normalized = normalizeFilesystemPath(path);
  return normalized === '/' || normalized === '/app-api.js' || readOnlyRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function ensureDirectory(fs, path, mkdirSync = fs.mkdirSync.bind(fs)) {
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += `/${part}`;
    if (!fs.existsSync(current)) mkdirSync(current);
  }
}

function removePath(fs, path) {
  if (!path || path === '/') throw new Error('Cannot remove the filesystem root');
  const stat = fs.statSync(path);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(path)) removePath(fs, `${path.replace(/\/$/, '')}/${name}`);
    fs.rmdirSync(path);
  } else {
    fs.unlinkSync(path);
  }
}

function callbackPromise(fs, method, args) {
  return new Promise((resolve, reject) => {
    fs[method](...args, (error, result) => error ? reject(error) : resolve(result));
  });
}

function waitForMirror(fs) {
  const mirror = typeof fs.getRootFS === 'function' ? fs.getRootFS() : fs;
  if (!mirror || !Array.isArray(mirror._queue)) return Promise.resolve();
  return new Promise((resolve) => {
    function checkQueue() {
      if (!mirror._queueRunning && mirror._queue.length === 0) resolve();
      else window.setTimeout(checkQueue, 20);
    }
    checkQueue();
  });
}

async function seedBundledTree(fs, Buffer, onProgress) {
  if (fs.existsSync(seedMarker)) return;
  const manifestResponse = await fetch(new URL('./filesystem-manifest.json', import.meta.url));
  if (!manifestResponse.ok) throw new Error(`Could not load filesystem manifest (${manifestResponse.status})`);
  const { files } = await manifestResponse.json();
  const sourceBase = new URL('./WebOS%20filesystem/', import.meta.url);
  let cursor = 0;
  let complete = 0;
  const concurrency = 12;

  async function worker() {
    while (cursor < files.length) {
      const relativePath = files[cursor++];
      const target = `/${relativePath}`;
      if (!fs.existsSync(target)) {
        const source = new URL(relativePath.split('/').map(encodeURIComponent).join('/'), sourceBase);
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Could not seed ${relativePath} (${response.status})`);
        const parent = target.slice(0, target.lastIndexOf('/')) || '/';
        ensureDirectory(fs, parent);
        fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      }
      complete++;
      if (complete % 40 === 0 || complete === files.length) onProgress?.(complete, files.length, 'Copying WebOS filesystem');
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  onProgress?.(files.length, files.length, 'Saving files to IndexedDB');
  await waitForMirror(fs);
  fs.writeFileSync(seedMarker, 'done');
  await waitForMirror(fs);
}

export function initializeFilesystem(onProgress) {
  if (!initialization) {
    initialization = (async () => {
      await new Promise((resolve, reject) => {
        window.BrowserFS.configure({
          fs: 'AsyncMirror',
          options: {
            sync: { fs: 'InMemory' },
            async: { fs: 'IndexedDB', options: { storeName: 'slipi-os-browserfs' } },
          },
        }, (error) => error ? reject(error) : resolve());
      });
      const fs = window.BrowserFS.BFSRequire('fs');
      const BrowserBuffer = window.BrowserFS.BFSRequire('buffer').Buffer;
      const baseMkdirSync = fs.mkdirSync.bind(fs);
      if (fs.existsSync('/Icons')) removePath(fs, '/Icons');
      for (const marker of previousSeedMarkers) {
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
      }
      for (const path of systemDirectories) ensureDirectory(fs, path, baseMkdirSync);
      fs.mkdirSync = (path, options) => options && typeof options === 'object' && options.recursive
        ? ensureDirectory(fs, path, baseMkdirSync)
        : baseMkdirSync(path, typeof options === 'number' ? options : undefined);
      fs.rmSync = (path) => removePath(fs, path);
      fs.Buffer = BrowserBuffer;
      fs.promises = {
        readdir: (path = '/') => callbackPromise(fs, 'readdir', [path]),
        stat: (path) => callbackPromise(fs, 'stat', [path]),
        readFile: (path, encoding) => callbackPromise(fs, 'readFile', encoding ? [path, encoding] : [path]),
        writeFile: (path, data, encoding) => {
          const contents = data instanceof Uint8Array && !(data instanceof BrowserBuffer) ? BrowserBuffer.from(data) : data;
          return callbackPromise(fs, 'writeFile', encoding ? [path, contents, encoding] : [path, contents]);
        },
        mkdir: (path) => new Promise((resolve, reject) => {
          try { ensureDirectory(fs, path); resolve(); } catch (error) { reject(error); }
        }),
        rename: (from, to) => callbackPromise(fs, 'rename', [from, to]),
        rm: (path) => Promise.resolve().then(() => removePath(fs, path)).then(() => waitForMirror(fs)),
        flush: () => waitForMirror(fs),
      };
      await seedBundledTree(fs, BrowserBuffer, onProgress);
      return fs;
    })();
  }
  return initialization;
}