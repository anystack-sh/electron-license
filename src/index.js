'use strict';

const { BrowserWindow } = require('electron');
// import {machineIdSync} from 'node-machine-id';
const {machineIdSync} = require('node-machine-id');

module.exports = class Unlock {
  constructor(config) {
      this.config = config;
  }

  hasActiveLicense() {

      // Create the browser window.
      const mainWindow = new BrowserWindow({
        width: 400,
        height: 500,
        alwaysOnTop: true,
        resizable: false,
        minimizable: false,
        titleBarStyle: 'hidden',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        }
      });

      // and load the index.html of the app.
      mainWindow.loadFile(`${__dirname}/../../node_modules/unlock-electron-license/src/app.html`, {query: {"data": JSON.stringify(this.config)}});

      // Open the DevTools.
      mainWindow.webContents.openDevTools();
  }
}
