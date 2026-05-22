const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { shortStorySelectors } = require('./selectors.js');
const logger = require('../logger.js');

const FANQIE_DASHBOARD_URL = 'https://fanqienovel.com/writer/zone/';
const DEFAULT_PROFILE_DIR = path.join(
  process.env.APPDATA || path.resolve(__dirname, '..', '..', '..', 'electron'),
  'fanqie-uploader',
  'browserProfile'
);
const DEFAULT_SCREENSHOT_DIR = path.join(logger.logsDir, 'screenshots');

function findInstalledBrowser() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];

  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate)) || '';
}

function tidyTitleText(value) {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateTimeForInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const pad = (number) => String(numb