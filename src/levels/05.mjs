// Level 5 (game-design §2): two spawn points, symmetric maze, ~40% obstacles.
// New this level: multi-wave spawning (2 waves), per §4 — the next wave
// starts once the live wave thins below a third of its size.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 5,
  name: "Twin Spawn",
  map: [
    "..1.......2..",
    "B.S.B.W.B.B.S",
    ".B.W.B.B.S.B.",
    "W.B.B.S.B.W.B",
    ".B.S.B.W.B.B.",
    "S.B.W.B.B.S.B",
    ".NW.B.B.S.BN.",
    "W.B.B.S.B.W.B",
    ".B.S.B.W.B.B.",
    "S.B.W.B.B.S.B",
    ".W.B.B.S.B...",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.16,
  waves: [
    { enemies: [{ type: "grunt", count: 3 }, { type: "sniper", count: 2 }, { type: "hunter", count: 2 }] },
    { enemies: [{ type: "grunt", count: 2 }, { type: "sniper", count: 1 }, { type: "hunter", count: 1 }] },
  ],
};
