/**
 * GraphGenerator.js — Macroscopic World Building via Graph River Routing.
 * 
 * Implements a variation of the Red Blob Games Polygonal Map Generation pattern.
 * Uses a Delaunay graph to simulate downhill river flows, which carve
 * valleys into the graph. Finally rasterizes the graph into a Float32Array
 * for the WebGPU pipeline to consume.
 */

import Delaunator from 'delaunator';

// Simplex noise specifically for CPU-side graph shaping
function hash(x, y) {
    let a = x * 32.43 + y * 133.11;
    let b = x * 111.31 + y * 43.43;
    return [Math.sin(a) * 43758.5453 % 1, Math.sin(b) * 43758.5453 % 1];
}

function smoothstep(min, max, value) {
    var x = Math.max(0.0, Math.min(1.0, (value - min) / (max - min)));
    return x * x * (3.0 - 2.0 * x);
}

function vnoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    // Hash corners
    const hash = (vx, vy) => {
        let n = Math.sin(vx * 12.9898 + vy * 78.233) * 43758.5453;
        return n - Math.floor(n);
    };

    const h00 = hash(ix, iy);
    const h10 = hash(ix + 1.0, iy);
    const h01 = hash(ix, iy + 1.0);
    const h11 = hash(ix + 1.0, iy + 1.0);

    const t = h00 * (1.0 - ux) + h10 * ux;
    const b = h01 * (1.0 - ux) + h11 * ux;
    return t * (1.0 - uy) + b * uy;
}

