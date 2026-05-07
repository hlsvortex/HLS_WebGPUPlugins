@group(0) @binding(0) var biomeTex : texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var linearSampler : sampler;
@group(0) @binding(3) var<uniform> settings : TerrainSettings;

struct TerrainSettings {
  terracingStrength: f32,
  blurRadius: f32,
  detailAmp: f32,
  cliffStrength: f32,
  riverCarving: f32,
  underwaterSuppress: f32,
  coastPV: f32,
  powerCurve: f32,
  baseOffset: f32,
  procHMult: f32,
  procHBase: f32,
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
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(biomeTex);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let size = vec2<f32>(dims);
  let uv = vec2<f32>(id.xy) / size;

  let heightSample = textureSampleLevel(heightTex, linearSampler, uv, 0.0);
  let h = heightSample.r;
  let flow = heightSample.g;
  let regionId = heightSample.b;
  let isLand = heightSample.a;

  let seaLevel = 0.333; // Normalized sea level (= Y 0 in world space after h*1200-400)
  let moisture = noise(uv * 7.0 + vec2<f32>(300.0, 400.0));
  // tempBase relative to sea level: temperature drops as land rises above water
  let tempBase = clamp(1.0 - (h - seaLevel) * 2.2 + (1.0 - uv.y) * 0.4, 0.0, 1.0);


  // 10-Biome Classification
  // 0.0 = Ocean
  // 0.1 = Beach
  // 0.2 = Grasslands
  // 0.3 = Temperate Forest
  // 0.4 = Pine Forest
  // 0.5 = Redwood Forest
  // 0.6 = Jungle
  // 0.7 = Swamp
  // 0.8 = Mountains
  // 0.9 = Snow / Tundra
  // 1.0 = Volcano (already handled via height/center in TSL, but we can pass it)

  var biomeId = 0.0; // Ocean
  var vegetation = 0.0;
  var rock = 0.0;
  var sand = 0.0;

  if (h < seaLevel) {
    // True Ocean Floor (Seabed)
    biomeId = 0.0;
    sand = 1.0;
    vegetation = 0.0;
    rock = 0.0;
  } else {
    // Landmass
    // Beach: seaLevel to seaLevel+0.08 (h 0.333–0.413, ≈ Y 0–96)
    // Covers land base offset (+0.025 → h≈0.358) without bleeding into grasslands
    if (h < seaLevel + settings.beachThreshold) {
      biomeId = 0.1;
      sand = 1.0;
      vegetation = 0.0;
    } else if (regionId > 0.25 && regionId < 0.35) {
      // Hardcoded Swamp region from CPU Macro
      biomeId = 0.7; // Swamp
      vegetation = 1.0;
      sand = 0.0;
    } else if (regionId > 0.15 && regionId < 0.25) {
      // Hardcoded Redwood region from CPU Macro
      biomeId = 0.5; // Redwoods
      vegetation = 1.0;
      rock = 0.3;
    } else if (regionId > 0.05 && regionId < 0.15) {
      // Hardcoded Snow region from CPU Macro
      if (h > settings.snowThreshold) {
          biomeId = 0.9; // Snow Peak (≈ Y 344)
          rock = 0.9;
      } else {
          biomeId = 0.4; // Pine Forest (Snow Foothills)
          vegetation = 0.8;
          rock = 0.2;
      }
    } else if (h > settings.mountainThreshold) {
      // Mountains / Volcano depending on distance from center (≈ Y 440+)
      let distCenter = length(uv - vec2(0.35, 0.45));
      if (distCenter < 0.1) {
          biomeId = 1.0; // Volcano
          rock = 1.0;
      } else {
          biomeId = 0.8; // Mountains
          rock = 0.8;
          vegetation = 0.1;
      }
    } else if (moisture > settings.moistureThreshold) {
      // High Moisture — tempBase > 0.55 = warm (Jungle), else cool (Temperate Forest)
      if (tempBase > 0.55) {
          biomeId = 0.6; // Jungle
          vegetation = 1.0;
          rock = 0.1;
      } else {
          biomeId = 0.3; // Temperate Forest
          vegetation = 0.85;
          rock = 0.1;
      }
    } else {
      // Low Moisture
      biomeId = 0.2; // Grasslands
      vegetation = 0.6;
      rock = 0.05;
    }
  }

  textureStore(biomeTex, vec2<i32>(id.xy), vec4<f32>(vegetation, rock, sand, biomeId));
}
