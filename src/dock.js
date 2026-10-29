const body = document.body;
let leaveTimer = 0;

const setState = (s) => {
  if (body.dataset.state === s) return;
  body.dataset.state = s;
  pf.send('dock:state', s);
};

pf.on('dock:state', (s) => { body.dataset.state = s; body.classList.remove('over'); });
pf.on('dock:side', (side) => { body.dataset.side = side; });

body.addEventListener('mouseenter', () => { if (body.dataset.state === 'thin') setState('peek'); });
body.addEventListener('mouseleave', () => { if (body.dataset.state === 'peek') setState('thin'); });
body.addEventListener('click', () => { if (body.dataset.state === 'peek') pf.send('clipboard:pin'); });
body.addEventListener('contextmenu', (e) => { e.preventDefault(); pf.send('dock:menu'); });

body.addEventListener('dragenter', (e) => {
  if (!hasDroppable(e.dataTransfer)) return;
  e.preventDefault();
  clearTimeout(leaveTimer);
  setState('open');
  body.classList.add('over');
});

body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  clearTimeout(leaveTimer);
  body.classList.add('over');
});

// dragleave also fires when moving between child elements, so only close if no dragover follows.
body.addEventListener('dragleave', () => {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => setState('thin'), 120);
});

body.addEventListener('drop', async (e) => {
  e.preventDefault();
  clearTimeout(leaveTimer);
  const payload = await readDrop(e.dataTransfer);
  pf.send('drop:payload', payload);
  setState('thin');
});
