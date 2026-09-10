const { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const express = require('express');
const Store = require('electron-store');

const HOST = '127.0.0.1';

app.setName('Vinyl Player');

const store = new Store({
  name: 'vinyl-player-config',
  defaults: {
    setupComplete: false,
    port: 3000,
    clientId: '',
    widgetBounds: null,
    widgetSize: 100,
    startMinimized: false,
    launchAtLogin: false,
    showInDock: true
  }
});

console.log('[config] Config file:', store.path);
console.log('[config] setupComplete:', store.get('setupComplete'));
console.log('[config] port:', store.get('port'));
console.log('[config] clientId:', store.get('clientId') ? '(set)' : '(empty)');
console.log('[config] showInDock:', store.get('showInDock'));

let tray = null;
let mainWindow = null;
let setupWindow = null;
let widgetWindow = null;
let server = null;
let serverPort = 3000;
let widgetMoveMode = false;
app.isQuitting = false;

const WIDGET_BASE_SIZE = 320;

// ── Local server ──────────────────────────────────────────────────────────
function startServer(port) {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    expressApp.use(express.static(path.join(__dirname, 'public')));

    let resolved = false;

    const attempt = (attemptPort, retriesLeft) => {
      const s = expressApp.listen(attemptPort, HOST, () => {
        server = s;
        serverPort = attemptPort;
        resolved = true;
        console.log(`[server] Vinyl Player running on http://${HOST}:${attemptPort}`);
        resolve();
      });

      s.on('error', (err) => {
        if (resolved) return;
        if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
          console.warn(`[server] Port ${attemptPort} in use — retrying in 500ms...`);
          setTimeout(() => attempt(attemptPort, retriesLeft - 1), 500);
        } else {
          console.error('[server] Could not start:', err);
          reject(err);
        }
      });
    };

    attempt(port, 3);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    try {
      s.close(() => resolve());
      setTimeout(resolve, 1000);
    } catch (e) {
      resolve();
    }
  });
}

// ── Error dialog ─────────────────────────────────────────────────────────
function showFatalError(title, message, detail) {
  try {
    dialog.showMessageBoxSync({
      type: 'error',
      title: title || 'Vinyl Player — Error',
      message: message || 'Something went wrong.',
      detail: detail || '',
      buttons: ['Quit'],
      defaultId: 0,
      noLink: true
    });
  } catch (e) {}
}

// ── Windows ──────────────────────────────────────────────────────────────
function baseWindowOptions(extra) {
  return Object.assign(
    {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: '#121212',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    },
    extra
  );
}

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow(
    baseWindowOptions({
      width: 720,
      height: 780,
      resizable: false,
      maximizable: false,
      fullscreenable: false
    })
  );

  setupWindow.loadURL(`http://${HOST}:${serverPort}/setup.html`);
  setupWindow.once('ready-to-show', () => setupWindow.show());

  setupWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('[setup] Failed to load:', code, desc, url);
    showFatalError(
      'Setup failed to load',
      'The setup wizard could not be loaded.',
      `URL: ${url}\nError: ${desc} (${code})\n\nMake sure port ${serverPort} is not blocked.`
    );
  });

  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!store.get('setupComplete') && !app.isQuitting) {
      app.isQuitting = true;
      app.quit();
    }
  });
}

function destroySetupWindow() {
  if (setupWindow) {
    const w = setupWindow;
    setupWindow = null;
    try { w.destroy(); } catch (e) {}
  }
}

function destroyMainWindow() {
  if (mainWindow) {
    const w = mainWindow;
    mainWindow = null;
    try { w.destroy(); } catch (e) {}
  }
}

