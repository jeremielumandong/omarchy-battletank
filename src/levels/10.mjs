// Level 10 (game-design §2): full mix of brick, steel and water, ~65%
// obstacles. New this level: the Elite Hunter — identical to a Hunter but
// takes 2 hits, exactly one, spawned last in the final wave (§3).
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 10,
  name: "Last Stand",
  map: [
    "..1.......2..",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWBBSBWBBSBW",
    "BBSBWBBSBWBBS",
    "BWBBSBWBBSBWB",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWBBSBWBBSBW",
    ".....N.N.....",
    "......B......",
    ".....SSS.....",
    "....PSES.....",
  ],
  speedMult: 1.36,
  waves: [
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    {
      enemies: [
        { type: "grunt", count: 1 },
        { type: "sniper", count: 1 },
        { type: "hunter", count: 3 },
        { type: "eliteHunter", count: 1 },
      ],
    },
  ],
  rules: { sniperRangeTiles: 8, hunterPairs: true },
};
