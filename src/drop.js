// The edge tab and the pin windows share this reader.
// dataTransfer can only be read while the drop event runs, so strings and File references
// must be read before the first await.

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
};

function guessMime(name) {
  return EXT_MIME[(name.split('.').pop() || '').toLowerCase()] || '';
}

function readDrop(dt) {
  const fileRefs = [...dt.files];
  const html = dt.getData('text/html');
  const uriList = dt.getData('text/uri-list');
  const text = dt.getData('text/plain');

  const urls = [];
  // For an image inside a link, uri-list holds the page URL, so try <img src> from the HTML first.
  if (html) {
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]');
    if (img) urls.push(img.getAttribute('src'));
  }
  const uri = uriList.split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  if (uri) urls.push(uri);
  if (text) urls.push(text);

  return (async () => {
    const files = [];
    for (const f of fileRefs) {
      const type = f.type || guessMime(f.name);
      if (!type.startsWith('image/')) continue;
      files.push({ name: f.name, type, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    return { files, urls: urls.map((u) => u.trim()).filter(Boolean) };
  })();
}

function hasDroppable(dt) {
  const types = [...dt.types];
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html')
    || types.includes('text/plain');
}
