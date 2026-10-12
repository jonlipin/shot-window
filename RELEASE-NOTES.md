## 0.2.1 - 2026-10-11

- Fixed: with EllesmereUI, a character with no Auto Shot or wand Shoot (a druid, for example) kept the game's own swing timer bars instead of the flat ones. EllesmereUI hands its look over at login just before Shot Window has loaded its settings, and only hunters and wand users had their bars styled again afterwards. Every class gets the flat bars now.
- Fixed: with EllesmereUI installed, choosing Blizzard or Dark could still give you EllesmereUI's look after logging in, for the same reason. Your saved choice now counts from the start.
- `/shotwindow debug` says whether each swing timer bar was drawn flat, and what art the main hand and ranged bars show.
