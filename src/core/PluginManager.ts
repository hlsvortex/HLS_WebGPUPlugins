export class PluginManager {
    core: any;
    plugins: Map<string, any>;

    constructor(coreDeps: any) {
        this.core = coreDeps || {};
        this.plugins = new Map();
    }

    register(name: string, plugin: any) {
        if (this.plugins.has(name)) {
            console.warn(`[PluginManager] Plugin '${name}' is already registered.`);
            return;
        }
        plugin.core = this.core;
        plugin._pluginName = name;
        this.plugins.set(name, plugin);
        console.log(`[PluginManager] Registered plugin: ${name}`);
    }

    get(name: string) {
        return this.plugins.get(name);
    }

    async initAll() {
        for (const [name, plugin] of this.plugins.entries()) {
            try {
                if (typeof plugin.init === 'function') {
                    await plugin.init();
                    console.log(`[PluginManager] Initialized: ${name}`);
                }
            } catch (err) {
                console.error(`[PluginManager] Error initializing plugin '${name}':`, err);
            }
        }
    }

    updateAll(deltaTime: number) {
        const debugUI = this.core.debugUI;
        for (const [name, plugin] of this.plugins.entries()) {
            if (typeof plugin.update === 'function') {
                // Skip update if the plugin is disabled via the UI
                if (debugUI && !debugUI.isPluginEnabled(name)) continue;
                plugin.update(deltaTime);
            }
        }
    }

    disposeAll() {
        for (const plugin of this.plugins.values()) {
            if (typeof plugin.dispose === 'function') {
                plugin.dispose();
            }
        }
        this.plugins.clear();
    }
}
