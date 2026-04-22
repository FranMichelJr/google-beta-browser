const path = require('path');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserView,
  BrowserWindow,
  ipcMain,
  session,
} = require('electron');

const { DEFAULT_PORT, startProxyServer } = require('./server');

const HOME_FILE = path.join(__dirname, 'index.html');
const HOME_URL_OBJECT = pathToFileURL(HOME_FILE);
const HOME_URL = HOME_URL_OBJECT.toString();
const HOME_PATHNAME = HOME_URL_OBJECT.pathname;
const MIN_CHROME_HEIGHT = 78;
const DEFAULT_CHROME_HEIGHT = 108;

let chromeHeight = DEFAULT_CHROME_HEIGHT;
let mainWindow = null;
let proxyServerHandle = null;
let activeTabId = null;
let nextTabId = 1;
let ipcRegistered = false;

const tabs = new Map();
const tabOrder = [];

function parseInternalGoogleUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.pathname !== HOME_PATHNAME) {
      return null;
    }

    const query = (parsed.searchParams.get('q') || '').trim();
    const pageValue = Number.parseInt(parsed.searchParams.get('page') || '0', 10);

    return {
      url: parsed,
      query,
      page: Number.isNaN(pageValue) || pageValue < 0 ? 0 : pageValue,
    };
  } catch {
    return null;
  }
}

function isHomeUrl(url) {
  const internalPage = parseInternalGoogleUrl(url);
  return Boolean(internalPage && !internalPage.query);
}

function formatTitle(title, url) {
  if (title && title.trim()) {
    return title.trim().slice(0, 60);
  }

  const internalPage = parseInternalGoogleUrl(url);
  if (internalPage) {
    return internalPage.query ? `${internalPage.query} - Google!`.slice(0, 60) : 'Google!';
  }

  if (!url) {
    return 'New Tab';
  }

  try {
    return new URL(url).hostname;
  } catch {
    return 'New Tab';
  }
}

function formatDisplayUrl(url) {
  const internalPage = parseInternalGoogleUrl(url);
  if (internalPage) {
    return internalPage.query;
  }

  if (!url) {
    return '';
  }

  return url;
}

function buildInternalSearchUrl(query, page = 0) {
  const searchUrl = new URL(HOME_URL);
  searchUrl.searchParams.set('q', query);
  if (page > 0) {
    searchUrl.searchParams.set('page', String(page));
  }
  return searchUrl.toString();
}

function hasSupportedProtocol(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'file:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function looksLikeUrl(value) {
  if (!value || /\s/.test(value)) {
    return false;
  }

  return /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?)(\/.*)?$/i.test(
    value
  );
}

function parseNavigationInput(rawValue) {
  const value = String(rawValue || '').trim();

  if (!value || /^home$/i.test(value) || /^mi:\/\/home\/?$/i.test(value)) {
    return { kind: 'home' };
  }

  if (hasSupportedProtocol(value)) {
    return { kind: 'url', url: new URL(value).toString() };
  }

  if (looksLikeUrl(value)) {
    const scheme = /^(localhost|(\d{1,3}\.){3}\d{1,3})/i.test(value) ? 'http://' : 'https://';
    return { kind: 'url', url: new URL(`${scheme}${value}`).toString() };
  }

  return {
    kind: 'search',
    query: value,
    url: buildInternalSearchUrl(value),
  };
}

function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) || null : null;
}

function serializeTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isLoading: tab.isLoading,
  };
}

function serializeState() {
  return {
    activeTabId,
    tabs: tabOrder.map((tabId) => serializeTab(tabs.get(tabId))).filter(Boolean),
    window: {
      isMaximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
    },
  };
}

function sendState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('browser:state', serializeState());
}

function syncTabState(tab) {
  if (!tab || tab.view.webContents.isDestroyed()) {
    return;
  }

  const { webContents } = tab.view;
  const currentUrl = webContents.getURL();

  tab.url = formatDisplayUrl(currentUrl) || tab.url;
  tab.title = formatTitle(webContents.getTitle(), currentUrl);
  tab.canGoBack = webContents.canGoBack();
  tab.canGoForward = webContents.canGoForward();
  tab.isLoading = webContents.isLoading();

  if (isHomeUrl(currentUrl)) {
    tab.url = '';
  }

  sendState();
}

function handleNavigationFailure(tab, url, error) {
  if (!tab || !error || /ERR_ABORTED/i.test(error.message)) {
    return;
  }

  tab.isLoading = false;
  tab.url = formatDisplayUrl(url);
  tab.title = 'Unable to load page';
  sendState();
}

function updateBrowserBounds() {
  const activeTab = getActiveTab();
  if (!mainWindow || !activeTab) {
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  activeTab.view.setBounds({
    x: 0,
    y: chromeHeight,
    width,
    height: Math.max(0, height - chromeHeight),
  });
  activeTab.view.setAutoResize({ width: true, height: true });
}

function attachTab(tabId) {
  const tab = tabs.get(tabId);
  if (!mainWindow || !tab) {
    return;
  }

  for (const browserView of mainWindow.getBrowserViews()) {
    mainWindow.removeBrowserView(browserView);
  }

  activeTabId = tabId;
  mainWindow.addBrowserView(tab.view);
  updateBrowserBounds();
  tab.view.webContents.focus();
  syncTabState(tab);
}

function configureBrowserView(tab) {
  const { webContents } = tab.view;

  webContents.setWindowOpenHandler(({ url }) => {
    createTab(parseNavigationInput(url));
    return { action: 'deny' };
  });

  webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    syncTabState(tab);
  });
  webContents.on('did-start-loading', () => syncTabState(tab));
  webContents.on('did-stop-loading', () => syncTabState(tab));
  webContents.on('did-finish-load', () => syncTabState(tab));
  webContents.on('did-navigate', () => syncTabState(tab));
  webContents.on('did-navigate-in-page', () => syncTabState(tab));
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }

    handleNavigationFailure(tab, validatedURL, new Error(errorDescription));
  });
}

