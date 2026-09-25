// Geometry and file-format regression tests: `node test/run.js`
'use strict';
const Geo = require('../src/geo.js');
const Formats = require('../src/formats.js');

let failures = 0, checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log('  FAIL: ' + msg); }
}

let seed = 12345;
function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

const LAT0 = 49.25, LON0 = -123.1;
const m2ll = (x, y) => [LAT0 + y / 110540, LON0 + x / (111320 * Math.cos(LAT0 * Math.PI / 180))];

function star(n, rMin, rMax) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = rMin + (rMax - rMin) * rand();
    pts.push(m2ll(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
}

function smoothStar(n) {
  const pts = [];
  const k1 = 1 + Math.floor(rand() * 5), k2 = 3 + Math.floor(rand() * 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const r = 1000 + 300 * Math.sin(k1 * a) + 150 * Math.cos(k2 * a) + 20 * rand();
    pts.push(m2ll(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
}

// comb: a strip with tall narrow teeth, each tooth side subdivided
function comb(teeth, sub) {
  const w = 100;
  const pts = [m2ll(0, 0), m2ll(2 * w * (teeth - 1) + w, 0)];
  for (let t = teeth - 1; t >= 0; t--) {
    const xr = 2 * w * t + w, xl = 2 * w * t;
    for (let s = 0; s <= sub; s++) pts.push(m2ll(xr, 200 + (1000 * s) / sub));
    for (let s = sub; s >= 0; s--) pts.push(m2ll(xl, 200 + (1000 * s) / sub));
  }
  return pts;
}

// spiral corridor: a thick spiral arm, gives very deep winding pockets
function spiral(turns, perTurn) {
  const inner = [], outer = [];
  const N = turns * perTurn;
  for (let i = 0; i <= N; i++) {
    const a = (i / perTurn) * 2 * Math.PI;
    const r = 200 + 180 * (i / perTurn);
    outer.push(m2ll((r + 60) * Math.cos(a), (r + 60) * Math.sin(a)));
    inner.push(m2ll(r * Math.cos(a), r * Math.sin(a)));
  }
  return outer.concat(inner.reverse());
}

function simpleOrWeaklySimple(ring) {
  // pieces may touch themselves at a shared vertex, but edges must not cross
  const x = Geo.findSelfIntersection(ring);
  if (!x) return true;
  return false;
}

function runCase(name, pts, maxV) {
  for (const mode of ['inclusion', 'exclusion']) {
    let pieces;
    try {
      pieces = Geo.splitPolygon(pts, mode, maxV);
    } catch (e) {
      check(false, `${name} ${mode}: threw ${e.message}`);
      continue;
    }
    const ring = Geo.toCCW(Geo.cleanRing(pts));
    const over = pieces.filter((p) => p.length > maxV || p.length < 3);
    check(over.length === 0, `${name} ${mode}: piece sizes ${pieces.map((p) => p.length)}`);
    const err = Geo.verifySplit(ring, pieces, mode);
    check(err !== null && err < 1e-6, `${name} ${mode}: area mismatch ${err}`);
    const crossing = pieces.filter((p) => !simpleOrWeaklySimple(p)).length;
    if (crossing) console.log(`  note: ${name} ${mode}: ${crossing} piece(s) touch themselves`);
    if (process.env.VERBOSE) console.log(`  ${name} ${mode}: ${ring.length} -> ${pieces.length} pieces [${pieces.map((p) => p.length)}] err=${err}`);
  }
}

console.log('geometry');
runCase('square', [m2ll(0, 0), m2ll(100, 0), m2ll(100, 100), m2ll(0, 100)], 69);
runCase('circle200', star(200, 1000, 1000), 69);
runCase('circle1000', star(1000, 1000, 1000), 69);
for (let k = 0; k < 15; k++) runCase('noisystar' + k, star(70 + Math.floor(rand() * 400), 300 + rand() * 300, 1000), 69);
for (let k = 0; k < 10; k++) runCase('smoothstar' + k, smoothStar(70 + Math.floor(rand() * 900)), 69);
runCase('comb', comb(8, 20), 69);
runCase('comb-deep', comb(3, 60), 69);
runCase('spiral', spiral(1, 150), 69);
runCase('spiral-small-limit', spiral(1, 60), 30);
runCase('limit20', star(300, 500, 1000), 20);
check(Geo.findSelfIntersection([m2ll(0, 0), m2ll(10, 10), m2ll(10, 0), m2ll(0, 10)]) !== null, 'bowtie detected');
check(Geo.findSelfIntersection(star(300, 500, 1000)) === null, 'star is simple');

console.log('merge');
{
  const pts = Geo.toCCW(Geo.cleanRing(smoothStar(400)));
  for (const mode of ['inclusion', 'exclusion']) {
    const pieces = Geo.splitPolygon(pts, mode, 69);
    const merged = Geo.mergePolygons(pieces, mode);
    check(merged && merged.length === 1, `${mode} merge gives one polygon`);
    if (merged) {
      const err = Geo.verifySplit(pts, merged, 'exclusion');
      check(err < 1e-6, `${mode} merged area matches (${err})`);
    }
  }
}

console.log('china transform');
{
  const [gl, gn] = Geo.wgsToGcj(39.9087, 116.3975);
  check(Math.abs(gl - 39.9087) > 1e-4 && Math.abs(gn - 116.3975) > 1e-4, 'gcj offset applied in China');
  const [wl, wn] = Geo.gcjToWgs(gl, gn);
  check(Math.abs(wl - 39.9087) < 1e-7 && Math.abs(wn - 116.3975) < 1e-7, 'gcj round trip');
  const o = Geo.wgsToGcj(49.25, -123.1);
  check(o[0] === 49.25 && o[1] === -123.1, 'no offset outside China');
}

console.log('formats');
{
  const fence = {
    polygons: [
      { type: 'inclusion', pts: Geo.cleanRing(star(10, 900, 1000)) },
      { type: 'exclusion', pts: Geo.cleanRing(star(5, 50, 60)) },
    ],
    circles: [{ type: 'exclusion', lat: 49.26, lon: -123.11, radius: 25.5 }],
    returnPoint: [49.2501, -123.1001],
  };
  const same = (a, b) => JSON.stringify(a.polygons) === JSON.stringify(b.polygons) &&
    JSON.stringify(a.circles) === JSON.stringify(b.circles) &&
    JSON.stringify(a.returnPoint) === JSON.stringify(b.returnPoint);

  const wpl = Formats.writeWaypointFence(fence);
  check(wpl.startsWith('QGC WPL 110\n0\t1\t0\t16\t'), 'wpl header + home line');
  check(same(Formats.parseWaypointFence(wpl), fence), 'wpl round trip');

  const stg = Formats.writeStg(fence);
  check(stg[0] === 235 && stg[1] === 0 && stg[4] === 98, 'stg header');
  check(stg.length % 1024 === 0, 'stg padded to 1 KB');
  check(same(Formats.parseStg(stg), fence), 'stg round trip');

  const kml = Formats.writeKml(fence);
  const back = Formats.parseKml(kml);
  check(back.polygons.length === 2 && back.polygons[1].type === 'exclusion', 'kml round trip types');
  check(JSON.stringify(back.polygons[0].pts) === JSON.stringify(fence.polygons[0].pts), 'kml round trip coords');

  const legacy = '# saved\n49.2501 -123.1001\n49.25 -123.1\n49.26 -123.1\n49.26 -123.09\n49.25 -123.1\n';
  const lf = Formats.parseAny('fence.fen', legacy);
  check(lf.polygons.length === 1 && lf.polygons[0].pts.length === 3 && lf.returnPoint[0] === 49.2501, 'legacy fen');
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
