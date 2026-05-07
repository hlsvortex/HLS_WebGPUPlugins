import * as THREE from 'three/webgpu';
import { fog, color, positionWorld, cameraPosition, distance, smoothstep, uniform, float, max, exp, sin, cos, time, mix, clamp } from 'three/tsl';

export class HeightFogPlugin {
    core: any;
    
    // Uniforms
    _uFogColor: any;
    _uFogDensity: any;
    _uHeightFalloff: any;
    _uBaseHeight: any;
    
    _uFogStartDist: any;
    _uMaxOpacity: any;
    
    _uNoiseSpeed: any;
    _uNoiseScale: any;
    _uNoiseStrength: any;
    
    constructor() {}
    
    async init() {
        const { scene, debugUI } = this.core;
        
        this._uFogColor = uniform(color(0xaabbcc));
        this._uFogDensity = uniform(float(0.00005));
        this._uHeightFalloff = uniform(float(0.002));
        this._uBaseHeight = uniform(float(300.0));
        
        this._uFogStartDist = uniform(float(50.0));
        this._uMaxOpacity = uniform(float(0.95));
        
        this._uNoiseSpeed = uniform(float(0.5));
        this._uNoiseScale = uniform(float(0.002));
        this._uNoiseStrength = uniform(float(0.8));
        
        // 1. Distance Calculation
        const rawDist = distance(cameraPosition, positionWorld);
        const fogDist = max(float(0.0), rawDist.sub(this._uFogStartDist));
        
        // 2. Rolling Mist Noise (Domain Warping)
        const wPos = positionWorld;
        const mistTime = time.mul(this._uNoiseSpeed);
        
        const nX = wPos.x.mul(this._uNoiseScale).add(mistTime);
        const nZ = wPos.z.mul(this._uNoiseScale).sub(mistTime.mul(0.8));
        const nY = wPos.y.mul(this._uNoiseScale).add(mistTime.mul(0.5));
        
        // Simple 3D procedural noise approx
        const noiseVal = sin(nX).add(cos(nZ)).add(sin(nX.mul(0.5).sub(nY.mul(0.5)))).mul(0.33); 
        const normalizedNoise = noiseVal.mul(0.5).add(0.5); // 0.0 to 1.0
        
        // 3. Height Calculation
        // Add the noise to the world position Y so the "top" of the fog rolls like clouds
        const noisyY = positionWorld.y.add(noiseVal.mul(this._uNoiseStrength).mul(200.0));
        const heightDelta = max(float(0.0), this._uBaseHeight.sub(noisyY));
        const verticalDensity = heightDelta.mul(this._uHeightFalloff);
        
        // Also apply noise to the density itself so there are "pockets" of clear air
        const densityMultiplier = mix(float(1.0), normalizedNoise, this._uNoiseStrength);
        
        // 4. Combine Densities
        const combinedDensity = this._uFogDensity.add(verticalDensity.mul(densityMultiplier));
        
        // Calculate exponential fog factor: 1.0 - exp(-(distance * density))
        let fogFactor = float(1.0).sub(exp(fogDist.mul(combinedDensity).negate()));
        
        // Clamp maximum opacity so the fog is never 100% opaque (keeps some silhouette visibility)
        fogFactor = clamp(fogFactor, float(0.0), this._uMaxOpacity);
        
        // Apply global fog node
        scene.fogNode = fog(this._uFogColor, fogFactor);
        
        // Setup UI
        if (debugUI) {
            debugUI.registerPlugin('Height Fog', '🌫️', '#aaa', {
                category: 'Rendering',
                onEnable: () => { scene.fogNode = fog(this._uFogColor, fogFactor); },
                onDisable: () => { scene.fogNode = null; }
            });
            
            debugUI.addSection('Height Fog', '🌫️ Base Fog', '#aaa');
            debugUI.addSlider('Height Fog', 'fogDensity', 'Base Density', 0.00000, 0.0005, 0.000001, 0.00005, 'Base distance fog density.', (v: number) => { this._uFogDensity.value = v; });
            debugUI.addSlider('Height Fog', 'fogStartDist', 'Start Distance', 0.0, 1000.0, 10.0, 50.0, 'Distance from camera before fog starts.', (v: number) => { this._uFogStartDist.value = v; });
            debugUI.addSlider('Height Fog', 'maxOpacity', 'Max Opacity', 0.0, 1.0, 0.05, 0.95, 'Maximum fog thickness.', (v: number) => { this._uMaxOpacity.value = v; });
            
            debugUI.addSection('Height Fog', '⛰️ Valley Mist', '#8ac');
            debugUI.addSlider('Height Fog', 'fogBaseHeight', 'Mist Max Height', -100.0, 1000.0, 10.0, 300.0, 'Elevation where height fog completely fades out.', (v: number) => { this._uBaseHeight.value = v; });
            debugUI.addSlider('Height Fog', 'fogFalloff', 'Mist Thickness', 0.00001, 0.005, 0.00001, 0.002, 'How quickly fog thickens as elevation drops.', (v: number) => { this._uHeightFalloff.value = v; });
            
            debugUI.addSection('Height Fog', '☁️ Rolling Clouds', '#ccc');
            debugUI.addSlider('Height Fog', 'noiseStrength', 'Noise Strength', 0.0, 1.0, 0.05, 0.8, 'Intensity of the rolling cloud noise.', (v: number) => { this._uNoiseStrength.value = v; });
            debugUI.addSlider('Height Fog', 'noiseSpeed', 'Noise Speed', 0.0, 3.0, 0.1, 0.5, 'Speed of the rolling mist.', (v: number) => { this._uNoiseSpeed.value = v; });
            debugUI.addSlider('Height Fog', 'noiseScale', 'Noise Scale', 0.0001, 0.01, 0.0001, 0.002, 'Scale of the cloud pockets.', (v: number) => { this._uNoiseScale.value = v; });

            debugUI.addSection('Height Fog', '🎨 Color', '#ddd');
            debugUI.addSlider('Height Fog', 'fogColorR', 'Color R', 0.0, 1.0, 0.01, 0.66, 'Red channel.', (v: number) => { this._updateColor(v, null, null); });
            debugUI.addSlider('Height Fog', 'fogColorG', 'Color G', 0.0, 1.0, 0.01, 0.73, 'Green channel.', (v: number) => { this._updateColor(null, v, null); });
            debugUI.addSlider('Height Fog', 'fogColorB', 'Color B', 0.0, 1.0, 0.01, 0.80, 'Blue channel.', (v: number) => { this._updateColor(null, null, v); });
        }
        
        console.log('[HeightFogPlugin] Initialized advanced global height fog.');
    }
    
    _updateColor(r: number | null, g: number | null, b: number | null) {
        if (r !== null) this._uFogColor.value.r = r;
        if (g !== null) this._uFogColor.value.g = g;
        if (b !== null) this._uFogColor.value.b = b;
    }
    
    update(deltaTime: number) {}
    
    dispose() {
        if (this.core.scene.fogNode) {
            this.core.scene.fogNode = null;
        }
    }
}
