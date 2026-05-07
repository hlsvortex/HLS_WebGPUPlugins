import * as THREE from 'three/webgpu';

export class IBLPlugin {
    core: any;
    pmremGenerator: any;
    masterEnvMap: any;

    constructor() {}

    async init() {
        const { renderer, scene, onProgress } = this.core;
        
        if (onProgress) onProgress('Baking IBL Environment...', 25);
        
        this.pmremGenerator = new THREE.PMREMGenerator(renderer);
        this.pmremGenerator.compileCubemapShader();

        const horizonColor = new THREE.Color(0.85, 0.90, 0.95);
        const zenithColor = new THREE.Color(0.25, 0.45, 0.85);
        const sunIntensity = 1.0;

        this.masterEnvMap = this._bake(horizonColor, zenithColor, sunIntensity);
        scene.environment = this.masterEnvMap;
        scene.environmentIntensity = 0.8;

        this.core.iblSystem = this;
        console.log('[IBLPlugin] Fully baked single-pass master irradiance map');

        this._registerUI();
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('IBL', '☀️', '#fc0', {
            category: 'Rendering',
            onEnable: () => {
                if (this.masterEnvMap) this.core.scene.environment = this.masterEnvMap;
            },
            onDisable: () => {
                this.core.scene.environment = null;
            }
        });

        ui.addSection('IBL', '🌤️ Environment Lighting', '#fc0');
        ui.addSlider('IBL', 'envIntensity', 'Env Intensity', 0.0, 3.0, 0.1, 0.8, 'Environment map influence on materials.', (val: number) => {
            this.core.scene.environmentIntensity = val;
        });
        ui.addSlider('IBL', 'toneMappingExposure', 'Exposure', 0.3, 3.0, 0.1, 1.1, 'Tone mapping exposure level.', (val: number) => {
            this.core.renderer.toneMappingExposure = val;
        });

        ui.addSection('IBL', '💡 Sun Light', '#ff8');
        ui.addSlider('IBL', 'sunIntensity', 'Sun Intensity', 0.0, 8.0, 0.1, 3.0, 'Directional light brightness.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.intensity = val;
        });
        ui.addSlider('IBL', 'sunPosX', 'Sun X', -3000, 3000, 100, 1000, 'Sun directional light X position.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.x = val;
        });
        ui.addSlider('IBL', 'sunPosY', 'Sun Y', 500, 5000, 100, 2000, 'Sun directional light Y position.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.y = val;
        });
        ui.addSlider('IBL', 'sunPosZ', 'Sun Z', -3000, 3000, 100, 1000, 'Sun directional light Z position.', (val: number) => {
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.position.z = val;
        });

        ui.addSection('IBL', '🌑 Shadows', '#a8f');
        ui.addToggle('IBL', 'shadowsEnabled', 'Shadows', true, 'Global shadow rendering toggle.', (val: boolean) => {
            this.core.renderer.shadowMap.enabled = val;
            if (this.core.lightingSystem?.sunLight) this.core.lightingSystem.sunLight.castShadow = val;
        });
        ui.addSlider('IBL', 'shadowMapSize', 'Map Size', 512, 8192, 512, 4096, 'Shadow map resolution (higher = sharper but slower).', (val: number) => {
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) {
                sun.shadow.mapSize.width = val;
                sun.shadow.mapSize.height = val;
                if (sun.shadow.map) {
                    sun.shadow.map.dispose();
                    sun.shadow.map = null;
                }
            }
        });
        ui.addSlider('IBL', 'shadowBias', 'Shadow Bias', -0.005, 0.005, 0.0001, 0.0, 'Shadow acne fix. Nudge slightly negative if needed.', (val: number) => {
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) sun.shadow.bias = val;
        });
        ui.addSlider('IBL', 'shadowNear', 'Near Plane', 1, 500, 10, 100, 'Shadow camera near clipping plane.', (val: number) => {
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) { sun.shadow.camera.near = val; sun.shadow.camera.updateProjectionMatrix(); }
        });
        ui.addSlider('IBL', 'shadowFar', 'Far Plane', 1000, 15000, 500, 5000, 'Shadow camera far clipping plane.', (val: number) => {
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) { sun.shadow.camera.far = val; sun.shadow.camera.updateProjectionMatrix(); }
        });
        ui.addSlider('IBL', 'shadowExtent', 'Coverage', 200, 4000, 100, 1000, 'Shadow camera ortho extent (world units visible).', (val: number) => {
            const sun = this.core.lightingSystem?.sunLight;
            if (sun) {
                sun.shadow.camera.left = -val;
                sun.shadow.camera.right = val;
                sun.shadow.camera.top = val;
                sun.shadow.camera.bottom = -val;
                sun.shadow.camera.updateProjectionMatrix();
            }
        });

        ui.addSection('IBL', '🌫️ Ambient', '#8bf');
        ui.addSlider('IBL', 'ambientIntensity', 'Ambient Light', 0.0, 2.0, 0.05, 0.4, 'Hemisphere ambient fill light intensity.', (val: number) => {
            // Find ambient light in scene
            this.core.scene.traverse((obj: any) => {
                if (obj.isAmbientLight) obj.intensity = val;
            });
        });
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

    update(deltaTime: number) {}

    dispose() {
        if (this.masterEnvMap) {
            this.masterEnvMap.dispose();
            this.masterEnvMap = null;
        }
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }
        if (this.core && this.core.scene) {
            this.core.scene.environment = null;
        }
    }
}
