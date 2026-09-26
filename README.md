# Computer Architecture Tool

A browser-based circuit editor and simulator for exploring digital logic, components, and buses.

The ROM component starts with an 8-bit address bus and an 8-bit data bus. Address widths are limited to 1, 2, 4, 8, or 16 bits; data widths can also be 32 bits. The largest ROM is 65,536 words or 256 KiB at 32 bits per word. Select a ROM and use **Edit ROM contents** to open the ROM tab. The editor shows fixed address labels and accepts only hex values in each cell. It displays up to 64 addresses per page in four groups of 16, arranged in one, two, or four columns as space allows. Use the page buttons or hex address jump field to navigate. Empty cells read as zero. Click **Save to component** to apply edits. Changing the data size masks stored words to the new width; reducing the address size requires all stored addresses to fit.

The ROM tab can import and export `.txt` files containing one uninterrupted hexadecimal string, starting at address zero. Each fixed-width group of hex digits is one ROM word; the selected component supplies the word width. Export fills gaps with zero words and omits trailing zeros. Import replaces the ROM contents when you click **Save to component**.

RAM uses the same address and data width choices as ROM. Its ADDR and DIN inputs select an address and write data; a rising edge on the one-bit WR input stores DIN at ADDR. DATA continuously reads the selected address. RAM starts at zero and its contents last only for the current simulation; they are not edited in the ROM tab or saved with the circuit. Reducing a width trims stored values or addresses that no longer fit.

[Open the tool](https://comparch.ramza.cc)

Downloaded circuits use compact JSON with `components` and `wires` fields. Each component starts with `[type, x, y, rotation]`, followed by its properties in the layout defined in `public/model.js`. Each wire is `[orientation, x, y, size]`. Imports validate the entire circuit and report an error if any component or wire is invalid.
