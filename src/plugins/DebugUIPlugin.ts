/**
 * DebugUIPlugin.ts — Plugin Manager & Settings Panel
 * 
 * Each plugin gets its own collapsible panel with:
 *  - Enable/Disable toggle
 *  - Collapsible settings sections  
 *  - Sliders, color pickers, and value readouts
 *  - Global Save/Load/Regenerate controls
 * 
 * Toggle with Ctrl+F9
 */

const STORAGE_KEY = 'webgpu_pluginSettings';

interface PluginPanel {
    name: string;
    icon: string;
    color: string;
    enabled: boolean;
    container: HTMLDivElement;
    header: HTMLDivElement;
    content: HTMLDivElement;
    collapsed: boolean;
    onEnable?: () => void;
    onDisable?: () => void;
}

export class DebugUIPlugin {
    core: any;
    params: Record<string, any>;
    _visible: boolean;
    _panel: HTMLDivElement | null;
    _pluginPanels: Map<string, PluginPanel>;
    _regenerateCallbacks: Set<(params: any) => void>;
    _styles: HTMLStyleElement | null;

    constructor() {
        this.params = {};
        this._visible = false;
        this._panel = null;
        this._pluginPanels = new Map();
        this._regenerateCallbacks = new Set();
        this._styles = null;
    }

    async init() {
        this._loadSettings();
        this._injectStyles();
        this._buildBasePanel();
        this._bindToggle();
        
        this.core.debugUI = this;
        console.log('[DebugUIPlugin] Plugin Manager initialized.');
    }

    // ─── Public API ───────────────────────────────────────────────

    /** Register a callback to fire when the user hits Regenerate */
    onRegenerate(callback: (params: any) => void) {
        this._regenerateCallbacks.add(callback);
    }

