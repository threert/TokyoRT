// Files written by tools/tokyo/surfaces.ts, sampled in metres on geometry and roads.
import { Texture } from "@threert/scene";

export function finishMap(id: string, channel: "color" | "normal" | "rough" | "metal") {
  return new Texture(`assets/city/finishes/${id}/${channel}.png`, channel === "color" ? "srgb" : "linear");
}
