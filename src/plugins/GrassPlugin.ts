import * as THREE from 'three/webgpu';
import {
  positionLocal, instanceIndex, modelWorldMatrix, texture,
  vec2, vec3, vec4, float, color, smoothstep, mix, pow, uniform,
  sin, cos, time, hash, cameraPosition, length, normalize, dot, max, transformNormalToView
} from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export class GrassPlugin {
    core: any;
    terrainSystem: any;
    
    grassMeshPool: any[];
    activeMeshes: any[];
    
    _exclusionRes: number;
    _exclusionData: Uint8Array;
    _exclusionTexture: THREE.DataTexture;
    
    grassInstancesPerChunk: number;
    grassGeo: any;
    grassMaterials: any[];
    playerPosNode: any;

    // Live uniforms for UI
    _uViewDistNear: any;
    _uViewDistFar: any;
    _uWindSpeed: any;
    _uWindSwayStrength: any;
    _uWindGustStrength: any;
    _uBladeWidth: any;
    _uBladeHeight: any;
    _uInteractRadius: any;
    _uInteractStrength: any;
    _uProximityBoostNear: any;
    _uProximityBoostFar: any;

    // Color uniforms
    _uRootGreen: any;
    _uTipGreen: any;
    _uRootStraw: any;
    _uTipStraw: any;
    _uBrightness: any;
    _uSaturation: any;
    _uStrawBlend: any;
    _uGroundBlendStrength: any;

    _activeChunksReadout: HTMLSpanElement | null;
    _poolReadout: HTMLSpanElement | null;

    constructor() {
        this.grassMeshPool = [];
        this.activeMeshes = [];
        
        this._exclusionRes = 2048;
        this._exclusionData = new Uint8Array(this._exclusionRes * this._exclusionRes);
        this._exclusionData.fill(255);
        
        this._exclusionTexture = new THREE.DataTexture(
            this._exclusionData,
            this._exclusionRes,
            this._exclusionRes,
            THREE.RedFormat,
            THREE.UnsignedByteType
        );
        this._exclusionTexture.minFilter = THREE.LinearFilter;
        this._exclusionTexture.magFilter = THREE.LinearFilter;
        this._exclusionTexture.wrapS = THREE.ClampToEdgeWrapping;
        this._exclusionTexture.wrapT = THREE.ClampToEdgeWrapping;
        this._exclusionTexture.needsUpdate = true;

        this.playerPosNode = uniform(new THREE.Vector3(0, -9999, 0));
        
        this.grassInstancesPerChunk = 30000;
        this.grassMaterials = [];
        this._activeChunksReadout = null;
        this._poolReadout = null;
    }

    async init() {
        if (!this.core.terrainSystem) {
            console.error("[GrassPlugin] TerrainSystem must be initialized before GrassPlugin!");
            return;
        }

        this.terrainSystem = this.core.terrainSystem;
        this._buildGrassGeometryAndMaterial();

        // Hook into QuadTreeLOD chunk events
        const lod = this.terrainSystem.lod;
        if (lod) {
            lod.onChunkCreated = (chunk: any) => this.handleChunkCreated(chunk);
            lod.onChunkDestroyed = (chunk: any) => this.handleChunkDestroyed(chunk);
        }

        this.core.grassSystem = this;
        this._registerUI();
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('Grass', '🌿', '#4c8', {
            category: 'Rendering',
            onEnable: () => {
                for (const m of this.activeMeshes) { if (m) m.visible = true; }
            },
            onDisable: () => {
                for (const m of this.activeMeshes) { if (m) m.visible = false; }
            }
        });

        // ── View Distance ──
        ui.addSection('Grass', '👁️ View Distance', '#8cf');
        ui.addSlider('Grass', 'grassViewNear', 'Fade Start', 50, 500, 10, 200, 'Distance where grass begins fading.', (val: number) => {
            if (this._uViewDistNear) this._uViewDistNear.value = val;
        });
        ui.addSlider('Grass', 'grassViewFar', 'Fade End', 100, 800, 10, 300, 'Distance where grass is fully invisible.', (val: number) => {
            if (this._uViewDistFar) this._uViewDistFar.value = val;
        });

        // ── Blade Shape ──
        ui.addSection('Grass', '🌱 Blade Shape', '#6d4');
        ui.addSlider('Grass', 'grassBladeWidth', 'Blade Width', 0.03, 0.3, 0.01, 0.11, 'Width of individual grass blades.', (val: number) => {
            if (this._uBladeWidth) this._uBladeWidth.value = val;
        });
        ui.addSlider('Grass', 'grassBladeHeight', 'Blade Height', 0.2, 2.0, 0.05, 0.85, 'Height of individual grass blades.', (val: number) => {
            if (this._uBladeHeight) this._uBladeHeight.value = val;
        });
        ui.addSlider('Grass', 'grassInstances', 'Instances/Chunk', 5000, 60000, 5000, 30000, 'Grass instances per LOD chunk (requires regenerate).', (_val: number) => {});

        // ── Color ──
        ui.addSection('Grass', '🎨 Blade Color', '#8d4');
        ui.addColor('Grass', 'grassRootGreen', 'Root Green', '#0d2e0d', 'Base color at the root of green grass.', (hex: string) => {
            if (this._uRootGreen) this._uRootGreen.value.set(hex);
        });
        ui.addColor('Grass', 'grassTipGreen', 'Tip Green', '#409426', 'Tip color of healthy green grass.', (hex: string) => {
            if (this._uTipGreen) this._uTipGreen.value.set(hex);
        });
        ui.addColor('Grass', 'grassRootStraw', 'Root Straw', '#1f1f08', 'Base color at the root of dead/dry grass.', (hex: string) => {
            if (this._uRootStraw) this._uRootStraw.value.set(hex);
        });
        ui.addColor('Grass', 'grassTipStraw', 'Tip Straw', '#8c8033', 'Tip color of dead/dry grass.', (hex: string) => {
            if (this._uTipStraw) this._uTipStraw.value.set(hex);
        });
        ui.addSlider('Grass', 'grassStrawBlend', 'Straw Blend', 0.0, 1.0, 0.05, 0.5, 'How much straw/dead grass appears overall.', (val: number) => {
            if (this._uStrawBlend) this._uStrawBlend.value = val;
        });
        ui.addSlider('Grass', 'grassBrightness', 'Brightness', 0.2, 3.0, 0.05, 1.0, 'Overall grass brightness multiplier.', (val: number) => {
            if (this._uBrightness) this._uBrightness.value = val;
        });
        ui.addSlider('Grass', 'grassSaturation', 'Saturation', 0.0, 2.0, 0.05, 1.0, 'Color saturation. 0 = greyscale, 2 = vivid.', (val: number) => {
            if (this._uSaturation) this._uSaturation.value = val;
        });
        ui.addSlider('Grass', 'grassGroundBlend', 'Ground Tint', 0.0, 1.0, 0.05, 0.6, 'How much biome ground color bleeds into blades.', (val: number) => {
            if (this._uGroundBlendStrength) this._uGroundBlendStrength.value = val;
        });

        // ── Wind ──
        ui.addSection('Grass', '💨 Wind', '#9cf');
        ui.addSlider('Grass', 'grassWindSpeed', 'Wind Speed', 0.1, 3.0, 0.1, 1.2, 'Speed of wind wave animation.', (val: number) => {
            if (this._uWindSpeed) this._uWindSpeed.value = val;
        });
        ui.addSlider('Grass', 'grassWindSway', 'Sway Strength', 0.05, 1.0, 0.05, 0.35, 'Primary wind sway amplitude.', (val: number) => {
            if (this._uWindSwayStrength) this._uWindSwayStrength.value = val;
        });
        ui.addSlider('Grass', 'grassWindGust', 'Gust Strength', 0.0, 0.5, 0.05, 0.15, 'Secondary gust wave amplitude.', (val: number) => {
            if (this._uWindGustStrength) this._uWindGustStrength.value = val;
        });

        // ── Player Interaction ──
        ui.addSection('Grass', '🏃 Interaction', '#fa0');
        ui.addSlider('Grass', 'grassInteractRadius', 'Push Radius', 0.5, 5.0, 0.1, 1.2, 'Radius of player grass interaction.', (val: number) => {
            if (this._uInteractRadius) this._uInteractRadius.value = val;
        });
        ui.addSlider('Grass', 'grassInteractStrength', 'Push Strength', 0.0, 3.0, 0.1, 1.2, 'Strength of the grass push effect.', (val: number) => {
            if (this._uInteractStrength) this._uInteractStrength.value = val;
        });
        ui.addSlider('Grass', 'grassProximityNear', 'Boost Near', 1.0, 3.0, 0.1, 1.5, 'Size boost for grass near the player.', (val: number) => {
            if (this._uProximityBoostNear) this._uProximityBoostNear.value = val;
        });
        ui.addSlider('Grass', 'grassProximityFar', 'Boost Far Dist', 10, 100, 5, 40, 'Distance at which proximity boost fades out.', (val: number) => {
            if (this._uProximityBoostFar) this._uProximityBoostFar.value = val;
        });

        // ── Biome Density ──
        ui.addSection('Grass', '🌴 Biome Density (regen)', '#0f5');
        const onChange = (_val: number) => {};
        ui.addSlider('Grass', 'densityBeach', 'Beach', 0.0, 1.0, 0.05, 0.2, 'Foliage density on beaches.', onChange);
        ui.addSlider('Grass', 'densityGrass', 'Grassland', 0.0, 1.0, 0.05, 0.5, 'Foliage density on grasslands.', onChange);
        ui.addSlider('Grass', 'densityForest', 'Forest', 0.0, 1.0, 0.05, 0.65, 'Foliage density in forests.', onChange);
        ui.addSlider('Grass', 'densityPine', 'Pine', 0.0, 1.0, 0.05, 0.75, 'Foliage density in pine forests.', onChange);
        ui.addSlider('Grass', 'densityRedwood', 'Redwood', 0.0, 1.0, 0.05, 0.9, 'Foliage density in redwood forests.', onChange);
        ui.addSlider('Grass', 'densityJungle', 'Jungle', 0.0, 1.0, 0.05, 0.65, 'Foliage density in jungles.', onChange);
        ui.addSlider('Grass', 'densitySwamp', 'Swamp', 0.0, 1.0, 0.05, 0.55, 'Foliage density in swamps.', onChange);
        ui.addSlider('Grass', 'densityMountain', 'Mountain', 0.0, 1.0, 0.05, 0.3, 'Foliage density on mountains.', onChange);
        ui.addSlider('Grass', 'densitySnow', 'Snow', 0.0, 1.0, 0.05, 0.4, 'Foliage density on snow.', onChange);

        // ── Shadows ──
        ui.addSection('Grass', '🌑 Shadows', '#a8f');
        ui.addToggle('Grass', 'grassReceiveShadows', 'Receive Shadows', true, 'Grass receives shadows from the sun.', (val: boolean) => {
            for (const group of this.activeMeshes) {
                group.traverse((child: any) => { if (child.isInstancedMesh) child.receiveShadow = val; });
            }
        });
        ui.addToggle('Grass', 'grassCastShadows', 'Cast Shadows', false, 'Grass casts shadows (very expensive!).', (val: boolean) => {
            for (const group of this.activeMeshes) {
                group.traverse((child: any) => { if (child.isInstancedMesh) child.castShadow = val; });
            }
        });

        // ── Stats ──
        ui.addSection('Grass', '📊 Stats', '#556');
        this._activeChunksReadout = ui.addReadout('Grass', 'Active Patches');
        this._poolReadout = ui.addReadout('Grass', 'Pool Size');
    }

    handleChunkCreated(chunk: any) {
        const grassMesh = this.claimGrassMesh();
        grassMesh.position.set(chunk.x, 0, chunk.z);
        grassMesh.scale.set(chunk.size, 1, chunk.size);
        
        grassMesh.traverse((child: any) => {
            if (child.isInstancedMesh) {
                child.receiveShadow = true;
                child.castShadow = false; 
            }
        });
        
        grassMesh.updateMatrixWorld();
        chunk.grassMesh = grassMesh;
    }

    handleChunkDestroyed(chunk: any) {
        if (chunk.grassMesh) {
            this.releaseGrassMesh(chunk.grassMesh);
            chunk.grassMesh = null;
        }
    }

    claimGrassMesh() {
        if (this.grassMeshPool.length > 0) {
            const group = this.grassMeshPool.pop();
            group.visible = true;
            this.activeMeshes.push(group);
            return group;
        }

        const dummyMatrix = new THREE.Matrix4();
        const group = new THREE.Group();

        for (let i = 0; i < 1; i++) {
            const mesh = new THREE.InstancedMesh(this.grassGeo, this.grassMaterials[i], this.grassInstancesPerChunk);
            for (let j = 0; j < this.grassInstancesPerChunk; j++) {
                mesh.setMatrixAt(j, dummyMatrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.receiveShadow = true; 
            mesh.castShadow = false;
            mesh.frustumCulled = false;
            group.add(mesh);
        }
        
        this.core.scene.add(group);
        this.activeMeshes.push(group);
        return group;
    }

    releaseGrassMesh(mesh: any) {
        mesh.visible = false;
        const index = this.activeMeshes.indexOf(mesh);
        if (index > -1) {
            this.activeMeshes.splice(index, 1);
        }
        this.grassMeshPool.push(mesh);
    }

    addGrassExclusionZone(worldX: number, worldZ: number, radius: number) {
        const res = this._exclusionRes;
        const terrainSize = this.terrainSystem.terrainSize;
        const half = terrainSize / 2;
        
        const cx = Math.round(((worldX + half) / terrainSize) * res);
        const cz = Math.round(((worldZ + half) / terrainSize) * res);
        const pr = Math.max(Math.round((radius / terrainSize) * res), 1);
        
        const rSq = pr * pr;
        for (let dy = -pr; dy <= pr; dy++) {
            for (let dx = -pr; dx <= pr; dx++) {
                const distSq = dx * dx + dy * dy;
                if (distSq > rSq) continue;
                const px = cx + dx;
                const pz = cz + dy;
                if (px < 0 || px >= res || pz < 0 || pz >= res) continue;
                
                const dist = Math.sqrt(distSq);
                const gradient = dist / pr;
                
                const factor = Math.min(255, Math.floor(Math.pow(gradient, 3.0) * 255));
                
                const idx = pz * res + px;
                this._exclusionData[idx] = Math.min(this._exclusionData[idx], factor);
            }
        }
        
        this._exclusionTexture.needsUpdate = true;
    }

    _buildGrassGeometryAndMaterial() {
        const p1 = new THREE.PlaneGeometry(0.11, 0.85, 1, 3);
        const p2 = new THREE.PlaneGeometry(0.11, 0.85, 1, 3);
        p2.rotateY(Math.PI / 3); 
        const grassGeo = BufferGeometryUtils.mergeGeometries([p1, p2]);
        grassGeo.translate(0, 0.425, 0);
        p1.dispose();
        p2.dispose();
        
        const posAttr = grassGeo.attributes.position;
        const vCount = posAttr.count;
        
        for (let j = 0; j < vCount; j++) {
            const vy = posAttr.getY(j);
            const hRatio = Math.max(0.0, Math.min(1.0, vy / 0.85));
            
            const widthScale = 1.0 - Math.pow(hRatio, 2.0);
            posAttr.setX(j, posAttr.getX(j) * widthScale);
            posAttr.setZ(j, posAttr.getZ(j) * widthScale);
            
            posAttr.setZ(j, posAttr.getZ(j) + Math.pow(hRatio, 1.5) * 0.15);
        }
        grassGeo.computeVertexNormals();

        // ── Live uniforms ──
        this._uViewDistNear = uniform(float(200.0));
        this._uViewDistFar = uniform(float(300.0));
        this._uWindSpeed = uniform(float(1.2));
        this._uWindSwayStrength = uniform(float(0.35));
        this._uWindGustStrength = uniform(float(0.15));
        this._uBladeWidth = uniform(float(0.11));
        this._uBladeHeight = uniform(float(0.85));
        this._uInteractRadius = uniform(float(1.2));
        this._uInteractStrength = uniform(float(1.2));
        this._uProximityBoostNear = uniform(float(1.5));
        this._uProximityBoostFar = uniform(float(40.0));

        // ── Color uniforms ──
        this._uRootGreen = uniform(new THREE.Color(0.05, 0.18, 0.05));
        this._uTipGreen = uniform(new THREE.Color(0.25, 0.58, 0.15));
        this._uRootStraw = uniform(new THREE.Color(0.12, 0.12, 0.03));
        this._uTipStraw = uniform(new THREE.Color(0.55, 0.50, 0.20));
        this._uBrightness = uniform(float(1.0));
        this._uSaturation = uniform(float(1.0));
        this._uStrawBlend = uniform(float(0.5));
        this._uGroundBlendStrength = uniform(float(0.6));

        const heightRatioTSL = smoothstep(0.0, 0.5, positionLocal.y); 
        const aBladeRand = hash(instanceIndex.add(99.0));
        
        const rootGreen = vec3(this._uRootGreen);
        const tipGreen  = vec3(this._uTipGreen);
        
        const rootStraw = vec3(this._uRootStraw);
        const tipStraw  = vec3(this._uTipStraw);
        
        const chunkHash = hash(instanceIndex.add(5.0));
        const lifeFactor = mix(aBladeRand, chunkHash, 0.4); 
        const deathMask = pow(lifeFactor, 2.0).mul(this._uStrawBlend.mul(2.0));
        
        const finalRoot = mix(rootGreen, rootStraw, deathMask);
        const finalTip  = mix(tipGreen, tipStraw, deathMask);
        
        const shadeRandomness = mix(float(0.6), float(1.2), aBladeRand);
        const rawColor = mix(finalRoot, finalTip, pow(heightRatioTSL, 0.8)).mul(shadeRandomness);

        // Apply brightness and saturation
        const luminance = rawColor.x.mul(0.299).add(rawColor.y.mul(0.587)).add(rawColor.z.mul(0.114));
        const grey = vec3(luminance, luminance, luminance);
        let finalBaseColor: any = mix(grey, rawColor, this._uSaturation).mul(this._uBrightness);
        
        const preRx = hash(instanceIndex.add(1.0));
        const preRz = hash(instanceIndex.add(2.0));
        const preLocalX = mix(float(-0.5), float(0.5), preRx);
        const preLocalZ = mix(float(-0.5), float(0.5), preRz);
        const preWPos = modelWorldMatrix.mul(vec4(preLocalX, 0, preLocalZ, 1.0)); 
        const grassBiomeUV = vec2(preWPos.x.div(8000.0).add(0.5), preWPos.z.div(8000.0).add(0.5));
        const grassBiomeSample = texture(this.terrainSystem.biomeDataTex, grassBiomeUV);
        const grassBiomeId = grassBiomeSample.a;
        
        const groundTintGrassland = color(0.28, 0.55, 0.18); 
        const groundTintJungle    = color(0.10, 0.28, 0.08); 
        const groundTintPine      = color(0.18, 0.32, 0.12); 
        const groundTintRedwood   = color(0.35, 0.22, 0.12); 
        const groundTintSwamp     = color(0.22, 0.20, 0.10); 

        const gIsJungle  = smoothstep(0.65, 0.6, grassBiomeId).mul(smoothstep(0.55, 0.6, grassBiomeId));
        const gIsPine    = smoothstep(0.45, 0.4, grassBiomeId).mul(smoothstep(0.35, 0.4, grassBiomeId));
        const gIsRedwood = smoothstep(0.55, 0.5, grassBiomeId).mul(smoothstep(0.45, 0.5, grassBiomeId));
        const gIsSwamp   = smoothstep(0.75, 0.7, grassBiomeId).mul(smoothstep(0.65, 0.7, grassBiomeId));
        
        let groundTint: any = groundTintGrassland;
        groundTint = mix(groundTint, groundTintJungle, gIsJungle);
        groundTint = mix(groundTint, groundTintPine, gIsPine);
        groundTint = mix(groundTint, groundTintRedwood, gIsRedwood);
        groundTint = mix(groundTint, groundTintSwamp, gIsSwamp);
        
        const groundBlend = mix(float(0.35), float(0.85), float(1.0).sub(heightRatioTSL)).mul(this._uGroundBlendStrength);
        finalBaseColor = mix(finalBaseColor, groundTint, groundBlend);

        const tSize = float(8000.0);
        const hScale = float(this.terrainSystem.heightScale);
        
        const rx = hash(instanceIndex.add(1.0));
        const rz = hash(instanceIndex.add(2.0));
        const rt = hash(instanceIndex.add(3.0));
        
        const localX = mix(float(-0.5), float(0.5), rx);
        const localZ = mix(float(-0.5), float(0.5), rz);
        const rotY = rt.mul(Math.PI * 2.0);
        
        const baseWorld = modelWorldMatrix.mul(vec4(localX, 0.0, localZ, 1.0));
        const wX = baseWorld.x;
        const wZ = baseWorld.z;
        
        const terrainUV = vec2(wX, wZ).div(tSize).add(0.5);
        const hSample = texture(this.terrainSystem.heightDataTex, terrainUV);
        const bSample = texture(this.terrainSystem.biomeDataTex, terrainUV);
        
        const steepMask = float(1.0).sub(smoothstep(0.2, 0.5, bSample.g));
        
        const biomeId = bSample.a;
        const biomeMask = smoothstep(0.15, 0.25, biomeId).mul(smoothstep(0.85, 0.75, biomeId));
        const vegDensity = smoothstep(0.1, 0.5, bSample.r);
        
        const camXZ = vec2(cameraPosition.x, cameraPosition.z);
        const bladeXZ = vec2(wX, wZ);
        const distToCameraXZ = length(camXZ.sub(bladeXZ));
        const distanceMask = float(1.0).sub(smoothstep(this._uViewDistNear, this._uViewDistFar, distToCameraXZ));
        
        let validGrass = biomeMask.mul(vegDensity).mul(distanceMask).mul(steepMask);

        const exclusionUV = vec2(wX.div(float(this.terrainSystem.terrainSize)).add(0.5), wZ.div(float(this.terrainSystem.terrainSize)).add(0.5));
        const exclusionSample = texture(this._exclusionTexture, exclusionUV).r;
        const exclusionScale = exclusionSample.mul(0.8).add(0.2); 
        validGrass = validGrass.mul(exclusionScale);
        
        const playerXZ = vec2(this.playerPosNode.x, this.playerPosNode.z);
        const distToPlayerXZ = length(bladeXZ.sub(playerXZ));
        const proximityBoost = mix(this._uProximityBoostNear, float(1.0), smoothstep(float(10.0), this._uProximityBoostFar, distToPlayerXZ));
        
        const sizeVar = mix(0.7, 1.6, hash(instanceIndex.add(4.0)));
        const finalScale = validGrass.mul(sizeVar).mul(proximityBoost);
        
        const windDir = vec2(0.8, 0.6); 
        const worldUV = vec2(wX, wZ);
        
        const wavePhase = dot(worldUV, windDir).mul(0.015).add(time.mul(this._uWindSpeed));
        const swell = sin(wavePhase).mul(0.5).add(0.5); 
        
        const gustPhase = dot(worldUV, vec2(-0.5, 0.8)).mul(0.05).add(time.mul(this._uWindSpeed.mul(1.8)));
        const gust = sin(gustPhase).mul(cos(wavePhase.mul(2.0))); 
        
        const flutter = sin(time.mul(4.5).add(wX).add(wZ)).mul(0.05);
        
        const totalWind = swell.mul(this._uWindSwayStrength).add(gust.mul(this._uWindGustStrength)).add(flutter);
        const heightBend = pow(positionLocal.y, float(1.5)).mul(0.4);
        
        const swayX = windDir.x.mul(totalWind).mul(heightBend);
        const swayZ = windDir.y.mul(totalWind).mul(heightBend);

        const c = cos(rotY);
        const s = sin(rotY);
        
        const rotXLocal = positionLocal.x.mul(c).sub(positionLocal.z.mul(s));
        const rotZLocal = positionLocal.x.mul(s).add(positionLocal.z.mul(c));
        const chunkScaleXZ = length(modelWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz);

        const dirToPlayerXZ = bladeXZ.sub(playerXZ); 
        
        const pushFactor = smoothstep(this._uInteractRadius, float(0.0), distToPlayerXZ).mul(this._uInteractStrength).mul(heightBend);
        const safeDist = max(distToPlayerXZ, float(0.01));
        const pushVecWorldXZ = dirToPlayerXZ.div(safeDist).mul(pushFactor);

        const rotatedPos = vec3(
            rotXLocal.add(swayX),
            positionLocal.y,
            rotZLocal.add(swayZ)
        );

        const finalNormWorld = normalize(mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), heightRatioTSL.mul(0.8)));
        const finalNormNode = transformNormalToView(finalNormWorld);
        
        const seaLevelOff = float(this.terrainSystem.seaLevelOffset); // -400

        // Scale grass based on base geometry size (width: 0.11, height: 0.85) to hook up the UI sliders
        const userBladeScale = vec3(this._uBladeWidth.div(float(0.11)), this._uBladeHeight.div(float(0.85)), this._uBladeWidth.div(float(0.11)));

        const finalPosNode = rotatedPos
             .mul(finalScale) // finalScale is already a scalar float node, no need to wrap in vec3()
             .mul(userBladeScale)
             .div(vec3(chunkScaleXZ, float(1.0), chunkScaleXZ))
             .add(vec3(localX, hSample.r.mul(hScale).add(seaLevelOff), localZ))
             .add(vec3(pushVecWorldXZ.x.div(chunkScaleXZ), float(0.0), pushVecWorldXZ.y.div(chunkScaleXZ)));

        grassGeo.computeBoundingSphere();
        grassGeo.boundingSphere!.radius = 99999.0;
        this.grassGeo = grassGeo;

        for (let i = 0; i < 1; i++) {
            const mat = new THREE.MeshStandardNodeMaterial({
                side: THREE.DoubleSide,
                roughness: 0.8,
                metalness: 0.1
            });
            
            if (this.terrainSystem.decalSystem) {
                finalBaseColor = this.terrainSystem.decalSystem.getDecalBlendNodeLite(baseWorld, finalBaseColor);
            }

            mat.colorNode = finalBaseColor;
            mat.normalNode = finalNormNode;
            mat.positionNode = finalPosNode;
            
            mat.transparent = false; 
            mat.depthWrite = true;
            
            this.grassMaterials.push(mat);
        }
    }

    update(deltaTime: number) {
        const { camera } = this.core;
        if (camera) {
            this.playerPosNode.value.copy(camera.position);
        }

        // Update readouts
        if (this._activeChunksReadout) {
            this._activeChunksReadout.textContent = `${this.activeMeshes.length} active`;
        }
        if (this._poolReadout) {
            this._poolReadout.textContent = `${this.grassMeshPool.length} pooled`;
        }
    }

    dispose() {
        for (const mesh of this.grassMeshPool) {
            this.core.scene.remove(mesh);
        }
        for (const mesh of this.activeMeshes) {
            this.core.scene.remove(mesh);
        }
        this.grassMeshPool = [];
        this.activeMeshes = [];
        if (this.grassGeo) this.grassGeo.dispose();
        for (const mat of this.grassMaterials) mat.dispose();
    }
}