    /** Register a collapsible plugin panel */
    registerPlugin(name: string, icon: string, color: string, opts?: {
        category?: string;
        onEnable?: () => void;
        onDisable?: () => void;
    }) {
        if (this._pluginPanels.has(name)) return this._pluginPanels.get(name)!;

        const category = opts?.category || 'Misc';

        // Ensure category container exists
        const catId = `pm-category-${category.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        let categoryContainer = document.getElementById(catId);
        
        if (!categoryContainer) {
            categoryContainer = document.createElement('div');
            categoryContainer.id = catId;
            categoryContainer.className = 'pm-category';
            
            const catHeader = document.createElement('div');
            catHeader.className = 'pm-category-header';
            catHeader.textContent = category.toUpperCase();
            
            categoryContainer.appendChild(catHeader);
            // We'll append it to DOM later when we have the panel reference
        }

        const container = document.createElement('div');
        container.className = 'pm-plugin';

        // Header bar with toggle + collapse
        const header = document.createElement('div');
        header.className = 'pm-plugin-header';
        header.style.borderLeftColor = color;

        // Enable checkbox
        const enabledKey = `_enabled_${name}`;
        const isEnabled = this.params[enabledKey] !== undefined ? !!this.params[enabledKey] : true;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isEnabled;
        checkbox.className = 'pm-toggle';
        checkbox.title = `Enable/Disable ${name}`;

        const title = document.createElement('span');
        title.className = 'pm-plugin-title';
        title.textContent = `${icon} ${name}`;
        title.style.color = color;

        const collapseBtn = document.createElement('span');
        collapseBtn.className = 'pm-collapse-btn';
        collapseBtn.textContent = '▼';

        header.appendChild(checkbox);
        header.appendChild(title);
        header.appendChild(collapseBtn);

        // Content area
        const content = document.createElement('div');
        content.className = 'pm-plugin-content';

        container.appendChild(header);
        container.appendChild(content);

        const panel: PluginPanel = {
            name, icon, color,
            enabled: isEnabled,
            container, header, content,
            collapsed: false,
            onEnable: opts?.onEnable,
            onDisable: opts?.onDisable
        };

        // Toggle collapse
        const toggleCollapse = () => {
            panel.collapsed = !panel.collapsed;
            content.style.display = panel.collapsed ? 'none' : 'block';
            collapseBtn.textContent = panel.collapsed ? '▶' : '▼';
        };
        title.addEventListener('click', toggleCollapse);
        collapseBtn.addEventListener('click', toggleCollapse);

        // Enable/disable
        checkbox.addEventListener('change', () => {
            panel.enabled = checkbox.checked;
            this.params[enabledKey] = panel.enabled ? 1 : 0;
            content.style.opacity = panel.enabled ? '1' : '0.3';
            content.style.pointerEvents = panel.enabled ? 'auto' : 'none';

            if (panel.enabled && panel.onEnable) panel.onEnable();
            if (!panel.enabled && panel.onDisable) panel.onDisable();
        });

        // Apply initial state
        if (!isEnabled) {
            content.style.opacity = '0.3';
            content.style.pointerEvents = 'none';
            if (opts?.onDisable) opts.onDisable();
        } else {
            // Delay onEnable slightly so all plugins finish init before callbacks fire
            setTimeout(() => {
                if (panel.enabled && opts?.onEnable) opts.onEnable();
            }, 0);
        }

        this._pluginPanels.set(name, panel);

        // Insert category container before buttons if it's new
        if (this._panel && !categoryContainer!.parentNode) {
            const btnRow = this._panel.querySelector('.pm-buttons');
            this._panel.insertBefore(categoryContainer!, btnRow);
        }
        
        // Append plugin to category
        categoryContainer!.appendChild(container);

        return panel;
    }

    /** Add a section header inside a plugin panel */
    addSection(pluginName: string, sectionName: string, sectionColor: string = '#7cf') {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        const sec = document.createElement('div');
        sec.className = 'pm-section';
        sec.style.color = sectionColor;
        sec.style.borderBottomColor = sectionColor + '44';
        sec.textContent = sectionName;
        panel.content.appendChild(sec);
    }

    /** Add a standard numeric slider inside a plugin's panel */
    addSlider(pluginName: string, key: string, label: string, min: number, max: number, step: number, defaultValue: number, tooltip: string, onChange: (val: number) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        // Initialize param if not loaded from storage
        if (this.params[key] === undefined) {
            this.params[key] = defaultValue;
        }

        const row = document.createElement('div');
        row.className = 'pm-slider-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-slider-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = min.toString();
        input.max = max.toString();
        input.step = step.toString();
        input.value = this.params[key].toString();
        input.className = 'pm-slider';

        const val = document.createElement('span');
        val.className = 'pm-slider-value';
        const decimals = step < 0.001 ? 5 : step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
        val.textContent = Number(this.params[key]).toFixed(decimals);

        input.addEventListener('input', () => {
            this.params[key] = parseFloat(input.value);
            val.textContent = Number(this.params[key]).toFixed(decimals);
            if (panel.enabled && onChange) onChange(this.params[key]);
        });

        // Fire initial callback
        if (onChange) onChange(this.params[key]);

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(val);
        panel.content.appendChild(row);
    }

    /** Add a standard button inside a plugin's panel */
    addButton(pluginName: string, label: string, onClick: () => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        const row = document.createElement('div');
        row.className = 'pm-slider-row'; // reuse row styling for padding

        const btn = document.createElement('button');
        btn.className = 'pm-action-btn';
        btn.textContent = label;
        btn.addEventListener('click', onClick);

        row.appendChild(btn);
        panel.content.appendChild(row);
    }

    /** Add a color picker */
    addColor(pluginName: string, key: string, label: string, defaultHex: string, tooltip: string, onChange: (hex: string) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) {
            this.params[key] = defaultHex;
        }

        const row = document.createElement('div');
        row.className = 'pm-slider-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-slider-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'color';
        input.value = this.params[key];
        input.className = 'pm-color-picker';

        const val = document.createElement('span');
        val.className = 'pm-slider-value';
        val.textContent = this.params[key];

        input.addEventListener('input', () => {
            this.params[key] = input.value;
            val.textContent = input.value;
            if (panel.enabled) onChange(input.value);
        });

        onChange(this.params[key]);

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(val);
        panel.content.appendChild(row);
    }

    /** Add a boolean toggle switch */
    addToggle(pluginName: string, key: string, label: string, defaultValue: boolean, tooltip: string, onChange: (val: boolean) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) {
            this.params[key] = defaultValue ? 1 : 0;
        }

        const row = document.createElement('div');
        row.className = 'pm-slider-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-slider-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!this.params[key];
        input.className = 'pm-toggle';
        input.style.cssText = 'margin-left: 4px;';

        const val = document.createElement('span');
        val.className = 'pm-slider-value';
        val.textContent = input.checked ? 'ON' : 'OFF';
        val.style.color = input.checked ? '#4f8' : '#f84';

        input.addEventListener('change', () => {
            this.params[key] = input.checked ? 1 : 0;
            val.textContent = input.checked ? 'ON' : 'OFF';
            val.style.color = input.checked ? '#4f8' : '#f84';
            if (panel.enabled && onChange) onChange(input.checked);
        });

        if (onChange) onChange(!!this.params[key]);

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(val);
        panel.content.appendChild(row);
    }

    /** Add a text input */
    addText(pluginName: string, key: string, label: string, defaultValue: string, tooltip: string, onChange: ((val: string) => void) | null) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) {
            this.params[key] = defaultValue;
        }

        const row = document.createElement('div');
        row.className = 'pm-slider-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-slider-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.params[key];
        input.className = 'pm-text-input';
        input.style.cssText = 'flex: 1; background: rgba(0,0,0,0.4); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-size: 11px; margin-left: 8px;';

        input.addEventListener('change', () => {
            this.params[key] = input.value;
            if (panel.enabled && onChange) onChange(input.value);
        });

        row.appendChild(lbl);
        row.appendChild(input);
        panel.content.appendChild(row);
    }

    /** Add a read-only stats display line */
    addReadout(pluginName: string, label: string): HTMLSpanElement {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return document.createElement('span');

        const row = document.createElement('div');
        row.className = 'pm-slider-row';

        const lbl = document.createElement('span');
        lbl.className = 'pm-slider-label';
        lbl.textContent = label;

        const val = document.createElement('span');
        val.className = 'pm-readout-value';
        val.textContent = '—';

        row.appendChild(lbl);
        row.appendChild(val);
        panel.content.appendChild(row);
        return val;
    }

    /** Check if a plugin is currently enabled */
    isPluginEnabled(name: string): boolean {
        const panel = this._pluginPanels.get(name);
        return panel ? panel.enabled : true;
    }

    /** Programmatically toggle a plugin's state */
    togglePlugin(name: string, forceState?: boolean) {
        const panel = this._pluginPanels.get(name);
        if (!panel) return;
        
        const checkbox = panel.header.querySelector('.pm-toggle') as HTMLInputElement;
        if (checkbox) {
            const newState = forceState !== undefined ? forceState : !checkbox.checked;
            if (checkbox.checked !== newState) {
                checkbox.checked = newState;
                checkbox.dispatchEvent(new Event('change'));
            }
        }
    }

    // ─── Panel Construction ───────────────────────────────────────

    _injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #plugin-manager-panel {
                position: fixed; top: 10px; left: 10px; z-index: 99999;
                background: rgba(12,12,18,0.94); color: #eee; font: 12px 'Segoe UI', monospace;
                padding: 0; border-radius: 10px; display: none;
                max-height: 92vh; overflow-y: auto; width: 320px;
                border: 1px solid rgba(120,180,255,0.2);
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                backdrop-filter: blur(12px);
            }
            #plugin-manager-panel::-webkit-scrollbar { width: 6px; }
            #plugin-manager-panel::-webkit-scrollbar-thumb { background: rgba(120,180,255,0.3); border-radius: 3px; }
            #plugin-manager-panel::-webkit-scrollbar-track { background: transparent; }
            
            .pm-category {
                margin-bottom: 8px;
            }
            .pm-category-header {
                padding: 4px 10px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
                color: #8899aa;
                margin-top: 8px;
                margin-bottom: 4px;
                text-transform: uppercase;
                border-bottom: 1px solid rgba(255,255,255,0.05);
            }
            .pm-header {
                padding: 12px 16px 8px;
                font-size: 13px; font-weight: 700;
                color: #7cf; letter-spacing: 0.5px;
                border-bottom: 1px solid rgba(120,180,255,0.15);
                position: sticky; top: 0; z-index: 1;
                background: rgba(12,12,18,0.98);
                border-radius: 10px 10px 0 0;
            }
            .pm-header-sub { font-size: 10px; color: #556; font-weight: 400; margin-top: 2px; }

            .pm-plugin {
                margin: 0; border-bottom: 1px solid rgba(255,255,255,0.05);
            }
            .pm-plugin-header {
                display: flex; align-items: center; gap: 6px;
                padding: 7px 12px; cursor: pointer;
                background: rgba(255,255,255,0.03);
                border-left: 3px solid #7cf;
                transition: background 0.15s;
            }
            .pm-plugin-header:hover { background: rgba(255,255,255,0.07); }

            .pm-toggle {
                width: 14px; height: 14px; cursor: pointer;
                accent-color: #5af; flex-shrink: 0;
            }
            .pm-plugin-title {
                flex: 1; font-size: 11px; font-weight: 600;
                letter-spacing: 0.3px; cursor: pointer; user-select: none;
            }
            .pm-collapse-btn {
                font-size: 9px; color: #556; cursor: pointer; user-select: none;
                padding: 2px 4px; transition: color 0.15s;
            }
            .pm-collapse-btn:hover { color: #aaa; }

            .pm-plugin-content {
                padding: 4px 14px 8px;
                transition: opacity 0.2s;
            }

            .pm-section {
                font-weight: 600; margin: 8px 0 3px; padding-bottom: 2px;
                font-size: 10px; letter-spacing: 0.3px;
                border-bottom: 1px solid;
            }

            .pm-slider-row {
                display: flex; align-items: center; margin: 2px 0; gap: 4px;
            }
            .pm-slider-label {
                width: 100px; text-align: right; color: #778; font-size: 10px;
                flex-shrink: 0;
            }
            .pm-slider {
                flex: 1; accent-color: #5af; height: 14px; cursor: pointer;
            }
            .pm-slider-value {
                width: 48px; text-align: left; color: #ff0; font-size: 10px;
                font-family: monospace; flex-shrink: 0;
            }
            .pm-readout-value {
                flex: 1; text-align: left; color: #8cf; font-size: 10px;
                font-family: monospace;
            }
            .pm-color-picker {
                width: 32px; height: 20px; border: none; cursor: pointer;
                background: none; padding: 0;
            }

            .pm-buttons {
                display: flex; gap: 5px; padding: 8px 12px;
                border-top: 1px solid rgba(120,180,255,0.12);
                position: sticky; bottom: 0;
                background: rgba(12,12,18,0.98);
                border-radius: 0 0 10px 10px;
            }
            .pm-btn {
                flex: 1; padding: 6px 4px; border: none; border-radius: 4px;
                cursor: pointer; font: bold 11px 'Segoe UI', monospace;
                color: white; transition: filter 0.15s;
            }
            .pm-action-btn {
                width: 100%; padding: 6px 4px; border: none; border-radius: 4px;
                cursor: pointer; font: bold 11px 'Segoe UI', monospace;
                background: rgba(255,255,255,0.1); color: #fff;
                transition: background 0.15s; margin-top: 4px;
            }
            .pm-action-btn:hover { background: rgba(255,255,255,0.2); }
            .pm-btn-reload { background: #d44; color: #fff; }
            .pm-btn:hover { filter: brightness(1.2); }
            .pm-btn:active { filter: brightness(0.9); }
            .pm-btn-regen { background: #2a6; flex: 2; }
            .pm-btn-save { background: #46a; }
            .pm-btn-export { background: #555; }
        `;
        document.head.appendChild(style);
        this._styles = style;
    }

