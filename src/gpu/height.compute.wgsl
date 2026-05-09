@group(0) @binding(0) var heightTex : texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var riverMapTex : texture_2d<f32>;
@group(0) @binding(2) var linearSampler : sampler;
@group(0) @binding(3) var<uniform> settings : TerrainSettings;
struct TerrainSettings {
  terracingStrength: f32,   // 0 = off, 0.9 = current default
  blurRadius: f32,          // 0 = no blur, 2 = current (5x5)
  detailAmp: f32,           // multiplier on grit detail (1.0 = default)
  cliffStrength: f32,       // multiplier on cliff/ridge noise (1.0 = default)
  riverCarving: f32,        // 0 = off, 1.0 = default carving strength
  underwaterSuppress: f32,  // 0 = off, 1.0 = default suppression
  coastPV: f32,             // e.g. 0.20
  powerCurve: f32,          // e.g. 1.3
  baseOffset: f32,          // e.g. 0.05
  procHMult: f32,           // e.g. 0.80
  procHBase: f32,           // e.g. 0.01
  beachThreshold: f32,
  snowThreshold: f32,
  mountainThreshold: f32,
  moistureThreshold: f32,
  riverFalloff: f32,
  baseOffsetFalloff: f32,
  beachFlatness: f32,
  densityBeach: f32,
  densityGrass: f32,
  densityForest: f32,
  densityPine: f32,
  densityRedwood: f32,
  densityJungle: f32,
  densitySwamp: f32,
  densityMountain: f32,
  densitySnow: f32,
  beachShelfFalloff: f32,
  terraceSteps: f32,
  terraceSoftness: f32,
  terraceNoiseAmp: f32,
  terrainBandingFix: f32,
};

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < octaves; i++) {
    value += noise(pos * frequency) * amplitude;
    frequency *= 2.0;
    amplitude *= 0.5;
    pos = vec2<f32>(
      pos.x * 0.866 - pos.y * 0.5 + 1.7,
      pos.x * 0.5 + pos.y * 0.866 + 3.2
    );
  }
  return value;
}

