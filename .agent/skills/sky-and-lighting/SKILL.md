---
name: sky-and-lighting
description: Covers SkyPlugin and IBLPlugin, explaining procedural sun cycles and dynamic environment map baking.
---

# Sky & Lighting Architecture

The atmospheric rendering and global illumination are handled cooperatively by two plugins: `SkyPlugin.ts` and `IBLPlugin.ts`.

## 1. SkyPlugin.ts (Atmosphere)

The `SkyPlugin` implements a procedural atmospheric scattering model.
- **The Sun Model**: It manages a `THREE.DirectionalLight` (the primary sun) and uses spherical coordinates (`phi`, `theta`) to calculate its position.
- **Scattering**: It utilizes a specialized `Sky` shader (often imported from Three.js examples or custom TSL) to calculate Rayleigh and Mie scattering based on the sun's position.
- **Day/Night Cycle**: An `update()` loop parameter increments the sun's elevation, dynamically changing the sky from midday blue to sunset orange, and eventually into a star-lit night sky.

## 2. IBLPlugin.ts (Global Illumination)

The `IBLPlugin` (Image-Based Lighting) ensures that PBR materials correctly reflect the procedural sky.
- **Dynamic Baking**: Because the sky is procedural and constantly changing, static HDRIs cannot be used. Instead, `IBLPlugin` uses a `PMREMGenerator` (Prefiltered Mipmap Radiance Environment Map).
- **Update Frequency**: When the sun's elevation changes by a significant threshold, the `IBLPlugin` triggers a re-bake. It renders the current `SkyPlugin` output into a specialized cubemap and filters it for roughness mipmaps.
- **Scene Application**: The resulting environment map is applied globally to `scene.environment` and `scene.background`, providing realistic ambient light and reflections for water, grass, and terrain.

## Key Interactions
- **Sky -> IBL**: `IBLPlugin` requires the `SkyPlugin` to be fully initialized and updated before baking.
- Both plugins are heavily parameterized via `DebugUIPlugin.ts` (e.g., sun elevation, rayleigh scattering amounts).