    _buildBasePanel() {
        const panel = document.createElement('div');
        panel.id = 'plugin-manager-panel';

        // Title
        const header = document.createElement('div');
        header.className = 'pm-header';
        header.innerHTML = `⚙️ Plugin Manager <span class="pm-header-sub">Ctrl+F9 to toggle</span>`;
        panel.appendChild(header);

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.className = 'pm-buttons';

        const btnRegen = document.createElement('button');
        btnRegen.textContent = '🔄 Regenerate';
        btnRegen.className = 'pm-btn pm-btn-regen';
        btnRegen.addEventListener('click', () => {
            btnRegen.textContent = '⏳ Working...';
            btnRegen.disabled = true;
            setTimeout(() => {
                for (const cb of this._regenerateCallbacks) cb(this.params);
                btnRegen.textContent = '🔄 Regenerate';
                btnRegen.disabled = false;
            }, 50);
        });

        const btnSave = document.createElement('button');
        btnSave.textContent = '💾 Save';
        btnSave.className = 'pm-btn pm-btn-save';
        btnSave.addEventListener('click', () => {
            this._saveSettings();
            btnSave.textContent = '✅ Saved!';
            setTimeout(() => { btnSave.textContent = '💾 Save'; }, 1500);
        });

        const btnExport = document.createElement('button');
        btnExport.textContent = '📋 Export';
        btnExport.className = 'pm-btn pm-btn-export';
        btnExport.addEventListener('click', () => {
            const json = JSON.stringify(this.params, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                btnExport.textContent = '✅ Copied!';
                setTimeout(() => { btnExport.textContent = '📋 Export'; }, 1500);
            });
            console.log('[PluginManager] Settings exported:\n', json);
        });

