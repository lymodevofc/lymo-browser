// One-off tool: measures the SVG content's actual bounding box (getBBox).
// Run: npx electron scripts/measure-bbox.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'assets', 'lymologo.svg');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const html = `<!DOCTYPE html><html><body>${svgContent}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const bbox = await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('svg').getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`
  );
  console.log(JSON.stringify(bbox));
  app.quit();
});
