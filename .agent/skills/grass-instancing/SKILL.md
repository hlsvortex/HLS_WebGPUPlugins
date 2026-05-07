---
name: grass-instancing
description: Explains how GrassPlugin maps InstancedMesh pools to QuadTreeLOD chunks, including TSL wind animations and exclusion maps.
---

# Grass Instancing Architecture

The `GrassPlugin.ts` is responsible for rendering high-density foliage across the procedural terrain efficiently. It achieves this by coupling tightly with the `QuadTreeLOD` system.

## Core Concepts

### 1. Chunk Integration
The GrassPlugin listens to chunk creation and destruction events from the `TerrainSystem`.
- **`handleChunkCreated(chunk)`**: When the QuadTree generates a new high-detail chunk close to the camera, the GrassPlugin claims a pre-allocated `THREE.InstancedMesh` from its object pool.
- The `InstancedMesh` is positioned perfectly over the chunk, and its instances (blades of grass) are mapped to the chunk's boundaries.

### 2. TSL Material & Wind Animation
The plugin uses WebGPU's Node Material System (TSL) to create highly performant shaders.
- **Wind System**: It passes uniform parameters (`_uWindSpeed`, `_uWindSwayStrength`) to the TSL shader. The shader computes world-space sine waves to simulate wind gusts.
- **Ground Blending**: It samples the terrain's biome map texture to perfectly blend the root of each grass blade into the underlying terrain color.

### 3. Exclusion Mapping
To prevent grass from growing underwater or on steep cliffs, the plugin utilizes an exclusion texture.
- The GPU Compute pipeline generates a `spawnTex` (which evaluates elevation, slope, and biome).
- The TSL vertex shader samples this `spawnTex` to dynamically scale the grass blades to `0.0` in invalid areas (like deep water or solid rock).

## Key Interactions
- Relies heavily on `TerrainSystem.js` and `GPUCompute.js` for height/biome data.
- Controlled via parameters injected by `DebugUIPlugin.ts`.
