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
npm run dev      # local development server
npm run preview  # publish a Preview for the current branch
npm run deploy   # publish to your Cloudflare account
```

For a Cloudflare Git deployment, leave the build command empty and use
`npx wrangler deploy` as the deploy command. Change `name` in `wrangler.jsonc`
if you want a different Worker name.

### Pull request Previews

Connect the GitHub repository to this Worker in Cloudflare Workers Builds. In
**Settings > Build > Branch control**, enable **Preview Builds** and keep the
production branch set to your main branch. Set the Preview command to
`npx wrangler preview` (the default). Keep the build command empty because the
site is served directly from `public/`. The Worker name in Cloudflare must match
`name` in `wrangler.jsonc`.

Each push to a non-production branch then creates or updates its Preview. When
that branch has a pull request, Cloudflare posts the Preview URL in a PR comment.
The top-level `previews` block in `wrangler.jsonc` is required for this command;
an empty block works because this site has no runtime bindings or variables.
You can also run `npm run preview` locally after authenticating Wrangler.

Four example circuit documents are in [`public/examples/`](public/examples/). Import one with **Import .json**:

1. [Constant and LED](public/examples/constant-led.json) — connect a high constant directly to an LED.
2. [AND gate](public/examples/and-gate.json) — two high constants light an LED through an AND gate. Remove one input wire to see it turn off.
3. [Two-bit bus](public/examples/splitter-combine.json) — two high constants form a two-bit value through a splitter; another splitter separates the bits to light two LEDs. Select a bus wire to inspect its value.
4. [Button and LED](public/examples/button-led.json) — hold the button in Pan mode to light the LED; release it to turn the LED off.

The catalog holds real logic-level parts: a **Toggle switch** (click it in Pan mode to change its saved one-bit state; Shift-drag to move it), a **Button** (hold it in Pan mode to drive its single output high; release to drive low;
Shift-drag it to move it),
a **Clock** (toggles its one-bit output at a selected frequency),
a **Register** (stores a 1–32-bit value on a rising clock edge),
an **LED** (lights red when its input net is high), and **AND**, **OR**, **XOR**,
**NAND**, **NOR**, **XNOR**, and 2×2 **NOT** gates, plus a **Splitter**, **Constant** source, an **Output** display, and a **Seven-segment** display. Its seven one-bit inputs A–G directly light the corresponding segments; unwired inputs stay dark. The **Debug display** takes one fixed four-bit input and decodes it as a hex digit; its DBG badge distinguishes it from the numeric Output. Each pin declares an `in` or `out` role, and the board is
solved to a fixed point so gate outputs and LED state follow from the wiring.

The data-path catalog also includes:

| Part | Inputs | Outputs |
| --- | --- | --- |
| Multiplexer | 1–16 data channels D0…D15, selector S | Y receives the channel selected by S |
| Demultiplexer | D, selector S | D goes to one of 1–16 outputs Y0…Y15; the other outputs are 0 |
| Adder | A, B, one-bit CI | Width-limited SUM and one-bit carry out CO |
| Two's complement | A | −A, wrapped to the selected width |
| Comparator | A, B | One-bit LT, EQ, and GT (unsigned comparison) |
| Shift left / right | A, five-bit N | Logical shift by N, with zero fill and width-limited result |
| Register | D, one-bit CLK | Q holds the captured 1–32-bit value |

These parts use a configurable 1–32-bit data width. Mux and demux also have a
**Data channels** property from 1 to 16; the selector bus grows automatically
from 1 to 4 bits. Selector values outside the available channels produce zero.
Other control and flag pins keep their fixed widths. Unwired inputs read zero.
Select a part to change its properties, and hover its pins to see their names
and sizes.

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
direction: a bus can feed its branches, or driven branches can form a bus. Its height grows with its size
(1–32 bits), and it can be rotated like other components. LEDs remain 1 bit.

Place a 2×2 **Constant** and select it to edit its bit width (1–8) and value
(0 through 2^width − 1). Choose decimal, binary (`0b`), or hexadecimal (`0x`)
for both value entry and display. Changing the format converts the existing value.
Its output drives a bus of the selected width. Narrowing the width clamps the
value to the new maximum.

Place a 2×2 **Output** to read a bus. Its input starts at 1 bit and can be set
to 1–32 bits with **Selected size**. The value appears on the component and in
its selected properties. Choose decimal, binary, or hexadecimal display without
changing the circuit value. Its input pin and connected wires must have the same width.

Place a **Clock** to drive a one-bit signal. Select it to set its frequency from
0.1 to 20 Hz (default 1 Hz). It starts LOW and changes level every half period,
so one full LOW/HIGH cycle takes `1 / frequency` seconds. Tick events refresh
the evaluated circuit without saving each phase; only the frequency is stored.

Place a **Register** to hold a bus value. It starts at four bits; select it to
set its width from 1 to 32 bits. Connect a matching bus to D and a one-bit
signal to CLK. When CLK changes from LOW to HIGH, the register copies D to Q;
Q holds that value while CLK stays HIGH or goes LOW. Multiple registers on the
same edge capture their inputs together. A one-bit register behaves as a D
flip-flop. The selected register shows its stored Q value. Registers start at
zero when the board is loaded; saved documents retain the register's width
and wiring, while running values stay in the current simulation session.

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
the next available offset and selects them. Copy and paste include selected components,
their properties, and complete selected wire nets. Paste checks the whole group before
adding anything. Deleting a selection
removes its components and wire nets. Drag a selected component or wire in **Select mode**
to move the whole selection, including complete selected wire nets. Use **Pan mode**
to move a single component.

The code is split by responsibility:

- `components.js` defines the fixed component catalog, dimensions, pin roles,
  and rotated pins.
- `model.js` owns board geometry, wire networks, gate evaluation, and the JSON
  document format.
- `editor.js` owns accepted board edits, publishes a fresh `evaluation` after each
  change, and saves each completed change. `evaluate()` also refreshes state for
  future momentary input events without saving the document.
- `renderer.js` draws components, pins, and wires from that published evaluation.
- `app.js` handles browser events, view controls, and file actions.

Saved documents use schema version 9. They contain grid dimensions, component
types, positions, and gate sizes, plus sized wire segments. Pins, logic values, and wire states are
derived from the catalog. Loading converts legacy Power parts to one-bit Constants with value 1, treats missing sizes in older documents as 1 bit, and skips unknown or
overlapping components and invalid or mismatched wire segments; the browser console reports the number skipped.

Run `npm run check` for syntax and `npm test` for model and editor regressions
(Node.js 20 or newer). GitHub Actions runs both on pushes and pull requests.

## Browser smoke checklist

Serve the directory, open the editor, and check:

1. Place a component in an empty cell; drag it to another cell. An overlapping placement or drag should be rejected.
2. Select a Constant, change its size and value, then draw a matching wire from its output. Hover the wire to see the evaluated value. Try a mismatched wire size and confirm rejection.
3. Select a component and press `R` to rotate it; press `Delete` to remove it. Use `Escape` to clear the active tool and selection.
4. In Select mode, Shift-click or drag to select multiple components. Drag across wires to select their nets too, then move, copy, paste, or delete the mixed group. Also try copying and pasting a wire net alone.
5. Pan by dragging empty canvas, zoom with `Ctrl`/`Cmd` + scroll, then reset with `Ctrl`/`Cmd` + `0`.
6. Download the board, import an example JSON file, and reload the page. The imported board should remain, and the saved JSON should say version 9.

The original smoke pass was run on 2026-09-23 against the local HTTP server in
Orca's browser. Automated tests also cover group copy, paste, and delete.
