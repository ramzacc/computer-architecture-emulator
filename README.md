# Grid Canvas

A small browser-based component and wire editor. Serve this directory with any
static HTTP server, then open `index.html`. For example:

```sh
python3 -m http.server 8000
```

The code has three parts:

- `components.js` defines the fixed component catalog, dimensions, and rotated pins.
- `model.js` owns board geometry, wire networks, and the JSON document format.
- `app.js` handles browser events, rendering, and local storage.

Saved documents use schema version 4. They contain grid dimensions, component
types and positions, and wire segments. Pins and wire power are derived from
the catalog. Loading skips unknown or overlapping components and invalid wire
segments; the browser console reports the number skipped.

Run the model checks with `npm test` (Node.js 18 or newer). No install step is
needed.
