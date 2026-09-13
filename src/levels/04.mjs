// Level 4 (game-design §2): water hazards, one spawn, ~35% obstacles. A
// two-row river crosses mid-map, bridged at the centre and both flanks.
// New this level: the Hunter enemy, and Water terrain (blocks tanks, not
// shells), both per §3/§1.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 4,
  name: "Flood Zone",
  map: [
    "......1......",
    ".BB.BB.BB.BB.",
    ".BB.BS.SB.BB.",
    ".............",
    "SB.BB...BB.BS",
    "WW.WWW.WWW.WW",
    "WW.WWW.WWW.WW",
    "......N......",
    ".BB.B.S.B.BB.",
    ".BB.B...B.BB.",
    ".............",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.12,
  waves: [{ enemies: [{ type: "grunt", count: 5 }, { type: "sniper", count: 3 }, { type: "hunter", count: 2 }] }],
};
