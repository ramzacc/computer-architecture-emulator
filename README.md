# Grid Canvas

A small browser-based component and wire editor. Serve this directory with any
static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8000
```

Three example circuit documents are in [`examples/`](examples/). Import one with **Import .json**:

1. [Power an LED](examples/power-led.json) — connect a power rail directly to an LED.
2. [AND gate](examples/and-gate.json) — two powered inputs light an LED through an AND gate. Remove one input wire to see it turn off.
3. [Two-bit bus](examples/splitter-combine.json) — two power rails form a two-bit value through a splitter; another splitter separates the bits to light two LEDs. Select a bus wire to inspect its value.

The catalog holds real logic-level parts: a **Power** rail (always drives high),
an **LED** (lights red when its input net is high), and **AND**, **OR**, **XOR**
and **NAND** gates, plus a **Splitter**. Each pin declares an `in` or `out` role, and the board is
solved to a fixed point so gate outputs and LED state follow from the wiring.

Wires carry buses of 1–32 bits (the size property). Set **New wire size** before drawing,
or select a connected wire net or logic gate and edit **Selected size**. Connected
wires and gate pins must have the same size; the editor reports a mismatch and
rejects the change otherwise. Selecting a wire shows the current net value in
decimal and binary under **Bus properties** (or HIGH/LOW for one bit). Gates compute AND, OR, XOR, and NAND bitwise
across their configured size. A splitter has one bus connection and one 1-bit
branch per bit, with bit 0 closest to the bus connection. It works in either
direction: a bus can feed its branches, or powered branches can form a bus. Its height grows with its size
(1–32 bits), and it can be rotated like other components. Power and LEDs remain
1 bit.

The canvas is an infinite, pannable lattice. Drag empty space to pan, scroll to
move, and zoom with `Ctrl`/`Cmd` + scroll, `Ctrl`/`Cmd` + `+`/`-` (plain
`+`/`-` also work), or `Ctrl`/`Cmd` + `0` to reset the view to 100% centered on
the content. Components and wires may be placed anywhere, including negative
coordinates; the saved `grid` dimensions are legacy metadata and no longer
bound placement. Wires can start anywhere and run along component borders, but
cannot pass through a component's interior.

The code has three parts:

- `components.js` defines the fixed component catalog, dimensions, pin roles,
  and rotated pins.
- `model.js` owns board geometry, wire networks, gate evaluation, and the JSON
  document format.
- `app.js` handles browser events, SVG rendering, and local storage.

Saved documents use schema version 6. They contain grid dimensions, component
types, positions, and gate sizes, plus sized wire segments. Pins, logic values, and wire power are
derived from the catalog. Loading treats missing sizes in older documents as 1 bit and skips unknown or
overlapping components and invalid or mismatched wire segments; the browser console reports the number skipped.

Run the model checks with `npm test` (Node.js 18 or newer). No install step is
needed.
