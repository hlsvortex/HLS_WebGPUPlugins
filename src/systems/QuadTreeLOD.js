/**
 * QuadTreeLOD.js — GPU-driven chunk manager for massive terrain.
 * 
 * Manages a pool of identical PlaneGeometry chunks.
 * Subdivides based on camera distance.
 * Assigns world position so the TSL material can automatically displace it.
 */

import * as THREE from 'three/webgpu';
import {
  positionLocal, positionWorld, normalLocal, instanceIndex, modelWorldMatrix, texture, uv,
  vec2, vec3, vec4, float, color, smoothstep, mix, pow, abs, frontFacing, uniform, attribute,
  sin, cos, add, mul, sub, div, time, hash, cameraPosition, length, normalize, dot, max, exp, transformNormalToView
} from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

class QuadNode {
  constructor(x, z, size, depth, maxDepth, lodSystem) {
    this.x = x;
    this.z = z;
    this.size = size;
    this.depth = depth;
    this.lodSystem = lodSystem;
    
    this.isLeaf = true;
    this.children = [];
    this.mesh = null;
    this.waterMesh = null;
    this.chunkData = null;
  }

  update(cameraPos) {
    // Calculate distance from camera to the center of this node
    const dx = cameraPos.x - this.x;
    const dz = cameraPos.z - this.z;
    const distSq = dx * dx + dz * dz;

    // Split heuristic: if we are closer than MULTIPLIER x the size of the node, split it
    const threshold = this.size * this.lodSystem.lodSplitMultiplier;
    const shouldSplit = distSq < (threshold * threshold) && this.depth < this.lodSystem.maxDepth;

    if (shouldSplit) {
      if (this.isLeaf) {
        this.split();
      }
      for (const child of this.children) {
        child.update(cameraPos);
      }
    } else {
      if (!this.isLeaf) {
        this.merge();
      }
      if (!this.mesh) {
        this.claimMeshes();
      }
      
      // Emit chunk creation/destruction events for high-res leaf nodes
      if (this.depth >= this.lodSystem.maxDepth) {
          if (!this.chunkData) {
              this.chunkData = { x: this.x, z: this.z, size: this.size };
              if (this.lodSystem.onChunkCreated) this.lodSystem.onChunkCreated(this.chunkData);
          }
      } else {
          if (this.chunkData) {
              if (this.lodSystem.onChunkDestroyed) this.lodSystem.onChunkDestroyed(this.chunkData);
              this.chunkData = null;
          }
      }
    }
  }

  split() {
    this.isLeaf = false;
    if (this.mesh) {
      this.lodSystem.releaseMesh(this.mesh);
      this.mesh = null;
    }

    if (this.chunkData) {
      if (this.lodSystem.onChunkDestroyed) this.lodSystem.onChunkDestroyed(this.chunkData);
      this.chunkData = null;
    }

    const quarter = this.size / 4;
    const half = this.size / 2;
    const d = this.depth + 1;

    // Create 4 children
    this.children.push(new QuadNode(this.x - quarter, this.z - quarter, half, d, null, this.lodSystem));
    this.children.push(new QuadNode(this.x + quarter, this.z - quarter, half, d, null, this.lodSystem));
    this.children.push(new QuadNode(this.x - quarter, this.z + quarter, half, d, null, this.lodSystem));
    this.children.push(new QuadNode(this.x + quarter, this.z + quarter, half, d, null, this.lodSystem));
  }

  merge() {
    this.isLeaf = true;
    for (const child of this.children) {
      child.destroy();
    }
    this.children = [];
  }

  claimMeshes() {
    this.mesh = this.lodSystem.claimMesh();
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.scale.set(this.size, 1, this.size);
    // Only cast shadows from nearby high-detail chunks (depth >= 4, size <= 500m)
    // Massive distant chunks are too far for visible shadow detail and kill perf
    this.mesh.castShadow = (this.depth >= 4); // Chunks <= 500m cast shadows
    this.mesh.updateMatrixWorld();
  }

  destroy() {
    if (!this.isLeaf) {
      for (const child of this.children) {
        child.destroy();
      }
    }
    if (this.mesh) {
      this.lodSystem.releaseMesh(this.mesh);
      this.mesh = null;
    }
    if (this.chunkData) {
      if (this.lodSystem.onChunkDestroyed) this.lodSystem.onChunkDestroyed(this.chunkData);
      this.chunkData = null;
    }
    this.children = [];
  }
}

