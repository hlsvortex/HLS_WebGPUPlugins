@group(0) @binding(0) var spawnTex : texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var biomeTex : texture_2d<f32>;
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
  terraceSteps: f32,
  terraceSoftness: f32,
  terraceNoiseAmp: f32,
  terrainBandingFix: f32,
};

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(spawnTex);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let size = vec2<f32>(dims);
  let uv = vec2<f32>(id.xy) / size;

  let biome = textureSampleLevel(biomeTex, linearSampler, uv, 0.0);
  
  // Biome ID is stored in the Alpha channel (10 biomes)
  let biomeId = biome.a;

  var predators = 0.0;     // R
  var herbivores = 0.0;    // G
  var flying = 0.0;        // B
  var foliage = 0.0;       // A

  if (biomeId < 0.05) { 
      // 0.0 Ocean
      predators = 0.8;     // Megalodons
      herbivores = 0.5;    // Coels
      flying = 0.0;
      foliage = 0.5;       // Kelp density
  } else if (biomeId < 0.15) { 
      // 0.1 Beach / Coast
      predators = 0.1;     // Dilos
      herbivores = 0.3;    // Dodos, Turtles
      flying = 0.5;        // Pteranodons
      foliage = settings.densityBeach;       // Palm trees, shrubs
  } else if (biomeId < 0.25) { 
      // 0.2 Grasslands
      predators = 0.3;
      herbivores = 0.8;
      flying = 0.2;
      foliage = settings.densityGrass;       // Widespread grass/isolated trees
  } else if (biomeId < 0.35) { 
      // 0.3 Temperate Forest
      predators = 0.5;
      herbivores = 0.7;
      flying = 0.4;
      foliage = settings.densityForest;
  } else if (biomeId < 0.45) { 
      // 0.4 Pine Forest
      predators = 0.6;
      herbivores = 0.5;
      flying = 0.2;
      foliage = settings.densityPine;       // Dense pines
  } else if (biomeId < 0.55) { 
      // 0.5 Redwood / Giant Trees
      predators = 0.6;
      herbivores = 0.6;
      flying = 0.8;        // Tapejaras / Tree-climbers
      foliage = settings.densityRedwood;       // Massive trunks
  } else if (biomeId < 0.65) { 
      // 0.6 Jungle
      predators = 0.7;     // Ambush predators
      herbivores = 0.6;
      flying = 0.5;
      foliage = settings.densityJungle;       // Extreme density
  } else if (biomeId < 0.75) { 
      // 0.7 Swamp
      predators = 0.6;     // Sarcos, Kapros
      herbivores = 0.4;    // Phiomias
      flying = 0.5;        // Meganeura (Insects)
      foliage = settings.densitySwamp;       // Mangroves
  } else if (biomeId < 0.85) { 
      // 0.8 Mountains
      predators = 0.7;     // Rexes, Argies
      herbivores = 0.3;    // Ankys
      flying = 0.6;
      foliage = settings.densityMountain;       // Sparse trees, lots of rocks
  } else if (biomeId < 0.95) { 
      // 0.9 Snow / Tundra
      predators = 0.5;     // Direwolves
      herbivores = 0.3;    // Mammoths
      flying = 0.1;
      foliage = settings.densitySnow;       // Sparse dead trees
  } else { 
      // 1.0 Volcano
      predators = 0.8;     // Extreme danger
      herbivores = 0.0;
      flying = 0.4;
      foliage = 0.05;      // Charred wood
  }

  textureStore(spawnTex, vec2<i32>(id.xy),
    vec4<f32>(predators, herbivores, flying, foliage));
}
