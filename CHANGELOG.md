# Changelog

## 0.1.0 - 2026-10-03

- First version. A red zone on the game's own ranged swing timer marks when to stand still for a hunter's Auto Shot or a wand's Shoot (mages, priests and warlocks). It starts earlier by your latency and brightens while you are inside it, as long as Auto Shot or Shoot is on.
- When a shot is late, the zone stays lit, pulsing after a moment, until the shot actually fires, even though the game's bar has already emptied, and for as long as the game keeps retrying the shot. Stopping with a shot still due, or starting Auto Shot or Shoot, lights it for the wind-up.
- An options page at Esc > Options > AddOns > Shot Window, opened by `/shotwindow`: the aim window, latency, an extra lead, keeping the zone lit until the shot, the zone's colour, opacity, brightening and pulsing, the marker line's thickness and colour, and an optional tint of the bar's own fill inside the zone. A Defaults button puts everything back.
