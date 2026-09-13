// Level 6 (game-design §2): narrower base-approach corridors, ~45% obstacles.
// New this level: sniper engagement range increases (rules.sniperRangeTiles),
// per §3's "Level 6+ change".
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 6,
  name: "Narrow Approach",
  map: [
    "..1.......2..",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWBBSBWBBSBW",
    "BBSBWBBSBWBBS",
    "BWBBSBWBBSBWB",
    "BNSBWBB....N.",
    ".............",
    ".............",
    ".............",
    ".............",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.2,
  waves: [
    { enemies: [{ type: "grunt", count: 2 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
  ],
  rules: { sniperRangeTiles: 8 },
};