        btnRow.appendChild(btnRegen);
        btnRow.appendChild(btnSave);
        btnRow.appendChild(btnExport);
        panel.appendChild(btnRow);

        // Prevent interacting with the UI from triggering game inputs
        const stopProp = (e: Event) => e.stopPropagation();
        panel.addEventListener('mousedown', stopProp);
        panel.addEventListener('mousemove', stopProp);
        panel.addEventListener('mouseup', stopProp);
        panel.addEventListener('wheel', stopProp);
        panel.addEventListener('keydown', stopProp);
        panel.addEventListener('keyup', stopProp);

        document.body.appendChild(panel);
        this._panel = panel;
    }

    _saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params));
            console.log('[DebugUIPlugin] Settings saved to localStorage');
        } catch (e) {
            console.warn('[DebugUIPlugin] Failed to save settings:', e);
        }
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                Object.assign(this.params, saved);
                console.log('[DebugUIPlugin] Settings loaded from localStorage');
            }
        } catch (e) {
            console.warn('[DebugUIPlugin] Failed to load settings:', e);
        }
    }

    _bindToggle() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F9' && e.ctrlKey) {
                this._visible = !this._visible;
                if (this._panel) this._panel.style.display = this._visible ? 'block' : 'none';
            }
        });
    }

    show() {
        this._visible = true;
        if (this._panel) this._panel.style.display = 'block';
    }

    update() {}
    
    dispose() {
        if (this._panel) this._panel.remove();
        if (this._styles) this._styles.remove();
    }
}
