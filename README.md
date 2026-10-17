# Shot Window

Shot Window marks the game's own ranged swing timer on WoW Forever so you can see when to stand still for a hunter's Auto Shot or a wand's Shoot (mages, priests and warlocks). The marks sit on the game's bar, so it keeps its Edit Mode position, size and visibility. If you want more, pick one of eleven displays of its own, and alerts that work with any of them.

- **Red zone:** the end of the swing, where the shot winds up. Stop moving at the red line and stay still until the shot fires. Move freely before it, and again as soon as the shot is away. The zone brightens while you are inside it, as long as Auto Shot or Shoot is on.
- **Late shots:** the game's bar empties the moment its time runs out, even when the shot is late because you kept moving. Shot Window keeps the zone lit, pulsing after a moment, until the shot actually fires, and keeps it lit while the game retries the shot. When you stop moving with a shot still due, or start Auto Shot or Shoot, it lights up for the wind-up too. Nothing lights while the target is out of range.
- **Clipping:** move during the wind-up and the zone turns amber (the clip color), because moving then delays the shot. After a late shot, how late it was shows for a moment, for example "+0.42".
- The zone follows your swing speed, so it moves with haste such as Rapid Fire. It starts earlier by your latency, so a stop at the line reaches the server in time.

On Forever, Auto Shot fires during cast-time shots (Aimed Shot, Multi-Shot, Sniper Shot), so casting needs no marker. Only moving delays the shot.

Turn the game's swing timer on first (Options, Advanced Options, Swing Timer) and set the Ranged Swing Timer's visibility in Edit Mode. The red zone is for hunters, mages, priests and warlocks. Every other class gets only the Look option, which draws the game's swing timer bars flat under the Dark or EllesmereUI style. Settings are saved per character.

## Displays

A display is a frame of Shot Window's own, besides the marks on the game's bar. Choose one on the Display tab. The preview across the top of the options plays a made-up fight on a copy of the game's bar and on your display: an ordinary shot, one you move into (so it clips, comes late and the zone holds), then one more.

- **Classic bar:** one fill, left to right, with the red end as the stand-still zone.
- **Pincer bar:** two fills race in from the ends; the shot fires where they meet.
- **Vertical pincer:** the pincer stood on end, to sit beside your character.
- **Closing gap:** the bar shrinks toward the middle and closes at the shot.
- **Closing brackets:** two brackets slide in and close round the shot.
- **Pips:** pips light from both ends toward the middle pip, which is the shot.
- **Scanner:** the shot line stays in the middle and a spark sweeps across. Out and back, crossing the line at each shot, or left to right. If the shot is late, the spark stops on the line until it fires.
- **Rhythm track:** the coming shots scroll toward a fixed "now" line, so you see the next stand-still window before it arrives.
- **Horseshoe arc:** fills climb both sides of an arc and meet at the shot on top.
- **Ring:** one sweep round to the top, with a countdown inside.
- **Tightening reticle:** a circle closes on its center at the shot. Put it on your character to keep your eyes there.

The horseshoe's words (Move, Stand still, Moving, Late), the ring's "Late" and the ring's countdown can be turned off on the Display tab.

Every display does everything the marks on the game's bar do: it brightens inside the zone, holds at the shot and pulses while a shot is late, turns the clip color when you move inside the zone, and flashes when the shot fires. It shows in combat and while Auto Shot or Shoot is on (or always, if you like), can be dragged anywhere once unlocked, or can sit on the game's bar. Each display follows the window style. Under Blizzard the straight designs sit in the swing timer's own frame, and the horseshoe arc, the ring and the reticle wear the swing timer bar's own art bent round the curve, taken live from the game. Under Dark and EllesmereUI they are a flat panel in the style's colors.

## Alerts

On the Alerts tab, all optional except the first two, and all work with or without a display:

- **Warn when you move inside the zone** (the clip color), and **how late a late shot was**.
- **Call-out text:** "Stop" inside the zone, "Moving" while you clip it, "Late" while a shot is overdue, "Go" just after the shot.
- **Screen edge:** the edges of the screen tint while you must stand still, so you see it from the corner of your eye. In the zone's color or one of its own, and the clip color while you move in the zone (with the move warning on).
- **Sound:** a short sound as the stand-still zone starts, once per swing.

## Options

Esc > Options > AddOns > Shot Window, or type `/shotwindow`. The options show a live preview across the top and four tabs under it: Zone (the marks on the game's bar), Display, Alerts and Look. If the game will not show the page (in combat, for example), the same options open in a window of their own.

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
- `/shotwindow display [name]`: choose a display (none, classic, pincer, vpincer, gap, brackets, pips, scanner, track, arc, ring, reticle); with no word it steps to the next one.
- `/shotwindow unlock` and `/shotwindow lock`: drag the display, then fix it in place.
- `/shotwindow debug`: what the addon sees.
- `/shotwindow help` (or any other word): list the commands.

`/shotwin` works too.

## Beta note

Blizzard has said the 0.5 second wind-up before Auto Shot and wand shots is not working properly in the beta, and the shot currently fires after a much shorter wind-up. Until that is fixed the red zone is wider than it needs to be: lower the aim window in the options, or type `/shotwindow window 0.1`.
