// @ts-nocheck
import * as THREE from 'three/webgpu';
import {
    positionLocal, cameraPosition, uniform, float, vec2, vec3, vec4, color,
    normalize, dot, max, pow, smoothstep, mix, sin, cos, time, fract,
    step, length, abs, clamp, atan, asin, floor, mul, add,
    positionGeometry, attribute
} from 'three/tsl';

/**
 * SkyPlugin — Procedural sky dome with day/night cycle.
 * 
 * Drives sun position, sky gradient, horizon haze, stars, moon glow,
 * and synchronizes the directional light + IBL environment map.
 */
export class SkyPlugin {
    core: any;
    skyMesh: any;
    skyMat: any;
    
    starsMesh: any;
    starsMat: any;

    // Uniforms
    _uTimeOfDay: any;       // 0..24 hours
    _uCycleSpeed: any;      // real-time cycle speed multiplier
    _uSunElevation: any;    // computed from time
    _uSunAzimuth: any;
    _uSkyTopDay: any;
    _uSkyBottomDay: any;
    _uSkyTopNight: any;
    _uSkyBottomNight: any;
    _uSunColor: any;
    _uSunSize: any;
    _uSunGlowSize: any;
    _uHorizonHaze: any;
    _uStarDensity: any;
    _uStarBrightness: any;
    _uMoonGlow: any;
    _uAutoRotate: boolean;
    _uSunsetTint: any;

    _uAuroraIntensity: any;
    _uAuroraSpeed: any;
    _uAuroraColor1: any;
    _uAuroraColor2: any;
    _uShootingStarDensity: any;

    // Cloud uniforms
    _uCloudCoverage: any;
    _uCloudSoftness: any;
    _uCloudSpeed: any;
    _uCloudScale: any;
    _uCloudColor: any;
    _uCloudShadowColor: any;
    _uCloudHeight: any;

    // Readouts
    _timeReadout: HTMLSpanElement | null;
    _phaseReadout: HTMLSpanElement | null;
    _ambientLight: THREE.AmbientLight | null;  // Cached reference — avoid scene.traverse every frame

    constructor() {
        this.skyMesh = null;
        this.skyMat = null;
        this.starsMesh = null;
        this.starsMat = null;
        this._uAutoRotate = true;
        this._timeReadout = null;
        this._phaseReadout = null;
        this._ambientLight = null;
    }

    async init() {
        const { scene } = this.core;

        this._buildSkyDome();
        this._buildStars();
        
        scene.add(this.skyMesh);
        scene.add(this.starsMesh);

        this.core.skySystem = this;

        // Expose cloud uniforms on core so other plugins (terrain, grass)
        // can sample the identical noise to cast fake cloud shadows on the ground.
        this.core.cloudShadowUniforms = {
            coverage : this._uCloudCoverage,
            softness : this._uCloudSoftness,
            speed    : this._uCloudSpeed,
            scale    : this._uCloudScale,
            strength : uniform(float(0.35)),   // max shadow darkness (0 = off, 1 = black)
        };

        this._registerUI();

        // Cache ambient light to avoid scene.traverse every frame
        this.core.scene.traverse((obj: any) => {
            if (obj.isAmbientLight) this._ambientLight = obj;
        });

        console.log('[SkyPlugin] Procedural sky dome initialized.');
    }

