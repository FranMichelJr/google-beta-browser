const refs = {
  addressBar: document.getElementById('address-bar'),
  addressForm: document.getElementById('address-form'),
  backButton: document.getElementById('back-button'),
  closeWindowButton: document.getElementById('close-window-button'),
  forwardButton: document.getElementById('forward-button'),
  maximizeWindowButton: document.getElementById('maximize-window-button'),
  minimizeWindowButton: document.getElementById('minimize-window-button'),
  newTabButton: document.getElementById('new-tab-button'),
  reloadButton: document.getElementById('reload-button'),
  tabs: document.getElementById('tabs'),
  titleBar: document.getElementById('window-titlebar'),
  topChrome: document.getElementById('top-chrome'),
};

let browserState = {
  activeTabId: null,
  tabs: [],
  window: {
    isMaximized: false,
  },
};

function getActiveTab() {
  return browserState.tabs.find((tab) => tab.id === browserState.activeTabId) || null;
}

function reportChromeHeight() {
  const height = refs.topChrome.getBoundingClientRect().height;
  window.browserAPI.setChromeHeight(height);
}

function updateControls() {
  const activeTab = getActiveTab();

  refs.backButton.disabled = !activeTab || !activeTab.canGoBack;
  refs.forwardButton.disabled = !activeTab || !activeTab.canGoForward;
  refs.reloadButton.disabled = !activeTab;
  refs.maximizeWindowButton.setAttribute(
    'aria-label',
    browserState.window && browserState.window.isMaximized ? 'Restore window' : 'Maximize window'
  );
  refs.maximizeWindowButton.classList.toggle(
    'is-restored',
    Boolean(browserState.window && browserState.window.isMaximized)
  );

  if (document.activeElement !== refs.addressBar) {
    refs.addressBar.value = activeTab ? activeTab.url : '';
  }
}

function createTabElement(tab) {
  const tabElement = document.createElement('div');
  tabElement.className = `tab${tab.id === browserState.activeTabId ? ' active' : ''}${
    tab.isLoading ? ' is-loading' : ''
  }`;

  const selectButton = document.createElement('button');
  selectButton.className = 'tab-select';
  selectButton.type = 'button';
  selectButton.textContent = tab.title || 'New Tab';
  selectButton.title = tab.url || tab.title || 'New Tab';
  selectButton.addEventListener('click', () => {
    window.browserAPI.switchTab(tab.id);
  });

  const closeButton = document.createElement('button');
  closeButton.className = 'tab-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    window.browserAPI.closeTab(tab.id);
  });

  tabElement.appendChild(selectButton);
  tabElement.appendChild(closeButton);
  return tabElement;
}

function renderTabs() {
  refs.tabs.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (const tab of browserState.tabs) {
    fragment.appendChild(createTabElement(tab));
  }

  refs.tabs.appendChild(fragment);
}

function applyState(nextState) {
  browserState = nextState;
  renderTabs();
  updateControls();
}

function navigateFromAddressBar() {
  window.browserAPI.navigate(refs.addressBar.value.trim());
}

function handleKeyboardShortcuts(event) {
  const primaryModifier = event.ctrlKey || event.metaKey;

  if (primaryModifier && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    refs.addressBar.focus();
    refs.addressBar.select();
    return;
  }

  if (primaryModifier && event.key.toLowerCase() === 't') {
    event.preventDefault();
    window.browserAPI.createTab();
    return;
  }

  if (primaryModifier && event.key.toLowerCase() === 'w') {
    const activeTab = getActiveTab();
    if (!activeTab) {
      return;
    }

    event.preventDefault();
    window.browserAPI.closeTab(activeTab.id);
    return;
  }

  if ((primaryModifier && event.key.toLowerCase() === 'r') || event.key === 'F5') {
    event.preventDefault();
    window.browserAPI.reload();
    return;
  }

  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    window.browserAPI.goBack();
    return;
  }

  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    window.browserAPI.goForward();
  }
}

async function init() {
  refs.newTabButton.addEventListener('click', () => {
    window.browserAPI.createTab();
  });
  refs.minimizeWindowButton.addEventListener('click', () => {
    window.browserAPI.minimizeWindow();
  });
  refs.maximizeWindowButton.addEventListener('click', () => {
    window.browserAPI.toggleMaximizeWindow();
  });
  refs.closeWindowButton.addEventListener('click', () => {
    window.browserAPI.closeWindow();
  });
  refs.backButton.addEventListener('click', () => {
    window.browserAPI.goBack();
  });
  refs.forwardButton.addEventListener('click', () => {
    window.browserAPI.goForward();
  });
  refs.reloadButton.addEventListener('click', () => {
    window.browserAPI.reload();
  });
  refs.addressBar.addEventListener('focus', () => {
    refs.addressBar.select();
  });
  refs.addressBar.addEventListener('blur', updateControls);
  refs.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    navigateFromAddressBar();
  });
  refs.titleBar.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) {
      return;
    }

    window.browserAPI.toggleMaximizeWindow();
  });
  document.addEventListener('keydown', handleKeyboardShortcuts);

  const resizeObserver = new ResizeObserver(() => {
    reportChromeHeight();
  });
  resizeObserver.observe(refs.topChrome);
  window.addEventListener('resize', reportChromeHeight);

  const initialState = await window.browserAPI.getState();
  applyState(initialState);
  window.browserAPI.onState((state) => {
    applyState(state);
  });
  reportChromeHeight();
}

init();
