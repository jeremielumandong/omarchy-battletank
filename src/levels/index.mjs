// The ordered level list: position N is level N, and loadLevels() rejects
// gaps. Adding a level is one new NN.mjs file plus one line here.
//
// STUB: levels 02-10 are the engineer's, authored from docs/game-design.md §2
// and §4. tests/levels.test.mjs checks each against those rules.
import { level as level01 } from "./01.mjs";

export const levels = [level01];
