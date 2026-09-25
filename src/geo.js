/*
 * Geometry core: projection, polygon validation, splitting of large polygons
 * into ArduPilot-sized pieces, and the WGS-84 <-> GCJ-02 (mainland China)
 * coordinate transform.
 *
 * Coordinates handed in/out are [lat, lon] in degrees. All planar work is
 * done in a local equirectangular projection (metres). That projection is an
 * affine map of lat/lon, so straight edges stay straight in both spaces.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/earcut.min.js'), require('../vendor/polygon-clipping.umd.min.js'));
  } else {
    root.Geo = factory(root.earcut, root.polygonClipping);
  }
})(typeof self !== 'undefined' ? self : this, function (earcut, polygonClipping) {
  'use strict';

  // ---------------------------------------------------------------- basics

  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  function signedArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function round7(v) {
    return Math.round(v * 1e7) / 1e7;
  }

  function makeProjection(latlngs) {
    let lat0 = 0, lon0 = 0;
    for (const p of latlngs) { lat0 += p[0]; lon0 += p[1]; }
    lat0 /= latlngs.length; lon0 /= latlngs.length;
    const ky = 110540, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    return {
      fwd: (p) => [(p[1] - lon0) * kx, (p[0] - lat0) * ky],
      inv: (q) => [round7(q[1] / ky + lat0), round7(q[0] / kx + lon0)],
    };
  }

  // Signed orientation with a small tolerance, returns -1, 0 or 1.
  function orient(a, b, c) {
    const v = cross(a, b, c);
    const scale = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]),
      Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1]), 1e-12);
    if (Math.abs(v) <= 1e-12 * scale * scale) return 0;
    return v > 0 ? 1 : -1;
  }

  function onSegment(a, b, p) {
    return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
  }

  // True if closed segments ab and cd share any point.
  function segmentsIntersect(a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(a, b, c)) return true;
    if (o2 === 0 && onSegment(a, b, d)) return true;
    if (o3 === 0 && onSegment(c, d, a)) return true;
    if (o4 === 0 && onSegment(c, d, b)) return true;
    return false;
  }

  // ------------------------------------------------------------ ring hygiene

  // Drops the repeated closing vertex and consecutive duplicates.
  function cleanRing(latlngs) {
    const out = [];
    for (const p of latlngs) {
      const q = [round7(+p[0]), round7(+p[1])];
      if (!isFinite(q[0]) || !isFinite(q[1])) continue;
      const last = out[out.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      out.push(q);
    }
    while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  }

  // Returns the ring in counter-clockwise order (as seen with north up).
  function toCCW(latlngs) {
    const pts = latlngs.map((p) => [p[1], p[0]]);
    return signedArea(pts) < 0 ? latlngs.slice().reverse() : latlngs.slice();
  }

  // Finds a pair of crossing edges; returns null for a simple polygon.
  function findSelfIntersection(latlngs) {
    const n = latlngs.length;
    if (n < 3) return null;
    const pts = latlngs.map((p) => [p[1], p[0]]);
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      boxes.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
    }
    // sweep over x to keep this fast for large rings
    const order = boxes.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
    const active = [];
    for (const i of order) {
      const bi = boxes[i];
      for (let k = active.length - 1; k >= 0; k--) {
        if (boxes[active[k]][2] < bi[0]) active.splice(k, 1);
      }
      for (const j of active) {
        const bj = boxes[j];
        if (bj[1] > bi[3] || bj[3] < bi[1]) continue;
        const d = Math.abs(i - j);
        if (d === 1 || d === n - 1) {
          // adjacent edges may only share their common vertex
          const [e1, e2] = (j === (i + 1) % n) ? [i, j] : [j, i];
          const a = pts[e1], m = pts[(e1 + 1) % n], c = pts[(e2 + 1) % n];
          if (n > 3 && orient(a, m, c) === 0 && (a[0] - m[0]) * (c[0] - m[0]) + (a[1] - m[1]) * (c[1] - m[1]) > 0) return [i, j];
          continue;
        }
        if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return [i, j];
      }
      active.push(i);
    }
    return null;
  }

  // ------------------------------------------------------------ convex hull

  // Indices of the strict convex hull, in counter-clockwise order.
  function convexHullIndices(P) {
    const idx = P.map((_, i) => i).sort((a, b) => P[a][0] - P[b][0] || P[a][1] - P[b][1]);
    const lower = [], upper = [];
    for (const i of idx) {
      while (lower.length >= 2 && cross(P[lower[lower.length - 2]], P[lower[lower.length - 1]], P[i]) <= 0) lower.pop();
      lower.push(i);
    }
    for (let k = idx.length - 1; k >= 0; k--) {
      const i = idx[k];
      while (upper.length >= 2 && cross(P[upper[upper.length - 2]], P[upper[upper.length - 1]], P[i]) <= 0) upper.pop();
      upper.push(i);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // ------------------------------------------------- exclusion split (union)

  function leftOn(a, b, c) { return orient(a, b, c) >= 0; }
  function left(a, b, c) { return orient(a, b, c) > 0; }

  // Is the segment between positions i and j of the sub-polygon `idx` a
  // proper internal diagonal? Polygon must be counter-clockwise.
  function isDiagonal(P, idx, i, j) {
    const n = idx.length;
    if (i === j || (i + 1) % n === j || (j + 1) % n === i) return false;
    const inCone = (u, v) => {
      const a = P[idx[u]], b = P[idx[v]];
      const a0 = P[idx[(u - 1 + n) % n]], a1 = P[idx[(u + 1) % n]];
      if (leftOn(a0, a, a1)) return left(a, b, a0) && left(b, a, a1);
      return !(leftOn(a, b, a1) && leftOn(b, a, a0));
    };
    if (!inCone(i, j) || !inCone(j, i)) return false;
    const a = P[idx[i]], b = P[idx[j]];
    const minx = Math.min(a[0], b[0]), maxx = Math.max(a[0], b[0]);
    const miny = Math.min(a[1], b[1]), maxy = Math.max(a[1], b[1]);
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      if (k === i || k === j || k1 === i || k1 === j) continue;
      const c = P[idx[k]], d = P[idx[k1]];
      if (Math.max(c[0], d[0]) < minx || Math.min(c[0], d[0]) > maxx ||
          Math.max(c[1], d[1]) < miny || Math.min(c[1], d[1]) > maxy) continue;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
    return true;
  }

  // Fallback: pick the most balanced diagonal of a triangulation.
  function balancedDiagonal(P, idx) {
    const n = idx.length;
    const flat = [];
    for (const i of idx) flat.push(P[i][0], P[i][1]);
    const tris = earcut(flat);
    let best = null, bestScore = Infinity;
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        let u = tris[t + e], v = tris[t + (e + 1) % 3];
        if (u > v) [u, v] = [v, u];
        if (v - u === 1 || (u === 0 && v === n - 1)) continue;
        const score = Math.max(v - u + 1, n - (v - u) + 1);
        if (score < bestScore) { bestScore = score; best = [u, v]; }
      }
    }
    return best;
  }

  function findCut(P, idx, maxV) {
    const n = idx.length;
    const minK = Math.max(3, Math.floor(maxV / 2));
    for (let k = maxV; k >= minK; k--) {
      const cands = [];
      for (let s = 0; s < n; s++) cands.push([s, (s + k - 1) % n, dist(P[idx[s]], P[idx[(s + k - 1) % n]])]);
      cands.sort((x, y) => x[2] - y[2]);
      for (const [i, j] of cands) {
        if (isDiagonal(P, idx, i, j)) return i < j ? [i, j] : [j, i];
      }
    }
    return balancedDiagonal(P, idx);
  }

  // Splits a CCW polygon into pieces of at most maxV vertices whose union is
  // the polygon. Returns arrays of vertex indices.
  function splitUnion(P, maxV) {
    const out = [];
    const stack = [P.map((_, i) => i)];
    let guard = 0;
    while (stack.length) {
      if (++guard > 100000) throw new Error('Split did not converge');
      const idx = stack.pop();
      if (idx.length <= maxV) { out.push(idx); continue; }
      const cut = findCut(P, idx, maxV);
      if (!cut) throw new Error('Could not find a way to cut this polygon');
      const [a, b] = cut;
      stack.push(idx.slice(b).concat(idx.slice(0, a + 1)));
      stack.push(idx.slice(a, b + 1));
    }
    return out;
  }

  // Removes zero-width out-and-back excursions (a, b, a) from a ring whose
  // entries are vertex indices or new points.
  function removeSpikes(ring) {
    const same = (u, v) => u === v || (typeof u !== 'number' && typeof v !== 'number' && u[0] === v[0] && u[1] === v[1]);
    const r = ring.slice();
    let changed = true;
    while (changed && r.length > 3) {
      changed = false;
      for (let k = 0; k < r.length && r.length > 3; k++) {
        const n = r.length;
        if (same(r[(k - 1 + n) % n], r[(k + 1) % n])) {
          // drop the tip and one copy of the base
          const hi = Math.max(k, (k + 1) % n), lo = Math.min(k, (k + 1) % n);
          r.splice(hi, 1); r.splice(lo, 1);
          changed = true;
        }
      }
    }
    return r;
  }

  // --------------------------------------------- inclusion split (intersect)

  // Each piece is the polygon's boundary between two "split" vertices, closed
  // around the outside of the polygon via two spokes and the corners of a
  // bounding box. The spokes (non-crossing paths from each split vertex to
  // the box) partition the outside of the polygon, so every point outside
  // the original polygon is outside at least one piece, while the polygon
  // itself is inside every piece.
  function splitIntersection(P, maxV) {
    const n = P.length;
    const hull = convexHullIndices(P);
    if (hull.length < 3) throw new Error('Polygon is degenerate');
    const isHull = new Array(n).fill(false);
    hull.forEach((i) => { isHull[i] = true; });
    // vertices lying exactly on a hull edge count as hull points too, so that
    // every pocket (region between the polygon and its hull) is simple
    const strict = P.map((_, i) => i).filter((i) => isHull[i]);
    for (let k = 0; k < strict.length; k++) {
      const a = strict[k], b = strict[(k + 1) % strict.length];
      const A = P[a], B = P[b], L2 = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2;
      for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) {
        const off = Math.abs(cross(A, B, P[i])) / Math.sqrt(L2);
        const u = ((P[i][0] - A[0]) * (B[0] - A[0]) + (P[i][1] - A[1]) * (B[1] - A[1])) / L2;
        if (off < 1e-6 && u > 0 && u < 1) isHull[i] = true;
      }
    }
    // hull points in the polygon's own order
    const hullSeq = P.map((_, i) => i).filter((i) => isHull[i]);

    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of P) {
      minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
    }
    const margin = Math.max(0.15 * Math.max(maxx - minx, maxy - miny), 30);
    const box = { x0: minx - margin, y0: miny - margin, x1: maxx + margin, y1: maxy + margin };
    const W = box.x1 - box.x0, H = box.y1 - box.y0;

    const rayExit = (p, d) => {
      let t = Infinity;
      if (d[0] > 1e-12) t = Math.min(t, (box.x1 - p[0]) / d[0]);
      if (d[0] < -1e-12) t = Math.min(t, (box.x0 - p[0]) / d[0]);
      if (d[1] > 1e-12) t = Math.min(t, (box.y1 - p[1]) / d[1]);
      if (d[1] < -1e-12) t = Math.min(t, (box.y0 - p[1]) / d[1]);
      return [p[0] + t * d[0], p[1] + t * d[1]];
    };
    const outward = (a, b) => { // right-hand normal of a->b (outside for CCW)
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dy / l, -dx / l];
    };
    const boxParam = (q) => {
      const e = 1e-6 * (W + H);
      if (Math.abs(q[1] - box.y0) < e) return q[0] - box.x0;
      if (Math.abs(q[0] - box.x1) < e) return W + (q[1] - box.y0);
      if (Math.abs(q[1] - box.y1) < e) return W + H + (box.x1 - q[0]);
      return 2 * W + H + (box.y1 - q[1]);
    };
    const corners = [[box.x0, box.y0, 0], [box.x1, box.y0, W], [box.x1, box.y1, W + H], [box.x0, box.y1, 2 * W + H]];
    const perim = 2 * (W + H);

    // hull-vertex spokes: along the bisector of the two outward edge normals
    const hullPos = new Map();
    hullSeq.forEach((h, k) => hullPos.set(h, k));
    const hullSpoke = (h) => {
      const k = hullPos.get(h), m = hullSeq.length;
      const hp = P[hullSeq[(k - 1 + m) % m]], hn = P[hullSeq[(k + 1) % m]];
      const n1 = outward(hp, P[h]), n2 = outward(P[h], hn);
      let d = [n1[0] + n2[0], n1[1] + n2[1]];
      const l = Math.hypot(d[0], d[1]);
      d = l > 1e-12 ? [d[0] / l, d[1] / l] : n1;
      return [rayExit(P[h], d)];
    };

    // pockets: runs of the boundary between consecutive hull vertices
    const pocketOf = new Array(n).fill(null);
    for (let k = 0; k < hullSeq.length; k++) {
      const a = hullSeq[k], b = hullSeq[(k + 1) % hullSeq.length];
      if ((a + 1) % n === b) continue;
      const chain = [];
      for (let i = a; ; i = (i + 1) % n) { chain.push(i); if (i === b) break; }
      const cum = [0];
      for (let c = 1; c < chain.length; c++) cum.push(cum[c - 1] + dist(P[chain[c - 1]], P[chain[c]]));
      const pocket = { a, b, chain, cum, normal: outward(P[a], P[b]), tri: null };
      chain.forEach((i, c) => { if (c > 0 && c < chain.length - 1) pocketOf[i] = { pocket, c }; });
    }

    const prepPocket = (pk) => {
      if (pk.tri) return pk.tri;
      const m = pk.chain.length;
      const flat = [];
      for (const i of pk.chain) flat.push(P[i][0], P[i][1]);
      const raw = earcut(flat);
      const tris = [];
      for (let t = 0; t < raw.length; t += 3) {
        let tr = [raw[t], raw[t + 1], raw[t + 2]];
        const ar = cross(P[pk.chain[tr[0]]], P[pk.chain[tr[1]]], P[pk.chain[tr[2]]]);
        if (ar < 0) tr = [tr[0], tr[2], tr[1]];
        tris.push(tr);
      }
      const edgeMap = new Map();
      const key = (u, v) => (u < v ? u * m + v : v * m + u);
      tris.forEach((tr, t) => {
        for (let e = 0; e < 3; e++) {
          const k = key(tr[e], tr[(e + 1) % 3]);
          if (!edgeMap.has(k)) edgeMap.set(k, []);
          edgeMap.get(k).push(t);
        }
      });
      const lidTris = edgeMap.get(key(0, m - 1)) || [];
      const res = { tris, edgeMap, key, dist: null, parent: null, vtris: null };
      if (lidTris.length !== 1) { pk.tri = res; return res; }
      const distA = new Array(tris.length).fill(-1), parent = new Array(tris.length).fill(-1);
      const queue = [lidTris[0]];
      distA[lidTris[0]] = 0;
      for (let q = 0; q < queue.length; q++) {
        const t = queue[q], tr = tris[t];
        for (let e = 0; e < 3; e++) {
          for (const u of edgeMap.get(key(tr[e], tr[(e + 1) % 3]))) {
            if (distA[u] < 0) { distA[u] = distA[t] + 1; parent[u] = t; queue.push(u); }
          }
        }
      }
      const vtris = Array.from({ length: m }, () => []);
      tris.forEach((tr, t) => tr.forEach((v) => vtris[v].push(t)));
      Object.assign(res, { dist: distA, parent, vtris });
      pk.tri = res;
      return res;
    };

    // shortest path inside the pocket from chain vertex c to point t on the
    // lid (funnel algorithm over the pocket triangulation)
    const geodesic = (pk, c, t) => {
      const T = prepPocket(pk);
      if (!T.dist) return null;
      let cands = T.vtris[c];
      if (!cands.length) {
        // vertex was dropped by the triangulator (collinear); it lies on the
        // edge between its nearest triangulated neighbours
        let cp = c - 1, cn = c + 1;
        while (cp > 0 && !T.vtris[cp].length) cp--;
        while (cn < T.vtris.length - 1 && !T.vtris[cn].length) cn++;
        cands = T.edgeMap.get(T.key(cp, cn)) || [];
      }
      let start = -1;
      for (const tr of cands) if (T.dist[tr] >= 0 && (start < 0 || T.dist[tr] < T.dist[start])) start = tr;
      if (start < 0) return null;
      const seq = [start];
      while (T.dist[seq[seq.length - 1]] > 0) seq.push(T.parent[seq[seq.length - 1]]);
      const pt = (v) => (v === 'end' ? t : P[pk.chain[v]]);
      const portals = [[c, c]];
      for (let s = 0; s + 1 < seq.length; s++) {
        const tr = T.tris[seq[s]], nx = T.tris[seq[s + 1]];
        for (let e = 0; e < 3; e++) {
          const p = tr[e], q = tr[(e + 1) % 3];
          if (nx.includes(p) && nx.includes(q)) { portals.push([q, p]); break; } // [left, right]
        }
      }
      portals.push(['end', 'end']);
      const path = [];
      let apex = c, pl = c, pr = c, ai = 0, li = 0, ri = 0;
      const same = (u, v) => u === v || dist(pt(u), pt(v)) < 1e-9;
      for (let i = 1; i < portals.length; i++) {
        const [l, r] = portals[i];
        if (cross(pt(apex), pt(pr), pt(r)) >= 0) {
          if (same(apex, pr) || cross(pt(apex), pt(pl), pt(r)) < 0) { pr = r; ri = i; }
          else {
            path.push(pl); apex = pl; ai = li; pr = apex; ri = ai; i = ai; continue;
          }
        }
        if (cross(pt(apex), pt(pl), pt(l)) <= 0) {
          if (same(apex, pl) || cross(pt(apex), pt(pr), pt(l)) > 0) { pl = l; li = i; }
          else {
            path.push(pr); apex = pr; ai = ri; pl = apex; li = ai; i = ai; continue;
          }
        }
      }
      return path.filter((v) => v !== 'end' && v !== c).map((v) => pk.chain[v]);
    };

    const spokeMemo = new Map();
    const spoke = (w) => {
      if (spokeMemo.has(w)) return spokeMemo.get(w);
      let s = null;
      if (isHull[w]) s = hullSpoke(w);
      else {
        const { pocket: pk, c } = pocketOf[w];
        const A = P[pk.a], B = P[pk.b];
        const offLid = Math.abs(cross(A, B, P[w])) / (dist(A, B) || 1);
        if (offLid < 1e-6) s = [rayExit(P[w], pk.normal)];
        else {
          const f = pk.cum[c] / pk.cum[pk.cum.length - 1];
          const t = [A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1])];
          const g = geodesic(pk, c, t);
          if (g) s = g.concat([t, rayExit(t, pk.normal)]);
        }
      }
      spokeMemo.set(w, s);
      return s;
    };
    const cost = (w) => { const s = spoke(w); return s ? s.length : null; };

    // greedy choice of split vertices
    const s0 = hullSeq[0];
    const splits = [s0];
    let cur = 0;
    for (let guard = 0; ; guard++) {
      if (guard > n + 5) throw new Error('Split did not converge');
      const wa = (s0 + cur) % n;
      const ca = cost(wa);
      if ((n - cur + 1) + ca + cost(s0) + 4 <= maxV) break;
      const maxLen = maxV - 4 - ca - 1;
      // first look for a split vertex with a straight spoke (it can see
      // outside directly), accepting a somewhat shorter piece for it
      let found = false;
      const hi = Math.min(cur + maxLen - 1, n - 1);
      const lo = Math.max(cur + 1, hi - Math.floor(maxLen / 3));
      for (const clean of [true, false]) {
        for (let off = hi; off > (clean ? lo - 1 : cur); off--) {
          const c = cost((s0 + off) % n);
          if (c === null || (clean && c > 2)) continue;
          if ((off - cur + 1) + ca + c + 4 <= maxV) {
            splits.push((s0 + off) % n); cur = off; found = true; break;
          }
        }
        if (found) break;
      }
      if (!found) throw new Error('Polygon shape is too intricate to split with this vertex limit');
    }

    const pieces = [];
    for (let k = 0; k < splits.length; k++) {
      const wa = splits[k], wb = splits[(k + 1) % splits.length];
      const piece = [];
      for (let i = wa; ; i = (i + 1) % n) { piece.push(i); if (i === wb) break; }
      const sb = spoke(wb), sa = spoke(wa);
      for (const q of sb) piece.push(q);
      const pb = boxParam(sb[sb.length - 1]);
      let pa = boxParam(sa[sa.length - 1]);
      if (pa <= pb) pa += perim;
      const cs = [];
      for (const cn of corners) {
        for (const off of [cn[2], cn[2] + perim]) if (off > pb && off < pa) cs.push([off, [cn[0], cn[1]]]);
      }
      cs.sort((x, y) => x[0] - y[0]).forEach((x) => piece.push(x[1]));
      for (let q = sa.length - 1; q >= 0; q--) piece.push(sa[q]);
      pieces.push(removeSpikes(piece));
    }
    return pieces;
  }

  // ------------------------------------------------------------ public API

  /**
   * Splits a polygon for ArduPilot.
   * latlngs: [[lat, lon], ...] (open ring)
   * mode: 'inclusion' (pieces intersect to the original) or
   *       'exclusion' (pieces union to the original)
   * Returns array of [[lat, lon], ...] pieces; a single piece if no split is needed.
   */
  function splitPolygon(latlngs, mode, maxV) {
    const ring = toCCW(cleanRing(latlngs));
    if (ring.length < 3) throw new Error('Polygon needs at least 3 vertices');
    if (ring.length <= maxV) return [ring];
    if (maxV < 12) throw new Error('Vertex limit is too small');
    const proj = makeProjection(ring);
    const P = ring.map(proj.fwd);
    const raw = mode === 'inclusion' ? splitIntersection(P, maxV) : splitUnion(P, maxV);
    return raw.map((piece) => piece.map((v) => (typeof v === 'number' ? ring[v].slice() : proj.inv(v))));
  }

  // ------------------------------------------------- boolean helpers (merge)

  const toPC = (ring) => [ring.map((p) => [p[1], p[0]])];
  const fromPC = (r) => cleanRing(r.map((p) => [p[1], p[0]]));

  function areaM2(latlngs) {
    const proj = makeProjection(latlngs);
    return Math.abs(signedArea(latlngs.map(proj.fwd)));
  }

  function mpArea(mp, proj) {
    let s = 0;
    for (const poly of mp) {
      poly.forEach((r, k) => {
        const a = Math.abs(signedArea(r.map((p) => proj.fwd([p[1], p[0]]))));
        s += k === 0 ? a : -a;
      });
    }
    return s;
  }

  // Relative area of the symmetric difference between the original polygon
  // and the combination of its pieces. ~0 means the split is exact.
  function verifySplit(original, pieces, mode) {
    if (!polygonClipping) return null;
    const combo = mode === 'inclusion'
      ? polygonClipping.intersection(...pieces.map(toPC))
      : polygonClipping.union(...pieces.map(toPC));
    const diff = polygonClipping.xor(combo, [toPC(original)]);
    const proj = makeProjection(original);
    return mpArea(diff, proj) / Math.abs(signedArea(original.map(proj.fwd)));
  }

  // Recombines polygons of one fence type into as few polygons as possible.
  // Inclusion fences combine by intersection, exclusion fences by union.
  // Returns null if the result cannot be expressed as simple polygons.
  function mergePolygons(polys, mode) {
    if (polys.length < 2) return polys.map((p) => p.slice());
    const res = mode === 'inclusion'
      ? polygonClipping.intersection(...polys.map(toPC))
      : polygonClipping.union(...polys.map(toPC));
    if (!res.length) return null;
    if (res.some((poly) => poly.length > 1)) return null; // holes
    return res.map((poly) => fromPC(poly[0]));
  }

  // --------------------------------------------- mainland China (GCJ-02)

  const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;

  function outOfChina(lat, lon) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function tLat(x, y) {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  }

  function tLon(x, y) {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  }

  function wgsToGcj(lat, lon) {
    if (outOfChina(lat, lon)) return [lat, lon];
    let dLat = tLat(lon - 105, lat - 35), dLon = tLon(lon - 105, lat - 35);
    const radLat = lat / 180 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    const sq = Math.sqrt(magic);
    dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sq) * Math.PI);
    dLon = (dLon * 180) / (GCJ_A / sq * Math.cos(radLat) * Math.PI);
    return [lat + dLat, lon + dLon];
  }

  function gcjToWgs(lat, lon) {
    if (outOfChina(lat, lon)) return [lat, lon];
    let wl = lat, wn = lon;
    for (let i = 0; i < 20; i++) {
      const g = wgsToGcj(wl, wn);
      const dl = lat - g[0], dn = lon - g[1];
      wl += dl; wn += dn;
      if (Math.abs(dl) < 1e-10 && Math.abs(dn) < 1e-10) break;
    }
    return [wl, wn];
  }

  return {
    cleanRing, toCCW, findSelfIntersection, splitPolygon, verifySplit, mergePolygons,
    areaM2, wgsToGcj, gcjToWgs, outOfChina, round7,
    _internal: { splitUnion, splitIntersection, convexHullIndices, makeProjection, signedArea },
  };
});
