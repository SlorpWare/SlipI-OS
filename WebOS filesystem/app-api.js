(function () {
  const params = new URLSearchParams(window.location.search);
  const sizeMatch = /^(\d{2,4})x(\d{2,4})$/i.exec(params.get('--window_size') || '');
  const flags = Object.freeze({
    isWindowed: params.has('--is_windowed'),
    windowId: Number(params.get('--window_id')) || null,
    windowSize: sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : null,
  });

  document.documentElement.classList.toggle('is-windowed', flags.isWindowed);
  let requestId = 0;
  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.channel !== 'slipi-app' || event.data.type !== 'response') return;
    const resolve = pendingRequests.get(event.data.requestId);
    if (!resolve) return;
    pendingRequests.delete(event.data.requestId);
    resolve(event.data);
  });

  function send(type, details = {}) {
    if (window.parent === window || !flags.windowId) return;
    window.parent.postMessage({ channel: 'slipi-app', type, ...details }, '*');
  }

  function request(type, details = {}) {
    if (window.parent === window || !flags.windowId) return Promise.reject(new Error('This app is not running in a WebOS window'));
    const id = `${flags.windowId}:${++requestId}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('WebOS host did not respond'));
      }, 10000);
      pendingRequests.set(id, (response) => {
        window.clearTimeout(timeout);
        resolve(response);
      });
      window.parent.postMessage({ channel: 'slipi-app', type, requestId: id, ...details }, '*');
    });
  }

  async function openKmsWindow(options = {}) {
    const response = await request('open-kms-window', options);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      function findCanvas() {
        const canvas = window.parent.document.querySelector(`canvas[data-kms-window-id="${response.windowId}"]`);
        if (canvas) resolve(canvas);
        else if (++attempts > 120) reject(new Error('KMS canvas window did not mount'));
        else window.requestAnimationFrame(findCanvas);
      }
      findCanvas();
    });
  }

  window.WebOSApp = Object.freeze({
    flags,
    openApp(path, options) {
      send('open-app', { src: new URL(path, window.location.href).href, options: options || {} });
    },
    openKmsWindow,
    close() { send('close'); },
    minimize() { send('minimize'); },
    maximize() { send('maximize'); },
    resize(width, height) { send('resize', { width, height }); },
    setTitle(title) { send('set-title', { title: String(title) }); },
    setIcon(path) { send('set-icon', { icon: new URL(path, window.location.href).href }); },
  });
})();