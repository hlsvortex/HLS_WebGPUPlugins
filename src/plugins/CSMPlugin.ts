import * as THREE from 'three/webgpu';
import { Fn, add, float, reference, renderGroup, texture, vec2 } from 'three/tsl';
import { CSMShadowNode } from '../vendor/csm/CSMShadowNode.js';

const SHADOW_TYPES = [
    { label: 'PCF Soft', value: THREE.PCFSoftShadowMap },
    { label: 'PCF',      value: THREE.PCFShadowMap },
    { label: 'VSM',      value: THREE.VSMShadowMap },
    { label: 'Basic',    value: THREE.BasicShadowMap },
] as const;

const CSM_MODES = [
    { label: 'Practical', value: 'practical' },
    { label: 'Uniform', value: 'uniform' },
    { label: 'Logarithmic', value: 'logarithmic' },
] as const;

const STABLE_TERRAIN_PCF_FILTER: any = Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: any) => {
    const depthCompare = (uv: any, compare: any) => {
        let depth: any = texture(depthTexture, uv);
        if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
        return depth.compare(compare);
    };

    const mapSize = (reference('mapSize', 'vec2', shadow) as any).setGroup(renderGroup);
    const radius = (reference('radius', 'float', shadow) as any).setGroup(renderGroup);
    const texel = (vec2(1) as any).div(mapSize).mul(radius);
    const uv = shadowCoord.xy;
    const z = shadowCoord.z;
    const sample = (sampleUv: any, weight = 1.0) => (depthCompare(sampleUv, z) as any).mul(weight);

    // Stable weighted disk. Avoid per-pixel rotated noise at terrain shadow edges.
    return (add as any)(
        sample(uv, 4.0),
        sample(uv.add(vec2(texel.x, 0)), 2.0),
        sample(uv.add(vec2(texel.x.negate(), 0)), 2.0),
        sample(uv.add(vec2(0, texel.y)), 2.0),
        sample(uv.add(vec2(0, texel.y.negate())), 2.0),
        sample(uv.add(vec2(texel.x, texel.y))),
        sample(uv.add(vec2(texel.x.negate(), texel.y))),
        sample(uv.add(vec2(texel.x, texel.y.negate()))),
        sample(uv.add(vec2(texel.x.negate(), texel.y.negate()))),
        sample(uv.add(vec2(texel.x.mul(2.0), 0))),
        sample(uv.add(vec2(texel.x.mul(-2.0), 0))),
        sample(uv.add(vec2(0, texel.y.mul(2.0)))),
        sample(uv.add(vec2(0, texel.y.mul(-2.0))))
    ).mul(float(1.0 / 20.0));
});

export class CSMPlugin {
    core: any;
    csm: any;
    
    // Default settings
    cascades: number = 3;
    maxFar: number = 8000;
    lightMargin: number = 200;
    csmMode: 'practical' | 'uniform' | 'logarithmic' = 'practical';
    csmFade: boolean = false;
    shadowMapSize: number = 3584;
    shadowBias: number = -0.00002;
    shadowNormalBias: number = 0.05;
    shadowRadius: number = 7.5;
    shadowBlurSamples: number = 12;
    shadowIntensity: number = 0.6;
    useStableFilter: boolean = true;
    _savedTerrainCastStates: WeakMap<any, boolean> = new WeakMap();
    _isRegisteringUI: boolean = false;
    _directionReadout: HTMLSpanElement | null = null;
    _cascadeReadout: HTMLSpanElement | null = null;

    constructor() {}

