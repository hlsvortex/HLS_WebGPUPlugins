/**
 * GPUCompute.js — Manages WebGPU compute pipelines for terrain generation.
 * 
 * Handles dispatch of height → biome → spawn compute passes using the
 * native WebGPU device from Three.js WebGPURenderer.
 */

import heightSrc from '../gpu/height.compute.wgsl?raw';
import biomeSrc from '../gpu/biome.compute.wgsl?raw';
import spawnSrc from '../gpu/spawn.compute.wgsl?raw';

export class GPUCompute {
  constructor(renderer) {
    this.renderer = renderer;
    this.device = null;
    this.pipelines = {};
    this.textures = {};
    this.sampler = null;
    this.ready = false;
    this.settingsBuffer = null;
    // Default terrain settings matching the shader struct
    this.terrainSettings = new Float32Array([
      0.90,  // terracingStrength
      2.0,   // blurRadius
      1.0,   // detailAmp
      1.0,   // cliffStrength
      1.0,   // riverCarving
      1.0,   // underwaterSuppress
      0.20,  // coastPV
      1.3,   // powerCurve
      0.05,  // baseOffset
      0.80,  // procHMult
      0.01,  // procHBase
      0.08,  // beachThreshold
      0.62,  // snowThreshold
      0.70,  // mountainThreshold
      0.65,  // moistureThreshold
      0.15,  // riverFalloff
      0.05,  // baseOffsetFalloff
      0.0,   // beachFlatness
      0.2,   // densityBeach
      0.5,   // densityGrass
      1.0,   // densityForest
      1.0,   // densityPine
      1.0,   // densityRedwood
      1.0,   // densityJungle
      0.8,   // densitySwamp
      0.2,   // densityMountain
      0.4,   // densitySnow
      0.05,  // beachShelfFalloff
      0.0,   // _pad1
      0.0,   // _pad2
      0.0,   // _pad3
    ]);
  }

  async init(textureSize = 512, cpuRiverData = null) {
    // Get the raw WebGPU device from Three.js renderer
    const backend = this.renderer.backend;
    this.device = backend.device;

    if (!this.device) {
      throw new Error('WebGPU device not available — ensure renderer.init() was called');
    }

    this.textureSize = textureSize;

    // Create shared linear sampler for texture reads
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create textures
    this._createTextures(cpuRiverData);

    // Load WGSL shaders and build compute pipelines
    await this._buildPipelines();

    this.ready = true;
    console.log(`[GPUCompute] Initialized — ${textureSize}x${textureSize} textures`);
  }

