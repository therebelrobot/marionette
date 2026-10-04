# marionette

Self-hosted isometric **character mannequins** for pixel art. Pick a height (child 1 block · adult 2 · tall 3) and a build (thin · regular · wide), choose an animation, and export pixel-exact frames in all 8 directions as Procreate-ready layered PSDs, sprite sheets, frame strips and GIFs.

It's plinth's companion: same tile and level pixel sizes, same 2:1 projection, so a 2-block adult stands correctly against a 2-block plinth wall.

Works with mouse + keyboard on desktop and with fingers + Pencil on iPad.

## Run it

```sh
docker run -d -p 3000:3000 -v marionette-data:/data ghcr.io/therebelrobot/marionette:latest
# or: docker compose up -d
```

Open `http://<docker-host>:3000`. Figures are stored in SQLite under `/data`.

```sh
npm install
npm run dev:server   # API on :3000
npm run dev          # Vite on :5173, proxies /api
npm test             # skeleton, animation, PSD/GIF/zip round-trips (uses python psd-tools + Pillow if installed)
npx tsx test/preview.ts sheet.png idle,walk 4   # contact sheet like the guides, from the CLI
```

Env: `PORT` (3000), `HOST`, `DATA_DIR` (`./data`), `STATIC_DIR` (`./dist/public`).
Releases: `npm run release:patch|minor|major` pushes a tag; `.github/workflows/release.yml` tests, builds amd64 + arm64 to GHCR and attests provenance. Pin the actions to SHAs first (see the note at the top of the workflow).

## Animations

| Locomotion | Emotes | Actions |
|---|---|---|
| idle (4 f · 3.5 fps) | wave | cast |
| walk (8 f · 10 fps) | cheer | slash |
| run (8 f · 12 fps) | nod | hurt |
| jump (10 f · 12 fps, once) | head shake | knock-down |
| crouch | shrug | |
| sit (seat at knee height) | point · bow · talk | |

