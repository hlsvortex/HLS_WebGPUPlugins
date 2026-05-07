---
name: debug-ui-manager
description: Outlines the DebugUIPlugin architecture and its schema-driven design for safe settings injection.
---

# Debug UI Manager Architecture

The `DebugUIPlugin.ts` acts as the central nerve center for developer interaction. It provides a visual overlay to modify internal parameters of all other plugins in real-time.

## Core Concepts

### Central State Management (`this.params`)
The `DebugUIPlugin` maintains a master dictionary of parameters (`ui.params`).
- When a user adjusts a slider, the value in `this.params` is updated.
- The UI system then fires specific callbacks or global events that plugins listen to, allowing them to instantly apply the new values to uniforms, logic, or state.

### Persistence
To maintain developer sanity, `DebugUIPlugin` serializes `this.params` into `localStorage`.
- Upon initialization, it loads these saved states.
- This ensures that if the page is refreshed, the terrain generation, lighting, and placement remain exactly as configured.

### Schema-Driven Architecture (Refactor Context)
Historically, the UI was highly fragile because plugins imperatively injected DOM elements using explicit callbacks (`ui.addSlider(..., callback)`). If a callback was null or mismatched, it caused catastrophic app failures.

The modern architecture uses **Data-Driven Schemas**:
1. Plugins expose a `getUISchema()` method returning a JSON object describing their parameters.
2. `DebugUIPlugin` acts as a compiler, safely parsing these schemas and instantiating DOM elements.
3. Errors in a plugin's schema are caught and skipped gracefully without crashing the core `PluginManager` loop.

## Key Interactions
- Every single plugin relies on `DebugUIPlugin` for configuration.
- It is instantiated *first* by the `PluginManager` so that its `params` object is available during the `init()` phase of the other plugins.