    async init() {
        const { lightingSystem } = this.core;
        
        if (!lightingSystem || !lightingSystem.sunLight) {
            console.error('[CSMPlugin] No sunLight found in core.lightingSystem');
            return;
        }

        const sunLight = lightingSystem.sunLight;
        this._loadInitialSettings();
        
        // Initial shadow map resolution (per cascade)
        const shadowTypeIdx = this.core.debugUI?.params?.shadowTypeSelect ?? 1;
        this.core.renderer.shadowMap.type = SHADOW_TYPES[shadowTypeIdx]?.value ?? THREE.PCFShadowMap;
        sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
        this._createCSM(sunLight);
        this._applyShadowBias();
        
        this.core.csmSystem = this;
        console.log('[CSMPlugin] Initialized Cascaded Shadow Maps');
        
        this._registerUI();
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;
        this._isRegisteringUI = true;

        ui.registerPlugin('CSM', '🌑', '#a8f', {
            category: 'Rendering',
            onEnable:  () => { this._setShadowsEnabled(true); },
            onDisable: () => { this._setShadowsEnabled(false); }
        });

        ui.addSection('CSM', '🌑 Shadow Settings', '#a8f');
        
        ui.addToggle('CSM', 'shadowsEnabled', 'Enabled', true, 'Global shadow rendering toggle.', (val: boolean) => {
            this._setShadowsEnabled(val);
        });

        ui.addDropdown('CSM', 'shadowTypeSelect', 'Shadow Type', SHADOW_TYPES as any, 1, 'Select the shadow map algorithm. PCF uses the Softness radius; VSM uses Softness plus Blur Samples.', (val: any) => {
            this.core.renderer.shadowMap.type = val;
            if (!this._isRegisteringUI) this._runHeavyChange('Updating shadow type...', () => this._applyCSMSettings());
        });

        ui.addSlider('CSM', 'shadowBias', 'Bias', -0.002, 0.002, 0.00005, this.shadowBias, 'Depth bias. Keep near zero; use Normal Bias for large terrain acne.', (val: number) => {
            this.shadowBias = val;
            this._applyShadowBias();
        });

        ui.addSlider('CSM', 'shadowNormalBias', 'Normal Bias', 0.0, 0.2, 0.005, this.shadowNormalBias, 'Normal offset for shadow acne. VibeJam baseline is 0.02.', (val: number) => {
            this.shadowNormalBias = val;
            this._applyShadowBias();
        });
        ui.addSlider('CSM', 'shadowIntensity', 'Shadow Strength', 0, 1, 0.05, this.shadowIntensity, 'Overall strength of CSM shadows.', (val: number) => {
            this.shadowIntensity = val;
            this._applyCSMSettings();
        });
        ui.addSlider('CSM', 'shadowRadius', 'Edge Softness', 1, 12, 0.5, this.shadowRadius, 'Filters physical shadow edges. Higher values soften stair-step edges; too high can blur contacts.', (val: number) => {
            this.shadowRadius = val;
            this._applyCSMSettings();
        });
        ui.addSlider('CSM', 'shadowBlurSamples', 'VSM Blur Samples', 1, 24, 1, this.shadowBlurSamples, 'Only affects VSM shadows. Higher values make smoother VSM edges at extra cost.', (val: number) => {
            this.shadowBlurSamples = val;
            this._applyCSMSettings();
        });
        ui.addToggle('CSM', 'csmStableFilter', 'Stable Edge Filter', true, 'PCF/PCF Soft only. Uses a stable weighted CSM edge filter to reduce patterned terrain shadow edges.', (val: boolean) => {
            this.useStableFilter = val;
            this._applyCSMSettings();
        });
        ui.addToggle('CSM', 'terrainShadowDebug', 'Debug: Disable Terrain Casting', false, 'Temporarily disables only terrain castShadow to confirm whether bands are terrain self-shadowing.', (val: boolean) => {
            this._setTerrainShadowDebug(val);
        });

        ui.addSection('CSM', '📊 Cascades', '#e8f');

        ui.addDropdown('CSM', 'csmMode', 'Split Mode', CSM_MODES as any, 0, 'How camera depth is split across cascades. Practical is balanced; logarithmic favors near detail; uniform spreads evenly.', (val: any) => {
            this.csmMode = val;
            if (!this._isRegisteringUI) this._runHeavyChange('Changing cascade split mode...', () => this._rebuildCSM());
        });

        ui.addToggle('CSM', 'csmFade', 'Blend Cascades', false, 'Softly blends between cascade ranges to reduce visible transition lines.', (val: boolean) => {
            this.csmFade = val;
            if (!this._isRegisteringUI) this._runHeavyChange('Updating cascade blend...', () => this._rebuildCSM());
        });

        // Note: Changing cascade count requires instantiating a new CSMShadowNode
        ui.addSlider('CSM', 'csmCascades', 'Cascade Count', 1, 8, 1, this.cascades, 'Number of shadow map subdivisions.', (val: number) => {
            this.cascades = val;
            if (!this._isRegisteringUI) this._runHeavyChange('Rebuilding shadow cascades...', () => this._rebuildCSM());
        });

        ui.addSlider('CSM', 'csmMaxFar', 'Max Distance', 100, 15000, 100, this.maxFar, 'Maximum distance shadows are rendered.', (val: number) => {
            this.maxFar = val;
            if (!this._isRegisteringUI) {
                this._runHeavyChange('Updating shadow distance...', () => {
                    this._applyCSMSettings();
                });
            }
        });

        ui.addSlider('CSM', 'csmMapSize', 'Map Size (Per Cascade)', 512, 8192, 512, this.shadowMapSize, 'Shadow map resolution per cascade slice.', (val: number) => {
            this.shadowMapSize = val;
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) {
                if (!this._isRegisteringUI) this._runHeavyChange('Resizing shadow maps...', () => {
                    this._applyCSMSettings();
                });
            }
        });

