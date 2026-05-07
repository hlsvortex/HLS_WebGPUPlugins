---
name: quadlod-terrain
description: Architectural instructions for the standalone QuadLOD Terrain Plugin. Explains how the GPU Compute pipeline connects to the QuadTree mesh generator.
---

# QuadLOD Terrain Plugin

The QuadLOD Terrain is a standalone, purely GPU-driven procedural landscape generator. It is completely agnostic of game logic (no SpacetimeDB or Entity logic).

## Core Architecture

The system is composed of the following isolated modules:

1. **`TerrainPlugin.ts`**: The high-level orchestrator. It acts as the bridge between the core generic `PluginManager` and the inner terrain engine.
2. **`TerrainSystem.js`**: The primary API. It boots the compute shaders, compiles the raw TSL (Three Shading Language) materials, and maintains the `QuadTreeLOD` instance. It holds the `onTerrainUpdated(heightData, size, scale)` callback which external game logic can listen to.
3. **`QuadTreeLOD.js`**: The spatial manager. It dynamically splits a flat plane into a dense grid of microscopic chunks near the camera, while leaving distant chunks massive. The vertex displacement is entirely handled by the `TerrainSystem`'s TSL material.
4. **`GPUCompute.js`**: Dispatches the `.wgsl` shaders sequentially. `height` -> `biome` -> `spawn`.
5. **`GraphGenerator.js`**: Runs purely on the CPU to pre-calculate rivers using a directed node graph before feeding it to the GPU.
6. **`TerrainDebugUI.js`**: A decoupled DOM interface for live-tuning WebGPU uniforms and triggering the `regenerate` callback.

## Mathematical Constraints
* **Sea Level**: The shader math offsets the height by `-400`. Normalizing the heightmap (`0.0 - 1.0`), sea level is exactly at Y `0`.
* **Zero-Copy Displacing**: Do **not** attempt to read geometry vertices on the CPU to place objects. You must use `terrainSystem.sampleHeightWorld(x, z)`. The mesh is visually displaced on the GPU only.
* **Instanced Grass**: Grass instances use identity matrices. Their actual world placement and wind deformation is injected computationally in `QuadTreeLOD.js` via the `positionNode`.

## Extending the Plugin
If you are adding new biomes or height layers:
1. Update `src/gpu/biome.compute.wgsl` to paint the new channel weights.
2. Add the corresponding visual representation into the `_buildTSLMaterial()` TSL logic within `TerrainSystem.js`. 
3. Update `DEFAULT_TERRAIN_PARAMS` in `TerrainDebugUI.js` to expose the tunable constraints.
