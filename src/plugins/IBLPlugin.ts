import * as THREE from 'three/webgpu';

// Tone mapping display names aligned to THREE constants
const TONE_MAPS = [
    { label: 'ACES Filmic', value: THREE.ACESFilmicToneMapping },
    { label: 'AgX',         value: THREE.AgXToneMapping },
    { label: 'Reinhard',    value: THREE.ReinhardToneMapping },
    { label: 'Cineon',      value: THREE.CineonToneMapping },
    { label: 'Linear',      value: THREE.LinearToneMapping },
    { label: 'None',        value: THREE.NoToneMapping },
] as const;

// Removed SHADOW_TYPES from this file, moved to CSMPlugin

export class IBLPlugin {
    core: any;
    pmremGenerator: any;
    masterEnvMap: any;

    // Bake parameters (CPU-side, used for rebake)
    _horizonColor: THREE.Color = new THREE.Color(0.85, 0.90, 0.95);
    _zenithColor:  THREE.Color = new THREE.Color(0.25, 0.45, 0.85);
    _groundColor:  THREE.Color = new THREE.Color(0.18, 0.14, 0.10); // earth bounce
    _sunBakeIntensity: number = 1.0;

    // Hemisphere light reference
    _hemiLight: THREE.HemisphereLight | null = null;
    _fillLight: THREE.DirectionalLight | null = null;

    // Tone mapping state
    _toneMapIdx: number = 0;
    _shadowTypeIdx: number = 0;

    // Auto-rebake state
    _autoRebake: boolean = false;
    _lastRebakeTod: number = -99;

    constructor() {}

    async init() {
        const { renderer, scene, onProgress } = this.core;

        if (onProgress) onProgress('Baking IBL Environment...', 25);

        this.pmremGenerator = new THREE.PMREMGenerator(renderer);
        this.pmremGenerator.compileCubemapShader();

        this.masterEnvMap = this._bake(this._horizonColor, this._zenithColor, this._sunBakeIntensity);
        scene.environment = this.masterEnvMap;
        scene.environmentIntensity = 0.8;

        // ── Upgrade AmbientLight → HemisphereLight ────────────────────────
        // Remove the flat ambient added in main.ts and replace with hemisphere
        // Collect first, then remove — never mutate the scene during traverse
        const toRemove: any[] = [];
        scene.traverse((obj: any) => { if (obj.isAmbientLight) toRemove.push(obj); });
        toRemove.forEach((obj: any) => scene.remove(obj));
        this._hemiLight = new THREE.HemisphereLight(
            0x8ba4d4,   // sky color (soft blue)
            0x4a3828,   // ground bounce (warm earth)
            0.4
        );
        scene.add(this._hemiLight);
        this.core.lightingSystem.hemiLight = this._hemiLight;

        // ── Secondary fill light (sky bounce) ───────────────────────────
        // Cool-blue fill from the opposite side of the sun to fake sky GI
        this._fillLight = new THREE.DirectionalLight(0x6699cc, 0.4);
        this._fillLight.position.set(-1000, 500, -1000);
        this._fillLight.castShadow = false;
        scene.add(this._fillLight);
        this.core.lightingSystem.fillLight = this._fillLight;

        // Apply initial tone mapping
        renderer.toneMapping = TONE_MAPS[this._toneMapIdx].value;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.core.iblSystem = this;
        console.log('[IBLPlugin] Initialized with HemisphereLight + fill light');

        this._registerUI();
    }

    _rebake() {
        const { scene } = this.core;
        if (this.masterEnvMap) this.masterEnvMap.dispose();
        this.masterEnvMap = this._bake(this._horizonColor, this._zenithColor, this._sunBakeIntensity);
        scene.environment = this.masterEnvMap;
    }