function createMainWindow() {
  const clientId = store.get('clientId') || '';

  // Safety: mag nooit een player openen zonder Client ID
  if (!clientId) {
    console.log('[main] No Client ID configured — opening setup wizard instead');
    createSetupWindow();
    return;
  }

  const url = `http://${HOST}:${serverPort}/spotify.html?cid=${encodeURIComponent(clientId)}`;
  const logUrl = url.replace(/cid=[^&]*/, 'cid=' + (clientId ? '(set)' : '(empty)'));

  if (mainWindow) {
    console.log('[main] Main window exists, checking URL...');
    mainWindow.show();
    mainWindow.focus();

    const currentUrl = mainWindow.webContents.getURL();
    const expectedBase = `http://${HOST}:${serverPort}/spotify.html`;

    // Als de window op een andere pagina staat (bijv. /setup.html door een redirect),
    // forceer een herlaad met de juiste URL
    if (!currentUrl.startsWith(expectedBase)) {
      console.log('[main] Window showing wrong page, reloading:', logUrl);
      mainWindow.loadURL(url);
    }
    return;
  }

  console.log('[main] Creating new main window:', logUrl);

  mainWindow = new BrowserWindow(
    baseWindowOptions({
      width: 480,
      height: 760,
      minWidth: 380,
      minHeight: 560
    })
  );

  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('did-fail-load', (e, code, desc, failedUrl) => {
    console.error('[main] Failed to load:', code, desc, failedUrl);
    showFatalError(
      'Player failed to load',
      'Vinyl Player could not connect to its local server.',
      `URL: ${failedUrl}\nError: ${desc} (${code})\n\n` +
      `Try restarting the app. If the problem persists, the port (${serverPort}) may be blocked by another application.`
    );
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Widget Window ────────────────────────────────────────────────────────
function getWidgetPixelSize() {
  const pct = store.get('widgetSize') || 100;
  return Math.round(WIDGET_BASE_SIZE * (pct / 100));
}

function getDefaultWidgetPosition(size) {
  const { width: screenW } = screen.getPrimaryDisplay().bounds;
  const margin = 16;
  return { x: screenW - size - margin, y: margin };
}

function getSavedWidgetPosition(size) {
  const saved = store.get('widgetBounds');
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    return saved;
  }
  return getDefaultWidgetPosition(size);
}

function createWidgetWindow() {
  if (widgetWindow) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  const size = getWidgetPixelSize();
  const { x, y } = getSavedWidgetPosition(size);
  const clientId = store.get('clientId') || '';

  widgetWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.setPosition(x, y);
  widgetWindow.loadURL(`http://${HOST}:${serverPort}/widget.html?scale=${store.get('widgetSize') || 100}&cid=${encodeURIComponent(clientId)}`);
  widgetWindow.once('ready-to-show', () => widgetWindow.show());

  widgetWindow.on('moved', () => {
    if (widgetMoveMode && widgetWindow) {
      const [nx, ny] = widgetWindow.getPosition();
      store.set('widgetBounds', { x: nx, y: ny });
    }
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
    if (widgetMoveMode) {
      widgetMoveMode = false;
      rebuildTrayMenu();
    }
  });
}

function closeWidgetWindow() {
  if (widgetWindow) {
    widgetWindow.close();
    widgetWindow = null;
  }
}

function toggleWidgetMode() {
  const isOpen = !!widgetWindow;
  if (isOpen) {
    closeWidgetWindow();
  } else {
    createWidgetWindow();
    if (mainWindow) mainWindow.hide();
  }
  rebuildTrayMenu();
}

function setWidgetMoveMode(enabled) {
  if (!widgetWindow) return;
  widgetMoveMode = !!enabled;

  if (widgetMoveMode) {
    widgetWindow.setMovable(true);
    widgetWindow.setFocusable(true);
    widgetWindow.focus();
  } else {
    widgetWindow.setMovable(false);
    const [nx, ny] = widgetWindow.getPosition();
    store.set('widgetBounds', { x: nx, y: ny });
  }

  widgetWindow.webContents.send('widget-move-mode', widgetMoveMode);
  rebuildTrayMenu();
}

function toggleMoveMode() {
  setWidgetMoveMode(!widgetMoveMode);
}

function setWidgetSize(pct) {
  store.set('widgetSize', pct);

  if (widgetWindow) {
    const [oldX, oldY] = widgetWindow.getPosition();
    const oldSize = widgetWindow.getSize()[0];
    const centerX = oldX + oldSize / 2;
    const centerY = oldY + oldSize / 2;

    const newSize = getWidgetPixelSize();
    const newX = Math.round(centerX - newSize / 2);
    const newY = Math.round(centerY - newSize / 2);

    widgetWindow.setSize(newSize, newSize, true);
    widgetWindow.setPosition(newX, newY, true);
    store.set('widgetBounds', { x: newX, y: newY });

    const clientId = store.get('clientId') || '';
    widgetWindow.loadURL(`http://${HOST}:${serverPort}/widget.html?scale=${pct}&cid=${encodeURIComponent(clientId)}`);
  }
  rebuildTrayMenu();
}

function resetWidgetPosition() {
  const size = getWidgetPixelSize();
  const pos = getDefaultWidgetPosition(size);
  store.set('widgetBounds', pos);
  if (widgetWindow) {
    widgetWindow.setPosition(pos.x, pos.y);
  }
  rebuildTrayMenu();
}

function openApp() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (setupWindow) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  if (store.get('setupComplete') && store.get('clientId')) {
    createMainWindow();
  } else {
    createSetupWindow();
  }
}

// ── Launch at login ──────────────────────────────────────────────────────
function setLaunchAtLogin(enabled) {
  store.set('launchAtLogin', enabled);
  applyLoginItem(enabled);
  rebuildTrayMenu();
}

function applyLoginItem(enabled) {
  if (!app.isPackaged) return;

  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  } catch (err) {
    console.warn('Could not set login item:', err.message);
  }
}

