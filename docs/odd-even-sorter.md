# Eight-register sorter example

Open **File → Open 8-register sorter example** in the simulator. This is a native project built from the editor's input, register, comparator, multiplexer, switch, button, and gate components. The eight register values and controls are also available on the Monitor tab.

1. Change **Value 0** through **Value 7** if you want a different starting order. The example starts with `[7, 2, 6, 1, 5, 0, 4, 3]`.
2. Press **RESET** to clear the eight registers and phase bit.
3. Turn **LOAD** on, press **STEP clock** once, then turn **LOAD** off. That clock edge copies the eight input values into the registers. LOAD also holds the phase register at 0.
4. Turn **RUN lock** on. Each press of **STEP clock** performs one sorting phase. You may turn RUN off to pause.

Phase 0 compares and swaps `(R0,R1)`, `(R2,R3)`, `(R4,R5)`, `(R6,R7)`. Phase 1 compares `(R1,R2)`, `(R3,R4)`, `(R5,R6)`; the outer registers hold their values. The **Phase** register alternates between 0 and 1. Each compare/swap uses the comparator's `GT` output to select either the original or crossed inputs with multiplexers. A pair swaps only when its left value is greater. Eight sorting clock edges are sufficient for eight values. Further clock edges leave the sorted order unchanged.

The [project file](../public/examples/odd-even-sorter.json) can also be downloaded and opened with **File → Import project from file**. Its layout can be regenerated with `node scripts/generate-sorter-example.mjs`.
