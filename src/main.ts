import './style.css'
import * as THREE from 'three/webgpu';
import Stats from 'three/addons/libs/stats.module.js';
import { InputPlugin } from './plugins/InputPlugin';
import { CameraPlugin } from './plugins/CameraPlugin';
import { PluginManager } from './core/PluginManager';
import { DebugUIPlugin } from './plugins/DebugUIPlugin';
import { IBLPlugin } from './plugins/IBLPlugin';
import { TerrainPlugin } from './plugins/TerrainPlugin';
import { WaterPlugin } from './plugins/WaterPlugin';
import { GrassPlugin } from './plugins/GrassPlugin';
import { SkyPlugin } from './plugins/SkyPlugin';
import { PostProcessPlugin } from './plugins/PostProcessPlugin';
import { PlayerControllerPlugin } from './plugins/PlayerControllerPlugin';
import { HeightFogPlugin } from './plugins/HeightFogPlugin';
import { CSMPlugin } from './plugins/CSMPlugin';

async function init() {
    // 1. Setup Three.js WebGPU Renderer
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    document.querySelector<HTMLDivElement>('#app')!.appendChild(renderer.domElement);
    
    await renderer.init();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;

    // 2. Setup Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8899bb);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1.0, 25000);
    camera.position.set(-2000, 5500, 5000);
    camera.lookAt(0, 500, 0);

    // 3. Setup Basic Lighting
    const ambientLight = new THREE.AmbientLight(0x8899bb, 0.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffee, 3.0);
    sunLight.position.set(1000, 2000, 1000);
    sunLight.castShadow = true;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 15000;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const lightingSystem = { sunLight };

    // 4. Boot PluginManager
    const coreDeps: Record<string, any> = {
        renderer,
        scene,
        camera,
        lightingSystem,
        onProgress: (msg: string, percent: number) => {
            console.log(`[Loading ${percent}%] ${msg}`);
        }
    };

    const pluginManager = new PluginManager(coreDeps);
    pluginManager.register('DebugUI', new DebugUIPlugin());
    pluginManager.register('IBL', new IBLPlugin());
    pluginManager.register('Sky', new SkyPlugin());
    pluginManager.register('Input', new InputPlugin(coreDeps));
    pluginManager.register('Camera', new CameraPlugin(coreDeps));
    pluginManager.register('Terrain', new TerrainPlugin());
    pluginManager.register('Water', new WaterPlugin());
    pluginManager.register('Grass', new GrassPlugin());
    pluginManager.register('HeightFog', new HeightFogPlugin());
    pluginManager.register('PostProcess', new PostProcessPlugin());
    pluginManager.register('Player', new PlayerControllerPlugin());
    pluginManager.register('CSM', new CSMPlugin());

    await pluginManager.initAll();

    // Show debug UI natively
    if (coreDeps.debugUI) {
        coreDeps.debugUI.show();
    }

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    // 5. Render Loop
    let lastTime = performance.now();
    function animate() {
        requestAnimationFrame(animate);
        stats.update();
        
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        
        pluginManager.updateAll(dt);

        if (coreDeps.postProcessing) {
            coreDeps.postProcessing.render();
        } else {
            renderer.render(scene, camera);
        }
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

init().catch(console.error);
