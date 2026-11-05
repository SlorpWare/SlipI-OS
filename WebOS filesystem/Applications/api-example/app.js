const launch = window.WebOSApp.flags;

document.getElementById('mode').textContent = launch.isWindowed ? 'Running in a managed window' : 'Running standalone';
document.getElementById('windowed-value').textContent = String(launch.isWindowed);
document.getElementById('size-value').textContent = launch.windowSize ? `${launch.windowSize.width} × ${launch.windowSize.height}` : 'Default';
document.getElementById('window-id-value').textContent = launch.windowId ?? 'None';

window.WebOSApp.setTitle('Application API Example');
window.WebOSApp.setIcon('../../Icons/nuvola/32x32/apps/kate.png');

document.getElementById('open-child').addEventListener('click', () => {
  window.WebOSApp.openApp('./index.html?--is_windowed&--window_size=420x300', { title: 'Child Example' });
});
document.getElementById('resize').addEventListener('click', () => window.WebOSApp.resize(480, 360));
document.getElementById('minimize').addEventListener('click', () => window.WebOSApp.minimize());
document.getElementById('close').addEventListener('click', () => window.WebOSApp.close());