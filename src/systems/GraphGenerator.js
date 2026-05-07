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

function ridgedNoise(x, y, octaves) {
    let result = 0.0;
    let amp = 0.5;
    let freq = 1.0;
    let weight = 1.0;
    for (let i = 0; i < octaves; i++) {
        let n = vnoise(x * freq, y * freq);
        // Map from [0, 1] to [-1, 1]
        n = n * 2.0 - 1.0;
        // Absolute value and invert for sharp ridges
        n = 1.0 - Math.abs(n);
        n = Math.pow(n, 1.3); // Soften the ridges from the previous n*n (which was 2.0)
        
        n *= weight;
        weight = Math.max(0.0, Math.min(1.0, n * 2.0)); // Multiply subsequent octaves by previous ridge
        
        result += n * amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    return result;
}

export class GraphGenerator {
    constructor() {}

    // Rasterize a single triangle into the Float32Array
    _rasterizeTriangle(outData, textureSize, p0, p1, p2, v0, v1, v2) {
        // p = {x, y}, v = {h, flow, region}
        // Bounding box
        let minX = Math.floor(Math.min(p0.x, p1.x, p2.x));
        let maxX = Math.ceil(Math.max(p0.x, p1.x, p2.x));
        let minY = Math.floor(Math.min(p0.y, p1.y, p2.y));
        let maxY = Math.ceil(Math.max(p0.y, p1.y, p2.y));

        minX = Math.max(0, Math.min(textureSize - 1, minX));
        maxX = Math.max(0, Math.min(textureSize - 1, maxX));
        minY = Math.max(0, Math.min(textureSize - 1, minY));
        maxY = Math.max(0, Math.min(textureSize - 1, maxY));

        // Denominator for barycentric coords
        let denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
        
        if (denom === 0) return; // Degenerate triangle

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                // Barycentric weights
                let w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) / denom;
                let w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) / denom;
                let w2 = 1.0 - w0 - w1;

                // Inside triangle check (with slight tolerance for edge precision)
                if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) {
                    // Clamp to exactly 0-1 for interpolation
                    w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
                    let sum = w0 + w1 + w2;
                    w0 /= sum; w1 /= sum; w2 /= sum;

                    const idx = (y * textureSize + x) * 4;
                    
                    // R: Base Height (pixelVal) -> we just map the procedural h into it
                    outData[idx] = v0.h * w0 + v1.h * w1 + v2.h * w2;
                    // G: River Flow
                    outData[idx + 1] = v0.flow * w0 + v1.flow * w1 + v2.flow * w2;
                    // B: Procedural Micro Noise (handled in shader usually, but we set it same as base)
                    outData[idx + 2] = outData[idx]; 
                    // A: Region Mask (Biome)
                    outData[idx + 3] = v0.region * w0 + v1.region * w1 + v2.region * w2;
                }
            }
        }
    }

    async _generateProcedural(textureSize, numPoints, config) {
        console.log(`[GraphGen] Running Delaunay graph generation with ${numPoints} points...`);
        const outData = new Float32Array(textureSize * textureSize * 4);
        
        const coords = new Float64Array(numPoints * 2);
        const nodes = new Array(numPoints);
        
        // Extract params with defaults
        const islandSize = config.procIslandSize ?? 0.45;
        const noiseScale = config.procNoiseScale ?? 3.0;
        const noiseAmp = config.procNoiseAmp ?? 0.4;
        const mtnChance = config.procMountainChance ?? 0.5;
        const hillsHeight = config.procHillsHeight ?? 0.3;
        const seedOffset = (config.procSeed ?? 1) * 100.0;

        // 1. Generate Points & Heights
        for (let i = 0; i < numPoints; i++) {
            let px = Math.random();
            let py = Math.random();
            
            coords[i * 2] = px * textureSize;
            coords[i * 2 + 1] = py * textureSize;
            
            // Domain Warping: Distort the coordinate space
            let warpX = fbm(px * 2.0 + seedOffset, py * 2.0 + seedOffset, 3) * 0.3;
            let warpY = fbm(px * 2.0 + seedOffset + 100, py * 2.0 + seedOffset + 100, 3) * 0.3;
            
            // Calculate distance from distorted center
            let dx = (px + warpX) - 0.65; // Offset center slightly due to warp positive bias
            let dy = (py + warpY) - 0.65;
            let dist = Math.sqrt(dx * dx + dy * dy);
            
            // Base Continental Shape
            let baseH = Math.max(0.0, 1.0 - (dist / islandSize));
            baseH = smoothstep(0.0, 1.0, baseH); // Smooth S-curve instead of sharp cone
            
            // Mountain Mask
            // mtnChance dictates how easily mountains spawn. 1.0 = everywhere, 0.0 = nowhere.
            let maskThreshold = 1.0 - mtnChance; 
            let mountainMask = smoothstep(maskThreshold, maskThreshold + 0.4, baseH);
            
            // Ridged Mountain Noise
            let mountainH = ridgedNoise(px * noiseScale + seedOffset, py * noiseScale + seedOffset, 6) * noiseAmp;
            
            // Rolling Hills / Base Details
            let hillsH = fbm(px * noiseScale * 2.0 + seedOffset, py * noiseScale * 2.0 + seedOffset, 4) * (noiseAmp * hillsHeight);
            
            // Combine layers
            let finalH = baseH * 0.2 + (hillsH * baseH) + (mountainH * mountainMask);
            
            // Non-linear scaling: Push mountains up slightly
            finalH = Math.pow(finalH, 1.05);

            // Region logic
            let regionId = 0.0;
            if (finalH > 0.6) regionId = 0.1; // snow
            else if (dist < 0.2 && finalH > 0.3) regionId = 0.2; // redwood
            else if (dist > 0.4) regionId = 0.3; // swamp
            
            nodes[i] = {
                x: px * textureSize,
                y: py * textureSize,
                h: finalH,
                flow: 0,
                region: regionId,
                downhill: -1
            };
        }
        
        // Add corner points to ensure graph covers entire screen
        nodes.push({ x: 0, y: 0, h: 0, flow: 0, region: 0, downhill: -1 });
        nodes.push({ x: textureSize, y: 0, h: 0, flow: 0, region: 0, downhill: -1 });
        nodes.push({ x: 0, y: textureSize, h: 0, flow: 0, region: 0, downhill: -1 });
        nodes.push({ x: textureSize, y: textureSize, h: 0, flow: 0, region: 0, downhill: -1 });
        
        // Update coords array
        const allCoords = new Float64Array(nodes.length * 2);
        for(let i=0; i<nodes.length; i++) {
            allCoords[i*2] = nodes[i].x;
            allCoords[i*2+1] = nodes[i].y;
        }

        // 2. Delaunay Triangulation
        const delaunay = new Delaunator(allCoords);
        
        // 3. Find Downhill Edges (River Routing)
        // We need an adjacency list
        const adj = Array.from({length: nodes.length}, () => []);
        const triangles = delaunay.triangles;
        for (let i = 0; i < triangles.length; i += 3) {
            let t0 = triangles[i];
            let t1 = triangles[i + 1];
            let t2 = triangles[i + 2];
            adj[t0].push(t1, t2);
            adj[t1].push(t0, t2);
            adj[t2].push(t0, t1);
        }
        
        // Sort nodes by height (highest first)
        let sortedIndices = Array.from({length: nodes.length}, (_, i) => i);
        sortedIndices.sort((a, b) => nodes[b].h - nodes[a].h);
        
        // Assign downhill links
        for (let idx of sortedIndices) {
            let n = nodes[idx];
            let lowestH = n.h;
            let lowestNeighbor = -1;
            for (let nbrIdx of adj[idx]) {
                if (nodes[nbrIdx].h < lowestH) {
                    lowestH = nodes[nbrIdx].h;
                    lowestNeighbor = nbrIdx;
                }
            }
            n.downhill = lowestNeighbor;
        }
        
        // 4. Simulate Rainfall (Erosion / Rivers)
        // Sprinkle 1 unit of water on every node
        for (let idx of sortedIndices) {
            let n = nodes[idx];
            // If it's land, add local rain
            if (n.h > 0.05) {
                n.flow += 1.0; 
                // Route downstream
                if (n.downhill !== -1) {
                    nodes[n.downhill].flow += n.flow;
                }
            }
        }
        
        // Normalize flow for visualization
        let maxFlow = 0;
        for (let n of nodes) {
            if (n.flow > maxFlow) maxFlow = n.flow;
        }
        for (let n of nodes) {
            // Logarithmic flow scaling so tiny rivers are visible
            if (n.flow > 0) {
                n.flow = Math.pow(n.flow / maxFlow, 0.3);
            }
        }

        // 5. Rasterize Triangles
        for (let i = 0; i < triangles.length; i += 3) {
            let n0 = nodes[triangles[i]];
            let n1 = nodes[triangles[i + 1]];
            let n2 = nodes[triangles[i + 2]];
            
            this._rasterizeTriangle(outData, textureSize, n0, n1, n2, n0, n1, n2);
        }
        
        console.log(`[GraphGen] Procedural Graph Rasterized successfully.`);
        return outData;
    }

    async generate(textureSize = 1024, config = null) {
        if (!config) config = {};
        const isProcedural = !!config.proceduralMode;

        if (isProcedural) {
            return await this._generateProcedural(textureSize, 15000, config);
        }

        const heightUrl = config.heightmapUrl || '/heightmap.png';
        const riverUrl = config.rivermapUrl || '/heightmap_rivers.png';

        return new Promise((resolve, reject) => {
            // Load both heightmap and river map in parallel
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = heightUrl;

            const riverImg = new Image();
            riverImg.crossOrigin = "Anonymous";
            riverImg.src = riverUrl;

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
                console.log(`[GraphGen] Loaded ${heightUrl}`);
                ctx.filter = 'grayscale(100%) blur(8px)';
                ctx.drawImage(img, 0, 0, textureSize, textureSize);
                idata = ctx.getImageData(0, 0, textureSize, textureSize).data;
                heightLoaded = true;
                tryProcess();
            };
            img.onerror = () => {
                console.error(`[GraphGen] Failed to load ${heightUrl}!`);
                resolve(new Float32Array(textureSize * textureSize * 4));
            };

            // River map load handler
            riverImg.onload = () => {
                console.log(`[GraphGen] Loaded ${riverUrl}`);
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
                console.warn(`[GraphGen] No ${riverUrl} found — proceeding without rivers.`);
                riverLoaded = true; // Continue without rivers
                tryProcess();
            };
        });
    }
}
