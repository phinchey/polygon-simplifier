# Geofence Editor for ArduPilot

Draw or import polygon geofences, automatically break large polygons into
pieces ArduPilot accepts, and export them for Mission Planner or directly to
the flight controller's SD card.

**The whole app is one file: [`GeofenceEditor.html`](GeofenceEditor.html)
(about 290 KB).** Download it and open it in any modern browser (Chrome, Edge,
Firefox or Safari) on Windows, macOS or Linux. Nothing needs to be installed,
and it works from a local folder or a USB stick. An internet connection is only
needed for the background map tiles.

## Features

- **Draw** fences by clicking vertices on satellite, street or topographic maps.
- **Inclusion / exclusion** type chosen with graphical buttons: a green fence
  with the drone inside (stay in) or a red hatched fence with a no-entry sign
  (keep out).
- **Automatic splitting**: any polygon with more vertices than the limit
  (default 69, adjustable) is split into polygons of at most that many
  vertices:
  - *Inclusion*: overlapping polygons whose **intersection** is exactly the
    original fence. ArduPilot requires the vehicle to be inside every inclusion
    polygon, so the effective fence is unchanged.
  - *Exclusion*: adjoining polygons whose **union** is exactly the original
    fence.

  Each split is checked with polygon boolean operations, and a ✓ is shown
  when the pieces reproduce the original area exactly.
- **Edit**: drag vertices, drag or click the midpoint handles to add vertices,
  and right-click (or Ctrl-click) a vertex to delete it. Undo with Ctrl+Z.
- **Return point** (optional) and circle fences read from files are kept and
  exported again.
- **Mainland China mode** corrects for the GCJ-02 offset used by Chinese maps.
  The map uses AMap tiles, and everything you draw or see is shifted between
  the map's GCJ-02 frame and true WGS-84. The cursor readout shows both.
  Exported files are always WGS-84, which is what ArduPilot uses. When
  importing KML/KMZ drawn on a Chinese map, tick *KML/KMZ coordinates are
  GCJ-02* to convert them.
- Work is saved in the browser automatically between sessions.

## File formats

| Format | Open | Save | Notes |
| --- | :-: | :-: | --- |
| `.fence` / `.txt` / `.waypoints` | ✓ | ✓ | Mission Planner / MAVProxy fence file (`QGC WPL 110` with `MAV_CMD_NAV_FENCE_*` items) |
| `fence.stg` | ✓ | ✓ | ArduPilot SD card fence storage (see below) |
| `.kml` / `.kmz` | ✓ | ✓ (KML) | Polygons (holes are ignored) and closed paths |
| `.fen` | ✓ | | Legacy Mission Planner fence (return point then `lat lon` lines) |
| `.poly` | ✓ | | MAVProxy `lat lon` polygon |

When an ArduPilot file (`.fence`, `.txt`, `.stg`) is opened, the split pieces
are recombined into the original shapes for editing: inclusion polygons by
intersection and exclusion polygons by union. Untick *Recombine split fences*
to load the pieces as they are.

### Uploading with Mission Planner

Open the **Plan** screen, change the dropdown from *Mission* to *Fence*,
click **Load File**, choose the exported `.fence` / `.txt`, and then **Write**.

### SD card storage (`BRD_SD_FENCE`)

When `BRD_SD_FENCE` is non-zero, ArduPilot keeps the fence in the file
`APM/fence.stg` on the microSD card instead of the internal storage.
`BRD_SD_FENCE` is the size of that file in kilobytes. The file is a raw image
of ArduPilot's fence storage (`AC_PolyFence_loader`):

```
bytes 0-3   magic: 235, 0, 0, 0
then items, each starting with a type byte:
  98 / 97   polygon inclusion / exclusion: uint8 vertex count, then per vertex int32 lat, int32 lon (degrees * 1e7)
  92 / 93   circle inclusion / exclusion: int32 lat, int32 lon, float32 radius (m)
  95        return point: int32 lat, int32 lon
  99        end of storage
all values little-endian
```

Export `fence.stg`, then with the vehicle powered off copy it to the `APM`
folder on the SD card, replacing the existing file. Set `BRD_SD_FENCE` at least
as large as the size shown under Export, then reboot.

## Development

The app is plain JavaScript with no build dependencies other than Node.js:

```
src/geo.js       geometry: splitting, verification, GCJ-02 transform
src/formats.js   file readers and writers
src/app.js       user interface
src/index.html   page template
src/app.css      styles
vendor/          Leaflet, earcut, polygon-clipping (with their licences)
```

```
node build.js      # regenerate GeofenceEditor.html
node test/run.js   # geometry and file-format tests
```

### How the inclusion split works

The polygon's boundary is cut at a few *split vertices*. From each split vertex
a *spoke* runs outward to a bounding box around the polygon. For vertices on
the convex hull the spoke is a straight ray. For vertices inside a concave
pocket it is the shortest path out of the pocket, found by triangulating the
pocket and running the funnel algorithm. The spokes never cross, so they divide
the area outside the polygon into regions. Each exported polygon is the whole
bounding box minus one of those regions: it follows the original boundary
between two consecutive split vertices and closes around the outside. Every
point of the original fence is inside all pieces, and every point outside it
is outside at least one piece.

Exclusion polygons are split along internal diagonals, choosing the shortest
diagonal that cuts off a piece of the maximum size.
