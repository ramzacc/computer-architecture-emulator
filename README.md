# Grid Canvas

A small browser-based component and wire editor. Serve this directory with any
static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8000
```

Four example circuit documents are in [`examples/`](examples/). Import one with **Import .json**:

1. [Power an LED](examples/power-led.json) — connect a power rail directly to an LED.
2. [AND gate](examples/and-gate.json) — two powered inputs light an LED through an AND gate. Remove one input wire to see it turn off.
3. [Two-bit bus](examples/splitter-combine.json) — two power rails form a two-bit value through a splitter; another splitter separates the bits to light two LEDs. Select a bus wire to inspect its value.
4. [Four-bit ALU](examples/alu.json) — constants 7 and 3 feed an ALU. The result bus reads 10; the carry and zero LEDs are off. Change the 2-bit OP constant to try other operations.

The catalog holds real logic-level parts: a 2×2 **Power** rail (always drives high),
an **LED** (lights red when its input net is high), and **AND**, **OR**, **XOR**,
**NAND**, and 2×2 **NOT** gates, plus a **Splitter** and **Constant** source. Each pin declares an `in` or `out` role, and the board is
solved to a fixed point so gate outputs and LED state follow from the wiring.

The **ALU** has configurable A, B, and result bus width (1–32 bits), a fixed
2-bit OP input, and 1-bit carry (C) and zero (Z) outputs. Its pins are labeled
on the component. OP selects `00` add, `01` subtract, `10` bitwise AND, or
`11` bitwise OR. Arithmetic wraps to the selected width. C is the carry out
for addition, or 1 when subtraction needs no borrow; it is 0 for logic
operations. Z is 1 when the result is zero. An unwired input reads zero.

Wires carry buses of 1–32 bits (the size property). Set **New wire size** before drawing,
then enter **Wire mode** and click a start point and successive corners or endpoints.
The preview snaps to the grid and routes horizontally then vertically, or takes
the other bend when the first is blocked. Double-click, right-click, or press
`Esc` to finish the current wire; click again to start another. Select existing
wires in **Pan mode**, and right-click a wire there to remove one segment.
Set **New wire size** again for a new bus,
or select a connected wire net or logic gate and edit **Selected size**. Connected
wires and gate pins must have the same size; the editor reports a mismatch and
rejects the change otherwise. Selecting a wire shows the current net value in
decimal and binary under **Bus properties** (or HIGH/LOW for one bit). Gates compute AND, OR, XOR, NAND, and NOT bitwise
across their configured size. A splitter has one bus connection and one 1-bit
branch per bit. Select it to set **Order**: Ascendant puts bit 0 at the first
branch; Descendant puts the highest bit there. It works in either
direction: a bus can feed its branches, or powered branches can form a bus. Its height grows with its size
(1–32 bits), and it can be rotated like other components. Power and LEDs remain
1 bit.

Place a 2×2 **Constant** and select it to edit its bit width (1–8) and decimal value
(0 through 2^width − 1). Its output drives a bus of the selected width. Narrowing
the width clamps the value to the new maximum.

The canvas is an infinite, pannable lattice. Drag empty space to pan, scroll to
move, and zoom with `Ctrl`/`Cmd` + scroll, `Ctrl`/`Cmd` + `+`/`-` (plain
`+`/`-` also work), or `Ctrl`/`Cmd` + `0` to reset the view to 100% centered on
the content. Components and wires may be placed anywhere, including negative
coordinates; the saved `grid` dimensions are legacy metadata and no longer
bound placement. Wires can start anywhere and run along component borders, but
cannot pass through a component's interior.

The code is split by responsibility:

- `components.js` defines the fixed component catalog, dimensions, pin roles,
  and rotated pins.
- `model.js` owns board geometry, wire networks, gate evaluation, and the JSON
  document format.
- `editor.js` owns accepted board edits and saves each completed change.
- `renderer.js` draws components, pins, and wires.
- `app.js` handles browser events, view controls, and file actions.

Saved documents use schema version 8. They contain grid dimensions, component
types, positions, and gate sizes, plus sized wire segments. Pins, logic values, and wire power are
derived from the catalog. Loading treats missing sizes in older documents as 1 bit and skips unknown or
overlapping components and invalid or mismatched wire segments; the browser console reports the number skipped.

Run `npm run check` for syntax and `npm test` for model and editor regressions
(Node.js 18 or newer). No install step is needed. GitHub Actions runs both on
pushes and pull requests.

## Browser smoke checklist

Serve the directory, open the editor, and check:

1. Place a component in an empty cell; drag it to another cell. An overlapping placement or drag should be rejected.
2. Select a Constant, change its size and value, then draw a matching wire from its output. Hover the wire to see the evaluated value. Try a mismatched wire size and confirm rejection.
3. Select a component and press `R` to rotate it; press `Delete` to remove it. Use `Escape` to clear the active tool and selection.
4. Pan by dragging empty canvas, zoom with `Ctrl`/`Cmd` + scroll, then reset with `Ctrl`/`Cmd` + `0`.
5. Download the board, import an example JSON file, and reload the page. The imported board should remain, and the saved JSON should say version 8.

The smoke pass was run on 2026-09-23 against the local HTTP server in Orca's
browser. Placement, dragging, wiring, properties, import, download, rotation,
and reload persistence passed; model tests cover rejected edits and legacy import.