    _buildSkyDome() {
        // Large inverted sphere for sky
        const geo = new THREE.SphereGeometry(12000, 32, 16);
        geo.scale(-1, 1, -1); // Invert so we see inside

        // === Uniforms ===
        this._uTimeOfDay = uniform(float(10.0));      // Start at 10 AM
        this._uCycleSpeed = uniform(float(0.0));       // 0 = paused, 1 = 1 hour per real minute
        this._uSkyTopDay = uniform(new THREE.Color(0.18, 0.40, 0.85));
        this._uSkyBottomDay = uniform(new THREE.Color(0.65, 0.78, 0.92));
        this._uSkyTopNight = uniform(new THREE.Color(0.01, 0.01, 0.04));
        this._uSkyBottomNight = uniform(new THREE.Color(0.02, 0.03, 0.08));
        this._uSunColor = uniform(new THREE.Color(1.0, 0.95, 0.8));
        this._uSunSize = uniform(float(0.04));
        this._uSunGlowSize = uniform(float(0.15));
        this._uHorizonHaze = uniform(float(0.3));
        this._uStarDensity = uniform(float(2000.0)); // Used as count for points
        this._uStarBrightness = uniform(float(1.0));
        this._uMoonGlow = uniform(float(0.6));
        this._uSunsetTint = uniform(new THREE.Color(1.0, 0.45, 0.15));

        this._uAuroraIntensity = uniform(float(1.0));
        this._uAuroraSpeed = uniform(float(1.0));
        this._uAuroraColor1 = uniform(new THREE.Color(0.1, 1.0, 0.5));
        this._uAuroraColor2 = uniform(new THREE.Color(0.6, 0.2, 1.0));
        this._uShootingStarDensity = uniform(float(0.5));

        // Cloud uniforms
        this._uCloudCoverage    = uniform(float(0.45));  // 0=clear, 1=overcast
        this._uCloudSoftness    = uniform(float(0.35));  // edge sharpness
        this._uCloudSpeed       = uniform(float(0.06));  // scroll speed
        this._uCloudScale       = uniform(float(3.5));   // noise frequency
        this._uCloudColor       = uniform(new THREE.Color(1.0, 1.0, 1.0));     // lit cloud tops
        this._uCloudShadowColor = uniform(new THREE.Color(0.60, 0.65, 0.72)); // underside shadow
        this._uCloudHeight      = uniform(float(0.12));  // min upDot to show clouds

        // === Compute sun direction from time ===
        // Time 0-24 maps to a full arc. Sun rises at 6, sets at 18.
        // Elevation: sin curve peaking at noon (12)
        const tod = this._uTimeOfDay;
        const sunAngle = tod.sub(6.0).div(12.0).mul(Math.PI); // 0 at sunrise, PI at sunset
        const sunElevation = sin(sunAngle).clamp(-0.3, 1.0);
        const sunAzimuth = tod.div(24.0).mul(Math.PI * 2.0);

        const sunDir = normalize(vec3(
            cos(sunAzimuth).mul(cos(sunAngle.clamp(0, Math.PI))),
            sunElevation,
            sin(sunAzimuth).mul(cos(sunAngle.clamp(0, Math.PI)))
        ));

        // === Fragment: sky direction ===
        const worldPos = positionLocal;
        const viewDir = normalize(worldPos);
        const upDot = viewDir.y; // -1 nadir, 0 horizon, +1 zenith

        // Day/night blend based on sun elevation
        const dayFactor = smoothstep(float(-0.1), float(0.15), sunElevation);

        // Sky gradient
        const heightFactor = smoothstep(float(-0.05), float(0.6), upDot);
        const skyDay = mix(vec3(this._uSkyBottomDay), vec3(this._uSkyTopDay), heightFactor);
        const skyNight = mix(vec3(this._uSkyBottomNight), vec3(this._uSkyTopNight), heightFactor);
        let skyColor = mix(skyNight, skyDay, dayFactor);

        // === Sunset/sunrise tint ===
        const sunsetFactor = smoothstep(float(0.0), float(0.2), sunElevation)
            .mul(smoothstep(float(0.4), float(0.15), sunElevation));
        const horizonBand = smoothstep(float(0.3), float(-0.05), abs(upDot));
        const sunsetInfluence = sunsetFactor.mul(horizonBand).mul(1.5);
        skyColor = mix(skyColor, vec3(this._uSunsetTint), sunsetInfluence);

        // === Horizon haze ===
        const hazeBand = smoothstep(float(0.15), float(-0.02), abs(upDot));
        const hazeColor = mix(vec3(this._uSkyBottomDay), vec3(1.0, 0.95, 0.88), float(0.5));
        skyColor = mix(skyColor, hazeColor, hazeBand.mul(this._uHorizonHaze).mul(dayFactor));

        // === Sun disc ===
        const sunDot = dot(viewDir, sunDir).clamp(0.0, 1.0);
        const sunDisc = smoothstep(float(1.0).sub(this._uSunSize), float(1.0), sunDot);
        const sunGlow = pow(sunDot, float(1.0).div(this._uSunGlowSize.add(0.001)).mul(8.0));
        const sunContrib = vec3(this._uSunColor).mul(sunDisc.add(sunGlow.mul(0.3)));
        const sunVisible = smoothstep(float(-0.05), float(0.05), sunElevation);
        skyColor = skyColor.add(sunContrib.mul(sunVisible));

        // === Moon glow (opposite sun) ===
        const nightFactor = float(1.0).sub(dayFactor);
        const moonDir = sunDir.negate();
        const moonDot = dot(viewDir, moonDir).clamp(0.0, 1.0);
        const moonDisc = smoothstep(float(0.995), float(1.0), moonDot);
        const moonHalo = pow(moonDot, float(64.0)).mul(0.15);
        const moonColor = vec3(0.7, 0.75, 0.9);
        skyColor = skyColor.add(moonColor.mul(moonDisc.add(moonHalo)).mul(this._uMoonGlow).mul(nightFactor));

        // === Aurora Borealis ===
        // Simulated via 3D domain warping to create overlapping, swirling ribbons
        const auroraTime = time.mul(this._uAuroraSpeed).mul(0.3);
        
        // Base 3D coordinate from view direction, scaled up to create space for swirls
        let p = viewDir.mul(4.0);
        
        // 3D Domain Warping: Swirl the coordinates heavily
        const warp1 = vec3(
            sin(p.y.add(auroraTime)),
            sin(p.z.add(auroraTime.mul(1.1))),
            sin(p.x.add(auroraTime.mul(1.2)))
        );
        p = p.add(warp1.mul(1.5));
        
        const warp2 = vec3(
            sin(p.y.mul(2.0).add(auroraTime.mul(2.0))),
            sin(p.z.mul(2.0).add(auroraTime.mul(2.1))),
            sin(p.x.mul(2.0).add(auroraTime.mul(2.2)))
        );
        p = p.add(warp2.mul(0.8));

        // Now compute azimuth from the heavily warped 3D coordinate
        const warpedAzimuth = atan(p.z, p.x);
        
        // The curtain path is defined by a sine wave on the warped coordinates
        const curtainPath = sin(p.x.mul(1.5)).add(sin(p.z.mul(1.2)));
        
        // Distance to the curtain line (using squared distance for a smooth, rounded core instead of a sharp ridge)
        const ribbonDist = curtainPath.mul(curtainPath).mul(0.5);
        
        // Massive, ultra-soft fade out to form a puffy cloud-like shape
        const curtainProfile = smoothstep(float(2.5), float(0.0), ribbonDist);

        // Vertical fade (keep it in the mid-sky, fade very softly)
        const verticalFade = smoothstep(float(-0.1), float(0.4), upDot).mul(smoothstep(float(0.9), float(0.2), upDot));

        // Very soft, wide vertical bands instead of sharp striations
        const striations1 = sin(warpedAzimuth.mul(10.0).add(auroraTime.mul(1.5)));
        const striations2 = sin(warpedAzimuth.mul(18.0).sub(auroraTime.mul(2.0)));
        // Extremely wide smoothstep for seamless, soft blending
        const striationMask = smoothstep(float(-1.5), float(1.5), striations1.add(striations2)).add(0.5); // Base of 0.5 so it never disappears

        // Density modulation (creates "puffs" or clouds of light)
        const cloudNoise1 = sin(warpedAzimuth.mul(2.0).sub(auroraTime));
        const cloudNoise2 = sin(p.x.add(auroraTime)).add(cos(p.z.sub(auroraTime.mul(0.8))));
        const ribbonDensity = smoothstep(float(-1.5), float(2.0), cloudNoise1.add(cloudNoise2)).add(0.2);
        
        // Isolate to northern sky (-Z direction) with a very slow fade
        const auroraMask = smoothstep(float(0.5), float(-0.7), viewDir.z); 
        
        // Combine all soft layers
        // Lower the base multiplier (from 3.0 to 1.2) so it's a translucent additive glow, not opaque paint
        const auroraIntensityBase = curtainProfile.mul(striationMask).mul(ribbonDensity).mul(verticalFade).mul(1.2);
        
        // Use an exponential falloff (pow) to make the edges blend perfectly into the night sky
        const auroraFinal = pow(auroraIntensityBase.mul(auroraMask).mul(this._uAuroraIntensity).mul(nightFactor), float(1.5));

        // Very soft color mixing
        const colorMixer = ribbonDist.add(striations2.mul(0.2)).clamp(0.0, 1.0);
        let auroraColor = mix(vec3(this._uAuroraColor1), vec3(this._uAuroraColor2), colorMixer);
        
        // Ground the aurora's base color by mixing it with the atmospheric night sky color
        // This prevents it from looking like a pasted-on neon sticker
        auroraColor = mix(auroraColor, skyNight, float(0.3));

        skyColor = skyColor.add(auroraColor.mul(auroraFinal));

        // === Shooting Stars ===
        // Generate random fast-moving streaks that occasionally appear
        const ssTime = time.mul(2.0); // Speed of shooting stars
        const ssCycle = fract(ssTime);
        const ssID = floor(ssTime);
        const ssHash1 = fract(sin(ssID.mul(123.45)).mul(4321.12));
        const ssHash2 = fract(sin(ssID.mul(678.90)).mul(4321.12));
        const ssHash3 = fract(sin(ssID.mul(345.67)).mul(4321.12));

        // Random start position (mostly high up) and direction (mostly downward)
        const ssStart = normalize(vec3(ssHash1.sub(0.5), ssHash2.add(0.3), ssHash3.sub(0.5)));
        const ssDir = normalize(vec3(ssHash2.sub(0.5), float(-0.5), ssHash1.sub(0.5)));

        // Position along the great circle
        const ssPos = normalize(ssStart.add(ssDir.mul(ssCycle).mul(0.8)));
        const ssDist = length(viewDir.sub(ssPos));

        // Tail position slightly behind
        const ssTailPos = normalize(ssStart.add(ssDir.mul(ssCycle.sub(0.1)).mul(0.8)));
        const ssTailDist = length(viewDir.sub(ssTailPos));

        const ssHead = smoothstep(float(0.008), float(0.001), ssDist);
        const ssTail = smoothstep(float(0.06), float(0.001), ssTailDist).mul(smoothstep(float(0.1), float(0.0), ssDist));

        // Mask by probability (density) and night time
        const ssProbability = float(1.0).sub(this._uShootingStarDensity);
        const ssActive = step(ssProbability, ssHash3).mul(nightFactor);
        const ssAlpha = ssCycle.mul(float(1.0).sub(ssCycle)).mul(4.0); // Parabola fade in/out

        skyColor = skyColor.add(vec3(1.0, 0.9, 0.8).mul(ssHead.add(ssTail.mul(0.5))).mul(ssActive).mul(ssAlpha));

        // === Procedural FBM Clouds ===
        // Project view ray onto a flat cloud plane (perspective divide onto imaginary cloud layer)
        const cloudTime = time.mul(this._uCloudSpeed);
        const cloudPlaneUV = viewDir.xz.div(viewDir.y.add(0.001));

        // Scale + drift in TWO different directions to prevent locking to any axis
        // Using irrational numbers (golden ratio derivatives) for all multipliers
        // to ensure the pattern never repeats visibly.
        const cs = this._uCloudScale;
        const ct1 = cloudTime;
        const ct2 = cloudTime.mul(0.618);   // drift layer 2 at golden-ratio speed
        const ct3 = cloudTime.mul(0.381);   // drift layer 3
        const ct4 = cloudTime.mul(1.272);   // drift layer 4 (faster small detail)

        // KEY FIX: Cross-mix u and v BEFORE feeding into sin/cos.
        // sin(u)*cos(v) is separable → grid. sin(u+v)*cos(u-v) is NOT → organic.
        const px = cloudPlaneUV.x.mul(cs);
        const py = cloudPlaneUV.y.mul(cs);

        // Octave 1 — large billowing puffs. Diagonal cross terms break the grid.
        const o1a = px.add(py.mul(0.7)).add(ct1);
        const o1b = py.sub(px.mul(0.7)).add(ct1.mul(0.8));
        const n1  = sin(o1a).add(cos(o1b)).mul(0.5);

        // Octave 2 — medium turbulence. Warped heavily by n1 and uses perpendicular drift.
        const o2a = px.mul(1.83).add(py.mul(1.41)).add(ct2).add(n1.mul(2.1));
        const o2b = py.mul(1.97).sub(px.mul(1.23)).add(ct2.mul(1.3)).sub(n1.mul(1.7));
        const n2  = sin(o2a).add(cos(o2b)).mul(0.5);

        // Octave 3 — fine detail. Cross-warped by both n1 and n2.
        const o3a = px.mul(3.71).add(py.mul(2.93)).add(ct3).add(n2.mul(1.8)).sub(n1.mul(0.9));
        const o3b = py.mul(4.13).sub(px.mul(3.57)).add(ct3.mul(1.7)).add(n1.mul(1.2)).add(n2.mul(0.7));
        const n3  = sin(o3a).add(cos(o3b)).mul(0.5);

        // Octave 4 — whispy high-frequency variation (breaks any remaining periodicity).
        const o4a = px.mul(7.23).add(py.mul(6.17)).add(ct4).add(n3.mul(2.5)).sub(n2.mul(1.1));
        const o4b = py.mul(8.31).sub(px.mul(7.91)).add(ct4.mul(0.9)).sub(n3.mul(1.5)).add(n1.mul(0.5));
        const n4  = sin(o4a).add(cos(o4b)).mul(0.5);

        // FBM: weighted sum — large shapes dominate, fine detail adds variation
        const fbm = n1.mul(0.46).add(n2.mul(0.28).add(n3.mul(0.16).add(n4.mul(0.10))));
        // Remap -1..1 → 0..1
        const cloudNoiseFBM = fbm.mul(0.5).add(0.5);

        // Coverage threshold: values above (1 - coverage) become cloud
        const threshold = float(1.0).sub(this._uCloudCoverage);
        // Soft threshold using smoothstep for wispy edges
        const cloudDensity = smoothstep(threshold, threshold.add(this._uCloudSoftness), cloudNoiseFBM);

        // Vertical fade — clouds only appear above _uCloudHeight elevation
        const cloudVerticalFade = smoothstep(this._uCloudHeight, this._uCloudHeight.add(float(0.08)), upDot);

        // Lit vs shadow: cloud tops face sun (sunElevation > 0 = daytime)
        // Shadow on underside when sun is low
        const sunLit = smoothstep(float(0.0), float(0.3), sunElevation);
        const cloudLitColor: any  = mix(vec3(this._uCloudShadowColor), vec3(this._uCloudColor), sunLit);

        // At sunset tint clouds orange-pink
        const cloudSunsetTint: any = mix(cloudLitColor, vec3(this._uSunsetTint).mul(1.2), sunsetFactor.mul(0.5));

        // Night clouds are dark grey
        const cloudNightColor = vec3(0.12, 0.14, 0.18);
        const finalCloudColor: any = mix(cloudNightColor, cloudSunsetTint, dayFactor);

        // Only show clouds in daytime / twilight (fade out at night)
        const cloudVisibility = cloudDensity.mul(cloudVerticalFade).mul(dayFactor.mul(0.85).add(0.15));

        skyColor = mix(skyColor, finalCloudColor, cloudVisibility);

        // === Material ===
        this.skyMat = new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        this.skyMat.colorNode = skyColor;

        this.skyMesh = new THREE.Mesh(geo, this.skyMat);
        this.skyMesh.renderOrder = -1000;
        this.skyMesh.frustumCulled = false;
    }

