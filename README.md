# Exploded Axonometry

An Adobe Illustrator script that turns a stack of selected artwork into an **exploded axonometric view** (tilted sheets spread apart) or a **row** (the layers lined up side by side). It's made for showing how a paper design is built up layer by layer.

Your original artwork is never changed. The result is a new group placed to the right of it.

## Files

| File | What it is |
|---|---|
| `ExplodedAxonometry.jsx` | The script itself |
| `ExplodedAxonometry.ahk` | AutoHotkey v2 file that runs the script with **F9** inside Illustrator |

## Setup

1. Put both files in the same folder.
2. Double-click `ExplodedAxonometry.ahk`. A green "H" appears in the system tray, which means F9 is live.
3. Optional: to start it with Windows, press Win+R, type `shell:startup`, and put a shortcut to the .ahk file in the folder that opens.

F9 only works while Illustrator is the active window. The hotkey talks to Illustrator directly, so no Illustrator Action is needed and no "You're about to run the script..." warning appears.

You can also run the script from **File > Scripts > Other Script...**

## Using it

1. Select the artwork. Every selected **path**, **compound path** or **group** counts as one layer. Groups are never broken up.
2. Press **F9**. The settings window opens.
3. Pick the options and click **Explode!** (or **Arrange!** for a row).

The layer order comes from the stacking order: the back-most object is the first layer, the front-most is the last. The window remembers your settings for next time.

### Projection

- **Tilt angle (X°):** how strongly the sheets are tilted. 30 gives the classic isometric look. 0 keeps the layers exactly as they are.
- **Sheet plane:** four picture tiles, each showing a sheet with a letter R so you can see how it gets distorted. The pictures update live while you type.

| Plane | What it looks like | Layout it gives |
|---|---|---|
| Slope down-right | Standing panels, sloping down to the right | Exploded |
| Slope up-right | Standing panels, sloping up to the right | Exploded |
| Floor | Sheets lying down, like floors of a building | Exploded |
| Flat | No tilt at all, the tilt field is locked to 0° | Row |

The plane decides the layout, so only the settings for that layout are shown.

### Exploded settings (Slope and Floor planes)

- **Direction:** Natural (front layers come towards you), Natural reversed, or Custom.
- **Custom angle (X°):** used with Custom. 0 = right, 90 = up, 180 = left, 270 = down.
- **Gap between layers (%):** a percentage of the artwork's larger side. 0 stacks the layers exactly on top of each other, so you see the original structure, just tilted.

### Row settings (Flat plane)

- **Direction:** Right, Left, Down, Up, or Custom (with its own angle field). The back layer always comes first.
- **Spacing (mm):** 5 = a 5 mm gap, 0 = touching, -10 = a 10 mm overlap. Where layers overlap, front layers sit on top.
- **Measure from:**
  - **Whole artwork** (default): every layer gets a same-size slot, the size of the whole selection, and keeps its original spot inside it. Small pieces stay where they belong instead of bunching up.
  - **Each layer:** like Illustrator's Align panel (Distribute Spacing): each layer starts right where the previous one's edge ends.

Across the row direction, the layers keep their original positions relative to each other.

### Other options

- **Reverse layer order:** tick it if the layers come out upside-down.
- In every picture, the **orange sheet** is the front layer.

### What stays the same

- **Stroke widths, stroke colours and fill colours** are never changed.
- **Gradients** follow the tilt.
- **Compound paths** keep all their holes.

## Changelog

### v4 (2026-11-27): Floor plane, tilt 0 and the Row layout

- **Tilt 0:** the tilt can now be set to 0, which leaves the layers untransformed (identity matrix).
- **Floor plane:** brought back the "lying down" projection (sheet axes `u = [cos, sin]`, `v = [-cos, sin]`), which can't be reached with the Slope planes plus a spread angle. Its natural spread direction is straight up.
- **Flat plane:** now always means no tilt. The tilt field is locked to 0° while Flat is picked, and the slope tilt is remembered and restored when switching back.
- **Row layout:** new layout for the Flat plane. The copies are tilted (identity for Flat), then shifted along a unit direction vector (right, left, down, up or a custom angle):
  - *Whole artwork:* slot size = the combined extent of all copies along the direction + spacing; layer *i* moves by *i* x slot.
  - *Each layer:* Align-style distribution; each layer's start is placed at the previous layer's end + spacing, measured from each copy's geometric bounds projected onto the direction.
  - The finished row is placed to the right of the original and centred on it vertically. The result group is named "Layer row".
- **Layout follows the plane:** Slope and Floor planes give Exploded, Flat gives Row. The settings window shows only the matching section (ScriptUI stacked panels); the separate Layout tiles were removed to keep the window simpler.
- **Settings window:** new pictogram tiles for the row directions and the two measuring modes, all updating live; unavailable tiles are drawn faded.
- New saved settings: `layout`, `rowDir`, `rowAngle`, `rowGapMm`, `rowMeasure`. Older settings files still load (missing values fall back to the defaults).

### v3.1 (2026-11-24): each layer tilted as one whole object

- **Fixed:** some compound paths (for example ones made with Shape Builder or Pathfinder) hide part of their sub-paths from scripts. Moving points one by one left those holes behind, sitting on top of the original.
- Each copy is now tilted with Illustrator's own `transform()` as one object, so every part inside it moves together. Gradients get the full tilt, including the slant.
- The matrix convention and origin are calibrated on an invisible test triangle before any artwork is touched; if no convention lands correctly, the script stops without changing anything.
- Stroke widths are measured before the transform and written back afterwards, so they never change.
- Removed the release / re-make (normalize) step, which is no longer needed.
