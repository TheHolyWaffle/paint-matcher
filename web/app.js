(() => {
  const { parseHex, rgbToHex, hexToLab, deltaE2000, relLuminance, oklchToHex } = window.ColorMath;
  const DATA = window.PAINTS || { boss: [], levis: [], levisTypeOrder: [] };
  const $ = id => document.getElementById(id);
  const UNGROUPED = 'Zonder groep';

  for (const c of [...DATA.boss, ...DATA.levis]) c.lab = hexToLab(c.hex);

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem('paint-matcher:' + key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('paint-matcher:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  const savedFilters = store.get('filters', {});
  const filters = {
    boss: {
      groups: new Set(savedFilters.boss?.groups || []),
      systems: new Set(savedFilters.boss?.systems || []),
      trending: !!savedFilters.boss?.trending,
      types: new Set(savedFilters.boss?.types || []),
      products: new Set(savedFilters.boss?.products || []),
    },
    levis: {
      types: new Set(savedFilters.levis?.types || []),
      collections: new Set(savedFilters.levis?.collections || []),
      hues: new Set(savedFilters.levis?.hues || []),
      products: new Set(savedFilters.levis?.products || []),
    },
  };
  let target = null;
  let recent = store.get('recent', []);
  let limit = Number(store.get('limit', 12));

  function saveFilters() {
    const plain = {};
    for (const [brand, f] of Object.entries(filters)) {
      plain[brand] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v instanceof Set ? [...v] : v]));
    }
    store.set('filters', plain);
  }

  // ---------- Filters ----------

  function countBy(list, keysOf) {
    const counts = new Map();
    for (const c of list) for (const k of keysOf(c)) counts.set(k, (counts.get(k) || 0) + 1);
    return counts;
  }

  function renderChips(container, counts, set, order) {
    const keys = order ? order.filter(k => counts.has(k)) : [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    container.replaceChildren(...keys.map(k => {
      const label = document.createElement('label');
      label.className = 'chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = set.has(k);
      input.addEventListener('change', () => {
        input.checked ? set.add(k) : set.delete(k);
        onFiltersChanged();
      });
      const count = document.createElement('small');
      count.textContent = counts.get(k);
      label.append(input, document.createTextNode(k), count);
      return label;
    }));
  }

  const bossGroupsOf = c => (c.groups.length ? c.groups : [UNGROUPED]);
  const BOSS_GROUP_ORDER = ['Wit', 'Beige', 'Geel', 'Oranje', 'Rood', 'Paars', 'Blauw', 'Blauw-Groen', 'Groen', 'Bruin', 'Grijs', 'Zwart', UNGROUPED];
  const LEVIS_HUE_ORDER = ['Rood', 'Oranje', 'Goud', 'Geel', 'Limoen', 'Groen', 'Blauwgroen', 'Blauw', 'Paars', 'Wit', 'Warm neutraal', 'Koel neutraal', 'Grijs'];

  function buildFilterUI() {
    renderChips($('boss-groups'), countBy(DATA.boss, bossGroupsOf), filters.boss.groups, BOSS_GROUP_ORDER);
    renderChips($('boss-systems'), countBy(DATA.boss, c => [c.system]), filters.boss.systems);
    $('boss-trending').checked = filters.boss.trending;
    renderChips($('boss-types'), countBy(DATA.boss, c => c.types || []), filters.boss.types);

    renderChips($('levis-types'), countBy(DATA.levis, c => c.types), filters.levis.types, DATA.levisTypeOrder);
    renderChips($('levis-collections'), countBy(DATA.levis, c => c.collections), filters.levis.collections);
    const hueCounts = countBy(DATA.levis, c => (c.hue ? [c.hue] : []));
    renderChips($('levis-hues'), hueCounts, filters.levis.hues, [...LEVIS_HUE_ORDER, ...[...hueCounts.keys()].filter(h => !LEVIS_HUE_ORDER.includes(h))]);
    renderProductList('boss');
    renderProductList('levis');
  }

  function renderProductList(brand) {
    const q = $(`${brand}-product-search`).value.trim().toLowerCase();
    const counts = countBy(DATA[brand], c => c.products || []);
    const names = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'nl'));
    const set = filters[brand].products;
    $(`${brand}-products`).replaceChildren(...names.filter(n => !q || n.toLowerCase().includes(q)).map(n => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = set.has(n);
      input.addEventListener('change', () => {
        input.checked ? set.add(n) : set.delete(n);
        onFiltersChanged();
      });
      const count = document.createElement('small');
      count.textContent = counts.get(n);
      label.append(input, document.createTextNode(n), count);
      return label;
    }));
  }

  const anyOf = (set, values) => set.size === 0 || values.some(v => set.has(v));

  // Pairings deliberately look outside the chosen hue, so they skip the hue filters.
  const passesIgnoringHue = {
    boss: c => {
      const f = filters.boss;
      return anyOf(f.systems, [c.system]) && (!f.trending || c.trending)
        && anyOf(f.types, c.types || []) && anyOf(f.products, c.products || []);
    },
    levis: c => {
      const f = filters.levis;
      return anyOf(f.types, c.types) && anyOf(f.collections, c.collections) && anyOf(f.products, c.products);
    },
  };
  const bossPasses = c => anyOf(filters.boss.groups, bossGroupsOf(c)) && passesIgnoringHue.boss(c);
  const levisPasses = c => anyOf(filters.levis.hues, c.hue ? [c.hue] : []) && passesIgnoringHue.levis(c);

  function activeCount(f) {
    return Object.values(f).reduce((n, v) => n + (v instanceof Set ? v.size : v ? 1 : 0), 0);
  }

  function onFiltersChanged() {
    saveFilters();
    for (const brand of ['boss', 'levis']) {
      const n = activeCount(filters[brand]);
      $(`${brand}-active`).textContent = n ? `${n} active` : '';
    }
    renderResults();
    renderPairings();
  }

  document.querySelectorAll('[data-reset]').forEach(btn => btn.addEventListener('click', () => {
    const f = filters[btn.dataset.reset];
    for (const k of Object.keys(f)) f[k] instanceof Set ? f[k].clear() : (f[k] = false);
    $(`${btn.dataset.reset}-product-search`).value = '';
    buildFilterUI();
    onFiltersChanged();
  }));
  $('boss-trending').addEventListener('change', e => { filters.boss.trending = e.target.checked; onFiltersChanged(); });
  for (const brand of ['boss', 'levis']) $(`${brand}-product-search`).addEventListener('input', () => renderProductList(brand));

  // ---------- Results ----------

  function verdict(de) {
    if (de < 1) return 'Indistinguishable';
    if (de < 2) return 'Barely visible';
    if (de < 3.5) return 'Slight difference';
    if (de < 5) return 'Noticeable';
    return 'Clearly different';
  }

  function inkFor(hex) {
    return relLuminance(hex) > 0.36 ? '#1C1C1C' : '#F4F4F2';
  }

  function resultItem(c, de, brand) {
    const li = document.createElement('li');
    const a = document.createElement(c.url ? 'a' : 'div');
    a.className = 'strip';
    if (c.url) { a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; }

    const seam = document.createElement('div');
    seam.className = 'seam';
    seam.style.setProperty('--paint', c.hex);
    seam.title = `Your color ${target.hex} beside ${c.hex}`;

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('strong');
    name.textContent = c.name;
    const sub = document.createElement('span');
    sub.className = 'sub';
    const details = brand === 'boss'
      ? [c.code !== c.name ? c.code : null, c.hex, c.groups.join(', ') || null, c.trending ? 'Trending' : null]
      : [c.hex, c.hue, c.collections.filter(x => x !== 'Overige').join(', ') || null];
    sub.textContent = details.filter(Boolean).join('  ·  ');
    info.append(name, sub);
    if (c.products?.length) {
      const prod = document.createElement('span');
      prod.className = 'products-line';
      prod.textContent = `${c.products.length} product${c.products.length === 1 ? '' : 's'}: ${c.types.join(', ')}`;
      prod.title = c.products.join('\n');
      info.append(prod);
    }

    const score = document.createElement('div');
    score.className = 'score';
    score.innerHTML = `<b>${de.toFixed(2)}</b><small>${verdict(de)}</small>`;

    a.append(seam, info, score);
    li.append(a);
    return li;
  }

  function renderBrand(brand, passes) {
    const list = DATA[brand];
    const pool = list.filter(passes);
    $(`${brand}-count`).textContent = `${pool.length.toLocaleString('en')} of ${list.length.toLocaleString('en')} colors`;
    const ol = $(`${brand}-results`);
    if (!list.length) {
      ol.replaceChildren(emptyNote(`No ${brand === 'boss' ? 'Boss Paints' : 'Levis'} data. Run scripts/update.sh to download it.`));
      return;
    }
    if (!target) {
      ol.replaceChildren(emptyNote('Pick a color to see the closest paints.'));
      return;
    }
    if (!pool.length) {
      ol.replaceChildren(emptyNote('No colors match these filters. Clear a filter to widen the search.'));
      return;
    }
    const ranked = pool.map(c => [c, deltaE2000(target.lab, c.lab)]).sort((x, y) => x[1] - y[1]).slice(0, limit);
    ol.replaceChildren(...ranked.map(([c, de]) => resultItem(c, de, brand)));
  }

  function emptyNote(text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    return li;
  }

  function renderResults() {
    renderBrand('boss', bossPasses);
    renderBrand('levis', levisPasses);
  }

  $('limit').value = String(limit);
  $('limit').addEventListener('change', e => { limit = Number(e.target.value); store.set('limit', limit); renderResults(); });

  // ---------- Target ----------

  function setTarget(hex, origin, { remember = true, paint = null } = {}) {
    const clean = parseHex(hex);
    if (!clean) return;
    target = { hex: clean, lab: hexToLab(clean), origin, paint };
    document.documentElement.style.setProperty('--target', clean);
    document.documentElement.style.setProperty('--target-ink', inkFor(clean));
    $('target-hex').textContent = clean;
    $('target-origin').textContent = origin;
    $('hex-input').value = clean;
    $('color-input').value = clean.toLowerCase();
    $('hex-input').removeAttribute('aria-invalid');
    window.history.replaceState(null, '', '#' + (paint || clean.slice(1)));
    if (remember) rememberPick(clean, origin, paint);
    renderResults();
    renderCompare();
    renderPairings();
  }

  function rememberPick(hex, origin, paint) {
    recent = [{ hex, origin, paint }, ...recent.filter(h => h.hex !== hex)].slice(0, 10);
    store.set('recent', recent);
    renderHistory();
  }

  function renderHistory() {
    $('history-wrap').hidden = recent.length === 0;
    $('history').replaceChildren(...recent.map(h => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--c', h.hex);
      b.title = `${h.hex}: ${h.origin}`;
      b.setAttribute('aria-label', `Use ${h.hex}`);
      b.addEventListener('click', () => setTarget(h.hex, h.origin, { remember: false, paint: h.paint }));
      li.append(b);
      return li;
    }));
  }

  $('target-form').addEventListener('submit', e => {
    e.preventDefault();
    const hex = parseHex($('hex-input').value);
    if (hex) setTarget(hex, 'Typed');
    else $('hex-input').setAttribute('aria-invalid', 'true');
  });
  $('hex-input').addEventListener('input', e => {
    const hex = parseHex(e.target.value);
    if (hex && e.target.value.replace('#', '').length === 6) setTarget(hex, 'Typed');
  });
  $('color-input').addEventListener('change', e => setTarget(e.target.value, 'Chosen with the color picker'));

  // ---------- Image picker ----------

  const stage = $('stage');
  const view = $('view');
  const loupe = $('loupe');
  const source = document.createElement('canvas');
  const srcCtx = source.getContext('2d', { willReadFrequently: true });
  const MAX_SIDE = 4000;
  let image = null;
  let picked = null;
  let cursor = null;

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      source.width = Math.round(img.naturalWidth * scale);
      source.height = Math.round(img.naturalHeight * scale);
      srcCtx.drawImage(img, 0, 0, source.width, source.height);
      URL.revokeObjectURL(url);
      image = { name: file.name || 'pasted image' };
      picked = null;
      cursor = { x: Math.floor(source.width / 2), y: Math.floor(source.height / 2) };
      stage.classList.add('has-image');
      $('stage-tools').hidden = false;
      drawView();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      $('target-origin').textContent = `Couldn't read ${file.name}. Try a JPEG or PNG.`;
    };
    img.src = url;
  }

  function drawView() {
    if (!image) return;
    const maxW = stage.clientWidth;
    const maxH = Math.max(240, window.innerHeight * 0.62);
    const s = Math.min(maxW / source.width, maxH / source.height);
    const w = Math.round(source.width * s), h = Math.round(source.height * s);
    const dpr = window.devicePixelRatio || 1;
    view.width = w * dpr; view.height = h * dpr;
    view.style.width = w + 'px'; view.style.height = h + 'px';
    const ctx = view.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    if (picked) {
      const px = (picked.x + 0.5) * (w / source.width), py = (picked.y + 0.5) * (h / source.height);
      ctx.lineWidth = 3; ctx.strokeStyle = '#1C1C1C';
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function toSource(e) {
    const r = view.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * source.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * source.height);
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
    return { x, y };
  }

  function sample({ x, y }) {
    const n = Number($('sample-size').value), half = Math.floor(n / 2);
    const x0 = Math.max(0, x - half), y0 = Math.max(0, y - half);
    const x1 = Math.min(source.width, x + half + 1), y1 = Math.min(source.height, y + half + 1);
    const d = srcCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    // Average in linear light so mixed pixels blend the way light does.
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      for (let k = 0; k < 3; k++) sum[k] += (d[i + k] / 255) ** 2.2;
      count++;
    }
    if (!count) return null;
    return rgbToHex(sum.map(v => 255 * (v / count) ** (1 / 2.2)));
  }

  function drawLoupe(p, clientX, clientY) {
    const ctx = loupe.getContext('2d');
    const zoom = 12, cells = loupe.width / zoom, half = Math.floor(cells / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#D6D6D4';
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(source, p.x - half, p.y - half, cells, cells, 0, 0, loupe.width, loupe.height);
    const n = Number($('sample-size').value);
    const box = n * zoom, o = (half - Math.floor(n / 2)) * zoom;
    ctx.lineWidth = 2; ctx.strokeStyle = '#1C1C1C'; ctx.strokeRect(o, o, box, box);
    ctx.lineWidth = 1; ctx.strokeStyle = '#FFFFFF'; ctx.strokeRect(o + 1.5, o + 1.5, box - 3, box - 3);
    const sr = stage.getBoundingClientRect();
    let lx = clientX - sr.left + 18, ly = clientY - sr.top - loupe.height - 18;
    if (lx + loupe.width > sr.width) lx = clientX - sr.left - loupe.width - 18;
    if (ly < 0) ly = clientY - sr.top + 18;
    loupe.style.transform = `translate(${lx}px, ${ly}px)`;
    loupe.classList.add('on');
    const hex = sample(p);
    if (hex) loupe.style.setProperty('--under', hex);
  }

  function pick(p) {
    const hex = sample(p);
    if (!hex) return;
    picked = p;
    drawView();
    setTarget(hex, `Picked from ${image.name} at ${p.x}, ${p.y}`);
  }

  view.addEventListener('pointermove', e => {
    const p = toSource(e);
    if (!p) { loupe.classList.remove('on'); return; }
    cursor = p;
    drawLoupe(p, e.clientX, e.clientY);
  });
  view.addEventListener('pointerleave', () => loupe.classList.remove('on'));
  view.addEventListener('pointerdown', e => {
    const p = toSource(e);
    if (p) { e.preventDefault(); pick(p); }
  });

  stage.addEventListener('keydown', e => {
    if (!image || !cursor) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      cursor = {
        x: Math.min(source.width - 1, Math.max(0, cursor.x + moves[e.key][0])),
        y: Math.min(source.height - 1, Math.max(0, cursor.y + moves[e.key][1])),
      };
      const r = view.getBoundingClientRect();
      drawLoupe(cursor, r.left + ((cursor.x + 0.5) / source.width) * r.width, r.top + ((cursor.y + 0.5) / source.height) * r.height);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(cursor);
    }
  });

  $('file-input').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('clear-image').addEventListener('click', () => {
    image = null; picked = null;
    stage.classList.remove('has-image');
    $('stage-tools').hidden = true;
    loupe.classList.remove('on');
  });
  $('sample-size').addEventListener('change', () => { if (picked) pick(picked); });

  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drop'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    document.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('drop'); });
  }
  document.addEventListener('drop', e => loadFile(e.dataTransfer?.files?.[0]));
  document.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });
  new ResizeObserver(drawView).observe(stage);

  // ---------- Compare ----------

  const BRAND_LABEL = { boss: 'Boss Paints', levis: 'Levis' };
  const paintKey = (brand, c) => `${brand}:${c.id}`;
  const byKey = new Map();
  for (const brand of ['boss', 'levis']) {
    for (const c of DATA[brand]) {
      const key = paintKey(brand, c);
      const label = brand === 'boss' && c.code !== c.name ? `${c.code} ${c.name}` : c.name;
      byKey.set(key, { key, brand, c, label, hay: `${label} ${c.hex} ${BRAND_LABEL[brand]}`.toLowerCase() });
    }
  }
  let compared = store.get('compare', []).filter(k => byKey.has(k));

  function searchPaints(q, brand, exclude) {
    const pool = [...byKey.values()].filter(p => (!brand || p.brand === brand) && !exclude.includes(p.key));
    const hex = /^#?[0-9a-f]{6}$/i.test(q.trim()) ? parseHex(q) : null;
    if (hex) {
      const lab = hexToLab(hex);
      return pool.map(p => [p, deltaE2000(lab, p.c.lab)]).sort((a, b) => a[1] - b[1]).slice(0, 40);
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const first = terms.join(' ');
    return pool.filter(p => terms.every(t => p.hay.includes(t)))
      .map(p => [p, p.label.toLowerCase().startsWith(first) ? 0 : 1])
      .sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label, 'nl', { numeric: true }))
      .slice(0, 40)
      .map(([p]) => [p, null]);
  }

  function paintCombo({ input, listbox, brand = () => '', exclude = () => [], onChoose }) {
    let options = [];
    let active = -1;
    const optId = i => `${listbox.id}-${i}`;

    function render() {
      options = searchPaints(input.value, brand(), exclude());
      active = options.length ? 0 : -1;
      listbox.replaceChildren(...options.map(([p, de], i) => {
        const li = document.createElement('li');
        li.id = optId(i);
        li.setAttribute('role', 'option');
        const sw = document.createElement('span');
        sw.className = 'opt-swatch';
        sw.style.background = p.c.hex;
        const name = document.createElement('span');
        name.className = 'opt-name';
        name.textContent = p.label;
        const meta = document.createElement('span');
        meta.className = 'opt-meta';
        meta.textContent = `${BRAND_LABEL[p.brand]}  ${p.c.hex}${de == null ? '' : `  ΔE ${de.toFixed(2)}`}`;
        li.append(sw, name, meta);
        li.addEventListener('pointerdown', e => { e.preventDefault(); choose(i); });
        li.addEventListener('pointermove', () => { if (active !== i) { active = i; markActive(); } });
        return li;
      }));
      if (input.value.trim() && !options.length) {
        const li = document.createElement('li');
        li.className = 'opt-none';
        li.textContent = 'No paints match. Try part of a name, a code like "CK C 26", or a hex.';
        listbox.append(li);
      }
      setOpen(!!input.value.trim());
      markActive();
    }

    function setOpen(open) {
      listbox.hidden = !open;
      input.setAttribute('aria-expanded', String(open));
      if (!open) input.removeAttribute('aria-activedescendant');
    }

    function markActive() {
      [...listbox.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      if (active < 0) { input.removeAttribute('aria-activedescendant'); return; }
      input.setAttribute('aria-activedescendant', optId(active));
      listbox.children[active]?.scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      const opt = options[i];
      if (!opt) return;
      input.value = '';
      setOpen(false);
      onChoose(opt[0]);
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
    input.addEventListener('blur', () => setOpen(false));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (listbox.hidden) { render(); return; }
        if (!options.length) return;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        markActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!listbox.hidden && active >= 0) choose(active);
      } else if (e.key === 'Escape') {
        if (!listbox.hidden) { e.preventDefault(); setOpen(false); }
      }
    });
    return { refresh: () => { if (input.value.trim()) render(); } };
  }

  function addCompared(...keys) {
    compared = [...compared, ...keys.filter(k => !compared.includes(k))];
    store.set('compare', compared);
    renderCompare();
  }

  function removeCompared(key) {
    compared = compared.filter(k => k !== key);
    store.set('compare', compared);
    renderCompare();
  }

  const compareCombo = paintCombo({
    input: $('compare-search'),
    listbox: $('compare-options'),
    brand: () => $('compare-brand').value,
    exclude: () => compared,
    onChoose: p => { addCompared(p.key); $('compare-search').focus(); },
  });
  $('compare-brand').addEventListener('change', compareCombo.refresh);

  const usePaint = p => setTarget(p.c.hex, `${BRAND_LABEL[p.brand]} ${p.label}`, { paint: p.key });
  paintCombo({
    input: $('paint-search'),
    listbox: $('paint-options'),
    exclude: () => (target?.paint ? [target.paint] : []),
    onChoose: p => { usePaint(p); $('paint-search').blur(); },
  });
  $('compare-clear').addEventListener('click', () => { compared = []; store.set('compare', compared); renderCompare(); });
  $('compare-add-target').addEventListener('click', () => {
    if (!target) return;
    const best = brand => DATA[brand].filter(brand === 'boss' ? bossPasses : levisPasses)
      .reduce((b, c) => { const de = deltaE2000(target.lab, c.lab); return !b || de < b[1] ? [c, de] : b; }, null);
    addCompared(...['boss', 'levis'].map(brand => [brand, best(brand)]).filter(([, b]) => b).map(([brand, [c]]) => paintKey(brand, c)));
  });

  function detailLines(p) {
    const c = p.c;
    const lines = p.brand === 'boss'
      ? [c.groups.join(', ') || null, c.trending ? 'Trending' : null]
      : [c.hue, c.collections.filter(x => x !== 'Overige').join(', ') || null];
    if (c.products?.length) lines.push(`${c.products.length} product${c.products.length === 1 ? '' : 's'}: ${c.types.join(', ')}`);
    return lines.filter(Boolean);
  }

  function renderCompare() {
    const paints = compared.map(k => byKey.get(k));
    $('compare-empty').hidden = paints.length > 0;
    $('compare-clear').hidden = paints.length === 0;
    $('compare-add-target').hidden = !target;

    $('compare-deck').replaceChildren(...paints.map(p => {
      const li = document.createElement('li');
      li.className = 'card';
      li.style.setProperty('--paint', p.c.hex);
      li.style.setProperty('--paint-ink', inkFor(p.c.hex));

      const face = document.createElement('div');
      face.className = 'card-face';
      const hex = document.createElement('span');
      hex.textContent = p.c.hex;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'card-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${p.label}`);
      remove.addEventListener('click', () => removeCompared(p.key));
      face.append(hex, remove);

      const body = document.createElement('div');
      body.className = 'card-body';
      const brand = document.createElement('span');
      brand.className = 'card-brand';
      brand.textContent = BRAND_LABEL[p.brand];
      const name = document.createElement(p.c.url ? 'a' : 'strong');
      name.className = 'card-name';
      name.textContent = p.label;
      if (p.c.url) { name.href = p.c.url; name.target = '_blank'; name.rel = 'noopener'; }
      body.append(brand, name);
      for (const line of detailLines(p)) {
        const s = document.createElement('span');
        s.className = 'card-line';
        s.textContent = line;
        body.append(s);
      }
      if (p.c.products?.length) body.lastChild.title = p.c.products.join('\n');
      if (target) {
        const de = deltaE2000(target.lab, p.c.lab);
        const vs = document.createElement('span');
        vs.className = 'card-vs';
        vs.innerHTML = `<b>${de.toFixed(2)}</b> from your color · ${verdict(de)}`;
        body.append(vs);
      }
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'link';
      use.textContent = 'Match this color';
      use.addEventListener('click', () => usePaint(p));
      body.append(use);
      if (target) {
        const inPalette = paletteKeys().includes(p.key);
        const pal = document.createElement('button');
        pal.type = 'button';
        pal.className = 'link';
        pal.textContent = inPalette ? 'Remove from palette' : 'Add to palette';
        pal.addEventListener('click', () => togglePalette(p.key));
        body.append(pal);
      }

      li.append(face, body);
      return li;
    }));

    $('compare-matrix-wrap').hidden = paints.length < 2;
    if (paints.length < 2) return;
    const head = document.createElement('tr');
    head.append(document.createElement('td'), ...paints.map(p => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.innerHTML = `<span class="m-swatch"></span>`;
      th.firstChild.style.background = p.c.hex;
      th.append(p.label);
      th.title = `${BRAND_LABEL[p.brand]} ${p.label} ${p.c.hex}`;
      return th;
    }));
    const rows = paints.map((a, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.innerHTML = `<span class="m-swatch"></span>`;
      th.firstChild.style.background = a.c.hex;
      th.append(a.label);
      tr.append(th, ...paints.map((b, j) => {
        const td = document.createElement('td');
        if (i === j) { td.className = 'self'; return td; }
        const de = deltaE2000(a.c.lab, b.c.lab);
        td.style.setProperty('--a', a.c.hex);
        td.style.setProperty('--b', b.c.hex);
        td.innerHTML = `<span class="pair"></span><b>${de.toFixed(2)}</b><small>${verdict(de)}</small>`;
        td.title = `${a.label} vs ${b.label}`;
        return td;
      }));
      return tr;
    });
    const caption = document.createElement('caption');
    caption.textContent = 'Difference between each pair (CIEDE2000 ΔE)';
    $('compare-matrix').replaceChildren(caption, head, ...rows);
  }

  // ---------- Pairings ----------

  const MIN_FROM_TARGET = 6;
  const MIN_BETWEEN = 4;
  const MAX_FROM_IDEAL = 14;
  let palettes = store.get('palettes', {});
  let pairBrand = store.get('pairBrand', '');
  $('pair-brand').value = pairBrand;
  $('pair-brand').addEventListener('change', e => { pairBrand = e.target.value; store.set('pairBrand', pairBrand); renderPairings(); });

  const paletteKeys = () => (target ? (palettes[target.hex] || []).filter(k => byKey.has(k)) : []);

  function setPalette(keys) {
    const { [target.hex]: _, ...rest } = palettes;
    palettes = keys.length ? { ...rest, [target.hex]: keys } : rest;
    store.set('palettes', palettes);
    renderPairings();
    renderCompare();
  }

  function togglePalette(key) {
    const keys = paletteKeys();
    setPalette(keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]);
  }

  $('board-clear').addEventListener('click', () => setPalette([]));

  const lrv = hex => Math.round(relLuminance(hex) * 100);

  function suggest(scheme, pool) {
    const picks = [];
    for (const ideal of scheme.ideals) {
      const idealLab = hexToLab(oklchToHex(ideal));
      let best = null;
      for (const p of pool) {
        if (p.fromTarget < MIN_FROM_TARGET) continue;
        const de = deltaE2000(idealLab, p.c.lab);
        if (best && de >= best.de) continue;
        if (picks.some(q => deltaE2000(q.p.c.lab, p.c.lab) < MIN_BETWEEN)) continue;
        best = { p, de };
      }
      if (best && best.de <= MAX_FROM_IDEAL) picks.push({ ...best, role: ideal.role });
    }
    return picks;
  }

  function addButton(key, label) {
    const inPalette = paletteKeys().includes(key);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'add';
    b.textContent = inPalette ? '✓' : '+';
    b.setAttribute('aria-pressed', String(inPalette));
    b.setAttribute('aria-label', `${inPalette ? 'Remove' : 'Add'} ${label} ${inPalette ? 'from' : 'to'} palette`);
    b.title = inPalette ? 'In your palette: click to remove' : 'Add to your palette';
    b.addEventListener('click', () => togglePalette(key));
    return b;
  }

  function paintName(p) {
    const name = document.createElement(p.c.url ? 'a' : 'strong');
    name.className = 'pair-name';
    name.textContent = p.label;
    if (p.c.url) { name.href = p.c.url; name.target = '_blank'; name.rel = 'noopener'; }
    return name;
  }

  function schemeCard(scheme, picks) {
    const card = document.createElement('article');
    card.className = 'scheme';
    const head = document.createElement('header');
    const h = document.createElement('h3');
    h.textContent = scheme.name;
    head.append(h);
    if (picks.length) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'link';
      all.textContent = 'Add all to palette';
      all.addEventListener('click', () => {
        const keys = paletteKeys();
        setPalette([...keys, ...picks.map(x => x.p.key).filter(k => !keys.includes(k))]);
      });
      head.append(all);
    }
    const blurb = document.createElement('p');
    blurb.className = 'blurb';
    blurb.textContent = scheme.blurb;

    const strip = document.createElement('ol');
    strip.className = 'scheme-strip';
    const self = document.createElement('li');
    self.className = 'scheme-self';
    self.innerHTML = '<div class="sw"><span>Your color</span></div>';
    strip.append(self, ...picks.map(({ p, role }) => {
      const li = document.createElement('li');
      li.style.setProperty('--paint', p.c.hex);
      li.style.setProperty('--paint-ink', inkFor(p.c.hex));
      const sw = document.createElement('div');
      sw.className = 'sw';
      const r = document.createElement('span');
      r.textContent = role;
      sw.append(r, addButton(p.key, p.label));
      const meta = document.createElement('div');
      meta.className = 'pair-meta';
      const sub = document.createElement('span');
      sub.textContent = `${BRAND_LABEL[p.brand]} · ${p.c.hex}`;
      meta.append(paintName(p), sub);
      li.append(sw, meta);
      return li;
    }));
    card.append(head, blurb, strip);
    if (!picks.length) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No paints fit this scheme with the current brand and filters.';
      card.append(none);
    }
    return card;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  function wrapWords(text, max, maxLines = 2) {
    const lines = [];
    for (const w of text.split(/\s+/)) {
      const last = lines[lines.length - 1];
      if (last != null && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w;
      else lines.push(w);
    }
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, max - 1) + '…';
    }
    return lines;
  }

  function ringText(lines, x, y, { size, weight = 700, fill }) {
    const lh = size * 1.2;
    const t = svgEl('text', { x, y: y - ((lines.length - 1) * lh) / 2, fill, 'font-size': size, 'font-weight': weight, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    lines.forEach((line, k) => t.append(svgEl('tspan', { x, dy: k ? lh : 0 }, line)));
    return t;
  }

  const RING = { C: 220, R: 214, r: 112 };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let ring = null;

  function sliceLabel(p, i, n, open) {
    if (open) return [...wrapWords(p.label, 16), p.c.hex];
    return n <= 8 ? wrapWords(p.label, n <= 4 ? 16 : 12) : [String(i + 1)];
  }

  // Slices fan out clockwise from the top; the target disc covers their tips so each slice touches it.
  function renderRing(paints) {
    const { C, R, r } = RING;
    const svg = $('board-ring');
    if (ring?.raf) cancelAnimationFrame(ring.raf);
    svg.replaceChildren(svg.querySelector('title'));
    const n = paints.length;
    const slices = paints.map((p, i) => {
      const shape = n === 1 ? svgEl('circle', { cx: C, cy: C, r: R }) : svgEl('path');
      shape.setAttribute('fill', p.c.hex);
      shape.append(svgEl('title', {}, `${i + 1}. ${BRAND_LABEL[p.brand]} ${p.label} ${p.c.hex}`));
      shape.addEventListener('pointerenter', () => focusSlice(i));
      const label = svgEl('g', { class: 'slice-label' });
      svg.append(shape);
      return { p, shape, label };
    });
    svg.append(...slices.map(s => s.label));
    const disc = svgEl('circle', { cx: C, cy: C, r: n ? r : R - 20, fill: target.hex });
    disc.addEventListener('pointerenter', () => focusSlice(-1));
    svg.append(disc);
    const ink = inkFor(target.hex);
    const name = target.paint ? byKey.get(target.paint)?.label : null;
    svg.append(ringText(['Your color'], C, C - 30, { size: 13, weight: 600, fill: ink }));
    svg.append(ringText(wrapWords(name || target.hex, 14), C, C + 2, { size: 18, fill: ink }));
    svg.append(ringText([`${name ? target.hex + ' · ' : ''}LRV ${lrv(target.hex)}`], C, C + 34, { size: 12, weight: 500, fill: ink }));
    svg.onpointerleave = () => focusSlice(-1);

    ring = { slices, focus: -1, cur: ringLayout(n, -1), raf: 0 };
    setLabels();
    drawRing(ring.cur);
  }

  // The focused slice takes a bigger share; the offset keeps its middle where it sat in the even layout.
  function ringLayout(n, focus) {
    if (focus < 0 || n < 2) return { weights: Array(n).fill(1 / n), offset: 0 };
    const share = 1 / n + (1 - 1 / n) * 0.4, rest = (1 - share) / (n - 1);
    return {
      weights: Array.from({ length: n }, (_, k) => (k === focus ? share : rest)),
      offset: (focus + 0.5) / n - (rest * focus + share / 2),
    };
  }

  function drawRing({ weights, offset }) {
    const { C, R, r } = RING, mid = (R + r) / 2;
    const at = (a, rad) => [C + rad * Math.cos(a), C + rad * Math.sin(a)].map(v => v.toFixed(2));
    const n = weights.length;
    let acc = offset;
    ring.slices.forEach(({ shape, label }, k) => {
      const a0 = (acc - 0.25) * 2 * Math.PI;
      acc += weights[k];
      const a1 = (acc - 0.25) * 2 * Math.PI;
      if (n > 1) shape.setAttribute('d', `M${C} ${C}L${at(a0, R)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1, R)}Z`);
      const [x, y] = n === 1 ? [C, C - mid] : at((a0 + a1) / 2, mid);
      label.setAttribute('transform', `translate(${x} ${y})`);
      label.style.opacity = (a1 - a0) * mid >= 34 ? 1 : 0;
    });
  }

  function setLabels() {
    const n = ring.slices.length;
    ring.slices.forEach(({ p, label }, i) => {
      label.replaceChildren(ringText(sliceLabel(p, i, n, i === ring.focus), 0, 0, { size: n <= 8 || i === ring.focus ? 13 : 15, fill: inkFor(p.c.hex) }));
    });
    [...$('board-legend').children].forEach((li, i) => li.classList.toggle('on', i === ring.focus));
  }

  function focusSlice(i) {
    if (!ring || ring.focus === i) return;
    ring.focus = i;
    setLabels();
    const from = ring.cur, to = ringLayout(ring.slices.length, i);
    cancelAnimationFrame(ring.raf);
    if (reduceMotion.matches) { ring.cur = to; drawRing(to); return; }
    const start = performance.now(), DURATION = 280;
    const step = now => {
      const t = Math.min(1, (now - start) / DURATION), e = 1 - (1 - t) ** 3;
      ring.cur = {
        weights: from.weights.map((w, k) => w + (to.weights[k] - w) * e),
        offset: from.offset + (to.offset - from.offset) * e,
      };
      drawRing(ring.cur);
      if (t < 1) ring.raf = requestAnimationFrame(step);
    };
    ring.raf = requestAnimationFrame(step);
  }

  function movePalette(key, dir) {
    const keys = paletteKeys();
    const i = keys.indexOf(key), j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setPalette(keys);
  }

  function iconButton(text, label, onClick, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.textContent = text;
    b.disabled = disabled;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderBoard() {
    const paints = paletteKeys().map(k => byKey.get(k));
    $('board-clear').hidden = paints.length === 0;
    $('board-hint').hidden = paints.length > 0;
    const base = lrv(target.hex);
    $('board-legend').replaceChildren(...paints.map((p, i) => {
      const li = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'legend-num';
      num.textContent = i + 1;
      const sw = document.createElement('span');
      sw.className = 'opt-swatch';
      sw.style.background = p.c.hex;
      const text = document.createElement('div');
      text.className = 'legend-text';
      const v = lrv(p.c.hex), d = v - base;
      const sub = document.createElement('span');
      sub.textContent = `${BRAND_LABEL[p.brand]} · ${p.c.hex} · LRV ${v} (${d > 0 ? '+' : ''}${d} vs yours)`;
      text.append(paintName(p), sub);
      const tools = document.createElement('div');
      tools.className = 'legend-tools';
      tools.append(
        iconButton('↑', `Move ${p.label} earlier`, () => movePalette(p.key, -1), i === 0),
        iconButton('↓', `Move ${p.label} later`, () => movePalette(p.key, 1), i === paints.length - 1),
        iconButton('×', `Remove ${p.label} from palette`, () => togglePalette(p.key)),
      );
      li.append(num, sw, text, tools);
      li.addEventListener('pointerenter', () => focusSlice(i));
      return li;
    }));
    renderRing(paints);
  }

  $('board-legend').addEventListener('pointerleave', () => focusSlice(-1));

  paintCombo({
    input: $('board-search'),
    listbox: $('board-options'),
    exclude: () => [...paletteKeys(), ...(target?.paint ? [target.paint] : [])],
    onChoose: p => { if (target) setPalette([...paletteKeys(), p.key]); $('board-search').focus(); },
  });

  function renderPairings() {
    $('pairings-empty').hidden = !!target;
    $('board-wrap').hidden = !target;
    if (!target) { $('schemes').replaceChildren(); return; }
    renderBoard();
    const pool = [...byKey.values()]
      .filter(p => (!pairBrand || p.brand === pairBrand) && passesIgnoringHue[p.brand](p.c))
      .map(p => ({ ...p, fromTarget: deltaE2000(target.lab, p.c.lab) }));
    $('schemes').replaceChildren(...Harmony.schemesFor(target.hex).map(s => schemeCard(s, suggest(s, pool))));
  }

  // ---------- Start ----------

  buildFilterUI();
  onFiltersChanged();
  renderHistory();
  renderCompare();
  const hash = decodeURIComponent(location.hash.slice(1));
  const fromHex = parseHex(hash);
  if (byKey.has(hash)) usePaint(byKey.get(hash));
  else if (fromHex) setTarget(fromHex, 'From the link', { remember: false });
  else if (recent[0]) setTarget(recent[0].hex, recent[0].origin, { remember: false, paint: recent[0].paint });
  else renderResults();
})();
