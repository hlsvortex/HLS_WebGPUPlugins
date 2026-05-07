import * as THREE from 'three/webgpu';
import { pass, uniform, float, mix, vec3, vec2, color, positionLocal, distance } from 'three/tsl';
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

    constructor() {}
    
    async init() {
        const { renderer, scene, camera, debugUI } = this.core;
        
        // Native WebGPU PostProcessing
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.core.postProcessing = this.postProcessing; // Let main.ts pick it up
        
        // Base scene pass
        this.scenePass = pass(scene, camera);
        
        // Uniforms setup
        this._uBloomStrength = uniform(float(0.5));
        this._uBloomRadius = uniform(float(0.4));
        this._uBloomThreshold = uniform(float(0.8));
        
        this._uContrast = uniform(float(1.05));
        this._uSaturation = uniform(float(1.1));
        this._uVignette = uniform(float(0.2));

        // 1. Bloom
        const bloomPass = bloom(this.scenePass, this._uBloomStrength, this._uBloomRadius, this._uBloomThreshold);
        let output = this.scenePass.add(bloomPass);

        // 2. Custom TSL Color Correction
        // Grayscale conversion for Saturation
        const luminance = output.r.mul(0.299).add(output.g.mul(0.587)).add(output.b.mul(0.114));
        const grey = vec3(luminance);
        
        // Saturation
        output = mix(grey, output, this._uSaturation);
        
        // Contrast
        output = output.sub(0.5).mul(this._uContrast).add(0.5);

        // Vignette
        const uv = positionLocal.xy.mul(0.5).add(0.5); // Screen coordinates 0..1
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
            debugUI.addSlider('PostProcess', 'bloomThreshold', 'Threshold', 0.0, 2.0, 0.05, 0.8, 'Luminance threshold to trigger bloom.', (v: number) => { this._uBloomThreshold.value = v; });
            
            debugUI.addSection('PostProcess', '🎨 Color Grading', '#0ff');
            debugUI.addSlider('PostProcess', 'contrast', 'Contrast', 0.5, 2.0, 0.05, 1.05, 'Global contrast curve.', (v: number) => { this._uContrast.value = v; });
            debugUI.addSlider('PostProcess', 'saturation', 'Saturation', 0.0, 2.0, 0.05, 1.1, 'Global color saturation.', (v: number) => { this._uSaturation.value = v; });
            debugUI.addSlider('PostProcess', 'vignette', 'Vignette', 0.0, 1.5, 0.05, 0.2, 'Screen edge darkening.', (v: number) => { this._uVignette.value = v; });
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