    _buildStars() {
        const starCount = 4000;
        const geo = new THREE.BufferGeometry();
        const posArray = new Float32Array(starCount * 3);
        const sizeArray = new Float32Array(starCount);
        const phaseArray = new Float32Array(starCount);
        const colorArray = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            // Random point on sphere
            const u = Math.random();
            const v = Math.random();
            const theta = u * 2.0 * Math.PI;
            const phi = Math.acos(2.0 * v - 1.0);
            
            // Push stars far away
            const r = 11000;
            
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            posArray[i*3] = x;
            posArray[i*3+1] = y;
            posArray[i*3+2] = z;

            // Random size 1.0 to 3.0
            sizeArray[i] = 1.0 + Math.random() * 2.0;

            // Random twinkle phase
            phaseArray[i] = Math.random() * Math.PI * 2.0;

            // Slight color variation (white/blue/orange)
            const type = Math.random();
            if (type > 0.8) {
                // Blueish
                colorArray[i*3] = 0.8;
                colorArray[i*3+1] = 0.9;
                colorArray[i*3+2] = 1.0;
            } else if (type > 0.6) {
                // Warm
                colorArray[i*3] = 1.0;
                colorArray[i*3+1] = 0.9;
                colorArray[i*3+2] = 0.8;
            } else {
                // White
                colorArray[i*3] = 1.0;
                colorArray[i*3+1] = 1.0;
                colorArray[i*3+2] = 1.0;
            }
        }

        geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(sizeArray, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phaseArray, 1));
        geo.setAttribute('aColor', new THREE.BufferAttribute(colorArray, 3));

        const aSize = attribute('aSize', 'float');
        const aPhase = attribute('aPhase', 'float');
        const aColor = attribute('aColor', 'vec3');

        // Twinkle factor based on time and phase
        const twinkle = sin(time.mul(2.0).add(aPhase)).mul(0.3).add(0.7);

        this.starsMat = new THREE.PointsNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false
        });

        // The overall opacity will be multiplied by the nightFactor in the update loop via a uniform
        // but since TSL is used, let's just make the color node dynamic.
        
        // Compute sun elevation dynamically here as well
        const tod = this._uTimeOfDay;
        const sunAngle = tod.sub(6.0).div(12.0).mul(Math.PI);
        const sunElevation = sin(sunAngle).clamp(-0.3, 1.0);
        const dayFactor = smoothstep(float(-0.1), float(0.15), sunElevation);
        const nightFactorNode = float(1.0).sub(dayFactor);
        
        // Fade out below horizon
        const worldPos = positionGeometry;
        const viewDir = normalize(worldPos);
        const upDot = viewDir.y;
        const aboveHorizon = smoothstep(float(0.0), float(0.1), upDot);

        // Density threshold (if uStarDensity is 2000, we show 50% of 4000)
        // Wait, it's easier to just use standard point sizes.
        
        this.starsMat.colorNode = vec4(
            aColor.mul(twinkle).mul(this._uStarBrightness), 
            nightFactorNode.mul(aboveHorizon)
        );

        // Size node
        this.starsMat.sizeNode = aSize.mul(10.0); // Size multiplier

        this.starsMesh = new THREE.Points(geo, this.starsMat);
        this.starsMesh.renderOrder = -900;
        this.starsMesh.frustumCulled = false;
    }

    _registerUI() {
        const ui = this.core.debugUI;
        if (ui) {
            ui.registerPlugin('Sky', '🌤️', '#5af', {
                category: 'Rendering',
                onEnable: () => { 
                    if (this.skyMesh) this.skyMesh.visible = true; 
                    if (this.starsMesh) this.starsMesh.visible = true;
                },
                onDisable: () => { 
                    if (this.skyMesh) this.skyMesh.visible = false; 
                    if (this.starsMesh) this.starsMesh.visible = false;
                }
            });
        }

        // ── Time of Day ──
        ui.addSection('Sky', '🕐 Time of Day', '#fc8');
        ui.addSlider('Sky', 'timeOfDay', 'Hour', 0, 24, 0.25, 10, 'Current time of day (0=midnight, 12=noon, 18=sunset).', (val: number) => {
            if (this._uTimeOfDay) this._uTimeOfDay.value = val;
        });
        ui.addSlider('Sky', 'cycleSpeed', 'Cycle Speed', 0.0, 5.0, 0.1, 0.0, 'Auto-advance speed. 0=paused, 1=1hr per real minute.', (val: number) => {
            if (this._uCycleSpeed) this._uCycleSpeed.value = val;
        });
        ui.addToggle('Sky', 'autoRotate', 'Auto Cycle', false, 'Enable automatic day/night cycle.', (val: boolean) => {
            this._uAutoRotate = val;
        });

        // ── Sky Colors ──
        ui.addSection('Sky', '🎨 Sky Colors', '#8cf');
        ui.addColor('Sky', 'skyTopDay', 'Zenith Day', '#2e66d9', 'Top of sky during daytime.', (hex: string) => {
            if (this._uSkyTopDay) this._uSkyTopDay.value.set(hex);
        });
        ui.addColor('Sky', 'skyBottomDay', 'Horizon Day', '#a6c7eb', 'Horizon color during daytime.', (hex: string) => {
            if (this._uSkyBottomDay) this._uSkyBottomDay.value.set(hex);
        });
        ui.addColor('Sky', 'skyTopNight', 'Zenith Night', '#03030a', 'Top of sky at night.', (hex: string) => {
            if (this._uSkyTopNight) this._uSkyTopNight.value.set(hex);
        });
        ui.addColor('Sky', 'skyBottomNight', 'Horizon Night', '#050814', 'Horizon color at night.', (hex: string) => {
            if (this._uSkyBottomNight) this._uSkyBottomNight.value.set(hex);
        });
        ui.addColor('Sky', 'sunsetTint', 'Sunset Tint', '#ff7326', 'Color of the sunrise/sunset glow.', (hex: string) => {
            if (this._uSunsetTint) this._uSunsetTint.value.set(hex);
        });
        ui.addSlider('Sky', 'horizonHaze', 'Horizon Haze', 0.0, 1.0, 0.05, 0.3, 'Atmospheric haze at the horizon.', (val: number) => {
            if (this._uHorizonHaze) this._uHorizonHaze.value = val;
        });

        // ── Sun ──
        ui.addSection('Sky', '☀️ Sun', '#ff8');
        ui.addColor('Sky', 'sunColor', 'Sun Color', '#fff2cc', 'Color of the sun disc.', (hex: string) => {
            if (this._uSunColor) this._uSunColor.value.set(hex);
        });
        ui.addSlider('Sky', 'sunSize', 'Disc Size', 0.01, 0.1, 0.005, 0.04, 'Angular size of the sun disc.', (val: number) => {
            if (this._uSunSize) this._uSunSize.value = val;
        });
        ui.addSlider('Sky', 'sunGlowSize', 'Glow Size', 0.02, 0.5, 0.01, 0.15, 'Atmospheric glow around the sun.', (val: number) => {
            if (this._uSunGlowSize) this._uSunGlowSize.value = val;
        });

        // ── Night ──
        ui.addSection('Sky', '🌙 Night', '#88f');
        ui.addSlider('Sky', 'starBrightness', 'Star Brightness', 0.0, 3.0, 0.1, 1.0, 'Brightness of the star field.', (val: number) => {
            if (this._uStarBrightness) this._uStarBrightness.value = val;
        });
        ui.addSlider('Sky', 'shootingStarDensity', 'Shooting Stars', 0.0, 1.0, 0.05, 0.5, 'Frequency of shooting stars.', (val: number) => {
            if (this._uShootingStarDensity) this._uShootingStarDensity.value = val;
        });
        ui.addSlider('Sky', 'moonGlow', 'Moon Glow', 0.0, 2.0, 0.1, 0.6, 'Intensity of the moon disc and halo.', (val: number) => {
            if (this._uMoonGlow) this._uMoonGlow.value = val;
        });

        // ── Aurora Borealis ──
        ui.addSection('Sky', '✨ Aurora Borealis', '#a5f');
        ui.addSlider('Sky', 'auroraIntensity', 'Intensity', 0.0, 5.0, 0.1, 1.0, 'Brightness of the northern lights.', (val: number) => {
            if (this._uAuroraIntensity) this._uAuroraIntensity.value = val;
        });
        ui.addSlider('Sky', 'auroraSpeed', 'Speed', 0.0, 5.0, 0.1, 1.0, 'Animation speed of the aurora waves.', (val: number) => {
            if (this._uAuroraSpeed) this._uAuroraSpeed.value = val;
        });
        ui.addColor('Sky', 'auroraColor1', 'Color 1', '#1aff80', 'Primary aurora color.', (hex: string) => {
            if (this._uAuroraColor1) this._uAuroraColor1.value.set(hex);
        });
        ui.addColor('Sky', 'auroraColor2', 'Color 2', '#9933ff', 'Secondary aurora color.', (hex: string) => {
            if (this._uAuroraColor2) this._uAuroraColor2.value.set(hex);
        });

        // ── Clouds ──
        ui.addSection('Sky', '☁️ Clouds', '#ddf');
        ui.addSlider('Sky', 'cloudCoverage', 'Coverage', 0.0, 1.0, 0.02, 0.45, 'How much of the sky is covered (0=clear, 1=overcast).', (val: number) => {
            if (this._uCloudCoverage) this._uCloudCoverage.value = val;
        });
        ui.addSlider('Sky', 'cloudSoftness', 'Softness', 0.05, 0.8, 0.05, 0.35, 'Edge feathering — higher = wispier.', (val: number) => {
            if (this._uCloudSoftness) this._uCloudSoftness.value = val;
        });
        ui.addSlider('Sky', 'cloudScale', 'Scale', 1.0, 10.0, 0.25, 3.5, 'Size of cloud puffs — lower = larger clouds.', (val: number) => {
            if (this._uCloudScale) this._uCloudScale.value = val;
        });
        ui.addSlider('Sky', 'cloudSpeed', 'Speed', 0.0, 0.5, 0.005, 0.06, 'Cloud scrolling speed.', (val: number) => {
            if (this._uCloudSpeed) this._uCloudSpeed.value = val;
        });
        ui.addSlider('Sky', 'cloudHeight', 'Min Elevation', 0.0, 0.4, 0.02, 0.12, 'Minimum sky elevation for cloud layer.', (val: number) => {
            if (this._uCloudHeight) this._uCloudHeight.value = val;
        });
        ui.addColor('Sky', 'cloudColor', 'Cloud Top', '#ffffff', 'Lit cloud top color.', (hex: string) => {
            if (this._uCloudColor) this._uCloudColor.value.set(hex);
        });
        ui.addColor('Sky', 'cloudShadow', 'Cloud Shadow', '#99a6b8', 'Cloud underside shadow color.', (hex: string) => {
            if (this._uCloudShadowColor) this._uCloudShadowColor.value.set(hex);
        });
        ui.addSlider('Sky', 'cloudGroundShadow', 'Ground Shadow', 0.0, 0.8, 0.05, 0.35, 'Strength of cloud shadows cast on terrain.', (val: number) => {
            if (this.core.cloudShadowUniforms) this.core.cloudShadowUniforms.strength.value = val;
        });

        // ── Readouts ──
        ui.addSection('Sky', '📊 Info', '#556');
        this._timeReadout = ui.addReadout('Sky', 'Time');
        this._phaseReadout = ui.addReadout('Sky', 'Phase');
    }

    _getPhase(tod: number): string {
        if (tod < 5) return '🌙 Night';
        if (tod < 6.5) return '🌅 Dawn';
        if (tod < 8) return '🌄 Morning';
        if (tod < 11) return '☀️ Late Morning';
        if (tod < 13) return '☀️ Noon';
        if (tod < 16) return '☀️ Afternoon';
        if (tod < 17.5) return '🌇 Golden Hour';
        if (tod < 19) return '🌆 Dusk';
        if (tod < 20.5) return '🌃 Twilight';
        return '🌙 Night';
    }

    _formatTime(tod: number): string {
        const h = Math.floor(tod) % 24;
        const m = Math.floor((tod % 1) * 60);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
    }

    update(deltaTime: number) {
        // Auto-cycle time
        if (this._uAutoRotate && this._uCycleSpeed.value > 0) {
            // cycleSpeed 1.0 = 1 hour per real minute = 1/60 hour per second
            let tod = this._uTimeOfDay.value + (this._uCycleSpeed.value / 60.0) * deltaTime;
            if (tod > 24) tod -= 24;
            this._uTimeOfDay.value = tod;
        }

        const tod = this._uTimeOfDay.value;

        // Sync directional light to sun position
        const sun = this.core.lightingSystem?.sunLight;
        if (sun) {
            const sunAngle = (tod - 6) / 12 * Math.PI;
            const elevation = Math.sin(sunAngle);
            const azimuth = (tod / 24) * Math.PI * 2;

            const dist = 2000;
            const isNight = elevation < 0;
            
            let lightElevation = elevation;
            let lightAzimuth = azimuth;

            if (isNight) {
                // Moon is diametrically opposed to the sun
                lightElevation = -elevation;
                lightAzimuth = (azimuth + Math.PI) % (Math.PI * 2);
            }

            // Match the sky shader's signed sun direction exactly. Using
            // sqrt(1 - elevation^2) here mirrored the light direction after noon.
            const signedHorizonRadius = Math.cos(((tod - 6) / 12 * Math.PI)) * dist;
            
            // The sun rotates globally around the origin.
            // CSMPlugin natively handles snapping the shadow frustums to the camera.
            sun.position.set(
                Math.cos(lightAzimuth) * signedHorizonRadius,
                Math.max(lightElevation, 0.05) * dist,
                Math.sin(lightAzimuth) * signedHorizonRadius
            );
            sun.target.position.set(0, 0, 0);
            sun.target.updateMatrixWorld();

            // Day factor for blending
            const dayFactor = Math.max(0, Math.min(1, (elevation + 0.1) / 0.25));

            if (isNight) {
                // Moonlight (cool blue)
                sun.intensity = 0.3; // Much dimmer than the sun, but enough to cast shadows
                sun.color.setRGB(0.4, 0.5, 0.8);
            } else {
                // Sunlight
                sun.intensity = THREE.MathUtils.lerp(0.05, 3.0, dayFactor);
                
                // Warm color during sunset/sunrise
                const sunsetFactor = Math.max(0, 1 - Math.abs(elevation - 0.1) / 0.2);
                const r = 1.0;
                const g = THREE.MathUtils.lerp(0.95, 0.6, sunsetFactor);
                const b = THREE.MathUtils.lerp(0.8, 0.3, sunsetFactor);
                sun.color.setRGB(r, g, b);
            }
        }

        // Sync scene background to match (fade to dark)
        const sunAngle = (tod - 6) / 12 * Math.PI;
        const elevation = Math.sin(sunAngle);
        const dayFactor = Math.max(0, Math.min(1, (elevation + 0.1) / 0.25));
        
        // Ambient light — use cached reference, no traverse needed
        if (this._ambientLight) {
            this._ambientLight.intensity = THREE.MathUtils.lerp(0.15, 0.4, dayFactor);
            const nightR = 0.15, nightG = 0.18, nightB = 0.35;
            const dayR = 0.53, dayG = 0.6, dayB = 0.73;
            this._ambientLight.color.setRGB(
                THREE.MathUtils.lerp(nightR, dayR, dayFactor),
                THREE.MathUtils.lerp(nightG, dayG, dayFactor),
                THREE.MathUtils.lerp(nightB, dayB, dayFactor)
            );
        }

        // Scene background
        if (this.core.scene.background && this.core.scene.background.isColor) {
            this.core.scene.background.setRGB(
                THREE.MathUtils.lerp(0.01, 0.53, dayFactor),
                THREE.MathUtils.lerp(0.01, 0.6, dayFactor),
                THREE.MathUtils.lerp(0.04, 0.73, dayFactor)
            );
        }

        // Sky dome follows camera
        if (this.skyMesh) {
            this.skyMesh.position.copy(this.core.camera.position);
        }
        if (this.starsMesh) {
            this.starsMesh.position.copy(this.core.camera.position);
            // Slowly rotate stars over time
            this.starsMesh.rotation.y = tod * 0.01;
            this.starsMesh.rotation.z = tod * 0.005;
        }

        // Readouts
        if (this._timeReadout) this._timeReadout.textContent = this._formatTime(tod);
        if (this._phaseReadout) this._phaseReadout.textContent = this._getPhase(tod);
    }

    dispose() {
        if (this.skyMesh) {
            this.core.scene.remove(this.skyMesh);
            this.skyMesh.geometry.dispose();
            this.skyMat.dispose();
            this.skyMesh = null;
        }
        if (this.starsMesh) {
            this.core.scene.remove(this.starsMesh);
            this.starsMesh.geometry.dispose();
            this.starsMat.dispose();
            this.starsMesh = null;
        }
    }
}
