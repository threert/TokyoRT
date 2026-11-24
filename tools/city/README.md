# tools/city: the open city's compiler (from jeantimex/tokyo)

The offline pipeline that turns public data about a Japanese city into 256 m binary tiles, and the mesher that turns
tiles into geometry. Imported from [jeantimex/tokyo](https://github.com/jeantimex/tokyo), commit `1984760`
(MIT, © 2026 Yong Su: [`LICENSE`](LICENSE), kept as it was). The code is the upstream's, changed only in:

- the import paths, for the new layout:
  - `pipeline/` was `tools/pipeline/`;
  - `shared/` was `src/shared/`;
  - `mesh/` was `src/world/` (only the mesher and what it needs: `meshing.js`, `drape.js`, `decals.js`,
    `constants.js`, `tower.js`);
  - `tests/` was `tools/tests/`;
- where data goes: `assets/city/` (`ROOT` in `pipeline/config.mjs`) instead of `data/` and `public/`;
- no photographs or scanned models: `fetch.mjs` downloads PLATEAU's buildings and roads only (not their photo textures,
  bridges, street furniture or trees) and no GSI aerial photos, and `compile.mjs` keeps the LOD2 shells without their
  photo coordinates (`photos.mjs` and `meshes.mjs` are gone). The mesher colours those buildings itself.
- `mesh/meshing.js` takes a building's wall colour and curtain wall from `b.look` when it has one (TokyoRT's far level:
  the look the near levels' dressing gave that building, `looks.json` from tools/tokyo/city-bake.ts).

## Use

`tools/setup.sh` runs these with the rest. By hand:

```
node tools/tokyo/prefetch-plateau.mjs --area=shinjuku                               # PLATEAU with curl (fetch.mjs then skips it)
node tools/city/pipeline/fetch.mjs --area=shinjuku                                  # raw data -> assets/city/raw/shinjuku
node --max-old-space-size=8192 tools/city/pipeline/compile.mjs --area=shinjuku     # -> assets/city/tiles/shinjuku
node tools/city/tests/tileformat.test.mjs                                           # the tile format's round trip
```

Areas (`pipeline/config.mjs`): tokyo, shiba, shibuya, shinjuku, chiyoda, chuo, fujinomiya. Each is about 3.4 × 2.8 km.

Network access, all from `pipeline/fetch.mjs` and `pipeline/terrain.mjs`:
- the PLATEAU data catalogue (`api.plateau.reearth.io`) and the CityGML files it lists;
- Overpass (`overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`);
- GSI elevation tiles (`cyberjapandata.gsi.go.jp`).

## Data, attribution and licences

The licence above covers the code only. The data keeps its sources' terms. Credit them wherever the city is shown:

- Buildings (footprints, heights, LOD2 shells) and road outlines: Project PLATEAU, MLIT Japan (CC BY 4.0,
  multi-licensed with ODbL).
- Elevation: Geospatial Information Authority of Japan (GSI).
- Road network, railways and places: © OpenStreetMap contributors (ODbL).

A compiled area is a derived database under the ODbL: do not publish compiled tiles without its terms (share-alike,
attribution).
