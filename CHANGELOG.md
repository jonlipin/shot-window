# Changelog

## 0.3.1 - 2026-10-17

- The screen edge alert can have a color of its own: untick "Same color as the zone" on the Alerts tab and pick an edge color. It still turns the clip color while you move in the zone, with the move warning on.

## 0.3.0 - 2026-10-14

- Displays: eleven designs of Shot Window's own, besides the marks on the game's bar. Classic bar, pincer bar, vertical pincer, closing gap, closing brackets, pips, scanner (the shot line stays in the middle and a spark sweeps across, stopping on it while a shot is late), rhythm track, horseshoe arc, ring with a countdown, and a tightening reticle. Every one shows the same things as the game's bar: move and stand still, brightening inside the zone, the hold and pulse while a shot is late, clipping, and the shot itself. The horseshoe's words (Move, Stand still, Moving, Late), the ring's Late and the ring's countdown can be turned off.
- A display shows in combat and while Auto Shot or Shoot is on, or always. Unlock it to drag it anywhere, or let it sit on the game's swing bar. Length and thickness for the straight designs, size and line thickness for the round ones, and options for the scanner, the rhythm track and the pips.
- Displays follow the window style. Under Blizzard the straight designs sit in the swing timer's own bar frame, and the horseshoe arc, the ring and the reticle's rim are drawn in the swing timer bar's own art (its background, fill and brass frame) bent round the curve, live from the game's files. Dark and EllesmereUI draw a flat panel in the style's colors with a thin outline, use the style's font, and can use the style's accent as the move color.
- The curved designs are drawn as pieces that share their edges exactly, so there are no seams, and see-through art and fades stay even. On a small design with thick lines, the line thickness shrinks to fit rather than closing the ring. `/shotwindow flipart` turns the curved art over, should it ever show inside out.
- Clipping: moving during the wind-up turns the zone the clip color (amber), on the game's bar and on every display.
- After a late shot, how late it was shows for a moment ("+0.42"), above the game's bar or under the display.
- New alerts, each optional: call-out text (Stop, Moving, Late, Go) in a size of your choice, a tint on the screen's edges while you must stand still, and a sound as the zone starts, with four sounds to pick from.
- The options have a live preview across the top, whichever tab is open: the game's ranged bar with the zone on it as the Zone tab sets it, and your display beside it (or on it), playing a made-up fight that includes a clipped, late shot. Under it hang four tabs like the character window's: Zone, Display, Alerts and Look.
- `/shotwindow display [name]`, `/shotwindow lock` and `/shotwindow unlock`. `/shotwindow debug` says which display is in use and which alerts are on.

## 0.2.1 - 2026-10-11

- Fixed: with EllesmereUI, a character with no Auto Shot or wand Shoot (a druid, for example) kept the game's own swing timer bars instead of the flat ones. EllesmereUI hands its look over at login just before Shot Window has loaded its settings, and only hunters and wand users had their bars styled again afterwards. Every class gets the flat bars now.
- Fixed: with EllesmereUI installed, choosing Blizzard or Dark could still give you EllesmereUI's look after logging in, for the same reason. Your saved choice now counts from the start.
- `/shotwindow debug` says whether each swing timer bar was drawn flat, and what art the main hand and ranged bars show.

## 0.2.0 - 2026-10-10

- A Look section in the options with a window style: Automatic, Blizzard or Dark. Automatic uses EllesmereUI's look when it is running and Blizzard's otherwise. Dark is a flat dark style built in, so it needs no other addon, and a Dark background opacity slider sets how much of the world shows through it (grayed out unless Dark is chosen). Switching from Blizzard to a drawn style happens at once; leaving a drawn style takes a reload, and Shot Window offers one. Defaults puts the style back to Automatic.
- `/shotwindow style [auto|blizzard|dark]` sets the window style from chat, or steps to the next one with no word after it. `/shotwindow debug` now says which style is drawn.
- EllesmereUI support: under its look the options window and the swing timer bars follow EllesmereUI's style and its accent color, and change color with it. If EllesmereUI is told to leave Shot Window alone, Shot Window stays Blizzard and says why.
- Under Dark or EllesmereUI the game's swing timer bars (main hand, off hand and ranged) are drawn flat: a dark track, a thin edge and a fill in the accent color, with the red zone and its line still on top. The bars keep their Edit Mode position, size and visibility, and still dim when the target is out of range. A bar that loads after login is drawn flat as soon as it appears. Blizzard leaves them exactly as the game draws them.
- The options window restyles a copy of its own controls, so the same options on the game's Esc > Options page keep the game's look.
- Shot Window now loads on every class. Characters with no Auto Shot or wand Shoot get no red zone, only the Look section (with a line saying why) and the flat swing timer bars. The zone commands tell them they do not apply.
- The options window's close button works in combat.
- American spelling throughout: color, gray and centered.

## 0.1.0 - 2026-10-03

- First version. A red zone on the game's own ranged swing timer marks when to stand still for a hunter's Auto Shot or a wand's Shoot (mages, priests and warlocks). It starts earlier by your latency and brightens while you are inside it, as long as Auto Shot or Shoot is on.
- When a shot is late, the zone stays lit, pulsing after a moment, until the shot actually fires, even though the game's bar has already emptied, and for as long as the game keeps retrying the shot. Stopping with a shot still due, or starting Auto Shot or Shoot, lights it for the wind-up.
- An options page at Esc > Options > AddOns > Shot Window, opened by `/shotwindow`: the aim window, latency, an extra lead, keeping the zone lit until the shot, the zone's color, opacity, brightening and pulsing, the marker line's thickness and color, and an optional tint of the bar's own fill inside the zone. A Defaults button puts everything back.
