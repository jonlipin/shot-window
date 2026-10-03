# Shot Window

Shot Window marks the game's own ranged swing timer for hunters on WoW Forever, so you can tell when to stand still for Auto Shot. It adds no bar of its own.

- **Red zone:** the end of the swing, where Auto Shot aims. Stop moving at the red line and stay still until the shot fires. Move freely before it, and again as soon as the shot is away. The zone brightens while the swing is inside it.
- The zone follows your swing speed, so it moves with haste such as Rapid Fire. It starts earlier by your latency, so a stop at the line reaches the server in time.

On Forever, Auto Shot fires during cast-time shots (Aimed Shot, Multi-Shot, Sniper Shot), so casting needs no marker. Only moving delays Auto Shot.

Turn the game's swing timer on first (Options, Advanced Options, Swing Timer) and set the Ranged Swing Timer's visibility in Edit Mode. Shot Window does nothing on other classes.

## Commands

- `/shotwindow window <seconds>`: the Auto Shot aim time at the end of the swing (default 0.5).
- `/shotwindow latency`: toggle starting the red zone earlier by your latency.
- `/shotwindow flash`: toggle brightening the red zone while you are in it.
- `/shotwindow debug`: what the addon sees.

`/shotwin` works too.

## Beta note

Blizzard has said the 0.5 second wind-up before Auto Shot is not working properly in the beta, and the shot currently fires after a much shorter wind-up. Until that is fixed the red zone is wider than it needs to be. `/shotwindow window 0.1` narrows it.
