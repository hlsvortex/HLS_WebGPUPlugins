import * as THREE from 'three/webgpu';
import { EventDispatcher } from 'three';
import { CameraDB, getCameraProfile } from '../data/CameraDB';

export class CameraManager extends EventDispatcher {
    camera: THREE.PerspectiveCamera;
    domElement: HTMLElement;
    
    yaw: number = 0;
    pitch: number = -0.15;
    sensitivity: number = 0.002;
    
    mode: 'fps' | 'third_person' | 'free' = 'fps';
    
    PROFILES = CameraDB;
    currentProfile: string = 'normal';
    
    fpsArmLength: number;
    fpsHeadHeight: number;
    fpsShoulderOffset: number;
    fpsVerticalOffset: number;
    
    targetArmLength: number;
    targetHeadHeight: number;
    targetShoulderOffset: number;
    targetVerticalOffset: number;
    targetFov: number;
    lerpSpeed: number;
    
    fpsPitchMin: number = -Math.PI / 2 + 0.05;
    fpsPitchMax: number = Math.PI / 2 - 0.05;
    
    tpDistance: number = 16.0;
    tpHeightBias: number = 1.8;
    tpPitchMin: number = -0.55;
    tpPitchMax: number = 0.65;
    
    _pivot: THREE.Vector3 = new THREE.Vector3();
    private _euler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');
    private _lookTarget: THREE.Vector3 = new THREE.Vector3();
    
    trauma: number = 0;
    traumaDecay: number = 1.2;
    shakeFreq: number = 14.0;
    shakeMaxPos: number = 0.20;
    shakeMaxRoll: number = 0.018;
    
    isLocked: boolean = false;
    _boundMouseMove: (e: MouseEvent) => void;
    _boundLockChange: () => void;
    
    constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
        super();
        this.camera = camera;
        this.domElement = domElement;
        
        this.fpsArmLength = this.PROFILES.normal.armLength;
        this.fpsHeadHeight = this.PROFILES.normal.headHeight;
        this.fpsShoulderOffset = this.PROFILES.normal.shoulderOffset;
        this.fpsVerticalOffset = this.PROFILES.normal.verticalOffset || 0.0;
        
        this.targetArmLength = this.fpsArmLength;
        this.targetHeadHeight = this.fpsHeadHeight;
        this.targetShoulderOffset = this.fpsShoulderOffset;
        this.targetVerticalOffset = this.fpsVerticalOffset;
        this.targetFov = this.PROFILES.normal.fov;
        this.lerpSpeed = this.PROFILES.normal.lerpSpeed;
        
