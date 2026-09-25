/*
 * Reading and writing geofence files.
 *
 * A fence is { polygons: [{type, pts, name?}], circles: [{type, lat, lon, radius}],
 *              returnPoint: [lat, lon] | null, warnings: [] }
 * where type is 'inclusion' or 'exclusion' and pts are [lat, lon] pairs (open ring).
 *
 * Supported formats:
 *  - Mission Planner / MAVProxy fence files ("QGC WPL 110" with MAV_CMD_NAV_FENCE_* items),
 *    usually saved as .fence, .txt or .waypoints
 *  - Legacy Mission Planner .fen files (return point then "lat lon" lines)
 *  - ArduPilot SD card fence storage image (APM/fence.stg, used when BRD_SD_FENCE > 0)
 *  - KML and KMZ
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Formats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CMD = {
    RETURN_POINT: 5000,
    POLY_INCLUSION: 5001,
    POLY_EXCLUSION: 5002,
    CIRCLE_INCLUSION: 5003,
    CIRCLE_EXCLUSION: 5004,
    WAYPOINT: 16,
  };

  // AC_PolyFenceType values used in fence storage
  const STG = {
    MAGIC: 235,
    END_OF_STORAGE: 99,
    POLYGON_INCLUSION: 98,
    POLYGON_EXCLUSION: 97,
    CIRCLE_EXCLUSION_INT: 96,
    RETURN_POINT: 95,
    CIRCLE_INCLUSION_INT: 94,
    CIRCLE_EXCLUSION: 93,
    CIRCLE_INCLUSION: 92,
    HOME_CIRCLE_INCLUSION: 91,
  };

  const r7 = (v) => Math.round(v * 1e7) / 1e7;
  const emptyFence = () => ({ polygons: [], circles: [], returnPoint: null, warnings: [] });

  function centroid(pts) {
    let a = 0, b = 0;
    for (const p of pts) { a += p[0]; b += p[1]; }
    return [a / pts.length, b / pts.length];
  }

  // ------------------------------------------------ Mission Planner (WPL 110)

  function writeWaypointFence(fence) {
    const f8 = (v) => Number(v).toFixed(8);
    const lines = ['QGC WPL 110'];
    let home = fence.returnPoint;
    if (!home && fence.polygons.length) home = centroid(fence.polygons[0].pts);
    if (!home && fence.circles.length) home = [fence.circles[0].lat, fence.circles[0].lon];
    if (!home) home = [0, 0];
    // line 0 is the home position, Mission Planner expects it and skips it on load
    lines.push(['0', '1', '0', CMD.WAYPOINT, f8(0), f8(0), f8(0), f8(0), f8(home[0]), f8(home[1]), f8(0), '1'].join('\t'));
    let seq = 1;
    const item = (cmd, p1, lat, lon) => {
      lines.push([seq++, 0, 0, cmd, f8(p1), f8(0), f8(0), f8(0), f8(lat), f8(lon), f8(0), 1].join('\t'));
    };
    if (fence.returnPoint) item(CMD.RETURN_POINT, 0, fence.returnPoint[0], fence.returnPoint[1]);
    for (const poly of fence.polygons) {
      const cmd = poly.type === 'exclusion' ? CMD.POLY_EXCLUSION : CMD.POLY_INCLUSION;
      for (const p of poly.pts) item(cmd, poly.pts.length, p[0], p[1]);
    }
    for (const c of fence.circles) {
      item(c.type === 'exclusion' ? CMD.CIRCLE_EXCLUSION : CMD.CIRCLE_INCLUSION, c.radius, c.lat, c.lon);
    }
    return lines.join('\n') + '\n';
  }

  function parseWaypointFence(text) {
    const fence = emptyFence();
    let cur = null, skipped = 0;
    const lines = text.split(/\r?\n/);
    for (let ln = 1; ln < lines.length; ln++) {
      const line = lines[ln].trim();
      if (!line || line.startsWith('#')) continue;
      const it = line.split(/[\s,]+/);
      if (it.length < 12) continue;
      const cmd = parseInt(it[3], 10);
      const p1 = parseFloat(it[4]);
      const lat = r7(parseFloat(it[8])), lon = r7(parseFloat(it[9]));
      if (cmd === CMD.POLY_INCLUSION || cmd === CMD.POLY_EXCLUSION) {
        const type = cmd === CMD.POLY_INCLUSION ? 'inclusion' : 'exclusion';
        const count = Math.round(p1);
        if (!cur || cur.type !== type || (cur.count > 0 && cur.pts.length >= cur.count)) {
          cur = { type, count, pts: [] };
          fence.polygons.push(cur);
        }
        cur.pts.push([lat, lon]);
      } else if (cmd === CMD.CIRCLE_INCLUSION || cmd === CMD.CIRCLE_EXCLUSION) {
        cur = null;
        fence.circles.push({ type: cmd === CMD.CIRCLE_INCLUSION ? 'inclusion' : 'exclusion', lat, lon, radius: p1 });
      } else if (cmd === CMD.RETURN_POINT) {
        cur = null;
        fence.returnPoint = [lat, lon];
      } else if (!(cmd === CMD.WAYPOINT && it[0] === '0')) {
        skipped++;
      }
    }
    for (const p of fence.polygons) {
      if (p.count && p.pts.length !== p.count) fence.warnings.push(`A polygon declares ${p.count} vertices but has ${p.pts.length}`);
      delete p.count;
    }
    if (skipped) fence.warnings.push(`${skipped} non-fence item(s) were ignored`);
    return fence;
  }

  // Legacy Mission Planner .fen: first line is the return point, then the
  // polygon with the first vertex repeated at the end.
  function parseLatLonLines(text, firstIsReturn) {
    const fence = emptyFence();
    const pts = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const it = line.split(/[\s,]+/).map(Number);
      if (it.length < 2 || !isFinite(it[0]) || !isFinite(it[1])) continue;
      pts.push([r7(it[0]), r7(it[1])]);
    }
    if (firstIsReturn && pts.length) fence.returnPoint = pts.shift();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length >= 3) fence.polygons.push({ type: 'inclusion', pts });
    return fence;
  }

  // --------------------------------------------- SD card storage (fence.stg)

  function stgSize(fence) {
    let n = 4 + 1;
    for (const p of fence.polygons) n += 2 + 8 * p.pts.length;
    n += 13 * fence.circles.length;
    if (fence.returnPoint) n += 9;
    return n;
  }

  function writeStg(fence) {
    const used = stgSize(fence);
    const size = Math.ceil(used / 1024) * 1024;
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    let o = 0;
    const u8 = (v) => { dv.setUint8(o, v); o += 1; };
    const ll = (lat, lon) => {
      dv.setInt32(o, Math.round(lat * 1e7), true);
      dv.setInt32(o + 4, Math.round(lon * 1e7), true);
      o += 8;
    };
    u8(STG.MAGIC); u8(0); u8(0); u8(0);
    for (const p of fence.polygons) {
      if (p.pts.length > 255) throw new Error('A polygon has more than 255 vertices; split it first');
      u8(p.type === 'exclusion' ? STG.POLYGON_EXCLUSION : STG.POLYGON_INCLUSION);
      u8(p.pts.length);
      for (const q of p.pts) ll(q[0], q[1]);
    }
    for (const c of fence.circles) {
      u8(c.type === 'exclusion' ? STG.CIRCLE_EXCLUSION : STG.CIRCLE_INCLUSION);
      ll(c.lat, c.lon);
      dv.setFloat32(o, c.radius, true); o += 4;
    }
    if (fence.returnPoint) { u8(STG.RETURN_POINT); ll(fence.returnPoint[0], fence.returnPoint[1]); }
    u8(STG.END_OF_STORAGE);
    return buf;
  }

  function parseStg(bytes) {
    const fence = emptyFence();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 5) throw new Error('File is too small to be fence storage');
    if (bytes[0] !== STG.MAGIC || bytes[1] || bytes[2] || bytes[3]) {
      throw new Error('Not an ArduPilot fence storage file (bad header)');
    }
    let o = 4;
    const need = (k) => { if (o + k > bytes.length) throw new Error('Fence storage is truncated'); };
    const ll = () => { need(8); const v = [dv.getInt32(o, true) / 1e7, dv.getInt32(o + 4, true) / 1e7]; o += 8; return v; };
    for (;;) {
      need(1);
      const t = bytes[o++];
      if (t === STG.END_OF_STORAGE) break;
      if (t === STG.POLYGON_INCLUSION || t === STG.POLYGON_EXCLUSION) {
        need(1);
        const n = bytes[o++];
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(ll());
        fence.polygons.push({ type: t === STG.POLYGON_INCLUSION ? 'inclusion' : 'exclusion', pts });
      } else if (t === STG.CIRCLE_INCLUSION || t === STG.CIRCLE_EXCLUSION) {
        const [lat, lon] = ll();
        need(4);
        const radius = Math.round(dv.getFloat32(o, true) * 1000) / 1000; o += 4;
        fence.circles.push({ type: t === STG.CIRCLE_INCLUSION ? 'inclusion' : 'exclusion', lat, lon, radius });
      } else if (t === STG.CIRCLE_INCLUSION_INT || t === STG.CIRCLE_EXCLUSION_INT) {
        const [lat, lon] = ll();
        need(4);
        const radius = dv.getUint32(o, true); o += 4;
        fence.circles.push({ type: t === STG.CIRCLE_INCLUSION_INT ? 'inclusion' : 'exclusion', lat, lon, radius });
      } else if (t === STG.RETURN_POINT) {
        fence.returnPoint = ll();
      } else if (t === STG.HOME_CIRCLE_INCLUSION) {
        need(4); o += 4;
        fence.warnings.push('A home-circle item was ignored');
      } else {
        fence.warnings.push(`Unknown item type ${t} at byte ${o - 1}; the rest of the file was ignored`);
        break;
      }
    }
    return fence;
  }

  // ------------------------------------------------------------- KML / KMZ

  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const unesc = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  function writeKml(fence, docName) {
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    out.push('<Document>');
    out.push(`<name>${esc(docName || 'Geofence')}</name>`);
    out.push('<Style id="inclusion"><LineStyle><color>ff00c000</color><width>3</width></LineStyle><PolyStyle><color>4000c000</color></PolyStyle></Style>');
    out.push('<Style id="exclusion"><LineStyle><color>ff0000e0</color><width>3</width></LineStyle><PolyStyle><color>400000e0</color></PolyStyle></Style>');
    const data = (pairs) => '<ExtendedData>' + Object.entries(pairs).map(([k, v]) => `<Data name="${k}"><value>${esc(v)}</value></Data>`).join('') + '</ExtendedData>';
    fence.polygons.forEach((p, i) => {
      const ring = p.pts.concat([p.pts[0]]).map((q) => `${q[1].toFixed(7)},${q[0].toFixed(7)},0`).join(' ');
      out.push('<Placemark>');
      out.push(`<name>${esc(p.name || (p.type === 'exclusion' ? 'Exclusion ' : 'Inclusion ') + (i + 1))}</name>`);
      out.push(`<styleUrl>#${p.type}</styleUrl>`);
      out.push(data({ fenceType: p.type }));
      out.push(`<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>`);
      out.push('</Placemark>');
    });
    fence.circles.forEach((c, i) => {
      out.push(`<Placemark><name>Circle ${i + 1}</name>${data({ fenceType: 'circle-' + c.type, radius: c.radius })}` +
        `<Point><coordinates>${c.lon.toFixed(7)},${c.lat.toFixed(7)},0</coordinates></Point></Placemark>`);
    });
    if (fence.returnPoint) {
      out.push(`<Placemark><name>Return point</name>${data({ fenceType: 'return' })}` +
        `<Point><coordinates>${fence.returnPoint[1].toFixed(7)},${fence.returnPoint[0].toFixed(7)},0</coordinates></Point></Placemark>`);
    }
    out.push('</Document>');
    out.push('</kml>');
    return out.join('\n') + '\n';
  }

  function parseCoords(s) {
    const pts = [];
    for (const tok of unesc(s).trim().split(/\s+/)) {
      const c = tok.split(',').map(Number);
      if (c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) pts.push([r7(c[1]), r7(c[0])]);
    }
    return pts;
  }

  // Small tolerant KML reader (works without a DOM, handles namespace prefixes).
  function parseKml(text) {
    const fence = emptyFence();
    const tag = (name) => `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`;
    const first = (src, name) => { const m = new RegExp(tag(name)).exec(src); return m ? m[1] : null; };
    const all = (src, name) => { const re = new RegExp(tag(name), 'g'); const r = []; let m; while ((m = re.exec(src))) r.push(m[1]); return r; };
    let holes = 0;
    const placemarks = all(text, 'Placemark');
    const sources = placemarks.length ? placemarks : [text];
    for (const pm of sources) {
      const name = unesc((first(pm, 'name') || '').trim());
      const ext = {};
      const dre = /<(?:[\w-]+:)?Data\b[^>]*name="([^"]*)"[^>]*>[\s\S]*?<(?:[\w-]+:)?value>([\s\S]*?)<\/(?:[\w-]+:)?value>/g;
      let m;
      while ((m = dre.exec(pm))) ext[m[1]] = unesc(m[2].trim());
      const ftype = ext.fenceType || '';
      const nameType = /exclu|no.?fly|keep.?out|禁/i.test(name) ? 'exclusion' : 'inclusion';
      for (const poly of all(pm, 'Polygon')) {
        const outer = first(poly, 'outerBoundaryIs') || poly;
        const coords = first(outer, 'coordinates');
        if (!coords) continue;
        let pts = parseCoords(coords);
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        if (pts.length < 3) continue;
        holes += all(poly, 'innerBoundaryIs').length;
        const type = ftype === 'inclusion' || ftype === 'exclusion' ? ftype : nameType;
        fence.polygons.push({ type, pts, name: name || undefined });
      }
      // closed paths drawn as lines are accepted as polygons too
      for (const ls of all(pm, 'LineString')) {
        const coords = first(ls, 'coordinates');
        if (!coords) continue;
        const pts = parseCoords(coords);
        if (pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
          pts.pop();
          fence.polygons.push({ type: nameType, pts, name: name || undefined });
        }
      }
      if (/^circle-/.test(ftype) || ftype === 'return') {
        const pt = first(pm, 'Point');
        const c = pt && parseCoords(first(pt, 'coordinates') || '')[0];
        if (c) {
          if (ftype === 'return') fence.returnPoint = c;
          else fence.circles.push({ type: ftype.slice(7), lat: c[0], lon: c[1], radius: parseFloat(ext.radius) });
        }
      }
    }
    if (holes) fence.warnings.push(`${holes} polygon hole(s) were ignored`);
    return fence;
  }

  async function unzipFirstKml(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid KMZ (zip) file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      entries.push({ name, method, csize, lho });
      p += 46 + nlen + xlen + clen;
    }
    const kmls = entries.filter((e) => /\.kml$/i.test(e.name));
    if (!kmls.length) throw new Error('KMZ contains no KML document');
    const e = kmls.find((x) => /(^|\/)doc\.kml$/i.test(x.name)) || kmls[0];
    const lh = e.lho;
    const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    const data = bytes.subarray(start, start + e.csize);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method !== 8) throw new Error('Unsupported KMZ compression');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  // ------------------------------------------------------------- dispatch

  function parseAny(filename, text) {
    const t = text.replace(/^﻿/, '');
    if (/^\s*QGC WPL/.test(t)) return parseWaypointFence(t);
    if (/<kml[\s>]|<(?:\w+:)?Placemark/i.test(t)) return parseKml(t);
    if (/\.poly$/i.test(filename)) return parseLatLonLines(t, false);
    if (/^\s*-?\d/m.test(t)) return parseLatLonLines(t, true);
    throw new Error('Unrecognised file format');
  }

  async function parseFile(filename, bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return parseKml(await unzipFirstKml(bytes));
    if (/\.stg$/i.test(filename) || (bytes[0] === STG.MAGIC && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0)) {
      return parseStg(bytes);
    }
    return parseAny(filename, new TextDecoder().decode(bytes));
  }

  return { writeWaypointFence, parseWaypointFence, writeStg, parseStg, stgSize, writeKml, parseKml, parseAny, parseFile };
});
