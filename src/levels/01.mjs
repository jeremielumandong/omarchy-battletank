// Level 1 (game-design §2): tutorial, open layout, a single enemy spawn, a
// brick ring around the base, 6 grunts, about 20% obstacles.
//
// Glyphs: . empty  B brick  S steel  W water  E base  P player spawn
//         1-3 enemy spawns  N sniper post (a sniper from the waves starts here)
export const level = {
  id: 1,
  name: "Training Ground",
  map: [
    "......1......",
    ".............",
    ".B.B.B.B.B.B.",
    ".B.B.B.B.B.B.",
    ".B.B.....B.B.",
    ".............",
    "BB..BB.BB..BB",
    ".............",
    ".B.B.....B.B.",
    ".B.B.....B.B.",
    ".............",
    ".....BBB.....",
    "....PBEB.....",
  ],
  speedMult: 1.0,
  waves: [{ enemies: [{ type: "grunt", count: 6 }] }],
};