// ── Start minimized ──────────────────────────────────────────────────────
function setStartMinimized(enabled) {
  store.set('startMinimized', enabled);
  rebuildTrayMenu();
}

// ── Show in Dock ─────────────────────────────────────────────────────────
function setShowInDock(enabled) {
  store.set('showInDock', enabled);
  applyDockVisibility(enabled);
  rebuildTrayMenu();
}

function applyDockVisibility(visible) {
  if (!app.dock) return;
  try {
    if (visible) {
      app.dock.show();
      console.log('[dock] Shown');
    } else {
      app.dock.hide();
      console.log('[dock] Hidden');
    }
  } catch (err) {
    console.warn('[dock] Failed to change visibility:', err.message);
  }
}

// ── Tray (menu bar) ──────────────────────────────────────────────────────
function rebuildTrayMenu() {
  if (!tray) return;

  const widgetEnabled = !!widgetWindow;
  const widgetSize = store.get('widgetSize') || 100;
  const startMin = store.get('startMinimized');
  const launchEnabled = store.get('launchAtLogin');
  const showInDock = store.get('showInDock');

  const sizeOptions = [75, 85, 100, 115, 125];

  const widgetSubmenu = [
    {
      label: 'Enable',
      type: 'checkbox',
      checked: widgetEnabled,
      click: () => toggleWidgetMode()
    },
    {
      label: 'Move',
      type: 'checkbox',
      checked: widgetMoveMode,
      enabled: widgetEnabled,
      click: () => toggleMoveMode()
    },
    { type: 'separator' },
    {
      label: 'Size',
      submenu: sizeOptions.map(pct => ({
        label: `${pct}%`,
        type: 'radio',
        checked: widgetSize === pct,
        click: () => setWidgetSize(pct)
      }))
    },
    { type: 'separator' },
    {
      label: 'Reset Position',
      enabled: widgetEnabled,
      click: () => resetWidgetPosition()
    }
  ];

  const settingsSubmenu = [
    {
      label: 'Start Minimized',
      type: 'checkbox',
      checked: startMin,
      click: () => setStartMinimized(!startMin)
    },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: launchEnabled,
      click: () => setLaunchAtLogin(!launchEnabled)
    },
    {
      label: 'Show in Dock',
      type: 'checkbox',
      checked: showInDock,
      click: () => setShowInDock(!showInDock)
    },
    { type: 'separator' },
    { label: 'Setup Wizard…', click: () => runSetupWizard() },
    { type: 'separator' },
    { label: 'Erase All Data…', click: () => confirmEraseAll() }
  ];

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Player', click: () => openApp() },
    { type: 'separator' },
    { label: 'Widget', submenu: widgetSubmenu },
    { label: 'Settings', submenu: settingsSubmenu },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);

  trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
  tray.setToolTip('Vinyl Player');

  rebuildTrayMenu();
}

// ── Setup wizard ─────────────────────────────────────────────────────────
async function runSetupWizard() {
  closeWidgetWindow();

  // Sluit zowel setup als main window — setup vervangt alles
  destroySetupWindow();
  destroyMainWindow();

  store.set('setupComplete', false);

  createSetupWindow();
  rebuildTrayMenu();
}

// Wordt aangeroepen vanuit setup.html wanneer de wizard klaar is
ipcMain.on('setup-complete', async (event, data) => {
  console.log('[setup] setup-complete received:', data);

  const {
    port,
    clientId,
    showInDock,
    startMinimized,
    launchAtLogin
  } = data || {};

  const chosenPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000;

  try {
    store.set('port', chosenPort);
    store.set('setupComplete', true);

    if (typeof clientId === 'string' && clientId.length > 0) {
      store.set('clientId', clientId);
    }

    if (typeof showInDock === 'boolean') {
      store.set('showInDock', showInDock);
      applyDockVisibility(showInDock);
    }

    if (typeof startMinimized === 'boolean') {
      store.set('startMinimized', startMinimized);
    }

    if (typeof launchAtLogin === 'boolean') {
      store.set('launchAtLogin', launchAtLogin);
      applyLoginItem(launchAtLogin);
    }

    console.log('[setup] Saved — verifying:');
    console.log('[setup]   setupComplete:', store.get('setupComplete'));
    console.log('[setup]   port:', store.get('port'));
    console.log('[setup]   clientId:', store.get('clientId') ? '(set)' : '(empty)');
    console.log('[setup]   showInDock:', store.get('showInDock'));
    console.log('[setup]   startMinimized:', store.get('startMinimized'));
    console.log('[setup]   launchAtLogin:', store.get('launchAtLogin'));
  } catch (err) {
    console.error('[setup] Failed to write config:', err);
    showFatalError(
      'Could not save settings',
      'Vinyl Player could not save your preferences.',
      `Error: ${err.message}\n\nThe config file may be locked or read-only.`
    );
    return;
  }

  // BELANGRIJK: sluit ALLE windows (setup én main als die op setup.html staat)
  console.log('[setup] Closing all windows before opening player');
  destroySetupWindow();
  destroyMainWindow();

  // Herstart server alleen als de poort is gewijzigd
  if (chosenPort !== serverPort) {
    console.log(`[setup] Restarting server on port ${chosenPort}`);
    await stopServer();
    try {
      await startServer(chosenPort);
    } catch (err) {
      console.error('[setup] Failed to restart server on new port:', err);
      showFatalError(
        'Could not start server',
        `Vinyl Player could not start on port ${chosenPort}.`,
        `The port may be in use by another application, or blocked by your firewall.\n\n` +
        `Try a different port via Settings → Setup Wizard.`
      );
      rebuildTrayMenu();
      return;
    }
  }

  // Open het hoofdvenster (tenzij "start minimized" gekozen is)
  if (!store.get('startMinimized')) {
    setTimeout(() => {
      console.log('[setup] Opening main window');
      createMainWindow();
    }, 300);
  }

  rebuildTrayMenu();
});

