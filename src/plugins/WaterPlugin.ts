// @ts-nocheck
import * as THREE from 'three/webgpu';
import {
  positionLocal, positionWorld, cameraPosition,
  texture, vec3, color, time, uniform,
  smoothstep, mix, max, float, sin, cos, transformNormalToView, length, dot, pow, step, fract
} from 'three/tsl';

export class WaterPlugin {
    core: any;
    waterMesh: any;
    waterLevelUniform: any;
    seaLevel: number;
    
    // Live uniforms for UI control
    _uWaveSpeed: any;
    _uWavePrimaryAmp: any;
    _uWaveSecondaryAmp: any;
    _uRoughness: any;
    _uMetalness: any;
    _uOpacityShallow: any;
    _uOpacityDeep: any;
    _uFresnelStrength: any;
    _uFoamIntensity: any;
    _uMeshResolution: number;

    // Color uniforms
    _uShoreColor: any;
    _uMidColor: any;
    _uDeepColor: any;
    _uFoamColor: any;
    _uSkyReflectColor: any;

    constructor() {
        this.waterMesh = null;
        this.seaLevel = 0;
        this._uMeshResolution = 512;
    }

    async init() {
        if (!this.core.terrainSystem) {
            console.error("[WaterPlugin] TerrainSystem must be initialized before WaterPlugin!");
            return;
        }

        const terrainSystem = this.core.terrainSystem;
        this._buildOceanMesh(terrainSystem);
        
        this.core.waterSystem = this;
        this._registerUI();
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('Water', '🌊', '#0cf', {
            category: 'Rendering',
            onEnable: () => { if (this.waterMesh) this.waterMesh.visible = true; },
            onDisable: () => { if (this.waterMesh) this.waterMesh.visible = false; }
        });

        // ── Wave Physics ──
        ui.addSection('Water', '🌊 Wave Physics', '#0cf');
        ui.addSlider('Water', 'waterLevelY', 'Water Level Y', -20, 20, 1, 0, 'Vertical offset of the water surface.', (val: number) => {
            if (this.waterLevelUniform) this.waterLevelUniform.value = val;
        });
        ui.addSlider('Water', 'waveSpeed', 'Wave Speed', 0.1, 2.0, 0.05, 0.6, 'Speed of wave animation.', (val: number) => {
            if (this._uWaveSpeed) this._uWaveSpeed.value = val;
        });
        ui.addSlider('Water', 'wavePrimaryAmp', 'Primary Amp', 0.01, 0.5, 0.01, 0.15, 'Amplitude of large primary waves.', (val: number) => {
            if (this._uWavePrimaryAmp) this._uWavePrimaryAmp.value = val;
        });
        ui.addSlider('Water', 'waveSecondaryAmp', 'Secondary Amp', 0.005, 0.15, 0.005, 0.03, 'Amplitude of secondary detail waves.', (val: number) => {
            if (this._uWaveSecondaryAmp) this._uWaveSecondaryAmp.value = val;
        });

        // ── Material ──
        ui.addSection('Water', '🎨 Material', '#7cf');
        ui.addSlider('Water', 'waterRoughness', 'Roughness', 0.0, 1.0, 0.01, 0.02, 'Surface roughness. Lower = more reflective.', (val: number) => {
            if (this._uRoughness) this._uRoughness.value = val;
        });
        ui.addSlider('Water', 'waterMetalness', 'Metalness', 0.0, 1.0, 0.01, 0.95, 'PBR metalness. Requires IBL for reflections.', (val: number) => {
            if (this._uMetalness) this._uMetalness.value = val;
        });
        ui.addSlider('Water', 'waterOpacityShallow', 'Opacity Shallow', 0.1, 1.0, 0.05, 0.45, 'Transparency in shallow water.', (val: number) => {
            if (this._uOpacityShallow) this._uOpacityShallow.value = val;
        });
        ui.addSlider('Water', 'waterOpacityDeep', 'Opacity Deep', 0.5, 1.0, 0.02, 0.98, 'Transparency in deep water.', (val: number) => {
            if (this._uOpacityDeep) this._uOpacityDeep.value = val;
        });
        ui.addSlider('Water', 'waterFresnelStrength', 'Fresnel', 0.0, 1.0, 0.05, 0.35, 'Strength of Fresnel sky reflection.', (val: number) => {
            if (this._uFresnelStrength) this._uFresnelStrength.value = val;
        });

        // ── Foam ──
        ui.addSection('Water', '🫧 Foam', '#cef');
        ui.addSlider('Water', 'waterFoamIntensity', 'Foam Intensity', 0.0, 3.0, 0.1, 1.2, 'Strength of shore foam bands.', (val: number) => {
            if (this._uFoamIntensity) this._uFoamIntensity.value = val;
        });

        // ── Colors ──
        ui.addSection('Water', '🎨 Colors', '#acf');
        ui.addSlider('Water', 'shoreR', 'Shore R', 0.0, 1.0, 0.01, 0.10, 'Shore color red.', (v: number) => { this._uShoreColor.value.r = v; });
        ui.addSlider('Water', 'shoreG', 'Shore G', 0.0, 1.0, 0.01, 0.60, 'Shore color green.', (v: number) => { this._uShoreColor.value.g = v; });
        ui.addSlider('Water', 'shoreB', 'Shore B', 0.0, 1.0, 0.01, 0.50, 'Shore color blue.', (v: number) => { this._uShoreColor.value.b = v; });
        ui.addSlider('Water', 'deepR', 'Deep R', 0.0, 1.0, 0.01, 0.01, 'Deep color red.', (v: number) => { this._uDeepColor.value.r = v; });
        ui.addSlider('Water', 'deepG', 'Deep G', 0.0, 1.0, 0.01, 0.08, 'Deep color green.', (v: number) => { this._uDeepColor.value.g = v; });
        ui.addSlider('Water', 'deepB', 'Deep B', 0.0, 1.0, 0.01, 0.22, 'Deep color blue.', (v: number) => { this._uDeepColor.value.b = v; });
        ui.addSlider('Water', 'foamR', 'Foam R', 0.0, 1.0, 0.01, 0.92, 'Foam color red.', (v: number) => { this._uFoamColor.value.r = v; });
        ui.addSlider('Water', 'foamG', 'Foam G', 0.0, 1.0, 0.01, 0.96, 'Foam color green.', (v: number) => { this._uFoamColor.value.g = v; });
        ui.addSlider('Water', 'foamB', 'Foam B', 0.0, 1.0, 0.01, 0.98, 'Foam color blue.', (v: number) => { this._uFoamColor.value.b = v; });

        // ── Performance ──
        ui.addSection('Water', '⚙️ Performance', '#88f');
        ui.addSlider('Water', 'waterMeshRes', 'Mesh Resolution', 128, 2048, 128, 512, 'Grid subdivisions (requires regenerate).', (_val: number) => {});
    }

