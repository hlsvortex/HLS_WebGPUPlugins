// voxel_density.compute.wgsl — Generates 3D cave density into a flat storage buffer.
//
// Dispatched as (8, 8, 8) workgroups over a 32×32×32 volume.
// Each thread writes one voxel: density > 0 = solid, < 0 = air.
//
// Uniforms:
//   chunkOrigin — world-space XYZ of this chunk's (0,0,0) corner
//   seed        — randomises the noise field per world seed
//   caveScale   — controls cave frequency (higher = more tunnels)
//   caveThreshold — iso-level offset (higher = more open caves)

struct Params {
    chunkOrigin: vec3<f32>,
    seed: f32,
    caveScale: f32,
    caveThreshold: f32,
    voxelScale: f32,
    gridSize: u32,
};

@group(0) @binding(0) var<storage, read_write> densityOut: array<f32>;
@group(0) @binding(1) var<storage, read_write> materialOut: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

// ─── 3D Noise (value noise, same style as height.compute.wgsl) ──────
fn hash3(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 54.53))) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));

    let x00 = mix(n000, n100, u.x);
    let x10 = mix(n010, n110, u.x);
    let x01 = mix(n001, n101, u.x);
    let x11 = mix(n011, n111, u.x);

    let y0 = mix(x00, x10, u.y);
    let y1 = mix(x01, x11, u.y);

    return mix(y0, y1, u.z);
}

fn fbm3(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;

    for (var i = 0; i < octaves; i++) {
        value += noise3(pos * frequency) * amplitude;
        frequency *= 2.0;
        amplitude *= 0.5;
        // Domain rotation per octave to reduce axial artifacts
        pos = vec3<f32>(
            pos.x * 0.866 - pos.y * 0.5 + 1.7,
            pos.x * 0.5 + pos.y * 0.866 + 3.2,
            pos.z + 0.8
        );
    }
    return value;
}

// ─── Main ──────────────────────────────────────────────────────────
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let gs = params.gridSize;
    if (id.x >= gs || id.y >= gs || id.z >= gs) {
        return;
    }

    let flatIdx = id.x + id.y * gs + id.z * gs * gs;

    // World position of this voxel
    let worldPos = params.chunkOrigin + vec3<f32>(id) * params.voxelScale;

    // ─── Base terrain density: positive = underground (solid) ───
    // Start fully solid, carve with noise
    // Height-based base: ground is solid below a height threshold
    let groundLevel = 0.0; // sea level reference
    var density = (groundLevel - worldPos.y) * 0.1; // solid below ground, air above

    // ─── Cave carving: 3D FBM creates organic tunnels ───
    let caveNoise = fbm3(worldPos * params.caveScale + vec3<f32>(params.seed, 0.0, params.seed * 0.7), 4);

    // Two-layer cave system:
    // 1. Large tunnels (low frequency)
    let largeTunnel = fbm3(worldPos * params.caveScale * 0.5 + vec3<f32>(params.seed * 1.3), 3);
    // 2. Worm-like connections (high frequency, narrow)
    let wormTunnel = fbm3(worldPos * params.caveScale * 2.0 + vec3<f32>(params.seed * 2.1), 3);

    // Combine: if cave noise is near 0.5, carve a tunnel
    let largeCarve = smoothstep(0.42, 0.58, largeTunnel) * 2.0;
    let wormCarve = smoothstep(0.46, 0.54, wormTunnel) * 1.5;
    let totalCarve = max(largeCarve, wormCarve);

    // Apply carving — subtract from density to create air pockets
    density = density + 1.0 - totalCarve * params.caveThreshold;

    // ─── Material assignment based on depth and noise ───
    var material: u32 = 0u; // air by default
    if (density > 0.0) {
        // Default: stone
        material = 2u;

        // Surface layer: dirt (thin shell near the iso-surface)
        if (density < 0.3) {
            material = 1u; // dirt
        }

        // Ore veins: pockets of iron deep underground
        let oreNoise = fbm3(worldPos * 4.0 + vec3<f32>(params.seed * 5.0), 3);
        if (oreNoise > 0.72 && worldPos.y < groundLevel - 10.0) {
            material = 4u; // iron
        }

        // Coal veins: more common, mid-depth
        let coalNoise = fbm3(worldPos * 3.5 + vec3<f32>(params.seed * 3.3), 3);
        if (coalNoise > 0.68 && worldPos.y < groundLevel - 5.0) {
            material = 6u; // coal
        }

        // Deep obsidian: rare, very deep
        if (oreNoise > 0.78 && worldPos.y < groundLevel - 30.0) {
            material = 7u; // obsidian
        }
    }

    densityOut[flatIdx] = density;
    materialOut[flatIdx] = material;
}
