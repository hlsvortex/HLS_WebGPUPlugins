/**
 * TerrainSystem.js — 100% GPU-Driven Terrain Pipeline
 * 
 * Uses WebGPU compute for generation.
 * Uses Three.js TSL (Three Shading Language) for zero-copy vertex displacement
 * and fragment coloring. Orchestrates the QuadTreeLOD system.
 */

import * as THREE from 'three/webgpu';
import {
  positionLocal, positionWorld, modelWorldMatrix, normalLocal, normalWorld, cameraPosition,
  texture, vec2, vec3, vec4, color, time, uniform,
  smoothstep, mix, max, min, abs, float, sin, cos, add, mul, floor, fract, transformNormalToView, length, exp, dot, normalize, pow, clamp, step
} from 'three/tsl';

import { GPUCompute } from './GPUCompute.js';
import { QuadTreeLOD } from './QuadTreeLOD.js';
import { GraphGenerator } from './GraphGenerator.js';

export class TerrainSystem {
  constructor(renderer, scene, lightingSystem, core) {
    this.renderer = renderer;
    this.scene = scene;
    this.lightingSystem = lightingSystem;
    this.core = core || null;  // Optional: used for cloud shadow uniforms, decal system, etc.
    this.gpuCompute = new GPUCompute(renderer);
    
    this.textureSize = 2048;
    this.heightScale = 1200;     // ARK total vertical range (Y -400 ocean → Y 800 peaks)
    this.seaLevelOffset = -400;  // Applied in vertex shader: h*1200-400 → sea level at Y 0
    this.terrainSize = 8000;
    
    // Live fluid tracking hook
    this.playerPosUniform = uniform(new THREE.Vector3());

    // High fidelity seamless volumetric caustic maps
    const texLoader = new THREE.TextureLoader();
    this.causticsMap = texLoader.load('textures/underwater_caustics_map.png');
    this.causticsMap.wrapS = THREE.RepeatWrapping;
    this.causticsMap.wrapT = THREE.RepeatWrapping;
    
    this.ready = false;
  }

  async init(onProgress, config = {}) {
    if (onProgress) onProgress('Running CPU Graph Generator...', 5);
    const graphGen = new GraphGenerator();
    const riverMapData = await graphGen.generate(this.textureSize, config);

    if (onProgress) onProgress('Initializing GPU compute...', 20);
    await this.gpuCompute.init(this.textureSize, riverMapData);

    if (onProgress) onProgress('Generating island data...', 40);
    // Apply terrain settings from debug panel (if any) before dispatch
    this.gpuCompute.updateSettings(config);
    this.gpuCompute.dispatch();

    // We read back height/biome to the CPU since we need Height + Biome for the SpawnSystem anyway.
    // We then wrap them in Three.js DataTextures so TSL can sample them normally.
    this.cachedHeightData = await this.gpuCompute.readbackTexture('height');
    this.cachedBiomeData = await this.gpuCompute.readbackTexture('biome');

    this.heightDataTex = new THREE.DataTexture(this.cachedHeightData, this.textureSize, this.textureSize, THREE.RGBAFormat, THREE.FloatType);
    this.heightDataTex.magFilter = THREE.LinearFilter;
    this.heightDataTex.minFilter = THREE.LinearFilter;
    this.heightDataTex.generateMipmaps = false;
    this.heightDataTex.needsUpdate = true;

    this.biomeDataTex = new THREE.DataTexture(this.cachedBiomeData, this.textureSize, this.textureSize, THREE.RGBAFormat, THREE.FloatType);
    this.biomeDataTex.magFilter = THREE.LinearFilter;
    this.biomeDataTex.minFilter = THREE.LinearFilter;
    this.biomeDataTex.generateMipmaps = false;
    this.biomeDataTex.needsUpdate = true;

    if (onProgress) onProgress('Compiling TSL Materials...', 60);
    this._buildTSLMaterial();

    if (onProgress) onProgress('Booting QuadTree...', 75);
    this.lod = new QuadTreeLOD(this.scene, this.material, this.terrainSize, this.heightDataTex, this.biomeDataTex, this.lightingSystem, this.decalSystem, this.heightScale);
    if (config.maxDepth) this.lod.maxDepth = config.maxDepth;
    if (config.lodSplitMultiplier) this.lod.lodSplitMultiplier = config.lodSplitMultiplier;

    // WaterPlugin handles volumetric ocean now.

    if (onProgress) onProgress('Terrain zero-copy pipeline ready!', 100);
    this.ready = true;
    console.log('[TerrainSystem] Fully initialized (Zero-Copy GPU TSL)');
  }

