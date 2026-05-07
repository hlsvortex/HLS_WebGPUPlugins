---
name: water-rendering
description: Details how WaterPlugin generates dynamic, depth-based shoreline foam and TSL normal map blending.
---

# Water Rendering Architecture

The `WaterPlugin.ts` provides a vast, dynamic ocean plane that intersects with the procedural terrain. It leverages WebGPU TSL (Three.js Shading Language) to create realistic water effects without expensive multi-pass rendering.

## Core Concepts

### 1. The Water Plane
The system generates a massive `THREE.PlaneGeometry` centered on the camera to simulate an infinite ocean. 
- To maintain performance, the plane's resolution is kept relatively low, relying entirely on the fragment shader for high-fidelity details.

### 2. TSL Material Pipeline
The water surface is entirely driven by a custom Node Material:
- **Normal Blending**: Two scrolling normal maps (`waterNormal1`, `waterNormal2`) are sampled at different scales and speeds. TSL blends them together to create chaotic, unpredictable wave patterns.
- **Depth-Based Foam**: The shader reads from a global `depthTexture` (provided by a depth pre-pass or the main render target if supported). By comparing the fragment's depth to the depth buffer, it calculates the water's shallowness.
- **Shoreline Edge**: When the depth difference is very small (near the terrain intersection), the shader aggressively boosts the color to white, creating a natural shoreline foam effect.

### 3. Environment Reflection
The water material relies on standard PBR properties.
- `roughness` and `metalness` are configured to highly reflective values.
- It seamlessly integrates with the `IBLPlugin` environment maps to reflect the sky and sun.

## Key Interactions
- Dependent on the `camera` position to move the infinite plane.
- Dependent on the `IBLPlugin` for environment map reflections.