function navigateTab(tabId, targetInput) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  const target =
    typeof targetInput === 'string' || typeof targetInput === 'undefined'
      ? parseNavigationInput(targetInput)
      : targetInput;

  tab.isLoading = true;
  tab.canGoBack = tab.view.webContents.canGoBack();
  tab.canGoForward = tab.view.webContents.canGoForward();

  if (target.kind === 'home') {
    tab.url = '';
    tab.title = 'Google!';
    sendState();
    tab.view.webContents.loadFile(HOME_FILE).catch((error) => {
      handleNavigationFailure(tab, HOME_URL, error);
    });
    return;
  }

  if (target.kind === 'search') {
    tab.url = target.query;
    tab.title = `${target.query} - Google!`.slice(0, 60);
    sendState();

    tab.view.webContents.loadURL(target.url).catch((error) => {
      handleNavigationFailure(tab, target.url, error);
    });
    return;
  }

  tab.url = formatDisplayUrl(target.url) || target.url;
  tab.title = formatTitle('', target.url);
  sendState();

  tab.view.webContents.loadURL(target.url).catch((error) => {
    handleNavigationFailure(tab, target.url, error);
  });
}

function createTab(target = { kind: 'home' }) {
  const tabId = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const tab = {
    id: tabId,
    view,
    title: 'New Tab',
    url: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  };

  tabs.set(tabId, tab);
  tabOrder.push(tabId);
  configureBrowserView(tab);
  attachTab(tabId);
  navigateTab(tabId, target);
  sendState();

  return tabId;
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  const wasActive = tabId === activeTabId;
  const closedIndex = tabOrder.indexOf(tabId);

  if (mainWindow && mainWindow.getBrowserViews().includes(tab.view)) {
    mainWindow.removeBrowserView(tab.view);
  }

  tab.view.webContents.destroy();
  tabs.delete(tabId);

  if (closedIndex >= 0) {
    tabOrder.splice(closedIndex, 1);
  }

  if (!tabOrder.length) {
    activeTabId = null;
    createTab({ kind: 'home' });
    return;
  }

  if (wasActive) {
    const nextIndex = Math.max(0, closedIndex - 1);
    attachTab(tabOrder[nextIndex]);
    return;
  }

  sendState();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#c0c0c0',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.on('resize', updateBrowserBounds);
  mainWindow.on('maximize', updateBrowserBounds);
  mainWindow.on('unmaximize', updateBrowserBounds);
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);
  mainWindow.on('restore', sendState);

  mainWindow.loadFile(path.join(__dirname, 'browser.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    if (!tabOrder.length) {
      createTab({ kind: 'home' });
      return;
    }

    attachTab(activeTabId || tabOrder[0]);
    sendState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  if (ipcRegistered) {
    return;
  }

  ipcRegistered = true;

  ipcMain.handle('browser:get-state', () => serializeState());
  ipcMain.handle('browser:new-tab', (_event, initialInput) => {
    createTab(parseNavigationInput(initialInput));
    return serializeState();
  });
  ipcMain.handle('browser:switch-tab', (_event, tabId) => {
    attachTab(Number(tabId));
    return serializeState();
  });
  ipcMain.handle('browser:close-tab', (_event, tabId) => {
    closeTab(Number(tabId));
    return serializeState();
  });
  ipcMain.handle('browser:navigate', (_event, input) => {
    if (activeTabId) {
      navigateTab(activeTabId, input);
    }
    return serializeState();
  });
  ipcMain.handle('browser:back', () => {
    const tab = getActiveTab();
    if (tab && tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
    return serializeState();
  });
  ipcMain.handle('browser:forward', () => {
    const tab = getActiveTab();
    if (tab && tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
    return serializeState();
  });
  ipcMain.handle('browser:reload', () => {
    const tab = getActiveTab();
    if (tab) {
      tab.view.webContents.reload();
    }
    return serializeState();
  });
  ipcMain.handle('browser:window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
    return serializeState();
  });
  ipcMain.handle('browser:window-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
    return serializeState();
  });
  ipcMain.handle('browser:window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return serializeState();
  });
  ipcMain.on('browser:set-chrome-height', (_event, height) => {
    if (!Number.isFinite(height)) {
      return;
    }

    chromeHeight = Math.max(MIN_CHROME_HEIGHT, Math.round(height));
    updateBrowserBounds();
  });
}

async function bootstrap() {
  await app.whenReady();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  proxyServerHandle = await startProxyServer({ port: DEFAULT_PORT });
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (proxyServerHandle && proxyServerHandle.server) {
    proxyServerHandle.server.close();
  }
});

bootstrap().catch((error) => {
  console.error(`Unable to start Mi Browser: ${error.message}`);
  app.quit();
});