function fbm(x, y, octaves) {
    let result = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    for (let i = 0; i < octaves; i++) {
        result += vnoise(x * freq, y * freq) * amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return result;
}

export class GraphGenerator {
    constructor() {
        this.nodes = [];     // {x, y, h, flow, neighbors[]}
        this.triangles = []; // [n1, n2, n3, ...] 
    }

    async generate(textureSize = 1024, config = null) {
        return new Promise((resolve, reject) => {
            // Load both heightmap and river map in parallel
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = '/heightmap.png';

            const riverImg = new Image();
            riverImg.crossOrigin = "Anonymous";
            riverImg.src = '/heightmap_rivers.png';

            let heightLoaded = false, riverLoaded = false;
            let idata = null, riverData = null;

            const canvas = document.createElement('canvas');
            canvas.width = textureSize;
            canvas.height = textureSize;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            const tryProcess = () => {
                if (!heightLoaded || !riverLoaded) return;
                console.log(`[GraphGen] Both maps loaded. Rasterizing to ${textureSize}x${textureSize} GPU Buffer.`);

                const outData = new Float32Array(textureSize * textureSize * 4);
                let riverPixelCount = 0;

                for (let y = 0; y < textureSize; y++) {
                    for (let x = 0; x < textureSize; x++) {
                        const idx = (y * textureSize + x) * 4;
                        const px = x / textureSize;
                        const py = y / textureSize;

                        let pixelVal = idata[idx] / 255.0;

                        // River flow from painted map (black = river, white = no river)
                        // Threshold: only pixels darker than 50% gray register as river
                        let rawRiver = riverData ? (1.0 - riverData[idx] / 255.0) : 0.0;
                        let flow = rawRiver > 0.5 ? (rawRiver - 0.5) * 2.0 : 0.0; // Remap 0.5-1.0 → 0-1

                        let hills = Math.max(0.0, fbm((px + 5.0) * 4.0, (py - 3.0) * 4.0, 6));
                        let peaks = Math.max(0.0, fbm((px - 2.0) * 8.0, (py + 1.0) * 8.0, 4) - 0.3) * 2.0;
                        let procH = hills * 0.4 + peaks * 0.6;

                        // --- 1. ORGANIC REGIONAL MAPPING ---
                        let nx = px + (fbm(px * 10.0, py * 10.0, 4) - 0.5) * 0.25;
                        let ny = py + (fbm(px * 10.0 + 50.0, py * 10.0 + 50.0, 4) - 0.5) * 0.25;

                        let redDist = Math.sqrt(Math.pow(nx - 0.45, 2) + Math.pow(ny - 0.65, 2));
                        let snowDist = Math.sqrt(Math.pow(nx - 0.2, 2) + Math.pow(ny - 0.25, 2));
                        let swampDist = Math.sqrt(Math.pow(nx - 0.75, 2) + Math.pow(ny - 0.55, 2));

                        let regionId = 0.0;
                        if (snowDist < 0.18) regionId = 0.1;
                        else if (redDist < 0.15) regionId = 0.2;
                        else if (swampDist < 0.12) regionId = 0.3;

                        // --- 2. BIOME-DRIVEN TOPOGRAPHICAL CARVING ---
                        let swampInf = Math.max(0.0, 1.0 - (swampDist / 0.12));
                        procH *= (1.0 - (swampInf * 0.85));

                        let snowInf = Math.max(0.0, 1.0 - (snowDist / 0.18));
                        procH += (procH * snowInf * 1.5) + (Math.pow(procH, 2.0) * snowInf * 1.0);

                        // Volcano cone
                        let volcDist = Math.sqrt(Math.pow(nx - 0.35, 2) + Math.pow(ny - 0.45, 2));
                        if (volcDist < 0.10) {
                            let vInf = 1.0 - (volcDist / 0.10);
                            let cone = Math.pow(vInf, 1.8) * 1.3;
                            if (volcDist < 0.02) {
                                let craterDrop = (0.02 - volcDist) / 0.02;
                                cone -= Math.pow(craterDrop, 1.5) * 0.35;
                            }
                            procH = Math.max(procH, cone + (procH * vInf * 0.5));
                        }


                        if (flow > 0.1) riverPixelCount++;

                        outData[idx] = pixelVal;     // R: Raw Base Image Pixel Value
                        outData[idx + 1] = flow;     // G: River Flow Density
                        outData[idx + 2] = procH;    // B: Procedural Mountain Noise
                        outData[idx + 3] = regionId; // A: Region ID Mask
                    }
                }
                console.log(`[GraphGen] River pixels detected: ${riverPixelCount} / ${textureSize * textureSize} (${(riverPixelCount / (textureSize * textureSize) * 100).toFixed(1)}%)`);
                resolve(outData);
            };

            // Heightmap load handler
            img.onload = () => {
                console.log('[GraphGen] Loaded /heightmap.png');
                ctx.filter = 'grayscale(100%) blur(8px)';
                ctx.drawImage(img, 0, 0, textureSize, textureSize);
                idata = ctx.getImageData(0, 0, textureSize, textureSize).data;
                heightLoaded = true;
                tryProcess();
            };
            img.onerror = () => {
                console.error("[GraphGen] Failed to load /heightmap.png!");
                resolve(new Float32Array(textureSize * textureSize * 4));
            };

            // River map load handler
            riverImg.onload = () => {
                console.log('[GraphGen] Loaded /heightmap_rivers.png');
                // Use a separate canvas for the river map to avoid overwriting heightmap data
                const rCanvas = document.createElement('canvas');
                rCanvas.width = textureSize;
                rCanvas.height = textureSize;
                const rCtx = rCanvas.getContext('2d', { willReadFrequently: true });
                rCtx.filter = 'grayscale(100%) blur(4px)'; // Slight blur to soften river edges
                rCtx.drawImage(riverImg, 0, 0, textureSize, textureSize);
                riverData = rCtx.getImageData(0, 0, textureSize, textureSize).data;
                riverLoaded = true;
                tryProcess();
            };
            riverImg.onerror = () => {
                console.warn("[GraphGen] No /heightmap_rivers.png found — proceeding without rivers.");
                riverLoaded = true; // Continue without rivers
                tryProcess();
            };
        });
    }
}
