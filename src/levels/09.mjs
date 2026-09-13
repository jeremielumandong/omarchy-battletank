// Level 9 (game-design §2): two spawn points, ~60% obstacles. New this
// level: three-wave spawning.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 9,
  name: "Triple Assault",
  map: [
    "..1.......2..",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWBBSBWBBSBW",
    "BBSBWBBSBWBBS",
    "BWBBSBWBBSBWB",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWB.........",
    ".....N.N.....",
    "......B......",
    ".....SSS.....",
    "....PSES.....",
  ],
  speedMult: 1.32,
  waves: [
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 1 }, { type: "hunter", count: 3 }] },
  ],
  rules: { sniperRangeTiles: 8, hunterPairs: true },
};
