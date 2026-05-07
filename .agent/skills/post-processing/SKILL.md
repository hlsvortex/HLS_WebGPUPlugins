---
name: post-processing
description: Explains how PostProcessPlugin intercepts the Three.js pipeline for WebGPU-compatible Bloom and Color Grading.
---

# Post-Processing Architecture

The `PostProcessPlugin.ts` manages cinematic effects like Bloom, Tone Mapping, and Depth of Field. In a WebGPU context, this leverages the modern `PostProcessing` node system rather than the older `EffectComposer`.

## Core Concepts

### WebGPU Node Pipeline
WebGPU Post-Processing in Three.js is achieved by replacing the standard `renderer.render(scene, camera)` loop with a Node-based pass system.
- The `scene` is wrapped in a `pass` node.
- Effect nodes (e.g., `bloom()`, `colorCorrection()`) are chained sequentially.

### The Render Loop Override
When `PostProcessPlugin` is enabled, it takes control of the main rendering loop from the core engine.
- Instead of calling `renderer.render()`, it calls `postProcessing.render()`.
- If the plugin is disabled via the UI, it falls back to the default forward renderer to save performance.

### Key Effects
- **Bloom**: Extracts highly emissive pixels (like the sun or magical effects) and blurs them across multiple mip-levels before compositing them back over the scene.
- **Tone Mapping & Exposure**: Standardizes the High Dynamic Range (HDR) colors coming from the `IBLPlugin` and `SkyPlugin` into standard monitor color space (sRGB), using ACES Filmic mapping.

## Key Interactions
- **Performance Impact**: High. Disabling this plugin provides the largest FPS boost.
- Mutates the core render loop. If another plugin needs to read the final framebuffer, it must coordinate with the PostProcess node chain.
