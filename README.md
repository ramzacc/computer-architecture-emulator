# Computer Architecture Tool

A browser-based circuit editor and simulator for exploring digital logic, components, and buses.

The ROM component takes an 8-bit address bus and drives an output bus adjustable from 1 to 32 bits. Select a ROM to edit its contents as hexadecimal `address: value` lines (for example, `00: FF`). Addresses not listed produce zero. Changing the output width masks stored words to the new width.

[Open the tool](https://comparch.ramza.cc)

Downloaded circuits use compact JSON with `components` and `wires` fields. Each component starts with `[type, x, y, rotation]`, followed by its properties in the layout defined in `public/model.js`. Each wire is `[orientation, x, y, size]`. Imports validate the entire circuit and report an error if any component or wire is invalid.
