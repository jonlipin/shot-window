## 0.2.0 - 2026-10-10

- A Look section in the options with a window style: Automatic, Blizzard or Dark. Automatic uses EllesmereUI's look when it is running and Blizzard's otherwise. Dark is a flat dark style built in, so it needs no other addon, and a Dark background opacity slider sets how much of the world shows through it (grayed out unless Dark is chosen). Switching from Blizzard to a drawn style happens at once; leaving a drawn style takes a reload, and Shot Window offers one. Defaults puts the style back to Automatic.
- `/shotwindow style [auto|blizzard|dark]` sets the window style from chat, or steps to the next one with no word after it. `/shotwindow debug` now says which style is drawn.
- EllesmereUI support: under its look the options window and the swing timer bars follow EllesmereUI's style and its accent color, and change color with it. If EllesmereUI is told to leave Shot Window alone, Shot Window stays Blizzard and says why.
- Under Dark or EllesmereUI the game's swing timer bars (main hand, off hand and ranged) are drawn flat: a dark track, a thin edge and a fill in the accent color, with the red zone and its line still on top. The bars keep their Edit Mode position, size and visibility, and still dim when the target is out of range. A bar that loads after login is drawn flat as soon as it appears. Blizzard leaves them exactly as the game draws them.
- The options window restyles a copy of its own controls, so the same options on the game's Esc > Options page keep the game's look.
- Shot Window now loads on every class. Characters with no Auto Shot or wand Shoot get no red zone, only the Look section (with a line saying why) and the flat swing timer bars. The zone commands tell them they do not apply.
- The options window's close button works in combat.
- American spelling throughout: color, gray and centered.