    _syncTodColors() {
        // Pull live sky colors from SkyPlugin uniforms for the rebake
        const sky = this.core.skySystem;
        if (!sky) return;
        const tod = sky._uTimeOfDay?.value ?? 10;
        const sunAngle = (tod - 6) / 12 * Math.PI;
        const elevation = Math.sin(sunAngle);
        const dayT = Math.max(0, Math.min(1, (elevation + 0.1) / 0.25));

        // Interpolate sky colors
        const topDay    = sky._uSkyTopDay?.value    ?? new THREE.Color(0.18, 0.40, 0.85);
        const botDay    = sky._uSkyBottomDay?.value ?? new THREE.Color(0.65, 0.78, 0.92);
        const topNight  = sky._uSkyTopNight?.value  ?? new THREE.Color(0.01, 0.01, 0.04);
        const botNight  = sky._uSkyBottomNight?.value ?? new THREE.Color(0.02, 0.03, 0.08);

        this._zenithColor.lerpColors(topNight,  topDay,  dayT);
        this._horizonColor.lerpColors(botNight, botDay, dayT);
        this._sunBakeIntensity = dayT;

        // Sync hemi light sky color too
        if (this._hemiLight) {
            this._hemiLight.color.copy(this._horizonColor);
            this._hemiLight.intensity = THREE.MathUtils.lerp(0.05, 0.4, dayT);
        }
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('IBL', '☀️', '#fc0', {
            category: 'Rendering',
            onEnable:  () => { if (this.masterEnvMap) this.core.scene.environment = this.masterEnvMap; },
            onDisable: () => { this.core.scene.environment = null; }
        });

        // ── Environment Lighting ──────────────────────────────────────────
        ui.addSection('IBL', '🌤️ Environment', '#fc0');
        ui.addSlider('IBL', 'envIntensity', 'Env Intensity', 0.0, 3.0, 0.1, 0.8, 'Environment map reflective influence on PBR materials.', (val: number) => {
            this.core.scene.environmentIntensity = val;
        });
        ui.addSlider('IBL', 'toneMappingExposure', 'Exposure', 0.3, 3.0, 0.1, 1.1, 'Tone mapping exposure.', (val: number) => {
            this.core.renderer.toneMappingExposure = val;
        });
        ui.addDropdown('IBL', 'toneMapSelect', 'Tone Mapping', TONE_MAPS as any, 0, 'Select the tone mapping algorithm.', (val: any) => {
            this.core.renderer.toneMapping = val;
        });

        // ── IBL Rebake ──────────────────────────────────────────────────
        ui.addSection('IBL', '🔄 IBL Rebake', '#fda');
        ui.addColor('IBL', 'iblHorizon', 'Horizon Color', '#d9e6f2', 'Horizon sky color baked into env map.', (hex: string) => {
            this._horizonColor.set(hex);
        });
        ui.addColor('IBL', 'iblZenith', 'Zenith Color', '#4072d9', 'Zenith sky color baked into env map.', (hex: string) => {
            this._zenithColor.set(hex);
        });
        ui.addSlider('IBL', 'iblSunBake', 'Sun Intensity', 0.0, 2.0, 0.1, 1.0, 'Sun hotspot strength baked into env map.', (val: number) => {
            this._sunBakeIntensity = val;
        });
        ui.addButton('IBL', 'Rebake IBL Now', () => {
            this._rebake();
        });
        ui.addButton('IBL', 'Sync to Sky & Rebake', () => {
            this._syncTodColors();
            this._rebake();
        });
        ui.addToggle('IBL', 'autoRebake', 'Auto-Rebake (ToD)', false, 'Auto-rebake IBL at each hour of day cycle.', (val: boolean) => {
            this._autoRebake = val;
        });

        // ── Sun Light ──────────────────────────────────────────────────
        ui.addSection('IBL', '💡 Sun Light', '#ff8');
        ui.addSlider('IBL', 'sunIntensity', 'Sun Intensity', 0.0, 8.0, 0.1, 3.0, 'Directional sun light brightness.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.intensity = val;
        });
        ui.addColor('IBL', 'sunColor', 'Sun Color', '#ffffee', 'Color of the directional sun light.', (hex: string) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.color.set(hex);
        });
        ui.addSlider('IBL', 'sunPosX', 'Sun X', -3000, 3000, 100, 1000, 'Sun X position (overridden by SkyPlugin if active).', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.x = val;
        });
        ui.addSlider('IBL', 'sunPosY', 'Sun Y', 500, 5000, 100, 2000, 'Sun Y position.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.y = val;
        });
        ui.addSlider('IBL', 'sunPosZ', 'Sun Z', -3000, 3000, 100, 1000, 'Sun Z position.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.z = val;
        });

        // ── Fill Light (Sky Bounce) ───────────────────────────────────
        ui.addSection('IBL', '🔵 Fill Light', '#8cf');
        ui.addSlider('IBL', 'fillIntensity', 'Fill Intensity', 0.0, 2.0, 0.05, 0.4, 'Secondary sky-bounce fill light intensity.', (val: number) => {
            if (this._fillLight) this._fillLight.intensity = val;
        });
        ui.addColor('IBL', 'fillColor', 'Fill Color', '#6699cc', 'Sky bounce fill light color.', (hex: string) => {
            if (this._fillLight) this._fillLight.color.set(hex);
        });

        // ── Hemisphere Light ─────────────────────────────────────────
        ui.addSection('IBL', '🌐 Hemisphere Light', '#adf');
        ui.addSlider('IBL', 'hemiIntensity', 'Hemi Intensity', 0.0, 2.0, 0.05, 0.4, 'Hemisphere ambient intensity.', (val: number) => {
            if (this._hemiLight) this._hemiLight.intensity = val;
        });
        ui.addColor('IBL', 'hemiSkyColor', 'Sky Color', '#8ba4d4', 'Hemisphere sky (top) color.', (hex: string) => {
            if (this._hemiLight) this._hemiLight.color.set(hex);
        });
        ui.addColor('IBL', 'hemiGroundColor', 'Ground Color', '#4a3828', 'Hemisphere ground (bottom) bounce color.', (hex: string) => {
            if (this._hemiLight) this._hemiLight.groundColor.set(hex);
        });

        // ── Shadows ──────────────────────────────────────────────────
        // Removed: Shadow controls are now fully handled by CSMPlugin.
    }

    _bake(horizonColor: THREE.Color, zenithColor: THREE.Color, sunIntensity: number) {
        const width = 64;
        const height = 32;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        for (let y = 0; y < height; y++) {
            const t = Math.pow(1.0 - (y / (height - 1)), 1.5);
            const r = Math.round(THREE.MathUtils.lerp(horizonColor.r, zenithColor.r, t) * 255);
            const g = Math.round(THREE.MathUtils.lerp(horizonColor.g, zenithColor.g, t) * 255);
            const b = Math.round(THREE.MathUtils.lerp(horizonColor.b, zenithColor.b, t) * 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(0, y, width, 1);
        }

        if (sunIntensity > 0.05) {
            const sunBrightness = Math.min(1.0, sunIntensity);
            const sunGrad = ctx.createRadialGradient(
                width * 0.75, height * 0.65, 0,
                width * 0.75, height * 0.65, height * 0.35
            );
            sunGrad.addColorStop(0, `rgba(255,240,200,${sunBrightness * 0.8})`);
            sunGrad.addColorStop(0.4, `rgba(255,200,100,${sunBrightness * 0.3})`);
            sunGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sunGrad;
            ctx.fillRect(0, 0, width, height);
        }

        const skyTexture = new THREE.CanvasTexture(canvas);
        skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture.colorSpace = THREE.SRGBColorSpace;

        const envMap = this.pmremGenerator.fromEquirectangular(skyTexture).texture;
        skyTexture.dispose();
        return envMap;
    }

    update(_dt: number) {
        // Auto-rebake: sync and rebake once per integer hour change
        if (this._autoRebake) {
            const sky = this.core.skySystem;
            if (sky) {
                const tod = sky._uTimeOfDay?.value ?? 0;
                const hour = Math.floor(tod);
                if (hour !== this._lastRebakeTod) {
                    this._lastRebakeTod = hour;
                    this._syncTodColors();
                    this._rebake();
                }
            }
        }
    }

    dispose() {
        if (this.masterEnvMap) { this.masterEnvMap.dispose(); this.masterEnvMap = null; }
        if (this.pmremGenerator) { this.pmremGenerator.dispose(); this.pmremGenerator = null; }
        if (this._hemiLight) { this.core.scene.remove(this._hemiLight); this._hemiLight = null; }
        if (this._fillLight) { this.core.scene.remove(this._fillLight); this._fillLight = null; }
        if (this.core?.scene) this.core.scene.environment = null;
    }
}
