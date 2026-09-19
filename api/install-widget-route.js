'use strict';
// Run once from the repository root: node api/install-widget-route.js
// This script makes two exact, guarded edits to api/index.js. Review the diff before committing.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'index.js');
const source = fs.readFileSync(file, 'utf8');
const importAnchor = "const { router: bakeSessionsRouter, setPool: setBakeSessionsPool } = require('./bake-sessions');";
const importLine = "const { createWidgetRouter } = require('./widget-status');";
const authAnchor = 'app.use(authenticateToken);';
const routeLine = "app.use('/api/widget', createWidgetRouter(pool));";
if (source.includes(importLine) && source.includes(routeLine)) {
  console.log('Widget route already installed.');
  process.exit(0);
}
if (source.includes(importLine) || source.includes(routeLine) ||
    source.split(importAnchor).length !== 2 || source.split(authAnchor).length !== 2) {
  console.error('Expected anchors missing or partial installation detected; no changes made.');
  process.exit(1);
}
const updated = source.replace(importAnchor, `${importAnchor}\n${importLine}`)
  .replace(authAnchor, `${routeLine}\n${authAnchor}`);
fs.writeFileSync(file, updated);
console.log('Widget route installed in api/index.js. Review with git diff.');
