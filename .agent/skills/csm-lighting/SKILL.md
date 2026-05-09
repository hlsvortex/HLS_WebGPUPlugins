---
name: csm-lighting
description: Architectural instructions for the standalone Cascaded Shadow Maps (CSM) Plugin. Explains how CSMShadowNode integrates with the lighting system and WebGPU nodes.
---

# CSM Lighting Plugin

The `CSMPlugin` provides native Cascaded Shadow Maps (CSM) using Three.js's WebGPU node architecture (`CSMShadowNode`). This enables high-fidelity, distance-scaled shadows across massive open-world environments without suffering from shadow acne or extreme resolution degradation.

## Core Concepts

1. **Native Integration**: Unlike older WebGL-based CSM implementations that required injecting custom shader chunks (`onBeforeCompile`), `CSMShadowNode` plugs directly into the `DirectionalLight.shadow.shadowNode`. The WebGPU `MeshStandardNodeMaterial` automatically evaluates it during fragment shading.
2. **Dynamic Cascading**: `CSMPlugin` subdivides the camera frustum into multiple "cascades" based on view distance (`maxFar`). Objects close to the camera are rendered into a high-resolution cascade, while distant objects use lower-resolution cascades.
3. **Frustum Updates**: `this.csm.updateFrustums()` is called every frame in the `update(dt)` loop to ensure the shadow cameras precisely follow the player's view frustum, even when transitioning between FPS and Free-Fly modes.

## Architecture & Integration

- **Initialization**: The plugin reads `this.core.lightingSystem.sunLight` provided by `main.ts` or `IBLPlugin` and wraps it in a `CSMShadowNode`.
- **UI Exposure**: `CSMPlugin` registers its own `DebugUI` panel containing settings for `Cascades` (1-8), `Max Distance`, `Light Margin`, and global shadow rendering properties (PCF Soft vs VSM, Biases).
- **Rebuilding**: Changing the number of cascades requires recreating the `CSMShadowNode` instance and forcing a shader recompilation by disposing of the active shadow map.

## Usage Rules

> [!WARNING]
> **Never manually modify `sunLight.shadow.camera` bounds** (`left`, `right`, `top`, `bottom`) in other plugins! `CSMShadowNode` natively generates and manages an array of orthogonal cameras under the hood. Modifying the base shadow camera will cause rendering corruption.

> [!TIP]
> If shadow peter-panning occurs on steep terrain cliffs, adjust `shadowNormalBias` rather than reducing `shadowBias`. A negative `shadowBias` (e.g., `-0.0005`) is still required to prevent acne on flat surfaces.
