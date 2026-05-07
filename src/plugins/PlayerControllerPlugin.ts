import * as THREE from 'three/webgpu';

export class PlayerControllerPlugin {
    core: any;
    
    enabled: boolean = false;
    
    // Physics
    velocity: THREE.Vector3 = new THREE.Vector3();
    direction: THREE.Vector3 = new THREE.Vector3();
    onGround: boolean = false;
    
    // Settings (1 unit = 1 meter)
    walkSpeed: number = 6.0;
    sprintMultiplier: number = 1.8;
    jumpForce: number = 12.0;
    gravity: number = 30.0;
    playerHeight: number = 1.7;
    
    // Physics state
    position: THREE.Vector3 = new THREE.Vector3(-2000, 500, 5000);
    
    // AAA Feel
    bobTimer: number = 0;
    baseYOffset: number = 0;
    targetVelocity: THREE.Vector3 = new THREE.Vector3();
    smoothedVelocity: THREE.Vector3 = new THREE.Vector3();
    
    // References
    cameraManager: any;
    input: any;
    terrainSystem: any;
    
    _onPointerLockChange: () => void;
    
    constructor() {
        this._onPointerLockChange = this.onPointerLockChange.bind(this);
    }
    
    async init() {
        this.cameraManager = this.core.cameraManager;
        this.input = this.core.input;
        this.terrainSystem = this.core.terrainSystem;
        
        // Sync position from current camera
        this.position.copy(this.core.camera.position);

        const ui = this.core.debugUI;
        if (ui) {
            ui.registerPlugin('Player', '🚶', '#4fa', {
                category: 'Gameplay',
                onEnable: () => this.enableController(),
                onDisable: () => this.disableController()
            });
            
            ui.addSection('Player', '⚙️ Controller Settings', '#4fa');
            ui.addSlider('Player', 'walkSpeed', 'Walk Speed', 1.0, 50.0, 0.5, this.walkSpeed, 'Base movement speed.', (v: number) => { this.walkSpeed = v; });
            ui.addSlider('Player', 'sprintMultiplier', 'Sprint Multi', 1.0, 5.0, 0.1, this.sprintMultiplier, 'Speed multiplier when holding Shift.', (v: number) => { this.sprintMultiplier = v; });
            ui.addSlider('Player', 'jumpForce', 'Jump Force', 5.0, 50.0, 0.5, this.jumpForce, 'Vertical leap strength.', (v: number) => { this.jumpForce = v; });
            ui.addSlider('Player', 'playerHeight', 'Eye Height', 0.5, 5.0, 0.1, this.playerHeight, 'Camera height above ground.', (v: number) => { this.playerHeight = v; });
        }
        
        // When the plugin is enabled, clicking the canvas will lock the pointer.
        this.core.renderer.domElement.addEventListener('click', () => {
            if (this.enabled && !this.cameraManager.isLocked) {
                this.cameraManager.lock();
            }
        });
        
        // Global hotkey to jump in and out of FPS mode using ~ (Backquote)
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') {
                e.preventDefault();
                const ui = this.core.debugUI;
                if (ui && typeof ui.togglePlugin === 'function') {
                    if (!this.enabled) {
                        // Toggle ON
                        ui.togglePlugin('Player', true);
                        this.cameraManager.lock();
                    } else {
                        // Toggle OFF
                        ui.togglePlugin('Player', false);
                        if (this.cameraManager.isLocked) {
                            this.cameraManager.unlock();
                        }
                    }
                }
            }
        });
    }
    
    enableController() {
        this.enabled = true;
        
        // Sync position if we were free flying
        if (this.cameraManager.mode === 'free') {
            this.position.copy(this.core.camera.position);
        }
        
        // Let CameraManager take over and set mode to FPS
        this.cameraManager.setMode('fps');
        this.cameraManager.setCameraProfile('normal');
        
        this.cameraManager.addEventListener('unlock', this._onPointerLockChange);
        
        // Start falling to ground
        this.velocity.set(0, 0, 0);
        
        console.log('[PlayerController] Enabled. Click canvas to lock mouse.');
    }
    
    disableController() {
        this.enabled = false;
        
        this.cameraManager.setMode('free');
        
        if (this.cameraManager.isLocked) {
            this.cameraManager.unlock();
        }
        
        this.cameraManager.removeEventListener('unlock', this._onPointerLockChange);
        
        console.log('[PlayerController] Disabled.');
    }
    
    onPointerLockChange() {
        // If unlocked via ESC, automatically disable plugin
        if (!this.cameraManager.isLocked && this.enabled) {
            const ui = this.core.debugUI;
            if (ui && typeof ui.togglePlugin === 'function') {
                ui.togglePlugin('Player', false);
            }
        }
    }
    
    update(dt: number) {
        if (!this.enabled) return;
        
        const cappedDt = Math.min(dt, 0.1);
        
        // Physics
        this.velocity.y -= this.gravity * cappedDt;
        
        // Determine input direction in world space
        this.direction.set(0, 0, 0);
        
        if (this.cameraManager.isLocked) {
            if (this.input.isHeld('MOVE_FORWARD')) this.direction.z -= 1;
            if (this.input.isHeld('MOVE_BACK')) this.direction.z += 1;
            if (this.input.isHeld('MOVE_LEFT')) this.direction.x -= 1;
            if (this.input.isHeld('MOVE_RIGHT')) this.direction.x += 1;
            
            if (this.input.justPressed('JUMP') && this.onGround) {
                this.velocity.y = this.jumpForce;
                this.onGround = false;
            }
        }
        
        if (this.direction.lengthSq() > 0) {
            this.direction.normalize();
        }
        
        this.direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraManager.yaw);
        
        const isSprinting = this.input.isHeld('SPRINT');
        const targetSpeed = this.walkSpeed * (isSprinting ? this.sprintMultiplier : 1.0);
        
        // Desired velocity based on input
        this.targetVelocity.x = this.direction.x * targetSpeed;
        this.targetVelocity.z = this.direction.z * targetSpeed;
        
        // Smoothly interpolate current XZ velocity toward target
        const friction = this.onGround ? 12.0 : 2.0; 
        this.velocity.x += (this.targetVelocity.x - this.velocity.x) * friction * cappedDt;
        this.velocity.z += (this.targetVelocity.z - this.velocity.z) * friction * cappedDt;
        
        // Apply velocity to position
        this.position.x += this.velocity.x * cappedDt;
        this.position.z += this.velocity.z * cappedDt;
        this.position.y += this.velocity.y * cappedDt;
        
        // Head Bobbing
        const speedSq = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
        if (this.onGround && speedSq > 1.0) {
            const speedScale = Math.sqrt(speedSq) / targetSpeed;
            const bobFrequency = isSprinting ? 15.0 : 10.0;
            const bobAmplitude = isSprinting ? 0.08 : 0.04;
            this.bobTimer += cappedDt * bobFrequency * speedScale;
            this.baseYOffset = Math.sin(this.bobTimer) * bobAmplitude;
        } else {
            // Smoothly return to center
            this.baseYOffset += (0 - this.baseYOffset) * 10.0 * cappedDt;
            this.bobTimer = 0;
        }
        
        // Terrain collision & stickiness
        if (this.terrainSystem) {
            const terrainHeight = this.terrainSystem.getTerrainHeightAt(this.position.x, this.position.z);
            const playerFeetY = this.position.y - this.playerHeight - this.baseYOffset;
            
            // Allow stepping up hills and sticking to down-slopes
            const isFallingOrWalking = this.velocity.y <= 2.0; 
            const distToGround = playerFeetY - terrainHeight;
            
            if (isFallingOrWalking && distToGround <= 0.6 && distToGround > -1.5) {
                // Snap to ground
                this.position.y = terrainHeight + this.playerHeight + this.baseYOffset;
                this.velocity.y = 0;
                this.onGround = true;
            } else if (distToGround < -1.5) {
                // Sunk deep underground (happens if spawning inside a mountain or massive lag spike)
                this.position.y = terrainHeight + this.playerHeight;
                this.velocity.y = 0;
                this.onGround = true;
            } else {
                // In the air
                this.onGround = false;
            }
        }
        
        // Feed pivot back to CameraManager
        this.cameraManager._pivot.copy(this.position);
        
        // We handle CameraProfile sprinting state here based on input
        if (this.cameraManager.mode === 'fps') {
            if (isSprinting && this.direction.lengthSq() > 0 && this.onGround) {
                this.cameraManager.setCameraProfile('sprint');
            } else {
                this.cameraManager.setCameraProfile('normal');
            }
        }
    }
}
