# Contributing to WebGPU Terrain Engine

Thank you for your interest in contributing! This document covers the conventions and patterns used in this project.

---

## Development Setup

```bash
npm install
npm run dev
```

The Vite dev server starts at `http://localhost:5174` with HMR enabled.

---

## Writing a Plugin

Every feature in the engine is a self-contained plugin. To add a new one:

### 1. Create the Plugin File

Create `src/plugins/MyPlugin.ts`:

```typescript
export class MyPlugin {
    core: any;  // Injected by PluginManager

    constructor() {
        // Initialize local state only — no access to `core` yet
    }

    async init() {
        // Access core dependencies
        const { renderer, scene, camera, debugUI } = this.core;

        // Register UI controls
        if (debugUI) {
            debugUI.registerPlugin('MyPlugin', '🔧', '#ff0', {
                category: 'Effects'
            });
            debugUI.addSlider('MyPlugin', 'myParam', 'My Parameter',
                0.0, 1.0, 0.05, 0.5,
                'Tooltip description',
                (val: number) => { /* react to changes */ }
            );
        }
    }

    update(deltaTime: number) {
        // Called every frame (skipped when plugin is disabled)
    }

    dispose() {
        // Clean up GPU resources, DOM elements, etc.
    }
}
```

### 2. Register in main.ts

```typescript
import { MyPlugin } from './plugins/MyPlugin';

// Inside init():
pluginManager.register('MyPlugin', new MyPlugin());
```

### 3. Plugin Lifecycle

Plugins are processed in **registration order**:

1. `register()` — Core dependencies are injected via `plugin.core = coreDeps`
2. `init()` — Async one-time setup (GPU pipelines, textures, UI)
3. `update(dt)` — Per-frame tick, skipped if disabled
4. `dispose()` — Teardown

> **Important:** `DebugUI` must be registered first so other plugins can access `this.core.debugUI` during their `init()`.

---

## GPU Compute Shaders

WGSL compute shaders live in `src/gpu/`. They are imported as raw strings via Vite:

```javascript
import heightSrc from '../gpu/height.compute.wgsl?raw';
```

The `GPUCompute` class manages pipeline creation, bind groups, and dispatch. If you need to add a new compute pass:

1. Create `src/gpu/mypass.compute.wgsl`
2. Import it in `GPUCompute.js`
3. Create a pipeline and bind group in `_buildPipelines()`
4. Add a dispatch call in `dispatch()`

### Texture Convention

All compute textures use `rgba32float` format at `textureSize × textureSize` resolution (default 2048). Channels are packed as:

| Texture | R | G | B | A |
|---|---|---|---|---|
| `height` | Elevation (0–1) | Slope | Moisture | Reserved |
| `biome` | Biome ID | Temperature | Precipitation | Reserved |
| `spawn` | Spawn density | Spawn type | Reserved | Reserved |

---

## TSL (Three Shading Language)

The terrain material uses TSL for both vertex displacement and fragment coloring. TSL nodes are imported from `three/tsl`:

```javascript
import { positionWorld, texture, vec2, smoothstep, mix } from 'three/tsl';
```

Key conventions:
- Uniforms are created with `uniform()` and stored as class properties for live updates
- Height sampling uses `texture(heightTex, uv)` in the vertex shader
- Biome colors are selected via `smoothstep` thresholds in the fragment shader

---

## Code Style

- **Plugins:** TypeScript (`.ts`)
- **Systems:** JavaScript (`.js`) — these predate the TS migration
- **Shaders:** WGSL (`.wgsl`)
- **Naming:** PascalCase for classes, camelCase for methods/variables
- **Comments:** Preserve existing doc comments; add JSDoc for new public methods

---

## Testing

Currently manual verification via the Debug UI panel. When adding features:

1. Toggle the plugin on/off via the UI to verify no side effects
2. Check the browser console for `[PluginManager]` and `[GPUCompute]` logs
3. Verify GPU memory isn't leaking by watching the Stats panel FPS over time
