// Level 8 (game-design §2): base ringed by steel with one brick choke point,
// ~55% obstacles. New this level: a fixed sniper pair guards the choke point.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 8,
  name: "The Bastion",
  map: [
    "..1.......2..",
    "BSBWBBSBWBBSB",
    "WBBSBWBBSBWBB",
    "SBWBBSBWBBSBW",
    "BBSBWBBSBWBBS",
    "BWBBSBWBBSBWB",
    "BSBWBBSBWBBSB",
    "WBBSBWBBS....",
    ".............",
    ".....N.N.....",
    "......B......",
    ".....SSS.....",
    "....PSES.....",
  ],
  speedMult: 1.28,
  waves: [
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 3 }, { type: "hunter", count: 4 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 4 }] },
  ],
  rules: { sniperRangeTiles: 8, hunterPairs: true },
};
