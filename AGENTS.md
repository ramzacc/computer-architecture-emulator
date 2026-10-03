# Working in this repository

## Project and workflow

Computer Architecture Tool is a desktop browser teaching app for designing digital circuits, composing reusable modules, defining an ISA, and running/debugging assembly on user-built hardware.

- The app lives in `public/`: vanilla JavaScript, native ES modules, HTML/CSS, and SVG rendering. There is no frontend framework or build step.
- Cloudflare Wrangler serves/deploys `public/` as static assets; configuration is in `wrangler.jsonc`.
- `npm ci` installs development dependencies; `npm run dev` starts the local server.
- `npm run check` checks JavaScript syntax; `npm test` runs the Node test suite. CI runs both on Node 20.
- Run one test file with `node --test tests/model.test.js` (substitute the relevant file).

## Where to work

- `public/app.js`: entry point, DOM/events, canvas interaction, inspector, module navigation, ROM editing, project import/export, and startup persistence.
- `public/components.js`: component definitions, dimensions/pins, width/property validation, and serialized component field order.
- `public/model.js`: board structure, wire routing/connectivity, circuit evaluation, validation, and circuit serialization/parsing.
- `public/editor.js`: `BoardEditor` owns editing operations, undo/redo, storage, clocks, and register/RAM runtime state.
- `public/renderer.js`: component SVG and wire rendering; `public/index.html` and `public/styles.css`: UI structure and styling.
- `public/monitor.js`: signal monitoring; `public/program.js`: ISA editing and program debugging; `public/assembly.js`: assembler/disassembler; `public/program-source.js`: source-to-ROM reconciliation.
- `public/project-file.js` and `public/import-worker.js`: versioned project files and background import validation. Read `docs/project-format-v1.md` before changing the file format.
- `tests/`: built-in `node:test` / strict assertions, including lightweight DOM/storage stubs. `fixtures/` and `examples/` contain circuit/project JSON; `public/demo-computer.json` is the startup demo.

## Important conventions

- Keep circuit logic independent of the DOM; use `BoardEditor` operations for UI edits so validation, history, evaluation, and persistence stay consistent. Validate trial edits before publishing them.
- Runtime boards use a component array, a wire `Map` keyed by `edgeKey`, and a junction `Set`. Wires are unit grid edges (`H`/`V`); use model helpers for geometry and connectivity.
- Component definitions, pins, evaluation, rendering, and serialization are coupled. When adding a component/property, inspect all of those paths and their tests.
- Serialized circuits use positional component tuples, compact wire runs, and component indexes for references. IDs are regenerated on parse; preserve tuple field order and index mappings.
- Distinguish circuit documents (`serialize`/`parseDocument`) from project files (`serializeProject`/`parseProject`), which also preserve pending ROM/ISA/source edits and breakpoints. Validate the complete import before replacing the current project.
- Clock phases and register/RAM values are runtime state and reset on import/history restoration. Keep them separate from saved circuit configuration.
- Match nearby code style and explicit `.js` imports. For behavior changes, extend the relevant tests and run `npm run check` and `npm test`; verify visible UI changes in the browser as well.

## Commits

- Commit completed, validated changes in cohesive groups. Stage only files belonging to the task; keep unrelated changes separate.
- Use short, imperative subjects (e.g. `Fix ROM import`). Omit descriptions unless strictly required to explain essential context; keep them brief.