    _buildOceanMesh(terrainSystem: any) {
      const waterGeo = new THREE.PlaneGeometry(terrainSystem.terrainSize, terrainSystem.terrainSize, this._uMeshResolution, this._uMeshResolution);
      waterGeo.rotateX(-Math.PI / 2);
      
      const seaLevel = 0;
      this.seaLevel = seaLevel;
      this.waterLevelUniform = uniform(float(0.0));
      
      // Live-adjustable uniforms
      this._uWaveSpeed = uniform(float(0.6));
      this._uWavePrimaryAmp = uniform(float(0.15));
      this._uWaveSecondaryAmp = uniform(float(0.03));
      this._uRoughness = uniform(float(0.02));
      this._uMetalness = uniform(float(0.95));
      this._uOpacityShallow = uniform(float(0.45));
      this._uOpacityDeep = uniform(float(0.98));
      this._uFresnelStrength = uniform(float(0.35));
      this._uFoamIntensity = uniform(float(1.2));

      // Color uniforms
      this._uShoreColor = uniform(color(0.10, 0.60, 0.50));
      this._uMidColor   = uniform(color(0.04, 0.28, 0.48));
      this._uDeepColor  = uniform(color(0.01, 0.08, 0.22));
      this._uFoamColor  = uniform(color(0.92, 0.96, 0.98));
      this._uSkyReflectColor = uniform(color(0.50, 0.68, 0.82));

      const tSize = float(terrainSystem.terrainSize);
      const hScale = float(terrainSystem.heightScale);
      const seaLevelF = float(seaLevel);
      
      const wPos = positionWorld;
      const terrainUV = wPos.xz.div(tSize).add(0.5);
      const terrainH = float((texture(terrainSystem.heightDataTex, terrainUV) as any).r).mul(hScale).add(terrainSystem.seaLevelOffset);
      const waterDepth = seaLevelF.sub(terrainH); 
      
      const waveTime = time.mul(this._uWaveSpeed);
      const depthWaveFactor = smoothstep(0.0, 15.0, waterDepth); 
      
      const wX = (wPos.x as any).mul(0.012).add(waveTime);
      const wZ = (wPos.z as any).mul(0.012).add(waveTime.mul(0.7));
      const wavePrimary = sin(wX).add(cos(wZ)).mul(this._uWavePrimaryAmp).mul(depthWaveFactor);
      
      const wX2 = (wPos.x as any).mul(0.04).sub(waveTime.mul(1.2));
      const wZ2 = (wPos.z as any).mul(0.04).sub(waveTime.mul(0.9));
      const waveSecondary = sin(wX2).add(cos(wZ2)).mul(this._uWaveSecondaryAmp);
      
      let waveHeight = wavePrimary.add(waveSecondary);
      
      const waterMat = new THREE.MeshStandardNodeMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide
      });

      waterMat.roughnessNode = this._uRoughness;
      waterMat.metalnessNode = this._uMetalness;
      
      waterMat.positionNode = positionLocal.add(vec3(0.0, waveHeight.add(this.waterLevelUniform), 0.0));
      
      const camDist  = length(cameraPosition.xz.sub(wPos.xz));
      const nearFade = float(1.0).sub(smoothstep(150.0, 600.0, camDist));
      const chopFade = float(1.0).sub(smoothstep(50.0, 250.0, camDist));

      const dX1 = cos(wX).mul(0.012).mul(this._uWavePrimaryAmp).mul(depthWaveFactor);
      const dZ1 = sin(wZ).negate().mul(0.012).mul(this._uWavePrimaryAmp).mul(depthWaveFactor);
      const dX2 = cos(wX2).mul(0.04).mul(this._uWaveSecondaryAmp);
      const dZ2 = sin(wZ2).negate().mul(0.04).mul(this._uWaveSecondaryAmp);

      const detailTime = time.mul(0.9);
      const dX3 = cos((wPos.x as any).mul(0.15).add(detailTime)).mul(sin((wPos.z as any).mul(0.12).sub(detailTime.mul(0.7)))).mul(0.12).mul(nearFade);
      const dZ3 = sin((wPos.z as any).mul(0.15).sub(detailTime)).mul(cos((wPos.x as any).mul(0.12).add(detailTime.mul(0.6)))).mul(0.12).mul(nearFade);

      const chopTime = time.mul(1.6);
      const dX4 = cos((wPos.x as any).mul(0.6).add((wPos.z as any).mul(0.35)).add(chopTime)).mul(0.08).mul(chopFade);
      const dZ4 = sin((wPos.z as any).mul(0.6).sub((wPos.x as any).mul(0.28)).sub(chopTime.mul(0.9))).mul(0.08).mul(chopFade);
      
      const waveNormal = vec3(
          dX1.add(dX2).add(dX3).add(dX4).negate(),
          1.0,
          dZ1.add(dZ2).add(dZ3).add(dZ4).negate()
      ).normalize();
      waterMat.normalNode = transformNormalToView(waveNormal);
      
      const viewDir = vec3(cameraPosition.sub(wPos)).normalize();
      const rawNDotV = float(dot(waveNormal, viewDir));
      const fresnelBase = float(float(1.0).sub(max(rawNDotV, float(0.0))));
      const fresnelSq = float(fresnelBase.mul(fresnelBase));
      const surfaceFresnel = float(fresnelSq.mul(fresnelSq));
      
      const seabedVisible = float(smoothstep(float(0.0), float(3.0), waterDepth));
      const seabedColor = mix(
          color(0.55, 0.50, 0.35),
          color(0.20, 0.35, 0.30),
          float(smoothstep(float(0.0), float(2.5), waterDepth))
      );
      
      const depthColor = float(smoothstep(float(0.0), float(8.0), waterDepth));
      
      const baseWaterCol = mix(this._uShoreColor, mix(this._uMidColor, this._uDeepColor, float(smoothstep(float(0.4), float(1.0), depthColor))), depthColor);
      const waterWithSeabed = mix(seabedColor, baseWaterCol, seabedVisible);
      const topWaterCol = mix(waterWithSeabed, this._uSkyReflectColor, float(surfaceFresnel.mul(this._uFresnelStrength)));

      const isUnderwaterSurface = float(step(cameraPosition.y, wPos.y)); 
      const invertedFresnelRaw = float(pow(float(1.0).sub(max(rawNDotV.negate(), float(0.0))), float(5.0)));
      const invertedFresnel = float(float(1.0).sub(invertedFresnelRaw));
      const undersideCol = mix(topWaterCol.mul(0.5), color(0.01, 0.1, 0.15), invertedFresnel);
      
      const finalWaterCol = mix(topWaterCol, undersideCol, isUnderwaterSurface);
      
      const foamZone   = float(smoothstep(float(4.0), float(0.0), waterDepth));
      
      const scroll1 = float(fract(waterDepth.mul(0.35).sub(time.mul(0.4))));
      const scroll2 = float(fract(waterDepth.mul(0.35).sub(time.mul(0.4)).add(0.5)));
      const band1 = float(smoothstep(float(0.0), float(0.12), scroll1).mul(smoothstep(float(0.5), float(0.1), scroll1)));
      const band2 = float(smoothstep(float(0.0), float(0.12), scroll2).mul(smoothstep(float(0.5), float(0.1), scroll2)));
      const crinkle = float(sin(float(wPos.x).mul(2.2).add(float(wPos.z).mul(1.4)).add(time.mul(0.8))).mul(0.3).add(0.7));
      const foamBands = float(max(band1, band2).mul(crinkle).mul(foamZone).mul(this._uFoamIntensity));
      
      const solidShoreline = float(smoothstep(float(0.6), float(0.0), waterDepth).mul(1.5));
      const crestFoam = float(smoothstep(float(0.7), float(1.0), sin(wX).mul(0.5).add(0.5)).mul(depthWaveFactor).mul(0.20));
      
      const totalFoam = float(foamBands.add(solidShoreline).add(crestFoam).clamp(0.0, 1.0));
      waterMat.colorNode = mix(finalWaterCol, this._uFoamColor, totalFoam);
      
      const depthOpacity = float(smoothstep(float(0.0), float(5.0), waterDepth));
      const baseOpacity = float(mix(this._uOpacityShallow, this._uOpacityDeep, depthOpacity));
      waterMat.opacityNode = mix(baseOpacity, float(1.0), surfaceFresnel);
      
      this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
      this.waterMesh.position.set(0, 0, 0);
      this.waterMesh.frustumCulled = false;
      this.core.scene.add(this.waterMesh);
    }

    getWaveHeightAt(x: number, z: number, t: number) {
      if (this.seaLevel === undefined) return 0;
      const waveTime = t * 0.6;
      const wX  = x * 0.012 + waveTime;
      const wZ  = z * 0.012 + waveTime * 0.7;
      const wX2 = x * 0.04  - waveTime * 1.2;
      const wZ2 = z * 0.04  - waveTime * 0.9;
      const primary   = (Math.sin(wX)  + Math.cos(wZ))  * 0.35;
      const secondary = (Math.sin(wX2) + Math.cos(wZ2)) * 0.07;
      return this.seaLevel + primary + secondary;
    }

    update(_deltaTime: number) {
        // Native TSL handles time internally via `time` node
    }

    dispose() {
        if (this.waterMesh) {
            this.core.scene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
            this.waterMesh.material.dispose();
            this.waterMesh = null;
        }
    }
}