        ui.addSlider('CSM', 'csmLightMargin', 'Light Margin', 0, 1000, 10, this.lightMargin, 'Margin to expand the light bounds (helps with pop-in at borders).', (val: number) => {
            this.lightMargin = val;
            if (!this._isRegisteringUI) this._runHeavyChange('Updating cascade bounds...', () => this._applyCSMSettings());
        });
        this._directionReadout = ui.addReadout('CSM', 'Light Dir');
        this._cascadeReadout = ui.addReadout('CSM', 'Cascades');
        this._isRegisteringUI = false;
    }

    _createCSM(sunLight: any) {
        try {
            const nextCSM = new CSMShadowNode(sunLight, {
                cascades: this.cascades,
                maxFar: this.maxFar,
                mode: this.csmMode,
                lightMargin: this.lightMargin
            });
            (nextCSM as any).fade = this.csmFade;

            sunLight.shadow.shadowNode = nextCSM;
            this.csm = nextCSM;
            this._applyCSMSettings(false);
            return nextCSM;
        } catch (err) {
            console.warn('[CSMPlugin] Failed to create CSMShadowNode; falling back to standard shadows.', err);
            sunLight.shadow.shadowNode = undefined;
            this.csm = null;
            return null;
        }
    }

    _setShadowsEnabled(enabled: boolean) {
        this.core.renderer.shadowMap.enabled = enabled;
        const sunLight = this.core.lightingSystem?.sunLight;
        if (sunLight) sunLight.castShadow = enabled;
    }

    _getShadowFilterNode() {
        if (!this.useStableFilter) return null;

        const type = this.core.renderer?.shadowMap?.type;
        if (type === THREE.PCFShadowMap || type === THREE.PCFSoftShadowMap) {
            return STABLE_TERRAIN_PCF_FILTER;
        }

        // VSM stores color moments in a regular float texture, so depth-compare
        // filters would generate invalid WGSL. Basic should stay unfiltered.
        return null;
    }

    _loadInitialSettings() {
        const params = this.core.debugUI?.params;
        if (!params) return;
        this.cascades = params.csmCascades ?? this.cascades;
        this.maxFar = params.csmMaxFar ?? this.maxFar;
        this.shadowMapSize = params.csmMapSize ?? this.shadowMapSize;
        this.lightMargin = params.csmLightMargin ?? this.lightMargin;
        this.shadowBias = params.shadowBias ?? this.shadowBias;
        this.shadowNormalBias = params.shadowNormalBias ?? this.shadowNormalBias;
        this.shadowRadius = params.shadowRadius ?? this.shadowRadius;
        this.shadowBlurSamples = params.shadowBlurSamples ?? this.shadowBlurSamples;
        this.shadowIntensity = params.shadowIntensity ?? this.shadowIntensity;
        this.useStableFilter = !!(params.csmStableFilter ?? (this.useStableFilter ? 1 : 0));
        this.csmFade = !!(params.csmFade ?? (this.csmFade ? 1 : 0));
        this.csmMode = CSM_MODES[params.csmMode ?? 0]?.value ?? this.csmMode;
    }

    _runHeavyChange(message: string, fn: () => void) {
        const ui = this.core.debugUI;
        ui?.beginBusy?.(message);
        try {
            fn();
            this._waitForShadowWork().finally(() => ui?.endBusy?.());
        } catch (err) {
            ui?.endBusy?.();
            throw err;
        }
    }

    async _waitForShadowWork() {
        const renderer = this.core.renderer;
        const device = renderer?.backend?.device;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (device?.queue?.onSubmittedWorkDone) {
            try {
                await device.queue.onSubmittedWorkDone();
            } catch (err) {
                console.warn('[CSMPlugin] Waiting for shadow GPU work failed.', err);
            }
        }
    }

    _forceRecompile() {
        const sun = this.core.lightingSystem?.sunLight;
        if (sun?.shadow?.shadowNode) sun.shadow.shadowNode.needsUpdate = true;
        if (sun?.shadow?.map) { 
            sun.shadow.map.dispose(); 
            sun.shadow.map = null; 
        }
        if (this.csm?.lights) {
            for (const lwLight of this.csm.lights) {
                if (lwLight.shadow?.map) {
                    lwLight.shadow.map.dispose();
                    lwLight.shadow.map = null;
                }
                if (lwLight.shadow) lwLight.shadow.needsUpdate = true;
            }
        }
        if (sun) sun.shadow.needsUpdate = true;
        this._markSceneMaterialsDirty();
    }

    _disposeCSMShadowMaps(csm: any) {
        if (!csm?.lights) return;
        for (const lwLight of csm.lights) {
            if (lwLight.shadow?.map) {
                lwLight.shadow.map.dispose();
                lwLight.shadow.map = null;
            }
        }
    }

    _resetLightShadowCache(light: any) {
        // Three caches the built shadow node on the light node. Dispatching
        // dispose clears that cache so the next material build uses the new CSM.
        light?.dispatchEvent?.({ type: 'dispose' });
    }

    _markSceneMaterialsDirty() {
        this.core.scene?.traverse?.((obj: any) => {
            const materials = obj?.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
            for (const material of materials) {
                if (material) material.needsUpdate = true;
            }
        });
    }

    _initializeCSM(csm: any) {
        if (!csm || csm.camera) return;
        const camera = this.core.camera;
        const renderer = this.core.renderer;
        if (!camera || !renderer) return;
        csm._init?.({ camera, renderer });
    }

    _applyCSMSettings(forceRecompile = true) {
        const sun = this.core.lightingSystem?.sunLight;
        const filterNode = this._getShadowFilterNode();
        if (sun) {
            sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
            sun.shadow.bias = this.shadowBias;
            sun.shadow.normalBias = this.shadowNormalBias;
            sun.shadow.radius = this.shadowRadius;
            sun.shadow.blurSamples = this.shadowBlurSamples;
            sun.shadow.intensity = this.shadowIntensity;
            sun.shadow.filterNode = filterNode;
        }

        if (this.csm) {
            this.csm.maxFar = this.maxFar;
            this.csm.lightMargin = this.lightMargin;
            this.csm.mode = this.csmMode;
            this.csm.fade = this.csmFade;
            if (this.csm.camera) this.csm.updateFrustums();
            if (this.csm.lights) {
                this.csm.lights.forEach((lwLight: any) => {
                    if (!lwLight.shadow) return;
                    lwLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
                    lwLight.shadow.bias = this.shadowBias;
                    lwLight.shadow.normalBias = this.shadowNormalBias;
                    lwLight.shadow.radius = this.shadowRadius;
                    lwLight.shadow.blurSamples = this.shadowBlurSamples;
                    lwLight.shadow.intensity = this.shadowIntensity;
                    lwLight.shadow.filterNode = filterNode;
                    lwLight.shadow.needsUpdate = true;
                });
            }
        }

        if (forceRecompile) this._forceRecompile();
    }

    _rebuildCSM() {
        const sunLight = this.core.lightingSystem?.sunLight;
        if (!sunLight) return;

        const previousCSM = this.csm;
        this._disposeCSMShadowMaps(previousCSM);
        this._resetLightShadowCache(sunLight);
        this.csm = null;

        const nextCSM = this._createCSM(sunLight);
        if (!nextCSM) {
            previousCSM?.dispose?.();
            this._forceRecompile();
            this._applyShadowBias();
            return;
        }

        if (previousCSM && previousCSM !== nextCSM) previousCSM.dispose();
        
        this._initializeCSM(nextCSM);
        this._applyCSMSettings();
        nextCSM.needsUpdate = true;
        this._markSceneMaterialsDirty();
    }

    _applyShadowBias() {
        const sun = this.core.lightingSystem?.sunLight;
        const filterNode = this._getShadowFilterNode();
        if (sun) {
            sun.shadow.bias = this.shadowBias;
            sun.shadow.normalBias = this.shadowNormalBias;
            sun.shadow.radius = this.shadowRadius;
            sun.shadow.blurSamples = this.shadowBlurSamples;
            sun.shadow.intensity = this.shadowIntensity;
            sun.shadow.filterNode = filterNode;
        }
        if (this.csm?.lights) {
            this.csm.lights.forEach((lwLight: any) => {
                lwLight.shadow.bias = this.shadowBias;
                lwLight.shadow.normalBias = this.shadowNormalBias;
                lwLight.shadow.radius = this.shadowRadius;
                lwLight.shadow.blurSamples = this.shadowBlurSamples;
                lwLight.shadow.intensity = this.shadowIntensity;
                lwLight.shadow.filterNode = filterNode;
                lwLight.shadow.needsUpdate = true;
            });
        }
        this._forceRecompile();
    }

    _setTerrainShadowDebug(disableTerrainCasting: boolean) {
        const lod = this.core.terrainSystem?.lod;
        if (!lod) return;

        for (const mesh of lod.activeMeshes) {
            if (!mesh) continue;
            if (disableTerrainCasting) {
                this._savedTerrainCastStates.set(mesh, mesh.castShadow);
                mesh.castShadow = false;
            } else {
                mesh.castShadow = this._savedTerrainCastStates.get(mesh) ?? (lod.castShadows && (mesh.userData?.lodDepth ?? 0) >= lod.shadowMinDepth);
            }
        }
    }

    update(_dt: number) {
        if (this.csm && this.csm.camera) {
            this.csm.updateFrustums();
        }
        this._updateDiagnostics();
    }

    _updateDiagnostics() {
        const sun = this.core.lightingSystem?.sunLight;
        if (sun && this._directionReadout) {
            const dir = new THREE.Vector3().subVectors(sun.target.position, sun.position).normalize();
            this._directionReadout.textContent = `${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)}`;
        }

        if (this._cascadeReadout) {
            if (!this.csm?.lights?.length) {
                this._cascadeReadout.textContent = sun?.shadow?.shadowNode ? `CSM pending setup (${this.cascades})` : 'standard shadows';
            } else {
                this._cascadeReadout.textContent = this.csm.lights.map((light: any, idx: number) => {
                    const shadow = light.shadow;
                    const cam = shadow?.camera;
                    return `C${idx + 1}:${shadow?.mapSize?.width ?? '?'} b${shadow?.bias?.toFixed?.(5) ?? '?'} nb${shadow?.normalBias?.toFixed?.(2) ?? '?'} r${shadow?.radius?.toFixed?.(1) ?? '?'} s${shadow?.intensity?.toFixed?.(2) ?? '?'} n${cam?.near?.toFixed?.(0) ?? '?'} f${cam?.far?.toFixed?.(0) ?? '?'}`;
                }).join(' | ');
            }
        }
    }

    dispose() {
        const sunLight = this.core.lightingSystem?.sunLight;
        if (sunLight) {
            sunLight.shadow.shadowNode = undefined;
        }
        this.csm = null;
    }
}
