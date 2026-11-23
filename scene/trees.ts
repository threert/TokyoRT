// Variant order is the geographic compiler's (generic street/park forms, ginkgo and cherry).
export const TREE_FORMS = ["street-ash", "street-oval", "park-oak", "park-ash", "ginkgo", "cherry"] as const;
export const TREE_HEIGHTS = [9, 8, 13, 17, 13, 7];
export const treeKey = (variant: number, level: number) => `ez-${TREE_FORMS[variant]}-L${level}`;

// Keep the centre, yaw and scale of each tree identical when its cell changes detail.
// The far tiles and the dressed cells both own a clump by its original map point.
export function treeSites(variant: number, x: number, z: number, rot: number, scale: number) {
  const sites = [{ x, z, rot, scale: scale || 1 }];
  if (variant === 2 || variant === 3) {
    const random = (c: number, k: number) => {
      const h = Math.sin(x * 12.9898 + z * 78.233 + c * 37.719 + k * 11.13) * 43758.5453;
      return h - Math.floor(h);
    };
    for (let c = 1; c <= 2; c++) {
      const away = 3 + 3.5 * random(c, 1), turn = random(c, 2) * 6.2832;
      sites.push({
        x: x + Math.cos(turn) * away,
        z: z + Math.sin(turn) * away,
        rot: rot + c * 2.1,
        scale: (scale || 1) * (0.7 + 0.35 * random(c, 3)),
      });
    }
  }
  return sites;
}
