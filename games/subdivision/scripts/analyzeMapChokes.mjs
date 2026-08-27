import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadMapCollision } = require('../mapCollision.js');
const maps = require('../maps.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const output = process.argv[2] || '/tmp/orbit-map-analysis';
fs.mkdirSync(output, { recursive: true });

const sources = {
  dust2: { path: 'assets/maps/de_dust_2_with_real_light.glb', scale: 20, levels: [20158, 20182] },
  nuke: { path: maps.MAP_DEFS.nuke.collisionPath, scale: maps.MAP_DEFS.nuke.scale, levels: [-132, -114, -103] },
  inferno: { path: maps.MAP_DEFS.inferno.collisionPath, scale: maps.MAP_DEFS.inferno.scale, levels: [-22, 8, 27, 44] },
  vertigo: { path: maps.MAP_DEFS.vertigo.collisionPath, scale: maps.MAP_DEFS.vertigo.scale, levels: [-84, -5] },
  mirage: { path: maps.MAP_DEFS.mirage.collisionPath, scale: maps.MAP_DEFS.mirage.scale, levels: [-26, 0, 48] }
};

function writePpm(filename, width, height, bytes) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  fs.writeFileSync(filename, Buffer.concat([header, bytes]));
}

for (const [mapId, source] of Object.entries(sources)) {
  const collision = await loadMapCollision(path.join(root, source.path), source.scale);
  const { minX, maxX, minZ, maxZ } = collision.bounds;
  const span = Math.max(maxX - minX, maxZ - minZ);
  const step = Math.max(3, span / 360);
  const width = Math.ceil((maxX - minX) / step) + 1;
  const height = Math.ceil((maxZ - minZ) / step) + 1;
  for (const level of source.levels) {
    const pixels = Buffer.alloc(width * height * 3);
    for (let py = 0; py < height; py++) {
      const z = minZ + py * step;
      for (let px = 0; px < width; px++) {
        const x = minX + px * step;
        const ground = collision.walkableGroundY(x, z, level + 24);
        const open = ground != null && ground <= level + 6 && ground >= level - 15;
        const offset = ((height - 1 - py) * width + px) * 3;
        const shade = open ? 225 : 10;
        pixels[offset] = shade;
        pixels[offset + 1] = open ? 225 : 14;
        pixels[offset + 2] = open ? 225 : 20;
      }
    }
    const spawns = mapId === 'dust2' ? [] : maps.SPAWN_SETS[mapId]?.points || [];
    for (const point of spawns) {
      const feet = point.y - 18;
      if (Math.abs(feet - level) > 24) continue;
      const cx = Math.round((point.x - minX) / step);
      const cy = height - 1 - Math.round((point.z - minZ) / step);
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const offset = (y * width + x) * 3;
        pixels[offset] = 255; pixels[offset + 1] = 45; pixels[offset + 2] = 45;
      }
    }
    const filename = path.join(output, `${mapId}-${level}.ppm`);
    writePpm(filename, width, height, pixels);
    console.log(`${filename}\t${width}x${height}\tstep=${step.toFixed(2)}\tbounds=${minX.toFixed(1)},${minZ.toFixed(1)}..${maxX.toFixed(1)},${maxZ.toFixed(1)}`);
  }
}