  /**
   * Fast path for real-time live updates of GPU compute variables (terracing, blur, etc.)
   * Updates the compute uniforms, dispatches passes, and hot-swaps the material textures.
   * Note: Doesn't update ecosystem collision/spawns — use full rebuild for that.
   */
  async updateGPULive(config) {
    if (!this.gpuCompute || !this.gpuCompute.ready) return;

    // 1. Update uniforms and run compute
    this.gpuCompute.updateSettings(config);
    this.gpuCompute.dispatch();

    // 2. Read back new textures
    this.cachedHeightData = await this.gpuCompute.readbackTexture('height');
    this.cachedBiomeData = await this.gpuCompute.readbackTexture('biome');

    // 3. Hot-swap the Three.js DataTexture buffers
    if (this.heightDataTex && this.heightDataTex.image) {
      this.heightDataTex.image.data = this.cachedHeightData;
      this.heightDataTex.needsUpdate = true;
    }
    
    if (this.biomeDataTex && this.biomeDataTex.image) {
      this.biomeDataTex.image.data = this.cachedBiomeData;
      this.biomeDataTex.needsUpdate = true;
    }
    
    // Fire decoupled callback so external systems (like SpawnSystem) can react to terrain height changes
    if (this.onTerrainUpdated) {
        this.onTerrainUpdated(this.cachedHeightData, this.terrainSize, this.heightScale);
    }
  }

  /**
   * Full macroscopic rebuild using GraphGenerator (for changing heightmaps or procedural mode).
   */
  async rebuildGraph(config) {
    if (!this.gpuCompute || !this.gpuCompute.ready) return;

    const graphGen = new GraphGenerator();
    const riverMapData = await graphGen.generate(this.textureSize, config);

    // Write new CPU data into the riverMap texture
    this.gpuCompute.updateGraphData(riverMapData);
    
    // Call the live update which will dispatch shaders, read back, and update textures
    await this.updateGPULive(config);
    
    console.log('[TerrainSystem] Graph Rebuilt and Textures Updated!');
  }

  /**
   * Reads back the interpolated terrain height at world coordinates.
   * Requires cachedHeightData to be populated (which happens after init() or updateGPULive()).
   */
  getTerrainHeightAt(worldX, worldZ) {
    if (!this.cachedHeightData) return this.seaLevelOffset;

    const tSize = this.terrainSize;
    const res = this.textureSize;

    // Map world to 0..1 UV
    const u = (worldX / tSize) + 0.5;
    const v = (worldZ / tSize) + 0.5;

    // Clamp to boundaries
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return this.seaLevelOffset;

    // Pixel coordinates
    const px = u * (res - 1);
    const py = v * (res - 1);

    const x0 = Math.floor(px);
    const x1 = Math.min(x0 + 1, res - 1);
    const y0 = Math.floor(py);
    const y1 = Math.min(y0 + 1, res - 1);

    const tx = px - x0;
    const ty = py - y0;

    // Format is rgba32float (4 floats per pixel), aligned to row length
    // For sizes like 512, 1024, 2048, there is no padding since they are multiples of 256 bytes
    const floatsPerRow = res * 4;

    const idx00 = (y0 * floatsPerRow) + (x0 * 4);
    const idx10 = (y0 * floatsPerRow) + (x1 * 4);
    const idx01 = (y1 * floatsPerRow) + (x0 * 4);
    const idx11 = (y1 * floatsPerRow) + (x1 * 4);

    const h00 = this.cachedHeightData[idx00];
    const h10 = this.cachedHeightData[idx10];
    const h01 = this.cachedHeightData[idx01];
    const h11 = this.cachedHeightData[idx11];

    // Bilinear interpolation
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    const h = h0 * (1 - ty) + h1 * ty;

    // Apply scale and offset matching the vertex shader
    return h * this.heightScale + this.seaLevelOffset;
  }


