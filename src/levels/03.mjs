// Level 3 (game-design §2): mirror-symmetric steel wall clusters, one spawn,
// ~27% obstacles.
// New this level: Steel (indestructible) terrain, per §3/§1's collision matrix.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 3,
  name: "Steel Yard",
  map: [
    "......1......",
    "..S.B.B.B.S..",
    ".B...S.S...B.",
    "S..B..B..B..S",
    "..B...N...B..",
    ".S..B.B.B..S.",
    ".B.B.S.S.B.B.",
    "..S.S...S.S..",
    "..B.B...B.B..",
    "...B.BBB.B...",
    ".............",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.08,
  waves: [{ enemies: [{ type: "grunt", count: 7 }, { type: "sniper", count: 2 }] }],
};