// Directe Dock toggle vanuit setup wizard (live preview)
ipcMain.on('set-dock-visibility', (event, visible) => {
  applyDockVisibility(!!visible);
});

// Check of een poort vrij is (voor de setup wizard)
ipcMain.handle('check-port', async (event, port) => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { available: false, error: 'invalid' };
  }

  return new Promise((resolve) => {
    const testServer = net.createServer();

    testServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ available: false, error: 'in-use' });
      } else {
        resolve({ available: false, error: 'unknown' });
      }
    });

    testServer.once('listening', () => {
      testServer.close(() => {
        resolve({ available: true });
      });
    });

    testServer.listen(port, HOST);
  });
});

ipcMain.handle('get-setup-info', () => {
  return {
    port: store.get('port') || 3000,
    clientId: store.get('clientId') || '',
    showInDock: store.get('showInDock'),
    startMinimized: store.get('startMinimized'),
    launchAtLogin: store.get('launchAtLogin')
  };
});

// ── Erase All Data ───────────────────────────────────────────────────────
function confirmEraseAll() {
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Cancel', 'Erase Everything'],
    defaultId: 0,
    cancelId: 0,
    title: 'Erase All Data',
    message: 'This will erase all data and sign you out of Spotify.',
    detail: 'Your settings, login, and cached data will be permanently removed. The app will restart as if freshly installed. This cannot be undone.',
    noLink: true
  });
  if (choice === 1) {
    eraseAll();
  }
}

async function eraseAll() {
  store.clear();
  try {
    await session.defaultSession.clearStorageData();
  } catch (err) {
    console.error('Failed to clear storage data:', err);
  }
  app.isQuitting = true;
  app.relaunch();
  app.exit(0);
}

// ── IPC from preload ─────────────────────────────────────────────────────
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) (win.isMaximized() ? win.unmaximize() : win.maximize());
});

ipcMain.on('set-hide-welcome', () => {
  store.set('setupComplete', true);
});

ipcMain.on('toggle-widget-mode', () => {
  toggleWidgetMode();
});

ipcMain.on('toggle-move-mode', () => {
  toggleMoveMode();
});

ipcMain.handle('get-widget-move-mode', () => widgetMoveMode);

// ── Single instance lock ─────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openApp();
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const showInDock = store.get('showInDock');
  console.log('[boot] Applying Dock visibility:', showInDock);
  applyDockVisibility(showInDock);

  const port = store.get('port') || 3000;

  try {
    await startServer(port);
  } catch (err) {
    console.error('Vinyl Player could not start its local server:', err);
    showFatalError(
      'Could not start local server',
      `Vinyl Player could not start on port ${port}.`,
      `The port may be in use by another application, or blocked by your firewall.\n\n` +
      `Try a different port via Settings → Setup Wizard.`
    );
  }

  applyLoginItem(store.get('launchAtLogin'));

  createTray();

  const setupComplete = store.get('setupComplete');
  const clientId = store.get('clientId') || '';

  console.log('[boot] setupComplete:', setupComplete);
  console.log('[boot] clientId:', clientId ? '(set)' : '(empty)');
  console.log('[boot] startMinimized:', store.get('startMinimized'));

  if (store.get('startMinimized')) {
    console.log('[boot] Start minimized — skipping window creation');
    return;
  }

  // Open player ALLEEN als zowel setupComplete als clientId er zijn
  if (setupComplete && clientId) {
    console.log('[boot] Setup complete with Client ID — opening player');
    createMainWindow();
  } else {
    console.log('[boot] Setup incomplete — opening setup wizard');
    createSetupWindow();
  }
});

app.on('window-all-closed', () => {
  // Never quit — menu bar app
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  if (server) {
    try { server.close(); } catch (e) {}
  }
});