  _buildTSLMaterial() {
    // Upgraded perfectly to StandardNodeMaterial for high-fidelity specular highlights across the terrain.
    // By locking metalness to 0, we avoid all HDRI-less blackout artifacting entirely!
    this.material = new THREE.MeshStandardNodeMaterial({
      side: THREE.FrontSide,
      roughness: 0.85,  // Highly rough (Lambert-like) but catches specular rim lighting!
      metalness: 0.0    // Zero metal physically
    });


    const hScale = float(this.heightScale);
    const hOffset = float(this.seaLevelOffset); // -400: shifts normalized range so sea level = Y 0
    const tSize = float(this.terrainSize);

    // 1. PROJECT UV FROM WORLD SPACE
    // The QuadTree mesh is transformed by modelMatrix. 
    // We grab the base undisplaced world coords to get stable UV mapping.
    const baseWorld = modelWorldMatrix.mul(vec4(positionLocal, 1.0));
    const uv = baseWorld.xz.div(tSize).add(0.5);

    // 2. DISPLACEMENT & NORMAL CALCULATION
    const heightTex = this.heightDataTex;
    const hSample = texture(heightTex, uv);
    const h = hSample.r;

    // Displace vertex ONLY along local Y.
    // h*1200 - 400 → deep ocean (h=0) = Y -400, sea level (h=0.333) = Y 0, peaks (h=1.0) = Y 800
    this.material.positionNode = positionLocal.add(vec3(0.0, h.mul(hScale).add(hOffset), 0.0));

    // Compute analytical normals by sampling neighbors via TSL
    const offset = float(1.0 / this.textureSize);
    const hL = texture(heightTex, uv.add(vec2(offset.negate(), 0.0))).r;
    const hR = texture(heightTex, uv.add(vec2(offset, 0.0))).r;
    const hD = texture(heightTex, uv.add(vec2(0.0, offset.negate()))).r;
    const hU = texture(heightTex, uv.add(vec2(0.0, offset))).r;

    const texelWorldSize = tSize.div(float(this.textureSize));
    // Normal calc uses same hScale (offset cancels in subtraction)
    const normalVec = vec3(
        hL.sub(hR).mul(hScale),
        texelWorldSize.mul(2.0),
        hD.sub(hU).mul(hScale)
    ).normalize();

    // 3. ZERO-COPY BIOME MAP PROPERTIES (TSL)
    const bSample = texture(this.biomeDataTex, uv);
    const vegD = bSample.r;
    const rockD = bSample.g;
    const sandD = bSample.b;   
    const biomeId = bSample.a; 
    
    // --- PROCEDURAL SAND RIPPLE NORMAL MAPPING ---
    // Low-frequency dune ripples instead of high-freq pebbles to prevent Moiré aliasing.
    // Two octaves: broad rolling dunes + medium wind ripples.
    const duneScale = float(8.0);
    const rippleScale = float(25.0);
    
    // Broad rolling dune shapes
    const duneX = sin(baseWorld.x.mul(duneScale).add(baseWorld.z.mul(duneScale.mul(0.7))));
    const duneZ = cos(baseWorld.z.mul(duneScale).add(baseWorld.x.mul(duneScale.mul(0.5))));
    
    // Medium wind-carved ripples riding on top
    const ripX = sin(baseWorld.x.mul(rippleScale).add(cos(baseWorld.z.mul(rippleScale.mul(0.6)))));
    const ripZ = cos(baseWorld.z.mul(rippleScale).add(sin(baseWorld.x.mul(rippleScale.mul(0.4)))));
    
    const microBump = vec3(
        duneX.mul(0.6).add(ripX.mul(0.3)),
        float(1.0),
        duneZ.mul(0.6).add(ripZ.mul(0.3))
    ).normalize();
    
    // Fade sand bump intensity with distance to camera to kill any remaining aliasing
    const distToCam = length(cameraPosition.sub(baseWorld.xyz));
    const sandDistFade = float(1.0).sub(smoothstep(float(100.0), float(300.0), distToCam));
    const sandBumpIntensity = sandD.mul(0.7).mul(sandDistFade);
    
    const blendedNormalVec = mix(normalVec, microBump, clamp(sandBumpIntensity, 0.0, 1.0)).normalize();
    
    this.material.normalNode = transformNormalToView(blendedNormalVec);

    // 4. BIOME COLORING (TSL FRAGMENT SHADER)

    // Surface steepness
    const normalY = abs(normalVec.y);
    const steepness = float(1.0).sub(normalY);

    // Broad, sweeping, clean low-frequency noise for subtle organic color variety (no Moiré!)
    // Single octave with combined X+Y phase — visually identical to dual-octave at half the GPU cost
    const organicSweep = sin(uv.x.mul(800.0).add(uv.y.mul(530.0))).mul(0.5).add(0.5);
    

    // --- BRIGHTENED STYLIZED PALETTE (greens boosted 40-60%) ---
    const pDeepOcean = color(0.03, 0.10, 0.28);
    const pOcean = color(0.05, 0.18, 0.38);
    const pShallowSea = color(0.08, 0.30, 0.48);
    
    // Sands & Dirts
    const pWetSand = color(0.45, 0.38, 0.25); // Darkened heavily for deep water saturation
    const pDrySand = color(0.82, 0.76, 0.60);
    const pSwampMud = color(0.28, 0.22, 0.14);
    const pRedwoodSoil = color(0.45, 0.28, 0.18);
    
    // Grasses — significantly brighter
    const pGrassBright = color(0.28, 0.55, 0.18);
    const pGrassHighlight = color(0.35, 0.62, 0.22);
    const pGrassMid    = color(0.22, 0.48, 0.14);
    const pGrassDark   = color(0.16, 0.38, 0.10);
    const pJungleFloor = color(0.10, 0.28, 0.08);
    const pPineFloor   = color(0.18, 0.32, 0.12);
    
    // Canopies
    const pForestLight = color(0.20, 0.48, 0.14);
    const pForestDark  = color(0.14, 0.38, 0.10);
    
    // Rocks
    // Apply soft, organic color shifts directly into the Rock formulas
    const cliffBands = sin(h.mul(400.0).add(organicSweep)).mul(0.5).add(0.5);
    const pRockLight = color(0.58, 0.54, 0.48);
    const pRockMid = mix(color(0.48, 0.44, 0.38), color(0.40, 0.36, 0.30), smoothstep(float(0.4), float(0.8), cliffBands));
    const pRockDark = mix(color(0.36, 0.34, 0.28), color(0.28, 0.26, 0.22), smoothstep(float(0.4), float(0.8), cliffBands));
    const pCliff = color(0.32, 0.30, 0.26);
    const pVolcanoRock = mix(color(0.18, 0.16, 0.16), color(0.08, 0.06, 0.06), smoothstep(float(0.4), float(0.8), cliffBands));
    
    // Snow
    const pSnow = color(0.92, 0.94, 0.96);
    const pSnowDirty = color(0.72, 0.74, 0.76);

    // TSL branching via mix/step logic
    
    // WATER (Physical Depth) 
    // We no longer physically paint the water onto the mesh natively, the new volume handles this!
    const depth = float(1.0).sub(hSample.a);

    // Wet sand darkening near sea level — sea level is now Y=0
    const seaLvl = float(0.0); // Y 0 = sea level
    const worldH = h.mul(hScale).add(hOffset); // Actual world Y position
    // Wetness gradient: fully wet at waterline (Y=0), fully dry by Y=80 (covers beach zone)
    const wetness = smoothstep(seaLvl.add(80.0), seaLvl.sub(2.0), worldH);
    const pWetSandDark = color(0.28, 0.24, 0.16); // Dark saturated wet sand
    const sandDetail = mix(pWetSand, pDrySand, organicSweep);
    // Sand wet-to-dry blend based on height above sea level
    let sandColor = mix(pWetSand, sandDetail, organicSweep.mul(0.4).add(max(float(0.0), h.sub(0.38).mul(3.0))));
    sandColor = mix(sandColor, pWetSandDark, wetness.mul(sandD)); // Only darken actual sand areas

    // Deep seabed darkening (transitions sand to dark murky mud further down)
    const deepSeabed = smoothstep(seaLvl, seaLvl.sub(25.0), worldH); // 0.0 at surface, 1.0 down deep
    const pDeepMud = color(0.12, 0.16, 0.12); // Dark oceanic algae mix
    sandColor = mix(sandColor, pDeepMud, deepSeabed.mul(sandD));

    // MOUNTAIN/ROCK
    const steepSnow = smoothstep(0.3, 0.5, steepness);
    let mixedSnow = mix(pSnowDirty, pSnow, organicSweep);
    let peakColor = mix(mixedSnow, pRockDark, steepSnow); 
    
    const steepMid = smoothstep(0.35, 0.45, steepness);
    let midRock = mix(mix(pRockLight, pRockMid, rockD.add(organicSweep.mul(0.2))), pCliff, steepMid);
    
    // VEGETATION BASE BLEND
    const denseForest = mix(pForestLight, pForestDark, organicSweep); 
    const transForest = mix(pGrassDark, pForestLight, smoothstep(float(0.4), float(0.7), vegD));
    let baseGrass = mix(pGrassBright, pGrassHighlight, organicSweep); 
    baseGrass = mix(baseGrass, pGrassMid, organicSweep.mul(0.35));
    
    // --- 10 BIOME MASKING AND OVERRIDES ---
    // Extract exact biome using sharp steps: smoothstep(TARGET+0.05, TARGET, biomeId) * smoothstep(TARGET-0.05, TARGET, biomeId)
    const isGrassland     = smoothstep(0.25, 0.2, biomeId).mul(smoothstep(0.15, 0.2, biomeId));
    const isTempForest    = smoothstep(0.35, 0.3, biomeId).mul(smoothstep(0.25, 0.3, biomeId));
    const isPineForest    = smoothstep(0.45, 0.4, biomeId).mul(smoothstep(0.35, 0.4, biomeId));
    const isRedwood       = smoothstep(0.55, 0.5, biomeId).mul(smoothstep(0.45, 0.5, biomeId));
    const isJungle        = smoothstep(0.65, 0.6, biomeId).mul(smoothstep(0.55, 0.6, biomeId));
    const isSwamp         = smoothstep(0.75, 0.7, biomeId).mul(smoothstep(0.65, 0.7, biomeId));
    const isMountain      = smoothstep(0.85, 0.8, biomeId).mul(smoothstep(0.75, 0.8, biomeId));
    const isSnow          = smoothstep(0.95, 0.9, biomeId).mul(smoothstep(0.85, 0.9, biomeId));
    const isVolcano       = smoothstep(0.95, 1.0, biomeId);

    // Apply Biome Soil Colors
    baseGrass = mix(baseGrass, pJungleFloor, isJungle);
    baseGrass = mix(baseGrass, pRedwoodSoil, isRedwood);
    baseGrass = mix(baseGrass, pPineFloor, isPineForest);
    baseGrass = mix(baseGrass, pSwampMud, isSwamp);
    
    const treeMix1 = smoothstep(0.7, 1.0, vegD);
    const treeMix2 = smoothstep(0.4, 0.7, vegD);
    let vegColor = mix(mix(baseGrass, transForest, treeMix2), denseForest, treeMix1);
    
    // Volcano turns peaks back to basalt
    peakColor = mix(peakColor, pVolcanoRock, isVolcano);
    midRock = mix(midRock, pVolcanoRock, isVolcano);
    
    // Combine rock depending on high-altitude snow cap or explicit Snow biome
    // h > 0.65 normalized = Y > 380 world units — matches mountain zone well
    let snowCap = max(smoothstep(0.65, 0.72, h), isSnow);
    snowCap = snowCap.mul(float(1.0).sub(isVolcano)); // Prevent snow on volcano
    const rockColor = mix(midRock, peakColor, snowCap);

    // Override vegetation with cliff aggressively if steep (removes grass from sheer walls)
    const cliffOverride = smoothstep(0.20, 0.40, steepness);
    vegColor = mix(vegColor, pRockDark, cliffOverride);

    // FINAL BLENDING
    let finalCol = mix(vegColor, rockColor, smoothstep(0.3, 0.5, rockD));
    finalCol = mix(finalCol, sandColor, smoothstep(0.3, 0.8, sandD));
    // (Ocean color masking physically removed in favor of pure volumetric mesh!)

    // (Triplanar micro-texture removed — ±0.04 intensity was imperceptible, saved 2 trig/fragment)

    // --- CAUSTICS (UNDERWATER SEABED) ---
    // Swapped to high-fidelity perfectly tileable GPU Caustics texture
    // seaLvl = Y 0, worldH = actual world Y (already includes -400 offset)
    const isUnderwaterTerrain = smoothstep(seaLvl.add(2.0), seaLvl.sub(1.0), worldH); // 1 = under, 0 = above
    const cTime = time.mul(float(0.3));
    
    // Dual-pan UVs at different scales to completely hide tiling and create dancing intersections
    const causticUV1 = baseWorld.xz.mul(float(0.03)).add(cTime.mul(0.05));
    const causticTex1 = texture(this.causticsMap, causticUV1);
    
    const causticUV2 = baseWorld.xz.mul(float(0.04)).sub(cTime.mul(0.03));
    const causticTex2 = texture(this.causticsMap, causticUV2);
    
    // Extracting red channel since it's mostly greyscale, multiply them to thin the beams out
    const causticIntensity = causticTex1.r.mul(causticTex2.r).mul(1.5);
    
    // Add a soft cyan glow and drastically lower the opacity to blend seamlessly
    const causticColor = color(0.4, 0.9, 1.0);
    const causticBeams = causticColor.mul(causticIntensity).mul(0.20); 
    
    // Use mix against 0.0 to safely multiply rather than risking NaN propagation on dry land
    finalCol = finalCol.add(mix(float(0.0), causticBeams, isUnderwaterTerrain));


    // ─── PROJECTED DECAL INJECTION ───────────────────────────────
    // Composite all active decals over the terrain color. This runs
    // inside the terrain's own fragment shader — zero z-fighting,
    // perfect conformance to GPU-displaced slopes.
    if (this.decalSystem) {
        finalCol = this.decalSystem.getDecalBlendNode(baseWorld, finalCol);
    }

    // --- CLOUD SHADOW PROJECTION ---
    // Re-run the exact same FBM noise as SkyPlugin but using world XZ position
    // instead of view direction. This simulates parallel-ray shadow casting from
    // a cloud layer overhead. No extra textures or render passes needed!
    const csu = this.core?.cloudShadowUniforms;
    if (csu) {
        // Scale world position by cloud scale / a fixed virtual cloud altitude (1500 world units)
        // This matches the projection distance used by the sky dome FBM.
        const cloudAlt = float(1500.0);
        const csPx = baseWorld.x.div(cloudAlt).mul(csu.scale);
        const csPy = baseWorld.z.div(cloudAlt).mul(csu.scale);

        const csTime = time.mul(csu.speed);
        const csCt1 = csTime;
        const csCt2 = csTime.mul(0.618);
        const csCt3 = csTime.mul(0.381);
        const csCt4 = csTime.mul(1.272);

        // Identical 4-octave cross-term FBM as sky dome (must stay in sync!)
        const csO1a = csPx.add(csPy.mul(0.7)).add(csCt1);
        const csO1b = csPy.sub(csPx.mul(0.7)).add(csCt1.mul(0.8));
        const csN1  = sin(csO1a).add(cos(csO1b)).mul(0.5);

        const csO2a = csPx.mul(1.83).add(csPy.mul(1.41)).add(csCt2).add(csN1.mul(2.1));
        const csO2b = csPy.mul(1.97).sub(csPx.mul(1.23)).add(csCt2.mul(1.3)).sub(csN1.mul(1.7));
        const csN2  = sin(csO2a).add(cos(csO2b)).mul(0.5);

        const csO3a = csPx.mul(3.71).add(csPy.mul(2.93)).add(csCt3).add(csN2.mul(1.8)).sub(csN1.mul(0.9));
        const csO3b = csPy.mul(4.13).sub(csPx.mul(3.57)).add(csCt3.mul(1.7)).add(csN1.mul(1.2)).add(csN2.mul(0.7));
        const csN3  = sin(csO3a).add(cos(csO3b)).mul(0.5);

        const csO4a = csPx.mul(7.23).add(csPy.mul(6.17)).add(csCt4).add(csN3.mul(2.5)).sub(csN2.mul(1.1));
        const csO4b = csPy.mul(8.31).sub(csPx.mul(7.91)).add(csCt4.mul(0.9)).sub(csN3.mul(1.5)).add(csN1.mul(0.5));
        const csN4  = sin(csO4a).add(cos(csO4b)).mul(0.5);

        const csFbm  = csN1.mul(0.46).add(csN2.mul(0.28)).add(csN3.mul(0.16)).add(csN4.mul(0.10));
        const csNoise = csFbm.mul(0.5).add(0.5); // remap → 0..1

        // Same threshold as sky
        const csThreshold = float(1.0).sub(csu.coverage);
        const csDensity   = smoothstep(csThreshold, csThreshold.add(csu.softness), csNoise);

        // Only cast shadows above sea level (no cloud shadows on the seabed)
        const aboveSea = smoothstep(seaLvl.sub(2.0), seaLvl.add(10.0), worldH);

        // Darken the terrain: shadow = 1 - density*strength
        const shadowMultiplier = float(1.0).sub(csDensity.mul(csu.strength).mul(aboveSea));
        finalCol = finalCol.mul(shadowMultiplier);
    }

    this.material.colorNode = finalCol;
  }

