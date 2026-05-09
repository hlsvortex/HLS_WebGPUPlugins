@group(0) @binding(0) var srcHeightTex : texture_2d<f32>;
@group(0) @binding(1) var dstHeightTex : texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> settings : TerrainSettings;

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
  terraceSteps: f32,
  terraceSoftness: f32,
  terraceNoiseAmp: f32,
  terrainBandingFix: f32,
};

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(srcHeightTex);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(id.xy);
  let center = textureLoad(srcHeightTex, coord, 0);
  let centerH = center.r;
  let strength = clamp(settings.terrainBandingFix, 0.0, 1.0);

  if (strength <= 0.001) {
    textureStore(dstHeightTex, coord, center);
    return;
  }

  let radius = i32(round(mix(1.0, 8.0, strength)));
  let edgeThreshold = mix(0.010, 0.180, strength);
  let edgeRelax = smoothstep(0.35, 0.95, strength);
  let sigma = max(f32(radius) * 0.55, 1.0);

  var sumH = 0.0;
  var sumWeight = 0.0;

  for (var y = -8; y <= 8; y++) {
    for (var x = -8; x <= 8; x++) {
      if (abs(x) > radius || abs(y) > radius) {
        continue;
      }

      let sampleCoord = clamp(coord + vec2<i32>(x, y), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let sample = textureLoad(srcHeightTex, sampleCoord, 0);
      let spatial = exp(-f32(x * x + y * y) / (2.0 * sigma * sigma));
      let heightDelta = abs(sample.r - centerH);
      let bilateralWeight = smoothstep(edgeThreshold, 0.0, heightDelta);
      let edgeWeight = mix(bilateralWeight, 1.0, edgeRelax);
      let landWeight = mix(0.15, 1.0, 1.0 - abs(sample.a - center.a));
      let weight = spatial * edgeWeight * landWeight;

      sumH += sample.r * weight;
      sumWeight += weight;
    }
  }

  let blurredH = select(centerH, sumH / sumWeight, sumWeight > 0.0001);
  let finalH = mix(centerH, blurredH, strength);

  textureStore(dstHeightTex, coord, vec4<f32>(finalH, center.g, center.b, center.a));
}