        this._boundMouseMove = this._onMouseMove.bind(this);
        this._boundLockChange = this._onLockChange.bind(this);
        this._setupPointerLock();
    }
    
    lock() {
        this.domElement.requestPointerLock();
    }
    
    unlock() {
        document.exitPointerLock();
    }
    
    setMode(mode: 'fps'|'third_person'|'free', armLength?: number) {
        this.mode = mode;
        if (armLength !== undefined) this.tpDistance = armLength;
        this._clampPitch();
    }
    
    setCameraProfile(profileName: string) {
        if (this.currentProfile === profileName) return;
        const profile = getCameraProfile(profileName);
        this.currentProfile = profileName;
        
        this.targetArmLength = profile.armLength;
        this.targetHeadHeight = profile.headHeight;
        this.targetShoulderOffset = profile.shoulderOffset;
        this.targetVerticalOffset = profile.verticalOffset || 0.0;
        this.targetFov = profile.fov;
        this.lerpSpeed = profile.lerpSpeed;
    }
    
    update(dt: number, pivot?: THREE.Vector3) {
        if (pivot) this._pivot.copy(pivot);
        
        this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
        
        const t = Math.min(1, this.lerpSpeed * dt);
        this.fpsArmLength += (this.targetArmLength - this.fpsArmLength) * t;
        this.fpsHeadHeight += (this.targetHeadHeight - this.fpsHeadHeight) * t;
        this.fpsShoulderOffset += (this.targetShoulderOffset - this.fpsShoulderOffset) * t;
        this.fpsVerticalOffset += (this.targetVerticalOffset - this.fpsVerticalOffset) * t;
        
        if (Math.abs(this.camera.fov - this.targetFov) > 0.1) {
            this.camera.fov += (this.targetFov - this.camera.fov) * t;
            this.camera.updateProjectionMatrix();
        }
        
        if (this.mode === 'fps') {
            this._applyFPS();
        } else if (this.mode === 'third_person') {
            this._applyThirdPerson();
        } else if (this.mode === 'free') {
            this._euler.set(this.pitch, this.yaw, 0);
            this.camera.quaternion.setFromEuler(this._euler);
        }
        
        if (this.trauma > 0.001) {
            this._applyShake();
        }
    }
    
    addTrauma(amount: number) {
        this.trauma = Math.min(1, this.trauma + amount);
    }
    
    _applyFPS() {
        this._euler.set(this.pitch, this.yaw, 0);
        this.camera.quaternion.setFromEuler(this._euler);
        
        this.camera.position.set(
            this._pivot.x,
            this._pivot.y + this.fpsHeadHeight,
            this._pivot.z
        );
        
        if (this.fpsArmLength > 0) {
            let safeLength = this.fpsArmLength;
            this.camera.translateZ(safeLength);
            
            if (Math.abs(this.fpsShoulderOffset) > 0.01) {
                this.camera.translateX(this.fpsShoulderOffset);
            }
            if (Math.abs(this.fpsVerticalOffset) > 0.01) {
                this.camera.translateY(this.fpsVerticalOffset);
            }
            this.camera.position.y += 0.15;
        }
    }
    
    _applyThirdPerson() {
        const dist = this.tpDistance;
        const cosPitch = Math.cos(this.pitch);
        const sinPitch = Math.sin(this.pitch);
        const cosYaw = Math.cos(this.yaw);
        const sinYaw = Math.sin(this.yaw);
        
        const offsetX = sinYaw * cosPitch * dist;
        const offsetY = -sinPitch * dist + this.tpHeightBias;
        const offsetZ = cosYaw * cosPitch * dist;
        
        this.camera.position.set(
            this._pivot.x + offsetX,
            this._pivot.y + offsetY,
            this._pivot.z + offsetZ
        );
        
        this._lookTarget.set(
            this._pivot.x,
            this._pivot.y + 1.2,
            this._pivot.z
        );
        this.camera.lookAt(this._lookTarget);
    }
    
    _applyShake() {
        const t = performance.now() * 0.001 * this.shakeFreq;
        const shake = this.trauma * this.trauma;
        
        this.camera.position.x += Math.sin(t * 1.73) * shake * this.shakeMaxPos;
        this.camera.position.y += Math.sin(t * 2.31) * shake * this.shakeMaxPos;
        this.camera.position.z += Math.sin(t * 1.11) * shake * this.shakeMaxPos;
        
        const roll = Math.sin(t * 3.17) * shake * this.shakeMaxRoll;
        this.camera.rotateZ(roll);
    }
    
    _setupPointerLock() {
        document.addEventListener('pointerlockchange', this._boundLockChange);
        document.addEventListener('mousemove', this._boundMouseMove);
    }
    
    _onLockChange() {
        const wasLocked = this.isLocked;
        this.isLocked = (document.pointerLockElement === this.domElement);
        if (!wasLocked && this.isLocked) {
            this.dispatchEvent({ type: 'lock' });
        } else if (wasLocked && !this.isLocked) {
            this.dispatchEvent({ type: 'unlock' });
        }
    }
    
    _onMouseMove(e: MouseEvent) {
        if (!this.isLocked && this.mode !== 'free') return;
        
        // In free mode, require left or right mouse button down
        if (this.mode === 'free' && !this.isLocked) {
            if ((e.buttons & 1) === 0 && (e.buttons & 2) === 0) return;
        }
        
        this.yaw -= e.movementX * this.sensitivity;
        this.pitch -= e.movementY * this.sensitivity;
        this._clampPitch();
    }
    
    _clampPitch() {
        if (this.mode === 'third_person') {
            this.pitch = Math.max(this.tpPitchMin, Math.min(this.tpPitchMax, this.pitch));
        } else {
            this.pitch = Math.max(this.fpsPitchMin, Math.min(this.fpsPitchMax, this.pitch));
        }
    }
    
    dispose() {
        document.removeEventListener('pointerlockchange', this._boundLockChange);
        document.removeEventListener('mousemove', this._boundMouseMove);
    }
}