  /**
   * Wire the projected decal system. Must be called BEFORE init().
   */
  setDecalSystem(ds) {
      this.decalSystem = ds;
  }



  sampleHeight(u, v) {
    if (!this.cachedHeightData) return 0;
    
    // Clamp uv exactly
    const uC = Math.max(0.0, Math.min(1.0, u));
    const vC = Math.max(0.0, Math.min(1.0, v));

    // Convert to pixel coordinates
    const px = uC * (this.textureSize - 1);
    const py = vC * (this.textureSize - 1);

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, this.textureSize - 1);
    const y1 = Math.min(y0 + 1, this.textureSize - 1);

    // Filter weights
    const wx = px - x0;
    const wy = py - y0;

    const row0 = y0 * this.textureSize;
    const row1 = y1 * this.textureSize;

    const h00 = this.cachedHeightData[(row0 + x0) * 4] || 0;
    const h10 = this.cachedHeightData[(row0 + x1) * 4] || 0;
    const h01 = this.cachedHeightData[(row1 + x0) * 4] || 0;
    const h11 = this.cachedHeightData[(row1 + x1) * 4] || 0;

    // Bilinear interpolation
    const top = h00 * (1.0 - wx) + h10 * wx;
    const bottom = h01 * (1.0 - wx) + h11 * wx;
    const finalH = top * (1.0 - wy) + bottom * wy;

