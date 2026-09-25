# Grid Canvas

A small browser-based component and wire editor. Serve `public/` with any
static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8000 --directory public
```

## Deploy to Cloudflare Workers

Wrangler serves the browser files directly from `public/`; no build command or
Worker script is needed.

```sh
npm ci
npm run dev      # local Cloudflare preview
npm run deploy   # publish to your Cloudflare account
```

For a Cloudflare Git deployment, leave the build command empty and use
`npx wrangler deploy` as the deploy command. Change `name` in `wrangler.jsonc`
if you want a different Worker name.

Three example circuit documents are in [`public/examples/`](public/examples/). Import one with **Import .json**:

1. [Power an LED](public/examples/power-led.json) — connect a power rail directly to an LED.
2. [AND gate](public/examples/and-gate.json) — two powered inputs light an LED through an AND gate. Remove one input wire to see it turn off.
3. [Two-bit bus](public/examples/splitter-combine.json) — two power rails form a two-bit value through a splitter; another splitter separates the bits to light two LEDs. Select a bus wire to inspect its value.

The catalog holds real logic-level parts: a 2×2 **Power** rail (always drives high),
an **LED** (lights red when its input net is high), and **AND**, **OR**, **XOR**,
**NAND**, **NOR**, **XNOR**, and 2×2 **NOT** gates, plus a **Splitter**, **Constant** source, and **Output** display. Each pin declares an `in` or `out` role, and the board is
solved to a fixed point so gate outputs and LED state follow from the wiring.

The data-path catalog also includes:

| Part | Inputs | Outputs |
| --- | --- | --- |
| MUX 2:1 | A, B, one-bit S | Y = A when S is 0, B when S is 1 |
| DEMUX 1:2 | D, one-bit S | Y0 = D when S is 0, Y1 = D when S is 1; the other output is 0 |
| Adder | A, B, one-bit CI | Width-limited SUM and one-bit carry out CO |
| Two's complement | A | −A, wrapped to the selected width |
| Comparator | A, B | One-bit LT, EQ, and GT (unsigned comparison) |
| Shift left / right | A, five-bit N | Logical shift by N, with zero fill and width-limited result |

These parts use a configurable 1–32-bit data width. Control and flag pins keep
the fixed widths shown above. Unwired inputs read zero. Select a part to change
its data width, and hover its pins to see their names and sizes.

Wires carry buses of 1–32 bits (the size property). Set **New wire size** before drawing,
then enter **Wire mode** and click a start point and successive corners or endpoints.
The preview snaps to the grid and routes horizontally then vertically, or takes
the other bend when the first is blocked. Double-click, right-click, or press
`Esc` to finish the current wire; click again to start another. Select existing
wires in **Select mode** or **Pan mode**, and right-click a wire to remove one segment.
Set **New wire size** again for a new bus,
or select a connected wire net or logic gate and edit **Selected size**. Connected
wires and component pins must have the same size; the editor reports a mismatch and
rejects the change otherwise. Selecting a wire shows the current net value in
decimal and binary under **Bus properties** (or HIGH/LOW for one bit). Gates compute AND, OR, XOR, NAND, NOR, XNOR, and NOT bitwise
across their configured size. A splitter has one bus connection and one 1-bit
branch per bit. Select it to set **Order**: Ascendant puts bit 0 at the first
branch; Descendant puts the highest bit there. It works in either
direction: a bus can feed its branches, or powered branches can form a bus. Its height grows with its size
(1–32 bits), and it can be rotated like other components. Power and LEDs remain
1 bit.

Place a 2×2 **Constant** and select it to edit its bit width (1–8) and decimal value
(0 through 2^width − 1). Its output drives a bus of the selected width. Narrowing
the width clamps the value to the new maximum.

Place a 2×2 **Output** to read a bus. Its input starts at 1 bit and can be set
to 1–32 bits with **Selected size**. The value appears on the component and in
its selected properties. Its input pin and connected wires must have the same width.

The canvas is an infinite, pannable lattice. Drag empty space to pan, scroll to
move, and zoom with `Ctrl`/`Cmd` + scroll, `Ctrl`/`Cmd` + `+`/`-` (plain
`+`/`-` also work), or `Ctrl`/`Cmd` + `0` to reset the view to 100% centered on
the content. Components and wires may be placed anywhere, including negative
coordinates; the saved `grid` dimensions are legacy metadata and no longer
bound placement. Wires can start anywhere and run along component borders, but
cannot pass through a component's interior.

Use **Select mode** to click a wire net or a component, Shift-click to add or remove either, or
drag across empty canvas to select components and wire nets. Shift-drag adds to the
selection. Use **Copy**, **Paste**, and **Delete**, or `Ctrl`/`Cmd` + `C`,
`Ctrl`/`Cmd` + `V`, and `Delete`/`Backspace`. Paste places copies together at
the next available offset and selects them. These actions copy components and
their properties; wires stay in place when copying or pasting. Deleting a selection
removes its components and wire nets. Use **Pan mode** to move a component.

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
(Node.js 20 or newer). GitHub Actions runs both on pushes and pull requests.

## Browser smoke checklist

Serve the directory, open the editor, and check:

1. Place a component in an empty cell; drag it to another cell. An overlapping placement or drag should be rejected.
2. Select a Constant, change its size and value, then draw a matching wire from its output. Hover the wire to see the evaluated value. Try a mismatched wire size and confirm rejection.
3. Select a component and press `R` to rotate it; press `Delete` to remove it. Use `Escape` to clear the active tool and selection.
4. In Select mode, Shift-click or drag to select multiple components. Drag across wires to select their nets too, then delete the mixed group. Copy and paste components as a separate check.
5. Pan by dragging empty canvas, zoom with `Ctrl`/`Cmd` + scroll, then reset with `Ctrl`/`Cmd` + `0`.
6. Download the board, import an example JSON file, and reload the page. The imported board should remain, and the saved JSON should say version 8.

The original smoke pass was run on 2026-09-23 against the local HTTP server in
Orca's browser. Automated tests also cover group copy, paste, and delete.
