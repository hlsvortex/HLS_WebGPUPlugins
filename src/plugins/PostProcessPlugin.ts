import * as THREE from 'three/webgpu';
import { pass, uniform, float, mix, vec3, vec2, color, positionLocal, distance, sin, fract, time } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class PostProcessPlugin {
    core: any;
    postProcessing: any;
    scenePass: any;
    
    // Uniforms
    _uBloomStrength: any;
    _uBloomRadius: any;
    _uBloomThreshold: any;
    
    _uContrast: any;
    _uSaturation: any;
    _uVignette: any;

    _uColorTemp: any;
    _uColorTint: any;
    _uFilmGrain: any;

    constructor() {}
    
    async init() {
        const { renderer, scene, camera, debugUI } = this.core;
        
        // Native WebGPU PostProcessing (now RenderPipeline)
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.core.postProcessing = this.postProcessing; // Let main.ts pick it up
        
        // Base scene pass
        this.scenePass = pass(scene, camera);
        
        // Uniforms setup
        this._uBloomStrength = uniform(float(0.5));
        this._uBloomRadius = uniform(float(0.4));
        // Lower threshold so bloom actually triggers on the sky/sun
        this._uBloomThreshold = uniform(float(0.5)); 
        
        this._uContrast = uniform(float(1.05));
        this._uSaturation = uniform(float(1.1));
        this._uVignette = uniform(float(0.25));

        this._uColorTemp = uniform(float(0.0));
        this._uColorTint = uniform(float(0.0));
        this._uFilmGrain = uniform(float(0.04));

        // 1. Bloom
        // Note: we pass 1.0 to the internal node strength and multiply the output by our uniform
        // to guarantee the slider takes effect even if the internal node caches uniforms.
        const bloomPass = bloom(this.scenePass, 1.0, this._uBloomRadius, this._uBloomThreshold);
        let output = this.scenePass.add(bloomPass.mul(this._uBloomStrength));

        // 2. Custom TSL Color Correction
        // Grayscale conversion for Saturation
        const luminance = output.r.mul(0.299).add(output.g.mul(0.587)).add(output.b.mul(0.114));
        const grey = vec3(luminance);
        
        // Saturation
        output = mix(grey, output, this._uSaturation);
        
        // Contrast
        output = output.sub(0.5).mul(this._uContrast).add(0.5);

        // Color Temperature & Tint
        // Temp > 0 : Warm (More Red, Less Blue) | Temp < 0 : Cool (More Blue, Less Red)
        // Tint > 0 : Magenta (More R+B, Less G) | Tint < 0 : Green (More G, Less R+B)
        const rTemp = this._uColorTemp.mul(0.2);
        const bTemp = this._uColorTemp.negate().mul(0.2);
        const gTint = this._uColorTint.negate().mul(0.2);
        const rbTint = this._uColorTint.mul(0.2);

        const wbMultiplier = vec3(
            float(1.0).add(rTemp).add(rbTint),
            float(1.0).add(gTint),
            float(1.0).add(bTemp).add(rbTint)
        );
        output = output.mul(wbMultiplier);

        const uv = positionLocal.xy.mul(0.5).add(0.5); // Screen coordinates 0..1

        // Film Grain
        // High frequency procedural hash based on UV and Time
        const grainHash = fract(sin(uv.x.mul(12.9898).add(uv.y.mul(78.233)).add(time.mul(10.0))).mul(43758.5453));
        const grain = grainHash.sub(0.5).mul(this._uFilmGrain);
        output = output.add(vec3(grain));

        // Vignette
        const dist = distance(uv, vec2(0.5, 0.5));
        const vignetteFactor = float(1.0).sub(dist.mul(this._uVignette).clamp(0.0, 1.0));
        output = output.mul(vignetteFactor);

        this.postProcessing.outputNode = output;

        // UI Setup
        if (debugUI) {
            debugUI.registerPlugin('PostProcess', '✨', '#f0f', {
                category: 'Rendering',
                onEnable: () => { this.core.postProcessing = this.postProcessing; },
                onDisable: () => { this.core.postProcessing = null; }
            });
            
            debugUI.addSection('PostProcess', '🌸 Bloom', '#f8f');
            debugUI.addSlider('PostProcess', 'bloomStrength', 'Strength', 0.0, 3.0, 0.1, 0.5, 'Bloom intensity.', (v: number) => { this._uBloomStrength.value = v; });
            debugUI.addSlider('PostProcess', 'bloomRadius', 'Radius', 0.0, 1.0, 0.05, 0.4, 'Bloom spread radius.', (v: number) => { this._uBloomRadius.value = v; });
            debugUI.addSlider('PostProcess', 'bloomThreshold', 'Threshold', 0.0, 2.0, 0.05, 0.5, 'Luminance threshold to trigger bloom.', (v: number) => { this._uBloomThreshold.value = v; });
            
            debugUI.addSection('PostProcess', '🎨 Color Grading', '#0ff');
            debugUI.addSlider('PostProcess', 'temperature', 'Temperature', -1.0, 1.0, 0.05, 0.0, 'White balance: -1 (Cool/Blue) to 1 (Warm/Orange).', (v: number) => { this._uColorTemp.value = v; });
            debugUI.addSlider('PostProcess', 'tint', 'Tint', -1.0, 1.0, 0.05, 0.0, 'Color tint: -1 (Green) to 1 (Magenta).', (v: number) => { this._uColorTint.value = v; });
            debugUI.addSlider('PostProcess', 'contrast', 'Contrast', 0.5, 2.0, 0.05, 1.05, 'Global contrast curve.', (v: number) => { this._uContrast.value = v; });
            debugUI.addSlider('PostProcess', 'saturation', 'Saturation', 0.0, 2.0, 0.05, 1.1, 'Global color saturation.', (v: number) => { this._uSaturation.value = v; });
            
            debugUI.addSection('PostProcess', '🎞️ Lens Effects', '#aaa');
            debugUI.addSlider('PostProcess', 'filmGrain', 'Film Grain', 0.0, 0.2, 0.01, 0.04, 'Animated noise overlay intensity.', (v: number) => { this._uFilmGrain.value = v; });
            debugUI.addSlider('PostProcess', 'vignette', 'Vignette', 0.0, 1.5, 0.05, 0.25, 'Screen edge darkening.', (v: number) => { this._uVignette.value = v; });
        }

        console.log('[PostProcessPlugin] Initialized PostProcessing Pipeline.');
    }
    
    update(deltaTime: number) {
        // No per-frame logic required for static post-process
    }

    dispose() {
        if (this.core.postProcessing === this.postProcessing) {
            this.core.postProcessing = null;
        }
    }
}