    // Apply the same vertex shader math: h*1200-400 → sea level = Y 0, peaks = Y 800
    return (finalH * this.heightScale) + this.seaLevelOffset;
  }

  /**
   * Flatten terrain around a world-space position.
   * Smoothly blends heights toward targetWorldY within the given radius.
   * Uses a cosine falloff so the edges taper naturally into the surrounding terrain.
   *
   * @param {number} worldX - World X coordinate (center of flattened area)
   * @param {number} worldZ - World Z coordinate (center of flattened area)
   * @param {number} radius - World-space radius to flatten
   * @param {number} targetWorldY - The desired world Y height to flatten toward
   * @param {number} [strength=0.85] - How aggressively to flatten (0 = no change, 1 = fully flat)
   */
  flattenTerrainAround(worldX, worldZ, radius, targetWorldY, strength = 0.85) {
    if (!this.cachedHeightData || !this.heightDataTex) return;

    // Convert target world Y back to normalized heightmap value
    // worldY = normalizedH * heightScale + seaLevelOffset  →  normalizedH = (worldY - seaLevelOffset) / heightScale
    const targetNorm = (targetWorldY - this.seaLevelOffset) / this.heightScale;

    // Convert world XZ to texel space
    const texSize = this.textureSize;
    const tSize = this.terrainSize;
    const halfT = tSize * 0.5;

    // Center UV
    const centerU = (worldX / tSize) + 0.5;
    const centerV = (worldZ / tSize) + 0.5;

    // Radius in texels
    const texelRadius = (radius / tSize) * texSize;
    const texelRadiusSq = texelRadius * texelRadius;

    // Center texel
    const cx = Math.round(centerU * (texSize - 1));
    const cy = Math.round(centerV * (texSize - 1));

    // Bounding box in texels (clamped)
    const minX = Math.max(0, Math.floor(cx - texelRadius));
    const maxX = Math.min(texSize - 1, Math.ceil(cx + texelRadius));
    const minY = Math.max(0, Math.floor(cy - texelRadius));
    const maxY = Math.min(texSize - 1, Math.ceil(cy + texelRadius));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > texelRadiusSq) continue;

        // Smooth cosine falloff (1.0 at center, 0.0 at edge)
        const t = Math.sqrt(distSq) / texelRadius;
        const falloff = 0.5 * (1.0 + Math.cos(t * Math.PI));

        const idx = (py * texSize + px) * 4;
        const currentH = this.cachedHeightData[idx];
        const blend = falloff * strength;
        this.cachedHeightData[idx] = currentH * (1.0 - blend) + targetNorm * blend;
      }
    }

    // Hot-swap the DataTexture so the vertex shader picks it up next frame
    this.heightDataTex.image.data = this.cachedHeightData;
    this.heightDataTex.needsUpdate = true;

    console.log(`[TerrainSystem] Flattened terrain at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) radius=${radius.toFixed(1)} targetY=${targetWorldY.toFixed(1)}`);
  }

  sampleHeightWorld(x, z) {
    const u = (x / this.terrainSize) + 0.5;
    const v = (z / this.terrainSize) + 0.5;
    return this.sampleHeight(u, v);
  }

  sampleNormalWorld(x, z) {
    // Finite difference to compute terrain normal at world coordinates
    const e = 1.0;
    const hL = this.sampleHeightWorld(x - e, z);
    const hR = this.sampleHeightWorld(x + e, z);
    const hD = this.sampleHeightWorld(x, z - e);
    const hU = this.sampleHeightWorld(x, z + e);
    
    // Cross product of X and Z derivatives (must match TSL math exactly)
    const normal = new THREE.Vector3(hL - hR, 2.0 * e, hD - hU).normalize();
    return normal;
  }

  sampleBiomeWorld(x, z) {
    if (!this.cachedBiomeData) return null;
    
    // Convert world space to normalized UV
    const u = (x / this.terrainSize) + 0.5;
    const v = (z / this.terrainSize) + 0.5;
    
    // Clamp uv exactly
    const uC = Math.max(0.0, Math.min(1.0, u));
    const vC = Math.max(0.0, Math.min(1.0, v));

    // Convert to pixel coordinates (nearest neighbor is fine for biome weights)
    const px = Math.floor(uC * (this.textureSize - 1));
    const py = Math.floor(vC * (this.textureSize - 1));

    const idx = (py * this.textureSize + px) * 4;
    return {
        veg: this.cachedBiomeData[idx],
        rock: this.cachedBiomeData[idx + 1],
        sand: this.cachedBiomeData[idx + 2],
        biomeId: this.cachedBiomeData[idx + 3]
    };
  }

  update(cameraPos, deltaTime) {
    if (!this.ready || !this.lod) return;
    this.lod.update(cameraPos);

  }

    // Single dense WebGPU grid requires no camera tracking!

  dispose() {
    if (this.lod) this.lod.dispose();
    if (this.heightDataTex) this.heightDataTex.dispose();
    if (this.biomeDataTex) this.biomeDataTex.dispose();
    if (this.material) this.material.dispose();
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); }
  }
}
