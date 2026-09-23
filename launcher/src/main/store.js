// Settings persistence: <userData>/settings.json, atomic writes, corrupted files are set aside.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeSettings } = require('./lib/settings');

class SettingsStore {
  constructor(dir, log) {
    this.file = path.join(dir, 'settings.json');
    this.log = log;
    this.data = this.load();
    this.timer = null;
  }

  load() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.log?.warn(`settings.json illisible (${err.message}), réglages par défaut`);
        try {
          fs.renameSync(this.file, this.file + '.corrompu');
        } catch { /* nothing to keep */ }
      }
    }
    return sanitizeSettings(raw);
  }

  get() {
    return this.data;
  }

  set(next) {
    this.data = sanitizeSettings(next);
    this.saveSoon();
    return this.data;
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.error(`impossible d'enregistrer les réglages : ${err.message}`);
    }
  }
}

module.exports = { SettingsStore };
