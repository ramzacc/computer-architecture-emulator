# Computer Architecture Tool

A browser-based circuit editor and simulator for exploring digital logic, components, and buses.

The ROM component starts with an 8-bit address bus and an 8-bit data bus. Select it to edit both sizes from 1 to 32 bits and enter contents as hexadecimal `address: value` lines (for example, `00: FF`). Addresses not listed produce zero. Changing the data size masks stored words to the new width; reducing the address size requires all stored addresses to fit.

[Open the tool](https://comparch.ramza.cc)

Downloaded circuits use compact JSON with `components` and `wires` fields. Each component starts with `[type, x, y, rotation]`, followed by its properties in the layout defined in `public/model.js`. Each wire is `[orientation, x, y, size]`. Imports validate the entire circuit and report an error if any component or wire is invalid.
