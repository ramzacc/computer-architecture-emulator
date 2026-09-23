# Grid Canvas

A small browser-based component and wire editor. Serve this directory with any
static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8000
```

The catalog holds real logic-level parts: a **Power** rail (always drives high),
an **LED** (lights red when its input net is high), and **AND**, **OR**, **XOR**
and **NAND** gates. Each pin declares an `in` or `out` role, and the board is
solved to a fixed point so gate outputs and LED state follow from the wiring.

The code has three parts:

- `components.js` defines the fixed component catalog, dimensions, pin roles,
  and rotated pins.
- `model.js` owns board geometry, wire networks, gate evaluation, and the JSON
  document format.
- `app.js` handles browser events, SVG rendering, and local storage.

Saved documents use schema version 5. They contain grid dimensions, component
types and positions, and wire segments. Pins, logic values, and wire power are
derived from the catalog. Loading skips unknown or overlapping components and
invalid wire segments; the browser console reports the number skipped.

Run the model checks with `npm test` (Node.js 18 or newer). No install step is
needed.
