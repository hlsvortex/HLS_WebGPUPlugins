// @ts-ignore
import { TerrainSystem } from '../systems/TerrainSystem.js';

export class TerrainPlugin {
    core: any;
    terrainSystem: any;
    _chunksReadout: HTMLSpanElement | null;

    constructor() {
        this.terrainSystem = null;
        this._chunksReadout = null;
    }

    async init() {
        const { renderer, scene, lightingSystem, onProgress, EditorConfig } = this.core;

        this.terrainSystem = new TerrainSystem(renderer, scene, lightingSystem);

        if (this.core.decalSystem) {
            this.terrainSystem.setDecalSystem(this.core.decalSystem);
        }

        const config = EditorConfig || {};
        await this.terrainSystem.init(onProgress, config);

        this.core.terrainSystem = this.terrainSystem;

        this._registerUI();
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('Terrain', '🏔️', '#f90', {
            category: 'Rendering',
            onEnable: () => {
                if (this.terrainSystem?.lod?.root) {
                    // Re-show terrain meshes
                    for (const m of this.terrainSystem.lod.activeMeshes) {
                        if (m) m.visible = true;
                    }
                }
            },
            onDisable: () => {
                if (this.terrainSystem?.lod?.activeMeshes) {
                    for (const m of this.terrainSystem.lod.activeMeshes) {
                        if (m) m.visible = false;
                    }
                }
            }
        });

        ui.onRegenerate((params: any) => {
            this.terrainSystem.updateGPULive(params);
        });

        const onChangeLive = (val: number) => { this.terrainSystem.updateGPULive(ui.params); };

        // ── Height Formula ──
        ui.addSection('Terrain', '📐 Height Formula', '#f90');
        ui.addSlider('Terrain', 'coastPV', 'Coast PV', 0.05, 0.50, 0.01, 0.23, 'Pixel value threshold for coast/ocean boundary.', onChangeLive);
        ui.addSlider('Terrain', 'powerCurve', 'Power Curve', 0.5, 3.0, 0.05, 2.1, 'Exponent for mountain steepness.', onChangeLive);
        ui.addSlider('Terrain', 'baseOffset', 'Base Offset', 0.0, 0.15, 0.005, 0.065, 'Constant height added to land.', onChangeLive);
        ui.addSlider('Terrain', 'baseOffsetFalloff', 'Coast Falloff', 0.0, 0.40, 0.01, 0.23, 'Slope smoothness from beach to ocean.', onChangeLive);
        ui.addSlider('Terrain', 'beachFlatness', 'Beach Shelf', 0.0, 1.0, 0.05, 0.05, 'Size of flat sandy shelf.', onChangeLive);
        ui.addSlider('Terrain', 'beachShelfFalloff', 'Shelf Falloff', 0.0, 0.20, 0.01, 0.05, 'Smoothness of beach-to-land slope.', onChangeLive);
        ui.addSlider('Terrain', 'procHMult', 'ProcH Mult', 0.3, 1.2, 0.02, 0.58, 'Multiplier for procedural mountains.', onChangeLive);
        ui.addSlider('Terrain', 'procHBase', 'ProcH Base', 0.0, 0.05, 0.005, 0.01, 'Baseline procedural height.', onChangeLive);

        // ── Biomes ──
        ui.addSection('Terrain', '🌲 Biome Thresholds', '#0f5');
        ui.addSlider('Terrain', 'beachThreshold', 'Beach Height', 0.01, 0.20, 0.01, 0.07, 'Height where beach transitions to land.', onChangeLive);
        ui.addSlider('Terrain', 'snowThreshold', 'Snow Height', 0.40, 0.90, 0.01, 0.62, 'Height for snow caps.', onChangeLive);
        ui.addSlider('Terrain', 'mountainThreshold', 'Mountain Height', 0.50, 0.90, 0.01, 0.7, 'Height for rocky mountain biome.', onChangeLive);
        ui.addSlider('Terrain', 'moistureThreshold', 'Moisture', 0.20, 0.90, 0.01, 0.65, 'Threshold for high-moisture biomes.', onChangeLive);

        // ── GPU Compute ──
        ui.addSection('Terrain', '⛰️ GPU Compute', '#f66');
        ui.addSlider('Terrain', 'terracingStrength', 'Terracing', 0.0, 1.0, 0.05, 0.2, 'Flat, stepped plateaus. 0 = off.', onChangeLive);
        ui.addSlider('Terrain', 'blurRadius', 'Blur Radius', 0, 4, 1, 3, 'Heightmap smoothing passes.', onChangeLive);
        ui.addSlider('Terrain', 'detailAmp', 'Detail Amp', 0.0, 3.0, 0.1, 0.8, 'Medium/high-freq ground noise.', onChangeLive);
        ui.addSlider('Terrain', 'cliffStrength', 'Cliff Noise', 0.0, 3.0, 0.1, 0.4, 'Jagged mountain ridge strength.', onChangeLive);
        ui.addSlider('Terrain', 'riverCarving', 'River Carving', 0.0, 2.0, 0.1, 0.6, 'River trench depth.', onChangeLive);
        ui.addSlider('Terrain', 'riverFalloff', 'River Falloff', 0.05, 0.50, 0.01, 0.35, 'River bank smoothness.', onChangeLive);
        ui.addSlider('Terrain', 'underwaterSuppress', 'UW Suppress', 0.0, 1.0, 0.1, 1.0, 'Suppress underwater noise.', onChangeLive);

        // ── Mesh & LOD Performance ──
        ui.addSection('Terrain', '⚙️ Mesh & LOD', '#88f');
        ui.addSlider('Terrain', 'maxDepth', 'LOD Max Depth', 3, 9, 1, 7, 'Max QuadTree subdivisions. Lower = fewer chunks.', (val: number) => {
            if (this.terrainSystem.lod) this.terrainSystem.lod.maxDepth = val;
        });
        ui.addSlider('Terrain', 'lodSplitMultiplier', 'LOD Split Distance', 0.5, 4.0, 0.1, 2.0, 'Camera distance multiplier for splitting.', (val: number) => {
            if (this.terrainSystem.lod) this.terrainSystem.lod.lodSplitMultiplier = val;
        });
        ui.addSlider('Terrain', 'chunkSegments', 'Chunk Resolution', 8, 64, 8, 16, 'Vertices per chunk side. Higher = smoother mesh.', (val: number) => {
            if (this.terrainSystem.lod) {
                this.terrainSystem.lod.chunkSegments = val;
                this.terrainSystem.lod._buildGeometry();
            }
        });
        ui.addSlider('Terrain', 'heightScale', 'Height Scale', 100, 2000, 50, 1200, 'Vertical range (baked at startup, requires regenerate).', (_val: number) => {});
        ui.addSlider('Terrain', 'terrainSize', 'Terrain Size', 2000, 16000, 500, 8000, 'World size in meters (requires regenerate).', (_val: number) => {});

        ui.addToggle('Terrain', 'terrainReceiveShadows', 'Receive Shadows', true, 'Terrain chunks receive shadows from the sun.', (val: boolean) => {
            if (this.terrainSystem?.lod?.activeMeshes) {
                for (const m of this.terrainSystem.lod.activeMeshes) {
                    if (m) m.receiveShadow = val;
                }
            }
        });
        ui.addToggle('Terrain', 'terrainCastShadows', 'Cast Shadows', false, 'Terrain chunks cast shadows (expensive).', (val: boolean) => {
            if (this.terrainSystem?.lod?.activeMeshes) {
                for (const m of this.terrainSystem.lod.activeMeshes) {
                    if (m) m.castShadow = val;
                }
            }
        });

        this._chunksReadout = ui.addReadout('Terrain', 'Active Chunks');
    }

    update(deltaTime: number) {
        if (!this.terrainSystem) return;
        const { camera } = this.core;
        this.terrainSystem.update(camera.position, deltaTime);

        // Update readout
        if (this._chunksReadout && this.terrainSystem.lod) {
            this._chunksReadout.textContent = `${this.terrainSystem.lod.activeMeshes.length} chunks`;
        }
    }

    dispose() {
        if (this.terrainSystem) {
            this.terrainSystem.dispose();
            this.terrainSystem = null;
        }
    }
}
