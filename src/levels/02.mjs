// Level 2 (game-design §2): mirror-symmetric brick maze corridors, one spawn,
// ~20% obstacles.
// New this level: the Sniper enemy (introduced here per §3).
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 2,
  name: "Brick Maze",
  map: [
    "......1......",
    "..B.B...B.B..",
    ".B...B.B...B.",
    "B..B..B..B..B",
    "..B...N...B..",
    ".B..B...B..B.",
    "...B.B.B.B...",
    "..B.B...B.B..",
    "....B...B....",
    ".............",
    ".............",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.04,
  waves: [{ enemies: [{ type: "grunt", count: 6 }, { type: "sniper", count: 1 }] }],
};
