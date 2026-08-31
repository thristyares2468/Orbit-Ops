// Last updated: 13 August 2026
// Shared catalog for imported maps. Nuke, Inferno, and Mirage are public;
// Vertigo stays available only through the allow-listed admin room.
// Positions are eye-height candidates in the browser's world scale; both server
// and client ground them against the converted GLB before spawning a player.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GameMaps = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAP_ASSET_VERSION = '2026-08-13-mirage-uv-breakables-v6';
  const assetPath = id => `/assets/maps/de_${id}.glb?v=${MAP_ASSET_VERSION}`;
  const ADMIN_MAP_IDS = ['nuke', 'inferno', 'vertigo', 'mirage'];
  const PUBLIC_MAP_IDS = ['dust2', 'nuke', 'inferno', 'mirage'];
  const HALF_MAP_RULES = {
    nuke: {
      type: 'floor', top: -122.5, thickness: 8,
      xMin: -930, xMax: 1050, zMin: -285, zMax: 800,
      surfaceTexture: 'crete4_flr01'
    },
    inferno: {
      type: 'wallX', x: 310, keep: 'less', thickness: 8,
      yMin: -135, yMax: 160, zMin: -980, zMax: 260,
      surfaceTexture: 'cuwllj'
    },
    mirage: {
      type: 'wallX', x: -430, keep: 'greater', thickness: 8,
      yMin: -75, yMax: 100, zMin: -535, zMax: 420,
      surfaceTexture: 'cuwllj'
    }
  };
  const IMPORTED_MAP_SCALE = 22;
  const IMPORTED_SPAWN_SCALE = IMPORTED_MAP_SCALE / 20;
  const withBoundsMetadata = row => ({
    ...row,
    center: row.min.map((value, axis) => (value + row.max[axis]) / 2)
  });
  // Authored GoldSrc func_door brush bounds after BSP -> GLB axis conversion.
  // Each entry is one double sliding doorway; the midpoint separates its leaves.
  const NUKE_DOORS = [
    { id: 'nuke-door-0', min: [2.94, -9.52, 11.38], max: [3.06, -8.12, 13.12] },
    { id: 'nuke-door-1', min: [12.94, -9.52, 25.28], max: [13.06, -8.12, 27.02] },
    { id: 'nuke-door-2', min: [2.94, -9.52, 25.28], max: [3.06, -8.12, 27.02] },
    { id: 'nuke-door-3', min: [12.94, -9.52, 11.38], max: [13.06, -8.12, 13.12] }
  ].map(door => ({
    ...withBoundsMetadata(door),
    slide: (door.max[2] - door.min[2]) * 0.49
  }));
  // Connected components from the shipped Nuke GLB. Keeping these authored
  // bounds shared prevents the browser and server assigning different IDs.
  const NUKE_LADDERS = [
    { id: 'nuke-ladder-0', min: [2.85, -5.1, 9.8], max: [2.9, -1.2, 10.2] },
    { id: 'nuke-ladder-1', min: [13, -5.1, 5], max: [13.05, -1.1, 5.4] },
    { id: 'nuke-ladder-2', min: [10.55, -7.4, 17.8], max: [10.6, -5.1, 18.2] },
    { id: 'nuke-ladder-3', min: [6.15, -7.4, 17.8], max: [6.2, -5.1, 18.2] }
  ].map(withBoundsMetadata);
  const NUKE_VENTS = [
    { id: 'nuke-vent-0', min: [9.8, -7.5, 16.5], max: [10.6, -6.7, 16.6] },
    { id: 'nuke-vent-1', min: [9.8, -5.1, 17.6], max: [10.6, -4.3, 17.7] },
    { id: 'nuke-vent-2', min: [5.4, -7.5, 16.5], max: [6.2, -6.7, 16.6] },
    { id: 'nuke-vent-3', min: [5.4, -5.1, 17.6], max: [6.2, -4.3, 17.7] },
    { id: 'nuke-vent-4', min: [9.8, -7.5, 21.8], max: [10.6, -6.7, 21.9] },
    { id: 'nuke-vent-5', min: [5.4, -7.5, 21.8], max: [6.2, -6.7, 21.9] }
  ].map(withBoundsMetadata);
  // Only the five inserts explicitly identified in the Mirage screenshots are
  // destructible. Coordinates are in the source GLB space; matching by bounds
  // prevents every other mesh sharing these textures from being removed.
  const MIRAGE_BREAKABLE_WINDOWS = [
    { id: 'mirage-window-louvered-low', texture: '{eastwndwn2', min: [-20.41, -0.01, -1.21], max: [-20.39, 0.81, -0.39] },
    { id: 'mirage-window-louvered-high', texture: '{eastwndwn2', min: [-19.81, -0.01, -1.21], max: [-19.79, 0.81, -0.39] },
    { id: 'mirage-window-louvered', texture: '{eastwndwn2', min: [-18.21, 1.39, -7.71], max: [-17.39, 2.21, -7.39] },
    { id: 'mirage-window-boarded', texture: 'eastwndwn1', min: [-13.21, 0.29, 8.89], max: [-13.19, 1.11, 9.71] },
    { id: 'mirage-window-boarded-crates', texture: 'eastwndwn1', min: [-13.21, 0.29, 11.09], max: [-13.19, 1.11, 11.91] }
  ];
  const ADMIN_TELEPORTS = {
    dust2: {
      A: { x: 304.8, z: 23985.76, yHint: 20180 },
      B: { x: -413.62, z: 23945.79, yHint: 20180 }
    },
    // Target centers come from the source BSP bomb-trigger bounds. yHint stays
    // close to the intended floor so stacked or roofed geometry cannot win the
    // grounding ray before the actual bombsite does.
    nuke: {
      A: { x: 187, z: 213.4, yHint: -80 },
      B: { x: 178.2, z: 248.6, yHint: -185 }
    },
    inferno: {
      A: { x: 545.6, z: -125.4, yHint: 70 },
      B: { x: 79.2, z: -765.6, yHint: 70 }
    },
    vertigo: {
      A: { x: -85.8, z: -57.2, yHint: 26 },
      B: { x: -627, z: -206.8, yHint: 26 }
    },
    // Mirage's shipped floor artwork identifies the A and B target centers.
    mirage: {
      A: { x: -177.1, z: 322.3, yHint: 20 },
      B: { x: -666.6, z: -338.8, yHint: 20 }
    }
  };

  // Containment barriers are authored at actual route choke points, never at
  // player/enemy spawn markers. Coordinates were measured against the
  // walkable triangles in each shipped GLB. `width` spans wall-to-wall and
  // `yaw` rotates that span across (rather than along) the route. Every gate
  // owns a named sector: buying it adds that sector's breach points to the
  // horde director rather than leaving the barriers as unrelated props.
  const CONTAINMENT_GATES = {
    dust2: [
      // Measured from the labelled Ground captures in
      // docs/zombies-gate-ground-coordinates.txt. Where two captures span a
      // doorway, each pair is used as a choke-area seed. The final centre,
      // floor, rotation, and span are snapped against the Dust2 GLB's actual
      // walkable floor and wall triangles. Every width includes a small wall
      // overlap so neither players nor zombies can squeeze around a closed
      // barrier at its ends.
      { id: 'dust2-gate-01', label: 'Gate 1', section: 'Gate 1', x: 140.27, z: 24083.70, yHint: 20126.78, yaw: -2.793, width: 69.1 },
      { id: 'dust2-gate-02', label: 'Gate 2', section: 'Gate 2', x: -102.42, z: 24189.10, yHint: 20125.87, yaw: 0, width: 77.9 },
      { id: 'dust2-gate-03', label: 'Gate 3', section: 'Gate 3', x: -188.57, z: 23976.25, yHint: 20132.12, yaw: -2.793, width: 81.2 },
      { id: 'dust2-gate-04', label: 'Gate 4', section: 'Gate 4', x: -149.84, z: 24257.35, yHint: 20130.13, yaw: -1.396, width: 63 },
      { id: 'dust2-gate-05', label: 'Gate 5', section: 'Gate 5', x: -102.50, z: 24455.08, yHint: 20160, yaw: -2.618, width: 90.9 },
      { id: 'dust2-gate-06', label: 'Gate 6', section: 'Gate 6', x: 121.26, z: 24203.36, yHint: 20160, yaw: -0.436, width: 39.4 },
      { id: 'dust2-gate-07', label: 'Gate 7', section: 'Gate 7', x: 255.27, z: 24012.57, yHint: 20157.05, yaw: -0.611, width: 51.5 },
      { id: 'dust2-gate-08', label: 'Gate 8', section: 'Gate 8', x: 337.94, z: 24055.65, yHint: 20160, yaw: -Math.PI / 2, width: 69.4 },
      { id: 'dust2-gate-09', label: 'Gate 9', section: 'Gate 9', x: 388.44, z: 24321.97, yHint: 20160, yaw: 0, width: 88.3 },
      { id: 'dust2-gate-10', label: 'Gate 10', section: 'Gate 10', x: 66.48, z: 24769.40, yHint: 20160, yaw: -0.175, width: 84.1 },
      { id: 'dust2-gate-11', label: 'Gate 11', section: 'Gate 11', x: -255.17, z: 24840.56, yHint: 20194.13, yaw: -1.309, width: 71.7 },
      { id: 'dust2-gate-12', label: 'Gate 12', section: 'Gate 12', x: 168.89, z: 24447.84, yHint: 20160, yaw: -0.349, width: 58.5 },
      { id: 'dust2-gate-13', label: 'Gate 13', section: 'Gate 13', x: -443.73, z: 24423.15, yHint: 20168.53, yaw: 0, width: 40.9 },
      { id: 'dust2-gate-14', label: 'Gate 14', section: 'Gate 14', x: -528.74, z: 24184.42, yHint: 20168.53, yaw: 0, width: 40.9 },
      { id: 'dust2-gate-15', label: 'Gate 15', section: 'Gate 15', x: -346.52, z: 24053.32, yHint: 20160, yaw: -0.873, width: 28.5 },
      // The worksheet explicitly marks these as permanent invisible map
      // limits. They share the authoritative gate collision path but cannot
      // be interacted with or purchased.
      { id: 'dust2-boundary-01', label: 'Map boundary', section: 'Map boundary', x: -296.78, z: 23990.24, yHint: 20165.08, yaw: -2.370, width: 123, depth: 6, hidden: true, unbuyable: true },
      { id: 'dust2-boundary-02', label: 'Map boundary', section: 'Map boundary', x: -350.29, z: 23930.31, yHint: 20210.49, yaw: -1.525, width: 37, depth: 6, hidden: true, unbuyable: true }
    ],
    nuke: [
      { id: 'yard-west', label: 'Unlock west yard', section: 'West yard', x: 32, z: 548, yHint: -96.4, yaw: 0, width: 58 },
      { id: 'service-link', label: 'Unlock service wing', section: 'Service wing', x: -76, z: 289, yHint: -96.4, yaw: Math.PI / 2, width: 64 },
      { id: 'lower-access', label: 'Unlock lower access', section: 'Lower access', x: 78, z: -20, yHint: -96.4, yaw: Math.PI / 2, width: 56 }
    ],
    inferno: [
      { id: 'apartments', label: 'Unlock apartments', section: 'Apartments', x: 189, z: 9, yHint: 44.1, yaw: Math.PI / 2, width: 24 },
      { id: 'market-link', label: 'Unlock market', section: 'Market', x: 509.8, z: -186.6, yHint: 62, yaw: Math.PI / 2, width: 36 },
      { id: 'banana', label: 'Unlock Banana', section: 'Banana', x: 166.1, z: -686.9, yHint: 62, yaw: 0, width: 20 }
    ],
    vertigo: [
      { id: 'lower-ramp', label: 'Unlock lower ramp', section: 'Lower ramp', x: -482, z: -80, yHint: -61.2, yaw: Math.PI / 2, width: 60 },
      { id: 'mid-connector', label: 'Unlock lower works', section: 'Lower works', x: -209, z: -150, yHint: 18, yaw: Math.PI / 2, width: 24 },
      { id: 'upper-catwalk', label: 'Unlock upper catwalk', section: 'Upper catwalk', x: -128, z: -128, yHint: 18, yaw: Math.PI / 2, width: 22 }
    ],
    mirage: [
      { id: 'palace-link', label: 'Unlock Palace', section: 'Palace', x: -392, z: -214, yHint: 48.8, yaw: 0, width: 36 },
      { id: 'underpass', label: 'Unlock underpass', section: 'Underpass', x: -253, z: -57, yHint: -8.4, yaw: 0, width: 48 },
      { id: 'connector', label: 'Unlock connector', section: 'Connector', x: 51, z: 129, yHint: -5.2, yaw: 0, width: 52 }
    ]
  };

  // One deterministic staging room per map replaces PvP's random respawns.
  // Breaches are deliberately split by gate so the playable footprint grows
  // in recognisable chunks. `yHint` is floor height; the server grounds every
  // point against the shipped collision GLB before adding eye height.
  const CONTAINMENT_LAYOUTS = {
    dust2: {
      start: { id: 'ct-staging', label: 'CT staging', x: 90.26, z: 24032.75, yHint: 20125.87, yaw: Math.PI },
      breaches: [
        // Until the next set of labelled breach points is captured, the full
        // Dust 2 horde remains in the locked staging sector. Opening a gate
        // expands player access without inventing unverified spawn locations.
        { id: 'ct-staging-breach', section: 'CT staging', x: 110, z: 24058, yHint: 20125.87 }
      ]
    },
    nuke: {
      start: { id: 'yard-staging', label: 'Yard staging', x: 429, z: 220, yHint: -111.1, yaw: Math.PI },
      breaches: [
        { id: 'east-yard-breach', section: 'Yard staging', x: 682, z: 385, yHint: -114.4 },
        { id: 'west-yard-breach', section: 'West yard', requiresGate: 'yard-west', x: -506, z: 253, yHint: -114.4 },
        { id: 'service-breach', section: 'Service wing', requiresGate: 'service-link', x: -121, z: 462, yHint: -114.4 },
        { id: 'lower-breach', section: 'Lower access', requiresGate: 'lower-access', x: 220, z: -253, yHint: -132 }
      ]
    },
    inferno: {
      start: { id: 'mid-staging', label: 'Mid staging', x: 33, z: -429, yHint: 28.6, yaw: Math.PI },
      breaches: [
        { id: 'mid-breach', section: 'Mid staging', x: 99, z: -176, yHint: 26.4 },
        { id: 'apartments-breach', section: 'Apartments', requiresGate: 'apartments', x: -231, z: 198, yHint: 0 },
        { id: 'market-breach', section: 'Market', requiresGate: 'market-link', x: 638, z: 132, yHint: 27.4 },
        { id: 'banana-breach', section: 'Banana', requiresGate: 'banana', x: 187, z: -803, yHint: 35.2 }
      ]
    },
    vertigo: {
      start: { id: 'upper-staging', label: 'Upper staging', x: -303.6, z: -202.4, yHint: 0, yaw: Math.PI },
      breaches: [
        { id: 'upper-site-breach', section: 'Upper staging', x: -61.6, z: -118.8, yHint: 0 },
        { id: 'lower-ramp-breach', section: 'Lower ramp', requiresGate: 'lower-ramp', x: -409.2, z: -110, yHint: -79.2 },
        { id: 'lower-works-breach', section: 'Lower works', requiresGate: 'mid-connector', x: -202.4, z: -202.4, yHint: -79.2 },
        { id: 'catwalk-breach', section: 'Upper catwalk', requiresGate: 'upper-catwalk', x: -52.8, z: -246.4, yHint: 0 }
      ]
    },
    mirage: {
      start: { id: 'mid-staging', label: 'Mid staging', x: -154, z: -187, yHint: 0, yaw: Math.PI },
      breaches: [
        { id: 'mid-breach', section: 'Mid staging', x: 33, z: -264, yHint: -3.8 },
        { id: 'palace-breach', section: 'Palace', requiresGate: 'palace-link', x: -418, z: -396, yHint: 0 },
        { id: 'underpass-breach', section: 'Underpass', requiresGate: 'underpass', x: -517, z: 99, yHint: -26.4 },
        { id: 'connector-breach', section: 'Connector', requiresGate: 'connector', x: 308, z: 121, yHint: 0 }
      ]
    }
  };
  const MAP_DEFS = {
    nuke: {
      id: 'nuke', label: 'Nuke', path: assetPath('nuke'), collisionPath: 'assets/maps/de_nuke.glb',
      bytes: 3496344, scale: IMPORTED_MAP_SCALE, brightness: 1.12, background: 0x69aee0,
      fog: { color: 0x8fc0dc, near: 570, far: 3080 }, baked: true, adminOnly: false
    },
    inferno: {
      id: 'inferno', label: 'Inferno', path: assetPath('inferno'), collisionPath: 'assets/maps/de_inferno.glb',
      bytes: 5983656, scale: IMPORTED_MAP_SCALE, brightness: 1.12, background: 0x73b8e6,
      fog: { color: 0x9ac8df, near: 570, far: 3080 }, baked: true, adminOnly: false
    },
    vertigo: {
      id: 'vertigo', label: 'Vertigo', path: assetPath('vertigo'), collisionPath: 'assets/maps/de_vertigo.glb',
      bytes: 2492412, scale: IMPORTED_MAP_SCALE, brightness: 1.12, background: 0x65afe2,
      fog: { color: 0x88bfdc, near: 460, far: 2530 }, baked: true, adminOnly: true
    },
    mirage: {
      id: 'mirage', label: 'Mirage', path: assetPath('mirage'), collisionPath: 'assets/maps/de_mirage.glb',
      bytes: 4793800, scale: IMPORTED_MAP_SCALE, brightness: 1.12, background: 0x72b5e0,
      fog: { color: 0x9bc6da, near: 570, far: 3080 }, baked: true, adminOnly: false
    }
  };

  const RAW_SPAWNS = {
    nuke: {
      ct: [
        [804, -77, 132, 1.570796], [836, -77, 116, 1.570796], [796, -77, 100, 1.570796],
        [864, -77, 184, 1.570796], [828, -77, 156, 1.570796], [860, -77, 148, 1.570796],
        [764, -77, 152, 1.570796], [796, -77, 172, 1.570796], [824, -77, 192, 1.570796],
        [768, -77, 120, 1.570796]
      ],
      t: [
        [-680, -92, 272, 3.141593], [-700, -92, 168, 3.141593], [-560, -84, 264, 3.141593],
        [-732, -92, 192, 3.717551], [-720, -92, 228, 3.700098], [-696, -92, 200, 3.141593],
        [-684, -92, 240, 3.735005], [-644, -92, 288, 3.961897], [-636, -92, 248, 3.822271],
        [-556, -84, 220, 3.839724]
      ]
    },
    inferno: {
      ct: [
        [600, 32, -552, 1.570796], [600, 32, -588, 1.570796], [576, 32, -504, 1.570796],
        [600, 32, -616, 1.570796], [576, 32, -476, 1.570796], [564, 32, -616, 1.570796],
        [628, 32, -588, 1.570796], [628, 32, -552, 1.570796], [604, 32, -528, 1.570796],
        [604, 32, -492, 1.570796], [628, 32, -528, 1.570796], [632, 32, -500, 1.570796],
        [604, 32, -460, 1.570796], [632, 32, -468, 1.570796], [576, 32, -580, 1.570796],
        [628, 32, -616, 1.570796]
      ],
      t: [
        [-386, -4, -66, 3.159046], [-414, -4, -128, 3.159046], [-436, -4, -180, 3.159046],
        [-404, -4, -180, 3.159046], [-368, -4, -172, 3.159046], [-368, -4, -140, 3.159046],
        [-396, -4, -152, 3.159046], [-432, -4, -148, 3.159046], [-448, -4, -128, 3.159046],
        [-428, -4, -108, 3.159046], [-392, -4, -124, 3.159046], [-384, -4, -92, 3.159046],
        [-416, -4, -84, 3.159046], [-408, -4, -56, 3.159046], [-362, -4, -58, 3.159046],
        [-384, -4, -36, 3.159046]
      ]
    },
    vertigo: {
      ct: [
        [-48, 12, -224, 3.141593], [-80, 12, -220, 3.141593], [-32, 12, -192, 3.141593],
        [-64, 12, -192, 3.141593], [-104, 12, -176, 3.141593], [-72, 12, -164, 3.141593],
        [-136, 12, -192, 3.141593], [-108, 12, -210, 3.141593], [-164, 12, -212, 3.141593],
        [-186, 12, -188, 3.141593], [-80, 12, -132, 3.141593], [-224, 12, -184, 3.141593],
        [-276, 12, -216, 3.141593], [-288, 12, -184, 3.141593], [-276, 12, -152, 3.141593],
        [-56, 12, -108, 3.141593]
      ],
      t: [
        [-280, -60, -216, 3.159046], [-246, -60, -216, 3.159046], [-280, -60, -184, 3.159046],
        [-312, -60, -184, 3.159046], [-246, -60, -188, 3.159046], [-216, -60, -184, 3.159046],
        [-280, -60, -152, 3.159046], [-344, -60, -184, 3.159046], [-366, -60, -216, 3.159046],
        [-372, -60, -170, 3.159046], [-184, -60, -184, 3.159046], [-144, -60, -180, 3.159046],
        [-212, -60, -216, 3.159046], [-356, -60, -144, 3.159046], [-348, -60, -112, 3.159046],
        [-372, -60, -100, 3.159046]
      ]
    },
    mirage: {
      ct: [
        [-524, -1, 236, -1.570796], [-604, -1, 196, -1.570796], [-604, -1, 236, -1.570796],
        [-524, -1, 196, -1.570796], [-556, -1, 196, -1.570796], [-556, -1, 236, -1.570796],
        [-576, -1, 216, -1.570796], [-468, -1, 260, 4.014257], [-468, -1, 164, 0],
        [-484, -1, 216, -1.570796]
      ],
      t: [
        [280, 16, -180, 1.919862], [280, 16, -204, 1.570796], [280, 16, -228, 1.570796],
        [248, 16, -228, 3.141593], [220, 16, -194, 4.537856], [220, 16, -220, -1.570796],
        [220, 16, -248, -1.570796], [244, 16, -174, 3.141593], [231, 16, -285, 0],
        [259, 16, -285, 0]
      ]
    }
  };

  function expandSpawnSet(raw, scale = IMPORTED_SPAWN_SCALE) {
    const points = [];
    const teams = { 0: [], 1: [] };
    for (const [team, rows] of [[0, raw.ct], [1, raw.t]]) {
      for (const [x, y, z, yaw] of rows) {
        const id = points.length;
        points.push({ id, x: x * scale, y: y * scale, z: z * scale, yaw, halfMap: true, visZones: [] });
        teams[team].push(id);
      }
    }
    return { points, teams };
  }

  const SPAWN_SETS = Object.fromEntries(Object.entries(RAW_SPAWNS).map(([id, raw]) => [id, expandSpawnSet(raw)]));

  function addHalfOnlySpawns(mapId, team, rows) {
    const set = SPAWN_SETS[mapId];
    for (const [x, y, z, yaw] of rows) {
      const id = set.points.length;
      set.points.push({ id, x, y, z, yaw, halfMap: true, halfOnly: true, visZones: [] });
      set.teams[team].push(id);
    }
  }

  // Inferno's retained B/Banana side and Mirage's retained A side exclude the
  // imported CT rooms. Keep those source points for full matches and provide
  // grounded CT starts inside each compact combat area.
  SPAWN_SETS.inferno.teams[0].forEach(id => { SPAWN_SETS.inferno.points[id].halfMap = false; });
  addHalfOnlySpawns('inferno', 0, [
    [30, 62, -790, 0], [52, 62, -768, 0], [74, 62, -746, 0], [96, 62, -724, 0],
    [118, 62, -702, 0], [140, 62, -746, 0], [162, 62, -790, 0], [184, 53.2, -746, 0]
  ]);
  SPAWN_SETS.mirage.teams[0].forEach(id => { SPAWN_SETS.mirage.points[id].halfMap = false; });
  addHalfOnlySpawns('mirage', 0, [
    [-226, 65.8, 294, 0], [-226, 65.8, 338, 0], [-204, 65.8, 316, 0], [-182, 65.8, 294, 0],
    [-182, 65.8, 338, 0], [-160, 65.8, 316, 0], [-138, 65.8, 294, 0], [-138, 65.8, 338, 0]
  ]);

  function addDistributedSpawns(mapId, rows, halfMapFor) {
    const set = SPAWN_SETS[mapId];
    for (const [x, y, z, yaw] of rows) {
      const id = set.points.length;
      set.points.push({ id, x, y, z, yaw, halfMap: halfMapFor(x, y, z), visZones: [] });
      set.teams[id % 2].push(id);
    }
  }

  // Collision-grounded route-level candidates keep public Deathmatch/TDM from
  // collapsing into the two source team rooms. They were flood-filled only
  // across walkable, collider-clear layers connected to the authored spawns.
  addDistributedSpawns('inferno', [
    [286, 55.4, 198, 0], [594, 53.2, -792, 0], [-451, 13.6, 44, 0],
    [33, 46.6, -429, 0], [704, 62, -220, 0], [187, 53.2, -803, 0],
    [-55, 26.6, 0, 0], [330, 57, -176, 0], [638, 45.4, 132, 0],
    [462, 62, -484, 0], [-275, 18, -154, 0], [-231, 18, 198, 0],
    [231, 53.2, -561, 0], [748, 62, -451, 0], [99, 44.4, -176, 0],
    [528, 62, -66, 0], [396, 9.2, -704, 0], [154, 41.6, 33, 0]
  ], x => x < HALF_MAP_RULES.inferno.x);

  addDistributedSpawns('mirage', [
    [-682, 18, -506, Math.PI], [308, 18, 121, Math.PI], [-528, -8.4, 374, Math.PI],
    [44, -8.4, -462, Math.PI], [-341, -8.4, -110, Math.PI], [-99, 18, 286, Math.PI],
    [-726, 18, -88, Math.PI], [11, 18, -66, Math.PI], [-418, 18, -396, Math.PI],
    [-517, -8.4, 99, Math.PI], [297, -8.4, -396, Math.PI], [-275, 18, 121, Math.PI],
    [253, 3.7, -110, Math.PI], [-616, 18, -286, Math.PI], [88, -8.4, 165, Math.PI],
    [-308, 18, 363, Math.PI], [-154, 18, -187, Math.PI], [33, 14.2, -264, Math.PI]
  ], x => x > HALF_MAP_RULES.mirage.x);

  // The original entity spawns only cover the two team rooms. These grounded
  // candidates spread deathmatch across connected yard, hall, and reactor
  // routes without using the rooftop/extreme-elevation probes. The outside
  // lower approach remains full-map-only.
  const NUKE_DISTRIBUTED_SPAWNS = [
    [154, -96.4, 660, true], [220, -114, -253, false], [946, -78.8, 308, true],
    [-506, -96.4, 253, true], [429, -93.1, 220, true], [-44, -96.4, 143, true],
    [572, -96.4, 616, true], [-121, -96.4, 462, true], [715, -78.8, 121, true],
    [165, -96.4, 363, true], [220, -96.4, 33, true], [682, -96.4, 385, true],
    [-275, -96.4, 275, true]
  ];
  for (const [x, y, z, halfMap] of NUKE_DISTRIBUTED_SPAWNS) {
    const id = SPAWN_SETS.nuke.points.length;
    SPAWN_SETS.nuke.points.push({ id, x, y, z, yaw: Math.PI, halfMap, visZones: [] });
    SPAWN_SETS.nuke.teams[id % 2].push(id);
  }

  return {
    MAP_ASSET_VERSION,
    ADMIN_MAP_IDS,
    PUBLIC_MAP_IDS,
    HALF_MAP_RULES,
    IMPORTED_MAP_SCALE,
    MAP_DEFS,
    SPAWN_SETS,
    NUKE_DOORS,
    NUKE_LADDERS,
    NUKE_VENTS,
    MIRAGE_BREAKABLE_WINDOWS,
    ADMIN_TELEPORTS,
    CONTAINMENT_GATES,
    CONTAINMENT_LAYOUTS
  };
});
