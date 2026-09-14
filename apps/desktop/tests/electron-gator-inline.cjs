// Exercise the actual prepared token response in an isolated Electron session.
// No user profile, wallet, HTTP asset server, or public-chain write is involved.
const { app, BrowserWindow, session } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const root = process.env.KEEL_GATOR_VIEWER_PROOF_ROOT || resolve(__dirname, '../artifacts/gator-inline-sepolia/3750-shared-prepared');
const expectHiddenK = process.env.KEEL_GATOR_EXPECT_HIDDEN_K !== '0';
const timer = setTimeout(() => { console.error('Current Gator viewer timed out'); app.exit(1); }, 90000);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let win;
  try {
    const bytes = readFileSync(root + '/metadata-candidate.json');
    const acceptance = JSON.parse(readFileSync(root + (process.env.KEEL_GATOR_VIEWER_PROOF_ROOT ? '/preparation.json' : '/matrix-acceptance.json')));
    assert.equal('0x' + createHash('sha256').update(bytes).digest('hex'), acceptance.jsonDigest);
    const metadata = JSON.parse(bytes), errors = [], network = [];
    const isolated = session.fromPartition('gator-inline-proof-' + Date.now());
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const external = /^https?:/i.test(details.url);
      if (external) network.push(details.url);
      callback({ cancel: external });
    });
    win = new BrowserWindow({ show: false, width: 800, height: process.env.KEEL_GATOR_TEST_WIDE === '1' ? 450 : 800, webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadURL(metadata.animation_url);
    let png, frame;
    const started = Date.now();
    while (!png && Date.now() - started < 60000) {
      for (const child of win.webContents.mainFrame.framesInSubtree) {
        const result = await child.executeJavaScript(`(() => {
          const image = [...document.images].find(i => i.src.startsWith('data:image/png') && i.complete && i.naturalWidth);
          return image ? {src:image.src,width:image.naturalWidth,height:image.naturalHeight} : null;
        })()`).catch(() => null);
        if (result) { png = result; frame = child; break; }
      }
      if (!png) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(png, 'Verified HTML did not produce its PNG image');
    assert.equal(png.width, 3750); assert.equal(png.height, 3750);
    const imageBounds = await frame.executeJavaScript(`(() => {const r=document.querySelector('img').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()`);
    assert.ok(imageBounds.x >= -1 && imageBounds.y >= -1 && imageBounds.x + imageBounds.width <= imageBounds.viewportWidth + 1 && imageBounds.y + imageBounds.height <= imageBounds.viewportHeight + 1, 'Artwork is cropped in the viewer: ' + JSON.stringify(imageBounds));
    const shell = await win.webContents.executeJavaScript(`(() => {
      const corner=document.querySelector('.verify-corner'),seal=document.querySelector('.verify-seal');
      return {corner:!!corner,seal:!!seal,opacity:seal?getComputedStyle(seal).opacity:null,background:getComputedStyle(document.body).backgroundColor};
    })()`);
    assert.ok(shell.corner && shell.seal, 'Canonical K interface is missing');
    if (expectHiddenK) assert.equal(shell.opacity, '0', 'K should be hidden before interaction');
    const hit = await win.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('.verify-corner').getBoundingClientRect();
      return {x:Math.round(r.left+Math.min(8,r.width/2)),y:Math.round(r.bottom-Math.min(8,r.height/2))};
    })()`);
    win.webContents.sendInputEvent({type:'mouseMove',...hit});
    await new Promise(resolve => setTimeout(resolve, 500));
    const activeOpacity = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.verify-seal')).opacity`);
    assert.ok(Number(activeOpacity) > 0.9, 'K did not reveal on corner hover');
    win.webContents.sendInputEvent({type:'mouseMove',x:400,y:100});
    const comparison = await frame.executeJavaScript(`(async () => {
      const source=new Image();source.src=${JSON.stringify(metadata.image.startsWith('web3:') ? 'data:image/svg+xml;base64,' + readFileSync(root + '/image.svg').toString('base64') : metadata.image)};await source.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=3750;
      const context=canvas.getContext('2d');context.drawImage(source,0,0);
      const expected=context.getImageData(0,0,3750,3750).data;
      const actual=document.querySelector('canvas').getContext('2d').getImageData(0,0,3750,3750).data;
      let different=0,maxDelta=0,totalDelta=0;
      for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d)different++;maxDelta=Math.max(maxDelta,d);totalDelta+=d;}
      return {width:source.naturalWidth,height:source.naturalHeight,different,maxDelta,meanDelta:totalDelta/actual.length};
    })()`);
    assert.equal(comparison.width, 3750); assert.equal(comparison.height, 3750);
    writeFileSync(root + '/browser-comparison.json', JSON.stringify(comparison, null, 2));
    writeFileSync(root + '/browser-canvas.png', Buffer.from(png.src.split(',')[1], 'base64'));
    // Chromium's SVG and canvas raster paths round premultiplied alpha
    // differently. Permit one 8-bit color step, never a missing or shifted layer.
    assert.ok(comparison.maxDelta <= 1, 'SVG and HTML differ beyond one color step: ' + JSON.stringify(comparison));
    assert.deepEqual(network, [], 'Inline viewer attempted an external media request');
    assert.deepEqual(errors, [], 'Viewer reported a runtime error');
    writeFileSync(root + '/browser-viewer.png', (await win.webContents.capturePage()).toPNG());
    const report = { jsonDigest: acceptance.jsonDigest,
      htmlDigest: '0x' + createHash('sha256').update(Buffer.from(decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',')+1)))).digest('hex'),
      svgDigest: '0x' + createHash('sha256').update(readFileSync(root + '/image.svg')).digest('hex'),
      resolution: [3750,3750], htmlProducesPNG: true,
      canonicalKPresent: true, kHiddenAtRest: shell.opacity === '0', kRevealsOnCornerHover: Number(activeOpacity) > 0.9, externalRequests: 0, runtimeErrors: 0,
      svgCanvasComparison: comparison, publicChainVerified: false };
    writeFileSync(root + '/browser-acceptance.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); clearTimeout(timer); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); win?.destroy(); app.exit(1); }
});
