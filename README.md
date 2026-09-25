# Computer Architecture Tool

A browser-based circuit editor and simulator for exploring digital logic, components, and buses.

[Open the tool](https://comparch.ramza.cc)

Downloaded circuits use compact JSON with `components` and `wires` fields. Each component starts with `[type, x, y, rotation]`, followed by its properties in the layout defined in `public/model.js`. Each wire is `[orientation, x, y, size]`. Imports validate the entire circuit and report an error if any component or wire is invalid.
