# GPU Pipeline Reference

This document describes the WebGPU compute pipeline that drives terrain generation and the TSL material system that renders it.

---

## Overview

```
┌──────────────────┐     ┌──────────────────────────────────────────────┐
│  GraphGenerator   │     │              GPUCompute                      │
│  (CPU / JS)       │     │              (WebGPU)                        │
│                   │     │                                              │
│  Delaunay graph   │────►│  height.compute.wgsl ──► rawHeight (RGBA32F) │
│  River routing    │     │  height_blur.compute ──► heightTex (RGBA32F) │
│  Rasterization    │     │  biome.compute.wgsl  ──► biomeTex  (RGBA32F) │
│                   │     │  spawn.compute.wgsl  ──► spawnTex  (RGBA32F) │
│  ──► riverMapTex  │     │                                              │
└──────────────────┘     └──────────────┬─────────────────────────────────┘
                                        │
                         ┌──────────────▼──────────────┐
                         │     QuadTreeLOD              │
                         │     (Three.js Meshes)        │
                         │                              │
                         │  TSL Vertex: heightTex ──► Y │
                         │  TSL Fragment: biomeTex ──► C│
                         └──────────────────────────────┘
```

---

## Compute Pass 1: Height (`height.compute.wgsl`)

**Input:** `riverMapTex` (uploaded from GraphGenerator or loaded from PNG)
**Output:** `rawHeight` — RGBA32Float storage texture

### What it does:
1. Samples the river map for base elevation and river channel data
2. Applies multi-octave FBM noise for terrain detail
3. Carves river valleys using the river flow data
4. Applies configurable terracing (staircase effect for stylized terrain)
5. Generates cliff/ridge noise based on slope steepness

### Key Settings:
| Uniform | Default | Description |
|---|---|---|
| `terracingStrength` | 0.90 | Intensity of height quantization steps |
| `blurRadius` | 2.0 | Smoothing kernel radius (0 = sharp, 4 = very smooth) |
| `detailAmp` | 1.0 | Multiplier on high-frequency grit detail |
| `cliffStrength` | 1.0 | Slope-dependent cliff noise intensity |
| `riverCarving` | 1.0 | How deeply rivers cut into the terrain |
| `powerCurve` | 1.3 | Non-linear height redistribution exponent |

---

## Compute Pass 2: Height Blur (`height_blur.compute.wgsl`)

**Input:** `rawHeight`
**Output:** `heightTex` — RGBA32Float storage texture

### What it does:
1. Applies an edge-aware blur to the generated height channel
2. Smooths terrace intervals and noisy ridges before rendering/shadows
3. Preserves flow, region ID, and land mask channels

The `terrainBandingFix` uniform controls blur radius and strength. `0` keeps raw generated height, while `1` applies the strongest smoothing.

---

## Compute Pass 3: Biome (`biome.compute.wgsl`)

**Input:** `heightTex`
**Output:** `biomeTex` — RGBA32Float storage texture

### What it does:
1. Reads elevation, slope, and moisture from the height texture
2. Classifies each texel into a biome ID based on threshold rules
3. Outputs biome metadata for the fragment shader and spawn system

### Biome IDs:
| ID | Biome | Conditions |
|---|---|---|
| 0 | Ocean | Below sea level |
| 1 | Beach | Low elevation, flat slope |
| 2 | Grassland | Low-mid elevation, low moisture |
| 3 | Forest | Mid elevation, moderate moisture |
| 4 | Pine Forest | Higher elevation |
| 5 | Redwood | High moisture, mid elevation |
| 6 | Jungle | High moisture, low elevation |
| 7 | Swamp | Very high moisture, low elevation |
| 8 | Mountain | High elevation, steep slope |
| 9 | Snow | Very high elevation |

---

## Compute Pass 4: Spawn (`spawn.compute.wgsl`)

**Input:** `biomeTex`
**Output:** `spawnTex` — RGBA32Float storage texture

### What it does:
1. Reads the biome classification
2. Evaluates per-biome foliage density settings (configurable via UI)
3. Outputs a spawn probability map consumed by `GrassPlugin`

---

## TSL Material System

The `TerrainSystem.js` builds a `MeshStandardNodeMaterial` using Three.js TSL nodes.

### Vertex Shader (Displacement)
```
worldUV = (modelWorldMatrix × positionLocal).xz / terrainSize + 0.5
height  = texture(heightTex, worldUV).r
Y       = height × heightScale + seaLevelOffset
```

### Fragment Shader (Coloring)
```
biomeData = texture(biomeTex, worldUV)
biomeId   = biomeData.r
color     = mix(biomeColors[...], smoothstep thresholds)
```

The material applies:
- Slope-dependent cliff texturing
- Altitude-based snow coverage
- Moisture-driven vegetation saturation
- Underwater caustics below sea level

---

## Settings Buffer Layout

The `TerrainSettings` struct is uploaded as a uniform buffer. All fields are `f32`, padded to 16-byte alignment:

```
Offset  Field                Size
0       terracingStrength    4
4       blurRadius           4
8       detailAmp            4
12      cliffStrength        4
16      riverCarving         4
20      underwaterSuppress   4
24      coastPV              4
28      powerCurve           4
32      baseOffset           4
36      procHMult            4
40      procHBase            4
44      beachThreshold       4
48      snowThreshold        4
52      mountainThreshold    4
56      moistureThreshold    4
60      riverFalloff         4
64      baseOffsetFalloff    4
68      beachFlatness        4
72–104  density[9]           36
108     beachShelfFalloff    4
112     terraceSteps         4
116     terraceSoftness      4
120     terraceNoiseAmp      4
124     terrainBandingFix    4
```

Total: 128 bytes (16-byte aligned for WebGPU).
