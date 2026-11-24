#!/bin/sh
# Builds everything the fly-through needs, from nothing: the engine, the downloads, the compiled city, its far level, the
# dressed cells. Each step skips what is already there where it can; run it again after a failed download.
#   tools/setup.sh [areas]     (shinjuku shibuya, the city the scene streams: ~2.8 GB of downloads, ~36 GB of baked cells,
#                               ~15 min on an M3 Max plus downloads)
set -e
cd "$(dirname "$0")/.."
AREAS=${*:-shinjuku shibuya}
git submodule update --init
npm ci --no-audit --no-fund
(cd engine && npm ci --no-audit --no-fund)
(cd engine/renderer && cargo build --release)
# the materials, street furniture and trees, generated (no scanned or photographed assets)
node tools/tokyo/surfaces.ts
npm run trees
# the signs, lanterns, noren, menus and labels (drawn with the system's Japanese fonts)
node tools/tokyo/hero-textures.ts
node tools/tokyo/hero-props-textures.ts
for AREA in $AREAS; do
  # the city: PLATEAU, OpenStreetMap and GSI, compiled into 256 m tiles (tools/city, from jeantimex/tokyo)
  node tools/tokyo/prefetch-plateau.mjs --area="$AREA"
  node tools/tokyo/prefetch-osm.mjs --area="$AREA"
  node tools/city/pipeline/fetch.mjs --area="$AREA"
  node --max-old-space-size=8192 tools/city/pipeline/compile.mjs --area="$AREA"
  # the near levels: every 128 m cell dressed at mid distance (L1) and at street level (L0)
  node --max-old-space-size=24000 tools/tokyo/city-bake.ts --area="$AREA"
  # the far level: every tile's ground, and its buildings, props and trees by 128 m quadrant, in the
  # colours the near levels gave each building (city-bake's looks.json)
  node --max-old-space-size=8192 tools/tokyo/to-glb.ts --area="$AREA" --city --out="$AREA-far"
done
# the city past the areas, to the horizon (blocks and towers out to ~6 km)
# the benchmark routes (drive, expressway, flight) over the areas
node tools/tokyo/routes.ts
# the expressway's elevated decks
node tools/tokyo/viaducts.ts
node tools/tokyo/distant.ts --areas="$(echo $AREAS | tr ' ' ',')"
node tools/bundle.ts
echo "done: tools/demo.sh day"