  _createTextures(cpuRiverData) {
    const size = this.textureSize;
    const device = this.device;

    // Height texture — written by height compute, read by biome compute + terrain material
    this.textures.height = device.createTexture({
      label: 'heightmap',
      size: [size, size],
      format: 'rgba32float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    // Biome texture — written by biome compute, read by spawn compute + terrain material
    this.textures.biome = device.createTexture({
      label: 'biomemap',
      size: [size, size],
      format: 'rgba32float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    // Spawn texture — written by spawn compute, read by SpawnSystem
    this.textures.spawn = device.createTexture({
      label: 'spawnmap',
      size: [size, size],
      format: 'rgba32float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    // River Map input — written by CPU graph generator
    this.textures.riverMap = device.createTexture({
      label: 'rivermap',
      size: [size, size],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Upload CPU data to River Map texture if provided
    if (cpuRiverData) {
      this.updateGraphData(cpuRiverData);
    }

    console.log(`[GPUCompute] Created ${size}x${size} compute textures`);

    // Create uniform buffer for terrain settings (8 floats = 32 bytes)
    this.settingsBuffer = device.createBuffer({
      label: 'terrain-settings',
      size: this.terrainSettings.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.settingsBuffer, 0, this.terrainSettings);
  }

  updateGraphData(cpuRiverData) {
    if (!this.device || !this.textures.riverMap) return;
    this.device.queue.writeTexture(
      { texture: this.textures.riverMap },
      cpuRiverData,
      { bytesPerRow: this.textureSize * 16 }, // rgba32float = 16 bytes per pixel
      [this.textureSize, this.textureSize]
    );
  }

  async _buildPipelines() {
    const device = this.device;

    // WGSL source strings are imported at build time via Vite ?raw loader

    // --- HEIGHT pipeline ---
    // Bind group layout: 0=heightTex (storage write), 1=riverMapTex (unfilterable), 2=sampler
    const heightBGL = device.createBindGroupLayout({
      label: 'height-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.pipelines.height = device.createComputePipeline({
      label: 'height-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [heightBGL] }),
      compute: {
        module: device.createShaderModule({ label: 'height-shader', code: heightSrc }),
        entryPoint: 'main',
      },
    });

    this.pipelines.heightBindGroup = device.createBindGroup({
      label: 'height-bind',
      layout: heightBGL,
      entries: [
        { binding: 0, resource: this.textures.height.createView() },
        { binding: 1, resource: this.textures.riverMap.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.settingsBuffer } },
      ],
    });

    // --- BIOME pipeline ---
    const biomeBGL = device.createBindGroupLayout({
      label: 'biome-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.pipelines.biome = device.createComputePipeline({
      label: 'biome-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [biomeBGL] }),
      compute: {
        module: device.createShaderModule({ label: 'biome-shader', code: biomeSrc }),
        entryPoint: 'main',
      },
    });

    this.pipelines.biomeBindGroup = device.createBindGroup({
      label: 'biome-bind',
      layout: biomeBGL,
      entries: [
        { binding: 0, resource: this.textures.biome.createView() },
        { binding: 1, resource: this.textures.height.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.settingsBuffer } },
      ],
    });

    // --- SPAWN pipeline ---
    // Bind group layout: 0=spawnTex (storage write), 1=biomeTex (sampled), 2=sampler
    const spawnBGL = device.createBindGroupLayout({
      label: 'spawn-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.pipelines.spawn = device.createComputePipeline({
      label: 'spawn-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [spawnBGL] }),
      compute: {
        module: device.createShaderModule({ label: 'spawn-shader', code: spawnSrc }),
        entryPoint: 'main',
      },
    });

    this.pipelines.spawnBindGroup = device.createBindGroup({
      label: 'spawn-bind',
      layout: spawnBGL,
      entries: [
        { binding: 0, resource: this.textures.spawn.createView() },
        { binding: 1, resource: this.textures.biome.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.settingsBuffer } },
      ],
    });

    console.log('[GPUCompute] Compute pipelines built');
  }

  /**
   * Run all compute passes in sequence: height → biome → spawn
   */
  dispatch() {
    if (!this.ready) return;

    const device = this.device;
    const encoder = device.createCommandEncoder({ label: 'compute-encoder' });
    const workgroups = Math.ceil(this.textureSize / 8);

    // Pass 1: Height
    const heightPass = encoder.beginComputePass({ label: 'height-pass' });
    heightPass.setPipeline(this.pipelines.height);
    heightPass.setBindGroup(0, this.pipelines.heightBindGroup);
    heightPass.dispatchWorkgroups(workgroups, workgroups);
    heightPass.end();

    // Pass 2: Biome (reads height)
    const biomePass = encoder.beginComputePass({ label: 'biome-pass' });
    biomePass.setPipeline(this.pipelines.biome);
    biomePass.setBindGroup(0, this.pipelines.biomeBindGroup);
    biomePass.dispatchWorkgroups(workgroups, workgroups);
    biomePass.end();

    // Pass 3: Spawn (reads biome)
    const spawnPass = encoder.beginComputePass({ label: 'spawn-pass' });
    spawnPass.setPipeline(this.pipelines.spawn);
    spawnPass.setBindGroup(0, this.pipelines.spawnBindGroup);
    spawnPass.dispatchWorkgroups(workgroups, workgroups);
    spawnPass.end();

    device.queue.submit([encoder.finish()]);

    console.log('[GPUCompute] Dispatched height → biome → spawn');
  }

  /**
   * Read back a texture to CPU for debugging or CPU-side spawn logic
   */
  async readbackTexture(name) {
    const tex = this.textures[name];
    if (!tex) throw new Error(`Unknown texture: ${name}`);

    const device = this.device;
    const size = this.textureSize;
    const bytesPerRow = Math.ceil(size * 16 / 256) * 256; // rgba32float = 16 bytes, aligned to 256

    const readBuffer = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: tex },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: size },
      [size, size]
    );
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    readBuffer.destroy();

    return data;
  }

  /**
   * Update terrain settings uniform buffer from config object
   */
  updateSettings(config) {
    if (!this.settingsBuffer) return;
    this.terrainSettings[0] = config.terracingStrength ?? 0.90;
    this.terrainSettings[1] = config.blurRadius ?? 2.0;
    this.terrainSettings[2] = config.detailAmp ?? 1.0;
    this.terrainSettings[3] = config.cliffStrength ?? 1.0;
    this.terrainSettings[4] = config.riverCarving ?? 1.0;
    this.terrainSettings[5] = config.underwaterSuppress ?? 1.0;
    this.terrainSettings[6] = config.coastPV ?? 0.20;
    this.terrainSettings[7] = config.powerCurve ?? 1.3;
    this.terrainSettings[8] = config.baseOffset ?? 0.05;
    this.terrainSettings[9] = config.procHMult ?? 0.80;
    this.terrainSettings[10] = config.procHBase ?? 0.01;
    this.terrainSettings[11] = config.beachThreshold ?? 0.08;
    this.terrainSettings[12] = config.snowThreshold ?? 0.62;
    this.terrainSettings[13] = config.mountainThreshold ?? 0.70;
    this.terrainSettings[14] = config.moistureThreshold ?? 0.65;
    this.terrainSettings[15] = config.riverFalloff ?? 0.15;
    this.terrainSettings[16] = config.baseOffsetFalloff ?? 0.05;
    this.terrainSettings[17] = config.beachFlatness ?? 0.0;
    this.terrainSettings[18] = config.densityBeach ?? 0.2;
    this.terrainSettings[19] = config.densityGrass ?? 0.5;
    this.terrainSettings[20] = config.densityForest ?? 1.0;
    this.terrainSettings[21] = config.densityPine ?? 1.0;
    this.terrainSettings[22] = config.densityRedwood ?? 1.0;
    this.terrainSettings[23] = config.densityJungle ?? 1.0;
    this.terrainSettings[24] = config.densitySwamp ?? 0.8;
    this.terrainSettings[25] = config.densityMountain ?? 0.2;
    this.terrainSettings[26] = config.densitySnow ?? 0.4;
    this.terrainSettings[27] = config.beachShelfFalloff ?? 0.05;
    this.device.queue.writeBuffer(this.settingsBuffer, 0, this.terrainSettings);
  }
}
