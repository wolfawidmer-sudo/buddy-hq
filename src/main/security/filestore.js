'use strict';

// Kleine JSON-Dateien im App-Datenordner, atomar geschrieben (erst .tmp, dann umbenennen).

const fs = require('node:fs');
const path = require('node:path');

class JsonFile {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read(fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw new Error(`Datei beschädigt: ${path.basename(this.filePath)}`);
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  delete() {
    fs.rmSync(this.filePath, { force: true });
  }

  exists() {
    return fs.existsSync(this.filePath);
  }
}

module.exports = { JsonFile };
