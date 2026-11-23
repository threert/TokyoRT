#!/bin/sh
# Builds everything the fly-through needs, from nothing: the engine, the downloads, the compiled city, its far level, the
# dressed cells. Each step skips what is already there where it can; run it again after a failed download.
#   tools/setup.sh [area]      (shinjuku; ~1.5 GB of downloads, ~25 GB of baked cells, ~10 min on an M3 Max plus downloads)
set -e
cd "$(dirname "$0")/.."
AREA=${1:-shinjuku}
git submodule update --init
npm ci --no-audit --no-fund
(cd engine && npm ci --no-audit --no-fund)
(cd engine/renderer && cargo build --release)
# the materials, street furniture and trees, generated (no scanned or photographed assets)
node tools/tokyo/surfaces.ts
npm run trees
# the city: PLATEAU, OpenStreetMap and GSI, compiled into 256 m tiles (tools/city, from jeantimex/tokyo)
node tools/tokyo/prefetch-plateau.mjs --area="$AREA"
node tools/tokyo/prefetch-osm.mjs --area="$AREA"
node tools/city/pipeline/fetch.mjs --area="$AREA"
node --max-old-space-size=8192 tools/city/pipeline/compile.mjs --area="$AREA"
# the far level: every tile's ground, and its buildings, props and trees by 128 m quadrant
node --max-old-space-size=8192 tools/tokyo/to-glb.ts --area="$AREA" --city --out="$AREA-far"
# the signs, lanterns, noren, menus and labels (drawn with the system's Japanese fonts)
node tools/tokyo/hero-textures.ts
node tools/tokyo/hero-props-textures.ts
# the near levels: every 128 m cell dressed at mid distance (L1) and at street level (L0)
node --max-old-space-size=24000 tools/tokyo/city-bake.ts --area="$AREA"
node tools/bundle.ts
echo "done: tools/demo.sh day"
