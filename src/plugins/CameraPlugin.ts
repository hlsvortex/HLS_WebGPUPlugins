import { CameraManager } from '../core/CameraManager';
import * as THREE from 'three/webgpu';

export class CameraPlugin {
    core: any;
    cameraManager: CameraManager;

    constructor(core: any) {
        this.core = core;
        this.cameraManager = new CameraManager(core.camera, core.renderer.domElement);
        this.core.cameraManager = this.cameraManager;
    }

    async init() {
        const ui = this.core.debugUI;
        if (ui) {
            ui.registerPlugin('Camera', '🎥', '#f8a', 'Core');
            ui.addSection('Camera', '⚙️ Settings', '#f8a');
            
            const modes = ['fps', 'third_person', 'free'];
            let currentModeIdx = modes.indexOf(this.cameraManager.mode);
            ui.addButton('Camera', 'Toggle Mode', () => {
                currentModeIdx = (currentModeIdx + 1) % modes.length;
                this.cameraManager.setMode(modes[currentModeIdx] as any);
                console.log(`[CameraPlugin] Mode: ${modes[currentModeIdx]}`);
            });
            
            ui.addSlider('Camera', 'Add Trauma', 0, 1, 0.05, 0, 'Test camera shake', (v: number) => {
                if (v > 0) this.cameraManager.addTrauma(v);
            });
        }
        
        // Initial state
        this.cameraManager.setMode('free');
    }

    update(dt: number) {
        // Free cam movement
        if (this.cameraManager.mode === 'free') {
            const input = this.core.input;
            if (input) {
                const direction = new THREE.Vector3();
                if (input.isHeld('MOVE_FORWARD')) direction.z -= 1;
                if (input.isHeld('MOVE_BACK')) direction.z += 1;
                if (input.isHeld('MOVE_LEFT')) direction.x -= 1;
                if (input.isHeld('MOVE_RIGHT')) direction.x += 1;
                
                // Q/E for vertical flight
                if (input.isKeyHeld('KeyE')) direction.y += 1;
                if (input.isKeyHeld('KeyQ')) direction.y -= 1;

                if (direction.lengthSq() > 0) {
                    direction.normalize();
                }

                // Fly relative to the camera's true 3D orientation
                direction.applyQuaternion(this.core.camera.quaternion);

                const speed = 300.0 * (input.isHeld('SPRINT') ? 4.0 : 1.0);
                this.core.camera.position.addScaledVector(direction, speed * dt);
            }
        }
        
        // Update the camera manager transforms
        this.cameraManager.update(dt);
    }
}
