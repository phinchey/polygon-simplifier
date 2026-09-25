/* Geofence Editor user interface. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ icons

  const DRONE = (x, y, s, col) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="${col}" fill="none" stroke-width="2.2" stroke-linecap="round">
    <path d="M-5.5-5.5L5.5 5.5M5.5-5.5L-5.5 5.5"/><circle cx="-6.5" cy="-6.5" r="3.6"/><circle cx="6.5" cy="-6.5" r="3.6"/>
    <circle cx="-6.5" cy="6.5" r="3.6"/><circle cx="6.5" cy="6.5" r="3.6"/><rect x="-2.6" y="-2.6" width="5.2" height="5.2" rx="1.2" fill="${col}" stroke="none"/></g>`;
  const ICONS = {
    inclusion: `<svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M7 13L25 5L42 14L39 40L9 42Z" fill="#16a34a" fill-opacity=".2" stroke="#16a34a" stroke-width="3" stroke-linejoin="round"/>
      ${DRONE(24, 23, 0.85, '#15803d')}
      <circle cx="37" cy="37" r="8.5" fill="#16a34a" stroke="#fff" stroke-width="2"/>
      <path d="M33 37.2l2.8 2.8 5-5.3" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    exclusion: `<svg viewBox="0 0 48 48" aria-hidden="true">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#dc2626" fill-opacity=".15"/><line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" stroke-width="2.4" stroke-opacity=".55"/></pattern></defs>
      <path d="M7 13L25 5L42 14L39 40L9 42Z" fill="url(#hatch)" stroke="#dc2626" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="24" cy="23" r="10" fill="#fff" stroke="#dc2626" stroke-width="3.2"/>
      <path d="M17 16l14 14" stroke="#dc2626" stroke-width="3.2" stroke-linecap="round"/>
      <g opacity=".95">${DRONE(38, 38, 0.55, '#374151')}</g></svg>`,
    home: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="#7c3aed" stroke="#fff" stroke-width="2.5"/>
      <path d="M13 25L24 15l11 10M16.5 22.5V34h15V22.5" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <rect x="21.5" y="27" width="5" height="7" fill="#fff"/></svg>`,
    plus: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="currentColor" opacity=".18"/><path d="M8 4.5v7M4.5 8h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`,
    zoom: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
    undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>`,
    open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 10v6M9 13l3-3 3 3" stroke-linecap="round"/></svg>`,
    circle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
  };
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });

  // ------------------------------------------------------------------ state

  const COLORS = { inclusion: '#16a34a', exclusion: '#dc2626' };
  const PIECE_COLORS = ['#f59e0b', '#3b82f6', '#d946ef', '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#ec4899'];
  const STORE_KEY = 'geofence-editor-v1';

  const state = {
    fences: [],        // {id, name, type, pts, pieces, error, verify, crossAt}
    circles: [],       // {type, lat, lon, radius}
    returnPoint: null, // [lat, lon]
    maxV: 69,
    china: false,
    basemap: 'esri-sat',
    labels: true,
    showPieces: true,
    selected: null,
    editing: null,
    mode: 'idle',      // 'idle' | 'draw' | 'return'
  };
  let nextId = 1;
  const undoStack = [];

  const BASEMAPS = [
    { id: 'esri-sat', name: 'Satellite', gcj: false, max: 19,
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}' },
    { id: 'esri-street', name: 'Streets', gcj: false, max: 19,
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attr: 'Tiles &copy; Esri' },
    { id: 'esri-topo', name: 'Topographic', gcj: false, max: 19,
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attr: 'Tiles &copy; Esri' },
    { id: 'osm', name: 'OpenStreetMap', gcj: false, max: 19,
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors' },
    { id: 'amap-sat', name: 'Satellite (AMap)', gcj: true, max: 18, sub: '1234',
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      attr: '&copy; AutoNavi',
      labels: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}' },
    { id: 'amap-road', name: 'Streets (AMap)', gcj: true, max: 18, sub: '1234',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      attr: '&copy; AutoNavi' },
  ];

  // ------------------------------------------------------ coordinate frames

  // Fence data is always WGS-84. In China mode the map tiles are GCJ-02, so
  // everything is shifted for display and shifted back when picked.
  const D = (p) => (state.china ? Geo.wgsToGcj(p[0], p[1]) : [p[0], p[1]]);
  const W = (ll) => {
    const p = state.china ? Geo.gcjToWgs(ll.lat, ll.lng) : [ll.lat, ll.lng];
    return [Geo.round7(p[0]), Geo.round7(p[1])];
  };

  // ---------------------------------------------------------------- toast

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 9000 : 4500);
  }

  // ------------------------------------------------------------ persistence

  function serial() {
    return {
      fences: state.fences.map((f) => ({ id: f.id, name: f.name, type: f.type, pts: f.pts })),
      circles: state.circles,
      returnPoint: state.returnPoint,
    };
  }

  function save() {
    try {
      const c = map.getCenter();
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(serial(), {
        maxV: state.maxV, china: state.china, basemap: state.basemap, labels: state.labels,
        showPieces: state.showPieces, view: [W(c), map.getZoom()],
        name: $('#inp-name').value,
      })));
    } catch (e) { /* storage unavailable */ }
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return s && typeof s === 'object' ? s : null;
    } catch (e) { return null; }
  }

  function snapshot() {
    undoStack.push(JSON.stringify(serial()));
    if (undoStack.length > 60) undoStack.shift();
    $('#btn-undo').disabled = false;
  }

  function undo() {
    if (state.mode === 'draw' && draw.pts.length) { draw.pts.pop(); renderDraw(); return; }
    const s = undoStack.pop();
    $('#btn-undo').disabled = !undoStack.length;
    if (!s) return;
    const d = JSON.parse(s);
    state.fences = d.fences.map((f) => Object.assign({}, f));
    state.circles = d.circles;
    state.returnPoint = d.returnPoint;
    if (!state.fences.some((f) => f.id === state.editing)) state.editing = null;
    state.fences.forEach(recompute);
    render();
  }

  // ------------------------------------------------------------------- model

  function recompute(f) {
    f.pts = Geo.cleanRing(f.pts);
    f.pieces = null; f.error = null; f.verify = null; f.crossAt = null;
    if (f.pts.length < 3) { f.error = 'Needs at least 3 vertices'; return; }
    const x = Geo.findSelfIntersection(f.pts);
    if (x) {
      f.error = 'Edges cross each other';
      const a = f.pts[x[0]], b = f.pts[(x[0] + 1) % f.pts.length], c = f.pts[x[1]], d = f.pts[(x[1] + 1) % f.pts.length];
      f.crossAt = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
      return;
    }
    if (f.pts.length > state.maxV) {
      try {
        f.pieces = Geo.splitPolygon(f.pts, f.type, state.maxV);
        try { f.verify = Geo.verifySplit(Geo.toCCW(f.pts), f.pieces, f.type); } catch (e) { f.verify = null; }
      } catch (e) {
        f.error = 'Could not split: ' + e.message;
      }
    }
  }

  function addFence(pts, type, name) {
    const f = { id: nextId++, name: name || '', type, pts };
    if (!f.name) f.name = (type === 'exclusion' ? 'Exclusion ' : 'Inclusion ') + f.id;
    recompute(f);
    state.fences.push(f);
    return f;
  }

  function exportFence() {
    const polygons = [];
    for (const f of state.fences) {
      for (const pts of (f.pieces || [f.pts])) polygons.push({ type: f.type, pts });
    }
    return { polygons, circles: state.circles, returnPoint: state.returnPoint };
  }

  // --------------------------------------------------------------------- map

  const saved = load();
  const map = L.map('map', { zoomControl: true, maxZoom: 21, worldCopyJump: true, attributionControl: true });
  L.control.scale({ imperial: false }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  let baseLayer = null, labelLayer = null;

  const pieceLayer = L.layerGroup().addTo(map);
  const fenceLayer = L.layerGroup().addTo(map);
  const extraLayer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);
  const drawLayer = L.layerGroup().addTo(map);

  function setBasemap() {
    const list = BASEMAPS.filter((b) => b.gcj === state.china);
    let bm = list.find((b) => b.id === state.basemap);
    if (!bm) { bm = list[0]; state.basemap = bm.id; }
    const sel = $('#sel-basemap');
    sel.innerHTML = list.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    sel.value = bm.id;
    if (baseLayer) map.removeLayer(baseLayer);
    if (labelLayer) map.removeLayer(labelLayer);
    const opts = { maxZoom: 21, maxNativeZoom: bm.max, attribution: bm.attr };
    if (bm.sub) opts.subdomains = bm.sub;
    baseLayer = L.tileLayer(bm.url, opts).addTo(map);
    baseLayer.bringToBack();
    labelLayer = null;
    if (bm.labels && state.labels) {
      labelLayer = L.tileLayer(bm.labels, Object.assign({}, opts, { attribution: '' })).addTo(map);
    }
    $('#chk-labels').disabled = !bm.labels;
  }

  // ------------------------------------------------------------------ render

  function fenceStyle(f) {
    const sel = f.id === state.selected || f.id === state.editing;
    return { color: COLORS[f.type], weight: sel ? 4 : 3, fillColor: COLORS[f.type], fillOpacity: f.type === 'exclusion' ? 0.28 : 0.14 };
  }

  function render() {
    fenceLayer.clearLayers();
    pieceLayer.clearLayers();
    extraLayer.clearLayers();
    for (const f of state.fences) {
      const poly = L.polygon(f.pts.map(D), fenceStyle(f));
      poly.on('click', (e) => {
        if (state.mode !== 'idle') return;
        L.DomEvent.stopPropagation(e);
        select(f.id);
      });
      poly.addTo(fenceLayer);
      f._layer = poly;
      f._pieceLayers = [];
      if (f.pieces && state.showPieces) {
        f.pieces.forEach((pc, k) => {
          const l = L.polygon(pc.map(D), { color: PIECE_COLORS[k % PIECE_COLORS.length], weight: 2, dashArray: '7 6', fill: false, interactive: false });
          l.addTo(pieceLayer);
          f._pieceLayers.push(l);
        });
      }
      if (f.crossAt) {
        L.marker(D(f.crossAt), { icon: L.divIcon({ className: 'cross-marker', iconSize: [18, 18] }), interactive: false }).addTo(extraLayer);
      }
    }
    state.circles.forEach((c) => {
      L.circle(D([c.lat, c.lon]), { radius: c.radius, color: COLORS[c.type], weight: 3, fillOpacity: c.type === 'exclusion' ? 0.28 : 0.14 }).addTo(extraLayer);
    });
    if (state.returnPoint) {
      const m = L.marker(D(state.returnPoint), {
        draggable: true,
        icon: L.divIcon({ className: 'home-marker', html: ICONS.home, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: 'Return point',
      });
      m.on('dragstart', snapshot);
      m.on('dragend', () => { state.returnPoint = W(m.getLatLng()); renderList(); save(); });
      m.addTo(extraLayer);
    }
    buildEditHandles();
    renderList();
    save();
  }

  function renderList() {
    const list = $('#fence-list');
    list.innerHTML = '';
    for (const f of state.fences) {
      const el = document.createElement('div');
      el.className = `fence ${f.type}` + (f.id === state.selected ? ' selected' : '');
      let meta;
      if (f.error) meta = `${f.pts.length} vertices · <span class="err">${esc(f.error)}</span>`;
      else if (f.pieces) {
        const exact = f.verify !== null && f.verify < 1e-6;
        meta = `${f.pts.length} vertices → ${f.pieces.length} polygons` +
          (f.verify === null ? '' : exact ? ' · <span class="ok" title="The split polygons reproduce the original area exactly">✓</span>'
            : ` · <span class="err">area off by ${(f.verify * 100).toFixed(3)}%</span>`);
      } else meta = `${f.pts.length} vertices`;
      el.innerHTML = `
        <div class="type-toggle">
          <button class="type-btn incl ${f.type === 'inclusion' ? 'on' : ''}" title="Inclusion: vehicle must stay inside" aria-label="Inclusion">${ICONS.inclusion}</button>
          <button class="type-btn excl ${f.type === 'exclusion' ? 'on' : ''}" title="Exclusion: vehicle must stay out" aria-label="Exclusion">${ICONS.exclusion}</button>
        </div>
        <div class="fence-body">
          <div class="fence-top">
            <input type="text" class="fence-name" value="${esc(f.name)}" spellcheck="false" aria-label="Fence name">
            <button class="icon-btn b-edit ${f.id === state.editing ? 'on' : ''}" title="Edit vertices">${ICONS.edit}</button>
            <button class="icon-btn b-zoom" title="Zoom to fence">${ICONS.zoom}</button>
            <button class="icon-btn b-del" title="Delete fence">${ICONS.trash}</button>
          </div>
          <div class="fence-meta">${meta}</div>
          ${f.pieces && state.showPieces ? `<div class="pieces">${f.pieces.map((pc, k) => {
            const col = PIECE_COLORS[k % PIECE_COLORS.length];
            return `<span class="piece" data-k="${k}" style="border-color:${col};color:${col}">${k + 1} · ${pc.length}</span>`;
          }).join('')}</div>` : ''}
        </div>`;
      const setType = (t) => {
        if (f.type === t) return;
        snapshot();
        f.type = t;
        if (/^(Inclusion|Exclusion) \d+$/.test(f.name)) f.name = (t === 'exclusion' ? 'Exclusion ' : 'Inclusion ') + f.id;
        recompute(f); render();
      };
      el.querySelector('.type-btn.incl').onclick = () => setType('inclusion');
      el.querySelector('.type-btn.excl').onclick = () => setType('exclusion');
      const nameInp = el.querySelector('.fence-name');
      nameInp.onchange = () => { f.name = nameInp.value.trim() || f.name; save(); };
      nameInp.onfocus = () => { if (state.selected !== f.id) { state.selected = f.id; restyle(); } };
      el.querySelector('.b-edit').onclick = () => toggleEdit(f.id);
      el.querySelector('.b-zoom').onclick = () => { select(f.id); zoomTo(f.pieces && state.showPieces ? f.pieces.flat() : f.pts); };
      el.querySelector('.b-del').onclick = () => {
        snapshot();
        state.fences = state.fences.filter((g) => g !== f);
        if (state.editing === f.id) state.editing = null;
        render();
      };
      el.querySelectorAll('.piece').forEach((chip) => {
        const l = f._pieceLayers && f._pieceLayers[+chip.dataset.k];
        if (!l) return;
        chip.onmouseenter = () => { l.setStyle({ weight: 5, dashArray: null }); l.bringToFront(); };
        chip.onmouseleave = () => { l.setStyle({ weight: 2, dashArray: '7 6' }); l.bringToBack(); };
      });
      el.onclick = (e) => { if (e.target === el || e.target.classList.contains('fence-meta')) select(f.id); };
      list.appendChild(el);
    }

    const extra = $('#extra-list');
    extra.innerHTML = '';
    state.circles.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'extra';
      row.innerHTML = `<span class="mini" style="color:${COLORS[c.type]}">${ICONS.circle}</span>
        <span class="grow">${c.type === 'exclusion' ? 'Exclusion' : 'Inclusion'} circle, ${c.radius} m</span>
        <button class="icon-btn" title="Zoom">${ICONS.zoom}</button><button class="icon-btn" title="Delete circle">${ICONS.trash}</button>`;
      const [bz, bd] = row.querySelectorAll('button');
      bz.onclick = () => map.fitBounds(L.latLng(D([c.lat, c.lon])).toBounds(c.radius * 2.4));
      bd.onclick = () => { snapshot(); state.circles.splice(i, 1); render(); };
      extra.appendChild(row);
    });
    if (state.returnPoint) {
      const row = document.createElement('div');
      row.className = 'extra';
      row.innerHTML = `<span class="mini">${ICONS.home}</span>
        <span class="grow">Return point ${state.returnPoint[0].toFixed(6)}, ${state.returnPoint[1].toFixed(6)}</span>
        <button class="icon-btn" title="Remove return point">${ICONS.trash}</button>`;
      row.querySelector('button').onclick = () => { snapshot(); state.returnPoint = null; render(); };
      extra.appendChild(row);
    }
    updateSummary();
  }

  function updateSummary() {
    const fence = exportFence();
    const nPoly = fence.polygons.length;
    const nVert = fence.polygons.reduce((s, p) => s + p.pts.length, 0);
    const el = $('#export-summary');
    if (!nPoly && !fence.circles.length) { el.textContent = 'Nothing to export yet.'; return; }
    const bytes = Formats.stgSize(fence);
    el.textContent = `${nPoly} polygon${nPoly === 1 ? '' : 's'}, ${nVert} vertices` +
      (fence.circles.length ? `, ${fence.circles.length} circle(s)` : '') +
      `. fence.stg needs ${bytes} bytes: set BRD_SD_FENCE to at least ${Math.max(1, Math.ceil(bytes / 1024))}.`;
  }

  function restyle() {
    for (const f of state.fences) if (f._layer) f._layer.setStyle(fenceStyle(f));
    document.querySelectorAll('.fence').forEach((el, i) => {
      const f = state.fences[i];
      el.classList.toggle('selected', !!f && f.id === state.selected);
    });
  }

  function select(id) {
    state.selected = id;
    restyle();
  }

  function zoomTo(pts) {
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts.map(D)), { padding: [30, 30], maxZoom: 19 });
  }

  // ----------------------------------------------------------- vertex edit

  const vtxIcon = L.divIcon({ className: 'vtx', iconSize: [12, 12] });
  const midIcon = L.divIcon({ className: 'mid', iconSize: [10, 10] });

  function toggleEdit(id) {
    cancelMode();
    state.editing = state.editing === id ? null : id;
    state.selected = id;
    render();
  }

  function liveUpdate(f) {
    if (f._layer) f._layer.setLatLngs(f.pts.map(D));
  }

  function buildEditHandles() {
    editLayer.clearLayers();
    const f = state.fences.find((g) => g.id === state.editing);
    if (!f) return;
    const n = f.pts.length;
    if (n > 4000) { toast('This fence has too many vertices to edit one by one.'); return; }
    const del = (i) => {
      if (f.pts.length <= 3) { toast('A fence needs at least 3 vertices.'); return; }
      snapshot();
      f.pts.splice(i, 1);
      recompute(f); render();
    };
    f.pts.forEach((p, i) => {
      const m = L.marker(D(p), { draggable: true, icon: vtxIcon, keyboard: false, zIndexOffset: 1000 });
      m.on('dragstart', snapshot);
      m.on('drag', () => { f.pts[i] = W(m.getLatLng()); liveUpdate(f); });
      m.on('dragend', () => { f.pts[i] = W(m.getLatLng()); recompute(f); render(); });
      m.on('contextmenu', (e) => { L.DomEvent.preventDefault(e.originalEvent); del(i); });
      m.on('click', (e) => { if (e.originalEvent.ctrlKey || e.originalEvent.metaKey || e.originalEvent.altKey) del(i); });
      editLayer.addLayer(m);
    });
    if (n > 1000) return;
    f.pts.forEach((p, i) => {
      const a = D(p), b = D(f.pts[(i + 1) % n]);
      const m = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { draggable: true, icon: midIcon, keyboard: false, title: 'Drag or click to add a vertex' });
      let inserted = false;
      const insert = () => {
        if (inserted) return;
        inserted = true;
        snapshot();
        f.pts.splice(i + 1, 0, W(m.getLatLng()));
      };
      m.on('dragstart', insert);
      m.on('drag', () => { f.pts[i + 1] = W(m.getLatLng()); liveUpdate(f); });
      m.on('dragend', () => { recompute(f); render(); });
      m.on('click', () => { insert(); recompute(f); render(); });
      editLayer.addLayer(m);
    });
  }

  // ------------------------------------------------------------ draw modes

  const draw = { pts: [], type: 'inclusion', cursor: null };

  function setMode(mode) {
    state.mode = mode;
    $('#draw-hint').hidden = mode !== 'draw';
    $('#return-hint').hidden = mode !== 'return';
    $('#btn-draw-incl').classList.toggle('active', mode === 'draw' && draw.type === 'inclusion');
    $('#btn-draw-excl').classList.toggle('active', mode === 'draw' && draw.type === 'exclusion');
    $('#btn-return').classList.toggle('active', mode === 'return');
    $('#map').classList.toggle('drawing', mode !== 'idle');
    if (mode === 'draw') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  }

  function startDraw(type) {
    if (state.editing) { state.editing = null; render(); }
    draw.pts = []; draw.type = type;
    setMode('draw');
    renderDraw();
  }

  function cancelMode() {
    draw.pts = [];
    drawLayer.clearLayers();
    setMode('idle');
  }

  function finishDraw() {
    const pts = Geo.cleanRing(draw.pts);
    if (pts.length < 3) { toast('Add at least 3 vertices first.'); return; }
    snapshot();
    const f = addFence(pts, draw.type);
    state.selected = f.id;
    cancelMode();
    render();
    if (f.pieces) toast(`${f.pts.length} vertices: exported as ${f.pieces.length} polygons of at most ${state.maxV} vertices.`);
  }

  function renderDraw() {
    drawLayer.clearLayers();
    if (state.mode !== 'draw') return;
    const col = COLORS[draw.type];
    const lls = draw.pts.map(D);
    if (lls.length) {
      L.polyline(lls, { color: col, weight: 3, interactive: false }).addTo(drawLayer);
      if (draw.cursor) {
        const tail = [lls[lls.length - 1], draw.cursor];
        if (lls.length >= 2) tail.push(lls[0]);
        L.polyline(tail, { color: col, weight: 2, dashArray: '5 6', interactive: false }).addTo(drawLayer);
      }
    }
    lls.forEach((ll, i) => {
      const m = L.circleMarker(ll, { radius: i === 0 ? 7 : 5, color: '#111827', weight: 2, fillColor: i === 0 ? col : '#fff', fillOpacity: 1, bubblingMouseEvents: false });
      if (i === 0) m.on('click', () => { if (draw.pts.length >= 3) finishDraw(); });
      else m.options.interactive = false;
      m.addTo(drawLayer);
    });
  }

  map.on('click', (e) => {
    if (state.mode === 'draw') {
      draw.pts.push(W(e.latlng));
      renderDraw();
    } else if (state.mode === 'return') {
      snapshot();
      state.returnPoint = W(e.latlng);
      setMode('idle');
      render();
    } else if (state.selected !== null && state.editing === null) {
      select(null);
    }
  });

  map.on('dblclick', (e) => {
    if (state.mode !== 'draw') return;
    // the double-click already added (up to) two points at the same spot
    const pts = draw.pts;
    const px = (p) => map.latLngToContainerPoint(D(p));
    while (pts.length >= 2 && px(pts[pts.length - 1]).distanceTo(px(pts[pts.length - 2])) < 6) pts.pop();
    L.DomEvent.stop(e);
    finishDraw();
  });

  map.on('mousemove', (e) => {
    const w = W(e.latlng);
    let txt = `${w[0].toFixed(7)}, ${w[1].toFixed(7)}  WGS-84`;
    if (state.china) txt += `\n${e.latlng.lat.toFixed(7)}, ${e.latlng.lng.toFixed(7)}  GCJ-02 (map)`;
    $('#coords').textContent = txt;
    if (state.mode === 'draw' && draw.pts.length) { draw.cursor = e.latlng; renderDraw(); }
  });
  map.on('mouseout', () => { $('#coords').textContent = ''; });
  map.on('moveend', save);

  // ------------------------------------------------------------ open files

  async function openFiles(files) {
    let added = 0, bounds = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fence = await Formats.parseFile(file.name, bytes);
        const isKml = /\.km[lz]$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b) || /<kml/i.test(new TextDecoder().decode(bytes.subarray(0, 400)));
        if (state.china && isKml && $('#chk-kml-gcj').checked) {
          const fix = (p) => { const q = Geo.gcjToWgs(p[0], p[1]); return [Geo.round7(q[0]), Geo.round7(q[1])]; };
          fence.polygons.forEach((p) => { p.pts = p.pts.map(fix); });
          fence.circles.forEach((c) => { [c.lat, c.lon] = fix([c.lat, c.lon]); });
          if (fence.returnPoint) fence.returnPoint = fix(fence.returnPoint);
        }
        let polys = fence.polygons;
        if (!isKml && $('#chk-recombine').checked) polys = recombine(polys);
        if (!polys.length && !fence.circles.length && !fence.returnPoint) throw new Error('No fence polygons found');
        if (!added) snapshot();
        const base = file.name.replace(/\.[^.]+$/, '');
        polys.forEach((p, k) => {
          const f = addFence(p.pts, p.type, p.name || (polys.length > 1 ? `${base} ${k + 1}` : base));
          bounds = bounds.concat(f.pts);
          added++;
        });
        state.circles = state.circles.concat(fence.circles);
        fence.circles.forEach((c) => bounds.push([c.lat, c.lon]));
        if (fence.returnPoint) { state.returnPoint = fence.returnPoint; bounds.push(fence.returnPoint); }
        if (fence.warnings.length) toast(`${file.name}: ${fence.warnings.join('; ')}`);
      } catch (e) {
        toast(`${file.name}: ${e.message}`, true);
      }
    }
    if (bounds.length) {
      render();
      zoomTo(bounds);
      const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '';
      if (name && name !== 'fence') $('#inp-name').value = name;
    }
  }

  // ArduPilot files contain the already-split polygons. Inclusion polygons act
  // together as their intersection and exclusion polygons as their union, so
  // combine them back into editable shapes.
  function recombine(polys) {
    const out = [];
    for (const type of ['inclusion', 'exclusion']) {
      const group = polys.filter((p) => p.type === type);
      if (group.length < 2) { out.push(...group); continue; }
      let merged = null;
      try { merged = Geo.mergePolygons(group.map((p) => Geo.cleanRing(p.pts)), type); } catch (e) { merged = null; }
      if (merged && merged.length && merged.length < group.length) {
        merged.forEach((pts) => out.push({ type, pts }));
      } else {
        out.push(...group);
      }
    }
    return out;
  }

  // ----------------------------------------------------------------- export

  function download(name, data, mime) {
    const blob = new Blob([data], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function checkExportable() {
    const bad = state.fences.filter((f) => f.error);
    if (bad.length) {
      toast(`Fix ${bad.map((f) => `"${f.name}"`).join(', ')} first: ${bad[0].error}.`, true);
      select(bad[0].id);
      return false;
    }
    const fence = exportFence();
    if (!fence.polygons.length && !fence.circles.length) { toast('Nothing to export yet.', true); return false; }
    return true;
  }

  const baseName = () => ($('#inp-name').value.trim() || 'geofence').replace(/[\\/:*?"<>|]+/g, '_');

  function exportWaypoints(ext) {
    if (!checkExportable()) return;
    download(`${baseName()}.${ext}`, Formats.writeWaypointFence(exportFence()), 'text/plain');
  }

  $('#btn-exp-fence').onclick = () => exportWaypoints('fence');
  $('#btn-exp-txt').onclick = () => exportWaypoints('txt');
  $('#btn-exp-stg').onclick = () => {
    if (!checkExportable()) return;
    try {
      const fence = exportFence();
      download('fence.stg', Formats.writeStg(fence), 'application/octet-stream');
      const kb = Math.max(1, Math.ceil(Formats.stgSize(fence) / 1024));
      toast(`Copy fence.stg to the APM folder on the SD card. BRD_SD_FENCE must be at least ${kb}.`);
    } catch (e) { toast(e.message, true); }
  };
  $('#btn-exp-kml').onclick = () => {
    if (!state.fences.length && !state.circles.length) { toast('Nothing to export yet.', true); return; }
    const fence = {
      polygons: state.fences.map((f) => ({ type: f.type, pts: f.pts, name: f.name })),
      circles: state.circles, returnPoint: state.returnPoint,
    };
    download(`${baseName()}.kml`, Formats.writeKml(fence, baseName()), 'application/vnd.google-earth.kml+xml');
  };

  // ------------------------------------------------------------- controls

  $('#btn-draw-incl').onclick = () => (state.mode === 'draw' && draw.type === 'inclusion' ? cancelMode() : startDraw('inclusion'));
  $('#btn-draw-excl').onclick = () => (state.mode === 'draw' && draw.type === 'exclusion' ? cancelMode() : startDraw('exclusion'));
  $('#btn-return').onclick = () => {
    if (state.mode === 'return') { cancelMode(); return; }
    cancelMode();
    if (state.editing) { state.editing = null; render(); }
    setMode('return');
  };
  $('#btn-finish').onclick = finishDraw;
  $('#btn-cancel').onclick = cancelMode;
  $('#btn-return-cancel').onclick = cancelMode;
  $('#btn-return-clear').onclick = () => { if (state.returnPoint) { snapshot(); state.returnPoint = null; } cancelMode(); render(); };
  $('#btn-undo').onclick = undo;
  $('#btn-undo').disabled = true;

  $('#chk-pieces').onchange = (e) => { state.showPieces = e.target.checked; render(); };
  $('#inp-maxv').onchange = (e) => {
    let v = Math.round(+e.target.value);
    if (!isFinite(v)) v = 69;
    v = Math.min(255, Math.max(12, v));
    e.target.value = v;
    state.maxV = v;
    state.fences.forEach(recompute);
    render();
  };
  $('#sel-basemap').onchange = (e) => { state.basemap = e.target.value; setBasemap(); save(); };
  $('#chk-labels').onchange = (e) => { state.labels = e.target.checked; setBasemap(); save(); };
  $('#chk-china').onchange = (e) => {
    const c = W(map.getCenter());
    state.china = e.target.checked;
    document.querySelectorAll('.china-only').forEach((el) => { el.hidden = !state.china; });
    setBasemap();
    map.setView(D(c), map.getZoom(), { animate: false });
    render();
    renderDraw();
  };
  $('#inp-name').onchange = save;
  $('#goto-form').onsubmit = (e) => {
    e.preventDefault();
    const m = $('#inp-goto').value.match(/(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)/);
    if (!m) { toast('Enter coordinates as "lat, lon".', true); return; }
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast('Coordinates out of range.', true); return; }
    map.setView(D([lat, lon]), Math.max(map.getZoom(), 16));
  };

  $('#inp-file').onchange = (e) => { openFiles([...e.target.files]); e.target.value = ''; };
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragover'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length) openFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (state.mode !== 'idle') cancelMode();
      else if (state.editing) toggleEdit(state.editing);
      return;
    }
    if (typing) return;
    if (state.mode === 'draw' && e.key === 'Enter') { e.preventDefault(); finishDraw(); return; }
    if (state.mode === 'draw' && e.key === 'Backspace') { e.preventDefault(); draw.pts.pop(); renderDraw(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  // ----------------------------------------------------------------- start

  if (saved) {
    state.maxV = Math.min(255, Math.max(12, +saved.maxV || 69));
    state.china = !!saved.china;
    state.basemap = saved.basemap || state.basemap;
    state.labels = saved.labels !== false;
    state.showPieces = saved.showPieces !== false;
    (saved.fences || []).forEach((f) => {
      if (Array.isArray(f.pts)) addFence(f.pts, f.type === 'exclusion' ? 'exclusion' : 'inclusion', f.name);
    });
    state.circles = Array.isArray(saved.circles) ? saved.circles : [];
    state.returnPoint = Array.isArray(saved.returnPoint) ? saved.returnPoint : null;
    if (saved.name) $('#inp-name').value = saved.name;
  }
  $('#inp-maxv').value = state.maxV;
  $('#chk-china').checked = state.china;
  $('#chk-labels').checked = state.labels;
  $('#chk-pieces').checked = state.showPieces;
  document.querySelectorAll('.china-only').forEach((el) => { el.hidden = !state.china; });
  setBasemap();
  if (saved && saved.view && Array.isArray(saved.view[0])) map.setView(D(saved.view[0]), saved.view[1] || 15);
  else map.setView([30, 0], 3);
  render();
})();
