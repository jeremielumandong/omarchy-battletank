// Level 7 (game-design §2): multiple lanes converge on base, ~50% obstacles.
// Five top lanes meet at row 5, then staircase lanes funnel into row 10.
// New this level: Hunters spawn and advance in pairs (rules.hunterPairs), per
// §3's "Level 7+ change". Enemy mix plateaus at 15/30/55 from here on (§2).
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 7,
  name: "Converging Lanes",
  map: [
    "..1.......2..",
    ".BB.BB.BB.BB.",
    ".BS.BW.WB.SB.",
    ".BB.BW.WB.BB.",
    ".BB.BB.BB.BB.",
    "...N.....N...",
    ".BBB..S..BBB.",
    "..BBB...BBB..",
    "B..BBB.BBB..B",
    "BB..BB.BB..BB",
    "BBB.......BBB",
    "BBB..BBB..BBB",
    "BBB.PBEB..BBB",
  ],
  speedMult: 1.24,
  waves: [
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 4 }] },
    { enemies: [{ type: "grunt", count: 1 }, { type: "sniper", count: 2 }, { type: "hunter", count: 4 }] },
  ],
  rules: { sniperRangeTiles: 8, hunterPairs: true },
};