fn ridged_fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < octaves; i++) {
    // Invert the absolute noise to sharply point peaks while aggressively flattening valleys
    let n = 1.0 - abs(noise(pos * frequency) * 2.0 - 1.0);
    value += (n * n) * amplitude; // Exponential shear guarantees harsh, distinct ridges!
    frequency *= 2.0;
    amplitude *= 0.5;
    pos = vec2<f32>(
      pos.x * 0.866 - pos.y * 0.5 + 1.7,
      pos.x * 0.5 + pos.y * 0.866 + 3.2
    );
  }
  return value;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(heightTex);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let size = vec2<f32>(dims);
  let uv = vec2<f32>(id.xy) / size;

  // Load the macroscopic river/island graph with configurable blur radius.
  // blurRadius: 0 = no blur (raw pixels), 1 = 3x3, 2 = 5x5 (default)
  var pixelVal: f32 = 0.0;
  var flow: f32 = 0.0;
  var procH: f32 = 0.0;
  var regionId: f32 = 0.0;
  
  let blurR = i32(settings.blurRadius);
  var sampleCount: f32 = 0.0;
  for(var dy: i32 = -blurR; dy <= blurR; dy++) {
      for(var dx: i32 = -blurR; dx <= blurR; dx++) {
          let cX = clamp(i32(id.x) + dx, 0, i32(dims.x) - 1);
          let cY = clamp(i32(id.y) + dy, 0, i32(dims.y) - 1);
          let raw = textureLoad(riverMapTex, vec2<i32>(cX, cY), 0);
          pixelVal += raw.r;
          flow += raw.g;
          procH += raw.b;
          regionId += raw.a;
          sampleCount += 1.0;
      }
  }
  pixelVal /= sampleCount;
  flow /= sampleCount;
  procH /= sampleCount;
  regionId /= sampleCount;

  // If no graph data here (ocean outside bounds), flatten
  if (pixelVal < 0.001) {
      textureStore(heightTex, vec2<i32>(id.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
      return;
  }

  // Sea level logic
  let seaLevel = 0.333;
  var baseH: f32 = 0.0;

  // --- GPU HEIGHT FORMULA (Real-time!) ---
  if (pixelVal < settings.coastPV - settings.baseOffsetFalloff) {
      baseH = (pixelVal / settings.coastPV) * seaLevel;
  } else {
      let landNorm = clamp((pixelVal - settings.coastPV) / (1.0 - settings.coastPV), 0.0, 1.0);
      let curved = pow(landNorm, settings.powerCurve);
      let targetH = seaLevel + settings.baseOffset + curved * (procH * settings.procHMult + settings.procHBase);
      
      // Smoothly blend the cliff at the coast if falloff is > 0
      if (settings.baseOffsetFalloff > 0.001) {
          let coastBlend = smoothstep(settings.coastPV - settings.baseOffsetFalloff, settings.coastPV + settings.baseOffsetFalloff, pixelVal);
          let oceanH = (pixelVal / settings.coastPV) * seaLevel;
          baseH = mix(oceanH, targetH, coastBlend);
      } else {
          baseH = targetH;
      }
      
      // Beach Shelf Flattening
      if (settings.beachFlatness > 0.01) {
          let flatShelf = seaLevel + settings.baseOffset;
          let elevationAboveSeaLevel = baseH - flatShelf;
          // Only flatten terrain that is actually above the base offset (don't flatten the cliff dropping into the ocean)
          if (elevationAboveSeaLevel > 0.0) {
              // beachFlatness determines how far inland the perfectly flat shelf extends
              let shelfEnd = settings.beachThreshold * settings.beachFlatness;
              
              // beachShelfFalloff determines how wide the slope is that connects the shelf back up to the mountains
              // Default is small to match previous sharp transition, larger values create massive gentle grassy slopes
              let falloffRange = max(0.001, settings.beachShelfFalloff);
              
              let shelfMask = 1.0 - smoothstep(shelfEnd, shelfEnd + falloffRange, elevationAboveSeaLevel);
              baseH = mix(baseH, flatShelf, shelfMask);
          }
      }
  }

  // Micro-Detail Pass (scaled by settings.detailAmp)
  let detailScale = settings.detailAmp;
  let macroGrit = fbm(uv * 30.0 + vec2<f32>(10.0, 20.0), 3) * 0.006 * detailScale;
  let microGrit = fbm(uv * 150.0, 2) * 0.002 * detailScale;
  
  // STRATA TERRACING (controlled by settings.terracingStrength, 0 = off)
  if (settings.terracingStrength > 0.01) {
      let terraceNoise = fbm(uv * 12.0, 3) * settings.terraceNoiseAmp;
      let tBase = baseH + terraceNoise;
      let terraceSteps = max(2.0, settings.terraceSteps);
      let t = tBase * terraceSteps;
      let tFloor = floor(t);
      let tFract = fract(t);
      let terraceHalfWidth = clamp(settings.terraceSoftness, 0.02, 0.5);
      let terraceBlend = smoothstep(0.5 - terraceHalfWidth, 0.5 + terraceHalfWidth, tFract);
      let terracedH = (tFloor + terraceBlend) / terraceSteps;
      let terraceMask = smoothstep(0.35, 0.75, baseH);
      baseH = mix(baseH, terracedH, terraceMask * settings.terracingStrength);
  }
  
  let grit = macroGrit + microGrit;
  
  // Jagged rocky peaks (scaled by settings.cliffStrength)
  let cliffNoise = ridged_fbm(uv * 15.0 + vec2<f32>(50.0, 100.0), 5) * 0.05 * settings.cliffStrength;
  let mountainMask = smoothstep(0.55, 0.90, baseH);
  
  // Combine detail
  var detail = mix(grit, cliffNoise, mountainMask);

  // River/Valley Smoothing
  let valleySmooth = smoothstep(0.0, 0.4, flow);
  detail = detail * (1.0 - valleySmooth);

  // Underwater suppression (controlled by settings.underwaterSuppress)
  if (settings.underwaterSuppress > 0.01) {
      let underwaterSmooth = smoothstep(0.30, 0.36, baseH);
      detail = detail * mix(1.0, underwaterSmooth, settings.underwaterSuppress);
  }

  var finalH = baseH + detail;

  // Sea level logic (already defined above as 0.333)

  // --- RIVER CARVING (post-process, controlled by settings.riverCarving) ---
  if (settings.riverCarving > 0.01 && flow > 0.05) {
      let riverFloor = seaLevel - 0.04;
      // Use riverFalloff to control the smoothness of the river banks
      let edgeStart = max(0.0, 0.5 - settings.riverFalloff);
      let edgeEnd = min(1.0, 0.5 + settings.riverFalloff);
      let riverStrength = smoothstep(edgeStart, edgeEnd, flow) * settings.riverCarving;
      finalH = mix(finalH, riverFloor, riverStrength);
  }

  finalH = clamp(finalH, 0.0, 1.0);
  
  let isLand = step(seaLevel - 0.005, finalH);

  // Pack data: R = Height, G = Flow, B = RegionId, A = Mask (IsLand)
  textureStore(heightTex, vec2<i32>(id.xy), vec4<f32>(finalH, flow, regionId, isLand));
}
