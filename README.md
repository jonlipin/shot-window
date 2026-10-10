# Shot Window

Shot Window marks the game's own ranged swing timer on WoW Forever so you can see when to stand still for a hunter's Auto Shot or a wand's Shoot (mages, priests and warlocks). It adds no bar of its own, so the game's bar keeps its Edit Mode position, size and visibility.

- **Red zone:** the end of the swing, where the shot winds up. Stop moving at the red line and stay still until the shot fires. Move freely before it, and again as soon as the shot is away. The zone brightens while you are inside it, as long as Auto Shot or Shoot is on.
- **Late shots:** the game's bar empties the moment its time runs out, even when the shot is late because you kept moving. Shot Window keeps the zone lit, pulsing after a moment, until the shot actually fires, and keeps it lit while the game retries the shot. When you stop moving with a shot still due, or start Auto Shot or Shoot, it lights up for the wind-up too. Nothing lights while the target is out of range.
- The zone follows your swing speed, so it moves with haste such as Rapid Fire. It starts earlier by your latency, so a stop at the line reaches the server in time.

On Forever, Auto Shot fires during cast-time shots (Aimed Shot, Multi-Shot, Sniper Shot), so casting needs no marker. Only moving delays the shot.

Turn the game's swing timer on first (Options, Advanced Options, Swing Timer) and set the Ranged Swing Timer's visibility in Edit Mode. The red zone is for hunters, mages, priests and warlocks. Every other class gets only the Look option, which draws the game's swing timer bars flat under the Dark or EllesmereUI style. Settings are saved per character.

## Options

Esc > Options > AddOns > Shot Window, or type `/shotwindow`. If the game will not show the page (in combat, for example), the same options open in a window of their own.

- **Timing:** the aim window (0 to 1 second), starting earlier by your latency, an extra lead of 0 to 300 milliseconds, and keeping the zone lit until the shot fires. A line under them shows how long the red zone is right now.
- **Red zone:** show or hide it, its color, its opacity, how bright it gets while you are inside it, and pulsing while it waits for a late shot.
- **Marker line:** show or hide it, its thickness (1 to 6 pixels) and its color.
- **Bar fill:** tint the swing timer's own fill while you are inside the zone, in a color and opacity of your choice. Off by default.
- **Look:** the window style, Automatic (EllesmereUI's look when it is running, otherwise Blizzard), Blizzard or Dark, and how much of the world shows through the Dark style. Under Dark or EllesmereUI the options window and the game's swing timer bars are drawn flat, with the red zone on top. Leaving a drawn style for another takes a reload, and Shot Window offers one.
- **Defaults** puts every setting back.

## Commands

- `/shotwindow` (or `/shotwindow options`): open or close the options.
- `/shotwindow window <seconds>`: the aim window at the end of the swing (0 to 1, default 0.5).
- `/shotwindow latency`: toggle starting the red zone earlier by your latency.
- `/shotwindow flash`: toggle brightening the red zone while you are in it.
- `/shotwindow style [auto|blizzard|dark]`: the window style; with no word it steps to the next one.
- `/shotwindow debug`: what the addon sees.
- `/shotwindow help` (or any other word): list the commands.

`/shotwin` works too.

## Beta note

Blizzard has said the 0.5 second wind-up before Auto Shot and wand shots is not working properly in the beta, and the shot currently fires after a much shorter wind-up. Until that is fixed the red zone is wider than it needs to be: lower the aim window in the options, or type `/shotwindow window 0.1`.
