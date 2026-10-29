const img = document.querySelector('img');
const flashEl = document.querySelector('.flash');
const closeBtn = document.querySelector('.close');
const body = document.body;

let objectUrl = null;
let flashTimer = 0;

function flash(text) {
  flashEl.textContent = text;
  flashEl.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flashEl.classList.remove('on'), 900);
}

pf.on('pin:image', ({ bytes, mime }) => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  img.onload = () => {
    // Some SVGs have no natural size, so use a default
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    pf.send('pin:ready', { w, h });
  };
  img.onerror = () => pf.send('pin:failed');
  img.src = objectUrl;
});

pf.on('pin:flash', flash);
pf.on('pin:through', (on) => { if (!on) flash('Clicks back on'); });
pf.on('pin:do', (action) => { if (action === 'copy') copyImage(); });

new ResizeObserver(() => body.classList.toggle('tiny', innerWidth < 90 || innerHeight < 60)).observe(body);

// --- Moving -------------------------------------------------------------------------

let dragging = false;
let moveQueued = false;

body.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.close')) return;
  dragging = true;
  body.setPointerCapture(e.pointerId);
  body.classList.add('dragging');
  pf.send('pin:drag-start');
});

body.addEventListener('pointermove', () => {
  if (!dragging || moveQueued) return;
  moveQueued = true;
  requestAnimationFrame(() => {
    moveQueued = false;
    if (dragging) pf.send('pin:drag-move');
  });
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  body.classList.remove('dragging');
  pf.send('pin:drag-end');
}
body.addEventListener('pointerup', endDrag);
body.addEventListener('pointercancel', endDrag);
body.addEventListener('lostpointercapture', endDrag);

// --- Size, opacity, keyboard --------------------------------------------------------

window.addEventListener('wheel', async (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    const op = await pf.invoke('pin:opacity', e.deltaY < 0 ? 0.05 : -0.05, true);
    if (op != null) flash(`${op}% opacity`);
  } else {
    const pct = await pf.invoke('pin:zoom', e.deltaY, e.clientX, e.clientY);
    if (pct != null) flash(`${pct}%`);
  }
}, { passive: false });

body.addEventListener('dblclick', async (e) => {
  if (e.target.closest('.close')) return;
  const pct = await pf.invoke('pin:actual-size');
  if (pct != null) flash(`${pct}%`);
});

body.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  pf.send('pin:menu');
});

closeBtn.addEventListener('click', () => pf.send('pin:close'));

window.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') return pf.send('pin:close');
  if (e.ctrlKey && e.key.toLowerCase() === 'c') return copyImage();

  // Digit keys set opacity: 1 = 10% up to 9 = 90%, 0 = 100%
  if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
    const v = e.key === '0' ? 1 : Number(e.key) / 10;
    const op = await pf.invoke('pin:opacity', v, false);
    return flash(`${op}% opacity`);
  }

  // Arrow keys help align overlays: 1px, or 10px with Shift
  const step = e.shiftKey ? 10 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key]) {
    e.preventDefault();
    pf.send('pin:nudge', ...arrows[e.key]);
  }
});

async function copyImage() {
  if (!img.naturalWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  await pf.invoke('pin:write-clipboard', new Uint8Array(await blob.arrayBuffer()));
  flash('Copied');
}

// --- An image dropped on a pin replaces its image ------------------------------------

body.addEventListener('dragenter', (e) => {
  if (!hasDroppable(e.dataTransfer)) return;
  e.preventDefault();
  body.classList.add('drop-over');
});
body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
body.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) body.classList.remove('drop-over');
});
body.addEventListener('drop', async (e) => {
  e.preventDefault();
  body.classList.remove('drop-over');
  pf.send('drop:payload', await readDrop(e.dataTransfer));
});
