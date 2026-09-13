// Level 9 (game-design §2): two spawn points, ~60% obstacles. Three tiers of
// lanes step inward toward the base, joined by open rows 4, 7 and 10.
// New this level: three-wave spawning.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 9,
  name: "Triple Assault",
  map: [
    "..1.......2..",
    "BB.BBB.BBB.BB",
    "BB.BWW.WWB.BB",
    "BB.BWW.WWB.BB",
    "SB.........BS",
    "BBB.BBSBB.BBB",
    "BWB.BBSBB.BWB",
    "BBBN.....NBBB",
    "SBBB.BWB.BBBS",
    "BBBB.BWB.BBBB",
    "BB.........BB",
    "BB...BBB...BB",
    "BB..PBEB...BB",
  ],
  speedMult: 1.32,
  waves: [
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 3 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 1 }, { type: "hunter", count: 3 }] },
  ],
  rules: { sniperRangeTiles: 8, hunterPairs: true },
};
