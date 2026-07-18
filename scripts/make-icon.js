// One-off tool: converts lymologo.svg into a 256x256 transparent PNG.
// Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE = 256;
const svgPath = path.join(__dirname, '..', 'assets', 'lymologo.svg');
const outPath = path.join(__dirname, '..', 'assets', 'icon.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });

  // strip width/height attributes so CSS can fit and center it on the square canvas
  const svgContent = fs.readFileSync(svgPath, 'utf-8')
    .replace(/width="[^"]*" height="[^"]*" viewBox=/, 'viewBox=');
  const html = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    body{width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center}
    svg{max-width:${SIZE}px;max-height:${SIZE}px;display:block}
  </style></head><body>${svgContent}</body></html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // brief wait for the SVG to decode
  await new Promise((r) => setTimeout(r, 500));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(outPath, image.toPNG());
  console.log('written:', outPath, image.getSize());
  app.quit();
});
