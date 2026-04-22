const { spawn } = require('child_process');

const electronModule = require('electron');

if (typeof electronModule === 'string') {
  if (process.env.MI_BROWSER_ELECTRON_RELAUNCHED === '1') {
    console.error('Electron started in Node mode twice. Clear ELECTRON_RUN_AS_NODE and try again.');
    process.exit(1);
  }

  const childEnv = { ...process.env, MI_BROWSER_ELECTRON_RELAUNCHED: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  try {
    spawn(electronModule, [__dirname], {
      env: childEnv,
      stdio: 'inherit',
      windowsHide: false,
    });
  } catch (error) {
    console.error(`Unable to relaunch Electron: ${error.message}`);
    process.exit(1);
  }

  process.exit(0);
}

require('./app-main');