export class QuadTreeLOD {
  constructor(scene, material, terrainSize, heightTex, biomeTex, lightingSystem, decalSystem, heightScale = 1200) {
    this.scene = scene;
    this.material = material;
    this.terrainSize = terrainSize;
    this.heightTex = heightTex;
    this.biomeTex = biomeTex;
    this.lightingSystem = lightingSystem;
    this.decalSystem = decalSystem;
    this.heightScale = heightScale;
    
    // Chunk configuration
    this.chunkSegments = 16;  // 16x16 = 256 quads per chunk => 512 tris (Massive triangle reduction)
    this.maxDepth = 7;        // 8000 -> 4000 -> 2000 -> 1000 -> 500 -> 250 -> 125 -> 62.5m!
    this.lodSplitMultiplier = 2.0; // Distance multiplier for splitting chunks
    
    this.meshPool = [];
    this.activeMeshes = [];
    
    // Shared geometry for ALL chunks (1x1 unit size, scaled by nodes)
    this._buildGeometry();

    // Init root node
    this.root = new QuadNode(0, 0, this.terrainSize, 0, this.maxDepth, this);
  }



  _buildGeometry() {
    // 1x1 plane
    const baseGeo = new THREE.PlaneGeometry(1, 1, this.chunkSegments, this.chunkSegments);
    baseGeo.rotateX(-Math.PI / 2);

    // Apply Skirts to hide LOD seams
    const pos = baseGeo.attributes.position;
    const vCount = pos.count;
    const segmentWidth = 1.0 / this.chunkSegments;
    const skirtDepth = -0.05; // 5% of node size down

    for (let i = 0; i < vCount; i++) {
        // Find edges (X or Z is near +/- 0.5)
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const isEdge = Math.abs(px) > 0.499 || Math.abs(pz) > 0.499;

        if (isEdge) {
            // Drop edge down to form a skirt hiding LOD height transitions seamlessly
            pos.setY(i, skirtDepth);
            
            // Expand the edges outwards perfectly by 1% to surgically seal the microscopic float-precision LOD rendering tearing across all chunks!
            if (px > 0.49) pos.setX(i, 0.505);
            if (px < -0.49) pos.setX(i, -0.505);
            if (pz > 0.49) pos.setZ(i, 0.505);
            if (pz < -0.49) pos.setZ(i, -0.505);
        }
    }
    pos.needsUpdate = true;
    baseGeo.computeVertexNormals();

    // Fix Frustum Culling Glitch:
    // TSL displaces the vertices up to 1000m on the GPU, but the CPU-side 
    // bounding box remains flat at Y=0. This causes Three.js to cull the chunk 
    // when you look at it from below or horizontally.
    // We strictly enlarge the bounding sphere to account for maximum height.
    baseGeo.computeBoundingSphere();
    if (baseGeo.boundingSphere) {
        baseGeo.boundingSphere.radius += 1000.0;
    }

    this.baseGeometry = baseGeo;
  }

  claimMesh() {
    if (this.meshPool.length > 0) {
      const mesh = this.meshPool.pop();
      mesh.visible = true;
      this.activeMeshes.push(mesh);
      return mesh;
    }

    // Create new mesh if pool is empty
    const mesh = new THREE.Mesh(this.baseGeometry, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // High res chunks cast shadows
    mesh.frustumCulled = true;
    
    this.scene.add(mesh);
    this.activeMeshes.push(mesh);
    return mesh;
  }

  releaseMesh(mesh) {
    mesh.visible = false;
    const index = this.activeMeshes.indexOf(mesh);
    if (index > -1) {
      this.activeMeshes.splice(index, 1);
    }
    this.meshPool.push(mesh);
  }

  update(cameraPos) {
    this.root.update(cameraPos);
  }

  dispose() {
    this.root.destroy();
    for (const mesh of this.meshPool) {
      this.scene.remove(mesh);
    }
    for (const mesh of this.activeMeshes) {
      this.scene.remove(mesh);
    }
    this.meshPool = [];
    this.activeMeshes = [];
    this.baseGeometry.dispose();
  }
}