Every animation has its own **frame rate** (decimals allowed: 3.5 fps ≈ 286 ms) and **frame count**. Frames are *sampled* from smooth key-pose curves rather than drawn, so any count works. At the default count, frames land exactly on the named key poses (the walk's contact R · down · passing · up · contact L …), and those names appear in the timeline, the sheet view and the PSD frame names. Other per-animation settings are **loop** (loops never repeat frame 0 at the end; one-shots include both ends) and **intensity** (scales every pose: 50% subtle, 150% broad).

Defaults match the guides you started from: walk 8 frames at 100 ms, idle 4 frames at ~286 ms (the guides used 280 ms; set 3.57 fps for an exact match).

## Getting it into Procreate

**Procreate animation PSD.** Export → *Procreate animation* gives one `.psd` per animation and direction. Each frame is a **layer group**, and **Animation Assist plays each group as one frame**, so it animates straight after import. Inside each group, every limb is its own layer: *Shadow, Left leg, Right leg, Left arm, Right arm, Body, Head, Lines* (plus a hidden *Tile* if the tile guide is on). Set the playback rate in Animation Assist's settings to match; the fps is in the panel and in `sheets/*.json`. PSDs don't carry a frame rate.

Each part layer holds only the pixels that part wins in the depth test, so layers never overlap. Hiding *Right arm* leaves a gap rather than revealing anything wrong behind it.

**Other exports**, for the current animation or all included ones, one direction or all 8, at 1×/2×/4×/8×:
- **Sprite sheets**: rows = directions (0 S … 7 SE), columns = frames, plus JSON with frame size, anchor, fps and frame names.
- **Frames & strips**: the same folder layout as the guides zip (`walk_frames/0_S_walk_0.png`, `walk_strips/0_S_walk_strip.png`).
- **Preview GIF**: one direction, or all 8 in a compass, at the animation's frame rate. GIF timing is in 10 ms steps, so 15 fps plays at 70 ms.
- **Everything**: all of the above plus `figure.json`.
- **Current frame** as a layered PSD or PNG, for painting a single key pose.

On iPad the share icon opens the share sheet (Procreate is listed there). That needs the app served over HTTPS; over plain HTTP, exports download instead.

## Controls

| | Desktop | iPad |
|---|---|---|
| Play / pause | `Space` | ▶ button |
| Step frames | `←` `→` | ⏮ ⏭, tap a frame |
| Turn the figure | `↑` `↓` / `Q` `E`, `0`–`7` | drag sideways on the figure, or the direction pad |
| Zoom | `⌘`/`Ctrl` + scroll | pinch |
| Previous / next animation | `[` `]` | Animations panel |
| View: one · 8-way · sheet | `V` | toolbar |
| Onion skin / block guide | `O` / `G` | toolbar |
| Undo / redo | `⌘Z` / `⇧⌘Z` | toolbar |

Directions are numbered as in the guides: 0 S (facing you), 1 SW, 2 W, 3 NW, 4 N, 5 NE, 6 E, 7 SE. Dragging right spins the figure like a turntable.

## Figure settings

- **Height class** sets height in levels and the head count. Proportions are pixel-art stylised (child ≈3 heads, adult ≈4.3, tall ≈5.4) so faces stay readable at sprite size. Lower **Head** for more realistic proportions.
- **Build** scales shoulder width, torso depth, hips and limb thickness. Fine-tune with the sliders: height in levels, head, shoulders, hips, limbs, legs, arms.
- **Tile width / level height**: keep these the same as your plinth scene.
- **Frame**: *Per animation* (default) fits each animation tightly. *Fit all* gives every animation the same cell size, which engines like but which also makes the walk as wide as the knock-down. *Custom* takes a fixed size, anchored bottom-centre. The anchor (tile centre at ground level) is shown, and is written to every JSON file.
- **Look**: guide colours (right side warm, left side cool, as in the guides) or values only; 2–6 light bands; facing markers (face patch, eyes, chest centre-line); outline outside or inside the shape, around body parts or the silhouette only; ground shadow; tile guide.

## How it works

The mannequin is a skeleton posed by forward kinematics. Limbs are capsules; the chest and pelvis are boxes rounded by intersecting them with an ellipsoid; the head is an ellipsoid; the feet are boxes. Every frame is rendered the way plinth renders blocks: one ray per pixel centre along the iso view direction, intersected analytically with each part and z-buffered. As a result:

- occlusion is correct in every pose and direction (an arm crossing the chest, a leg passing behind the other);
- edges are clean pixel staircases with no antialiasing;
- the 8 directions are the same pose turned in 45° steps, so they always agree with each other.

After posing, the figure is dropped so its lowest point touches the floor. Bending a stance knee therefore lowers the body on its own: walk bob, crouches, sitting and lying down all stay grounded at any proportions. Poses are a handful of named joint angles; walk and run define half a cycle and mirror the second half.

Storage is one SQLite table (`node:sqlite`) of whole JSON documents behind `node:http`, with no runtime dependencies. The client autosaves and keeps a localStorage draft as a fallback.

## Manual test checklist (real iPad)

Headless runs covered desktop input, touch swipe-to-turn, pinch zoom, the floating panels in portrait, and every export (PSDs read back with psd-tools, GIFs decoded with Pillow, zip integrity). These need a real device:

- [ ] Import an animation PSD into Procreate. Turn on Animation Assist: each *Frame N* group should be one frame, and the limb layers should be intact inside each group.
- [ ] Share sheet lists Procreate (needs HTTPS).
- [ ] Pinch zoom doesn't zoom the page; double-tap on buttons doesn't zoom.
- [ ] Dragging sideways on the figure turns it smoothly with a finger and with the Pencil.
- [ ] Playback runs at the set fps while the panels are open.
- [ ] Add to Home Screen opens full-screen and respects the safe areas.
- [ ] Edit on iPad, reload on desktop: same figure.

## License

[Unlicense](LICENSE)
