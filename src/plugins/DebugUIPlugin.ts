/**
 * DebugUIPlugin.ts — Two-Panel Plugin Manager
 * 
 * LEFT:  Narrow icon sidebar with one tab per plugin.
 * RIGHT: Detail panel showing the selected plugin's settings.
 * 
 * Toggle with Ctrl+F9
 */

const STORAGE_KEY = 'webgpu_pluginSettings';

interface PluginPanel {
    name: string;
    icon: string;
    color: string;
    category: string;
    enabled: boolean;
    tab: HTMLDivElement;
    content: HTMLDivElement;
    collapsed: boolean;
    onEnable?: () => void;
    onDisable?: () => void;
}

export class DebugUIPlugin {
    core: any;
    params: Record<string, any>;
    _visible: boolean;
    _root: HTMLDivElement | null;
    _sidebar: HTMLDivElement | null;
    _sidebarTop: HTMLDivElement | null;
    _sidebarBottom: HTMLDivElement | null;
    _detail: HTMLDivElement | null;
    _detailHeader: HTMLDivElement | null;
    _detailBody: HTMLDivElement | null;
    _pluginPanels: Map<string, PluginPanel>;
    _activePlugin: string | null;
    _regenerateCallbacks: Set<(params: any) => void>;
    _styles: HTMLStyleElement | null;

    constructor() {
        this.params = {
            "envIntensity": 0.5,
            "toneMappingExposure": 1.3,
            "sunIntensity": 1.8,
            "sunPosX": 1000,
            "sunPosY": 2000,
            "sunPosZ": 1000,
            "shadowsEnabled": 1,
            "shadowMapSize": 8192,
            "shadowBias": 0.005,
            "shadowNear": 491,
            "shadowFar": 10500,
            "shadowExtent": 4000,
            "ambientIntensity": 0.35,
            "timeOfDay": 6.75,
            "cycleSpeed": 0,
            "autoRotate": 0,
            "skyTopDay": "#2e66d9",
            "skyBottomDay": "#a6c7eb",
            "skyTopNight": "#1d1d49",
            "skyBottomNight": "#404763",
            "sunsetTint": "#ff7326",
            "horizonHaze": 0.45,
            "sunColor": "#fff2cc",
            "sunSize": 0.03,
            "sunGlowSize": 0.15,
            "starDensity": 800,
            "starBrightness": 1.4,
            "moonGlow": 1.5,
            "Add Trauma": "Test camera shake",
            "coastPV": 0.29,
            "powerCurve": 2.1,
            "baseOffset": 0.005,
            "baseOffsetFalloff": 0.27,
            "beachFlatness": 0.35,
            "beachShelfFalloff": 0.1,
            "procHMult": 0.66,
            "procHBase": 0.01,
            "beachThreshold": 0.02,
            "snowThreshold": 0.62,
            "mountainThreshold": 0.7,
            "moistureThreshold": 0.65,
            "terracingStrength": 0.75,
            "blurRadius": 4,
            "detailAmp": 3,
            "cliffStrength": 3,
            "riverCarving": 2,
            "riverFalloff": 0.5,
            "underwaterSuppress": 1,
            "maxDepth": 8,
            "lodSplitMultiplier": 3,
            "chunkSegments": 24,
            "heightScale": 1200,
            "terrainSize": 8000,
            "terrainReceiveShadows": 1,
            "terrainCastShadows": 1,
            "waterLevelY": -3,
            "waveSpeed": 1.8,
            "wavePrimaryAmp": 0.15,
            "waveSecondaryAmp": 0.09,
            "waterRoughness": 0.02,
            "waterMetalness": 0.95,
            "waterOpacityShallow": 0.45,
            "waterOpacityDeep": 0.98,
            "waterFresnelStrength": 0.35,
            "waterFoamIntensity": 1.2,
            "waterMeshRes": 512,
            "fogDensity": 0.00015,
            "grassViewNear": 250,
            "grassViewFar": 630,
            "grassBladeWidth": 0.04,
            "grassBladeHeight": 1.1,
            "grassInstances": 35000,
            "grassRootGreen": "#36bf36",
            "grassTipGreen": "#409426",
            "grassRootStraw": "#1e6b2b",
            "grassTipStraw": "#ffffff",
            "grassStrawBlend": 0.05,
            "grassBrightness": 1.7,
            "grassSaturation": 1.05,
            "grassGroundBlend": 1,
            "grassWindSpeed": 1.1,
            "grassWindSway": 1,
            "grassWindGust": 0.35,
            "grassInteractRadius": 5,
            "grassInteractStrength": 2.7,
            "grassProximityNear": 2.5,
            "grassProximityFar": 50,
            "densityBeach": 0.2,
            "densityGrass": 0.5,
            "densityForest": 0.65,
            "densityPine": 0.75,
            "densityRedwood": 0.9,
            "densityJungle": 0.65,
            "densitySwamp": 0.55,
            "densityMountain": 0.3,
            "densitySnow": 0.4,
            "grassReceiveShadows": 1,
            "grassCastShadows": 0,
            "bloomStrength": 0.5,
            "bloomRadius": 0.4,
            "bloomThreshold": 0.8,
            "contrast": 1.05,
            "saturation": 1.45,
            "vignette": 0.75,
            "walkSpeed": 6,
            "sprintMultiplier": 1.8,
            "jumpForce": 12,
            "playerHeight": 1.7,
            "_enabled_Player": 0,
            "shootingStarDensity": 0.1,
            "auroraIntensity": 0.3,
            "auroraSpeed": 0.7,
            "auroraColor1": "#1aff80",
            "auroraColor2": "#9933ff",
            "fogStartDist": 70,
            "maxOpacity": 1,
            "fogBaseHeight": 80,
            "fogFalloff": 0.00001,
            "noiseStrength": 0.2,
            "noiseSpeed": 0.6,
            "noiseScale": 0.0089,
            "fogColorR": 0.58,
            "fogColorG": 0.74,
            "fogColorB": 0.87,
            "_enabled_Height Fog": 1,
            "toneMapSelect": 0,
            "iblHorizon": "#d9e6f2",
            "iblZenith": "#4072d9",
            "iblSunBake": 1,
            "autoRebake": 0,
            "fillIntensity": 0.25,
            "fillColor": "#6699cc",
            "hemiIntensity": 0.6,
            "hemiSkyColor": "#8ba4d4",
            "hemiGroundColor": "#4a3828",
            "shadowTypeSelect": 0,
            "cloudCoverage": 0.54,
            "cloudSoftness": 0.5,
            "cloudScale": 1.25,
            "cloudSpeed": 0.285,
            "cloudHeight": 0.02,
            "cloudColor": "#ffffff",
            "cloudShadow": "#99a6b8",
            "cloudGroundShadow": 0.35,
            "cameraTrauma": 0,
            "proceduralMode": 0,
            "procIslandSize": 0.45,
            "procNoiseScale": 3,
            "procNoiseAmp": 0.4,
            "procMountainChance": 0.5,
            "procHillsHeight": 0.3,
            "procSeed": 1,
            "heightmapUrl": "./heightmap.png",
            "rivermapUrl": "./heightmap_rivers.png",
            "shoreR": 0.1,
            "shoreG": 0.6,
            "shoreB": 0.5,
            "deepR": 0.01,
            "deepG": 0.08,
            "deepB": 0.22,
            "foamR": 0.92,
            "foamG": 0.96,
            "foamB": 0.98,
            "fogColor": "#91beee",
            "temperature": 0,
            "tint": 0,
            "filmGrain": 0.01,
            "_enabled_Grass": 1
        };
        this._visible = false;
        this._root = null;
        this._sidebar = null;
        this._sidebarTop = null;
        this._sidebarBottom = null;
        this._detail = null;
        this._detailHeader = null;
        this._detailBody = null;
        this._pluginPanels = new Map();
        this._activePlugin = null;
        this._regenerateCallbacks = new Set();
        this._styles = null;
    }

    async init() {
        this._loadSettings();
        this._injectStyles();
        this._buildLayout();
        this._bindToggle();
        
        this.core.debugUI = this;
        console.log('[DebugUIPlugin] Plugin Manager initialized.');
    }

    // ─── Public API ───────────────────────────────────────────────

    /** Check if a plugin is enabled (used by PluginManager to gate updates) */
    isPluginEnabled(name: string): boolean {
        const panel = this._pluginPanels.get(name);
        if (!panel) return true;
        return panel.enabled;
    }

    /** Register a callback to fire when the user hits Regenerate */
    onRegenerate(callback: (params: any) => void) {
        this._regenerateCallbacks.add(callback);
    }

    /** Register a plugin — creates its sidebar tab and content container */
    registerPlugin(name: string, icon: string, color: string, opts?: {
        category?: string;
        onEnable?: () => void;
        onDisable?: () => void;
    }) {
        if (this._pluginPanels.has(name)) return this._pluginPanels.get(name)!;
        const category = opts?.category || 'Rendering';

        // ── Sidebar tab ──────────────────────────────────────────────
        const tab = document.createElement('div');
        tab.className = 'pm-tab';
        tab.title = name;
        tab.innerHTML = `<span class="pm-tab-icon">${icon}</span><span class="pm-tab-label">${name}</span>`;
        tab.style.setProperty('--tab-color', color);

        // ── Content container (hidden until selected) ────────────────
        const content = document.createElement('div');
        content.className = 'pm-content-pane';
        content.style.display = 'none';

        const enabledKey = `_enabled_${name}`;
        const isEnabled = this.params[enabledKey] !== undefined ? !!this.params[enabledKey] : true;

        const panel: PluginPanel = {
            name, icon, color, category,
            enabled: isEnabled,
            tab, content,
            collapsed: false,
            onEnable: opts?.onEnable,
            onDisable: opts?.onDisable
        };

        // Click tab → show this plugin
        tab.addEventListener('click', () => this._selectPlugin(name));

        this._pluginPanels.set(name, panel);

        // Append to sidebar — Core/Gameplay go to bottom, everything else to top
        const isBottom = category === 'Core' || category === 'Gameplay';
        const sidebarSection = isBottom ? this._sidebarBottom! : this._sidebarTop!;
        sidebarSection.appendChild(tab);
        this._detailBody!.appendChild(content);

        // Apply initial disabled state
        if (!isEnabled) {
            if (opts?.onDisable) opts.onDisable();
        } else {
            setTimeout(() => {
                if (panel.enabled && opts?.onEnable) opts.onEnable();
            }, 0);
        }

        // Auto-select first plugin
        if (!this._activePlugin) {
            this._selectPlugin(name);
        }

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

    /** Add a standard numeric slider */
    addSlider(pluginName: string, key: string, label: string, min: number, max: number, step: number, defaultValue: number, tooltip: string, onChange: (val: number) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) this.params[key] = defaultValue;

        const row = document.createElement('div');
        row.className = 'pm-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = min.toString();
        input.max = max.toString();
        input.step = step.toString();
        input.value = this.params[key].toString();
        input.className = 'pm-slider';

        const val = document.createElement('span');
        val.className = 'pm-value';
        const decimals = step < 0.001 ? 5 : step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
        val.textContent = Number(this.params[key]).toFixed(decimals);

        input.addEventListener('input', () => {
            this.params[key] = parseFloat(input.value);
            val.textContent = Number(this.params[key]).toFixed(decimals);
            if (panel.enabled && onChange) onChange(this.params[key]);
        });
        if (onChange) onChange(this.params[key]);

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(val);
        panel.content.appendChild(row);
    }

    /** Add a button */
    addButton(pluginName: string, label: string, onClick: () => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        const row = document.createElement('div');
        row.className = 'pm-row';

        const btn = document.createElement('button');
        btn.className = 'pm-btn-action';
        btn.textContent = label;
        btn.addEventListener('click', onClick);

        row.appendChild(btn);
        panel.content.appendChild(row);
    }

    /** Add a dropdown select */
    addDropdown(pluginName: string, key: string, label: string, options: {label: string, value: any}[], defaultIdx: number, tooltip: string, onChange: (val: any) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) this.params[key] = defaultIdx;

        const row = document.createElement('div');
        row.className = 'pm-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const select = document.createElement('select');
        select.className = 'pm-select';
        options.forEach((opt, idx) => {
            const el = document.createElement('option');
            el.value = idx.toString();
            el.textContent = opt.label;
            select.appendChild(el);
        });
        select.value = this.params[key].toString();

        select.addEventListener('change', () => {
            const idx = parseInt(select.value, 10);
            this.params[key] = idx;
            if (panel.enabled) onChange(options[idx].value);
        });
        onChange(options[this.params[key]].value);

        row.appendChild(lbl);
        row.appendChild(select);
        panel.content.appendChild(row);
    }

    /** Add a color picker */
    addColor(pluginName: string, key: string, label: string, defaultHex: string, tooltip: string, onChange: (hex: string) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) this.params[key] = defaultHex;

        const row = document.createElement('div');
        row.className = 'pm-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'color';
        input.value = this.params[key];
        input.className = 'pm-color';

        const val = document.createElement('span');
        val.className = 'pm-value';
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

    /** Add a boolean toggle */
    addToggle(pluginName: string, key: string, label: string, defaultValue: boolean, tooltip: string, onChange: (val: boolean) => void) {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return;

        if (this.params[key] === undefined) this.params[key] = defaultValue ? 1 : 0;

        const row = document.createElement('div');
        row.className = 'pm-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!this.params[key];
        input.className = 'pm-check';

        const val = document.createElement('span');
        val.className = 'pm-value';
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

        if (this.params[key] === undefined) this.params[key] = defaultValue;

        const row = document.createElement('div');
        row.className = 'pm-row';
        if (tooltip) row.title = tooltip;

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.params[key];
        input.className = 'pm-text';

        input.addEventListener('change', () => {
            this.params[key] = input.value;
            if (panel.enabled && onChange) onChange(input.value);
        });

        row.appendChild(lbl);
        row.appendChild(input);
        panel.content.appendChild(row);
    }

    /** Add a read-only stats display */
    addReadout(pluginName: string, label: string): HTMLSpanElement {
        const panel = this._pluginPanels.get(pluginName);
        if (!panel) return document.createElement('span');

        const row = document.createElement('div');
        row.className = 'pm-row';

        const lbl = document.createElement('span');
        lbl.className = 'pm-label';
        lbl.textContent = label;

        const val = document.createElement('span');
        val.className = 'pm-readout';
        val.textContent = '—';

        row.appendChild(lbl);
        row.appendChild(val);
        panel.content.appendChild(row);
        return val;
    }

    /** Programmatically toggle a plugin's state */
    togglePlugin(name: string, forceState?: boolean) {
        const panel = this._pluginPanels.get(name);
        if (!panel) return;
        const newState = forceState !== undefined ? forceState : !panel.enabled;
        if (panel.enabled !== newState) {
            panel.enabled = newState;
            const enabledKey = `_enabled_${name}`;
            this.params[enabledKey] = newState ? 1 : 0;
            if (newState && panel.onEnable) panel.onEnable();
            if (!newState && panel.onDisable) panel.onDisable();
            // Update the enable checkbox if this plugin is currently shown
            if (this._activePlugin === name) this._selectPlugin(name);
        }
    }

    // ─── Internal: Selection ──────────────────────────────────────

    _selectPlugin(name: string) {
        const panel = this._pluginPanels.get(name);
        if (!panel) return;

        // Deselect old
        for (const [n, p] of this._pluginPanels.entries()) {
            p.tab.classList.toggle('pm-tab--active', n === name);
            p.content.style.display = n === name ? 'block' : 'none';
        }

        // Update detail header
        if (this._detailHeader) {
            this._detailHeader.innerHTML = '';

            // Enable toggle
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = panel.enabled;
            checkbox.className = 'pm-check';
            checkbox.title = `Enable/Disable ${name}`;
            checkbox.addEventListener('change', () => {
                panel.enabled = checkbox.checked;
                const enabledKey = `_enabled_${name}`;
                this.params[enabledKey] = panel.enabled ? 1 : 0;
                panel.content.style.opacity = panel.enabled ? '1' : '0.3';
                panel.content.style.pointerEvents = panel.enabled ? 'auto' : 'none';
                if (panel.enabled && panel.onEnable) panel.onEnable();
                if (!panel.enabled && panel.onDisable) panel.onDisable();
            });

            const title = document.createElement('span');
            title.className = 'pm-detail-title';
            title.textContent = `${panel.icon} ${name}`;
            title.style.color = panel.color;

            this._detailHeader.appendChild(checkbox);
            this._detailHeader.appendChild(title);

            // Apply disabled styling
            panel.content.style.opacity = panel.enabled ? '1' : '0.3';
            panel.content.style.pointerEvents = panel.enabled ? 'auto' : 'none';
        }

        this._activePlugin = name;
    }

    // ─── Panel Construction ───────────────────────────────────────

    _injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* ── Root container ────────────────────────────────── */
            #pm-root {
                position: fixed; top: 10px; left: 10px; z-index: 99999;
                display: none; /* hidden until show() */
                flex-direction: row;
                height: calc(100vh - 20px);
                font: 12px 'Segoe UI', system-ui, sans-serif;
                pointer-events: auto;
            }

            /* ── Sidebar (icon strip) ─────────────────────────── */
            #pm-sidebar {
                width: 54px; flex-shrink: 0;
                background: rgba(10,10,16,0.96);
                border-radius: 10px;
                border: 1px solid rgba(100,160,255,0.15);
                display: flex; flex-direction: column;
                padding: 6px 0;
                gap: 2px;
                overflow-y: auto;
                box-shadow: 0 4px 24px rgba(0,0,0,0.5);
                backdrop-filter: blur(14px);
            }
            #pm-sidebar::-webkit-scrollbar { width: 0; }

            .pm-sidebar-section { display: flex; flex-direction: column; gap: 2px; }
            .pm-sidebar-spacer { flex: 1; }
            .pm-sidebar-divider {
                height: 1px; margin: 4px 8px;
                background: rgba(255,255,255,0.08);
            }

            .pm-tab {
                display: flex; flex-direction: column; align-items: center;
                padding: 7px 4px 5px; cursor: pointer;
                border-left: 3px solid transparent;
                transition: background 0.15s, border-color 0.15s;
                user-select: none;
            }
            .pm-tab:hover { background: rgba(255,255,255,0.06); }
            .pm-tab--active {
                background: rgba(100,160,255,0.12);
                border-left-color: var(--tab-color, #7cf);
            }
            .pm-tab-icon { font-size: 18px; line-height: 1; }
            .pm-tab-label {
                font-size: 8px; color: #889; margin-top: 2px;
                letter-spacing: 0.3px; text-align: center;
                white-space: nowrap; overflow: hidden;
                text-overflow: ellipsis; max-width: 48px;
            }
            .pm-tab--active .pm-tab-label { color: #cde; }

            /* ── Detail panel (right side) ────────────────────── */
            #pm-detail {
                width: 310px; margin-left: 6px;
                background: rgba(12,12,18,0.94);
                border: 1px solid rgba(100,160,255,0.18);
                border-radius: 10px;
                display: flex; flex-direction: column;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                backdrop-filter: blur(14px);
                overflow: hidden;
            }

            #pm-detail-header {
                display: flex; align-items: center; gap: 8px;
                padding: 10px 14px;
                background: rgba(20,20,30,0.9);
                border-bottom: 1px solid rgba(100,160,255,0.12);
                flex-shrink: 0;
            }
            .pm-detail-title {
                font-size: 13px; font-weight: 700;
                letter-spacing: 0.4px;
            }

            #pm-detail-body {
                flex: 1; overflow-y: auto;
                padding-bottom: 4px;
            }
            #pm-detail-body::-webkit-scrollbar { width: 5px; }
            #pm-detail-body::-webkit-scrollbar-thumb { background: rgba(100,160,255,0.25); border-radius: 3px; }
            #pm-detail-body::-webkit-scrollbar-track { background: transparent; }

            .pm-content-pane {
                padding: 6px 14px 10px;
            }

            /* ── Footer buttons ───────────────────────────────── */
            #pm-footer {
                display: flex; gap: 5px; padding: 8px 12px;
                border-top: 1px solid rgba(100,160,255,0.1);
                background: rgba(12,12,18,0.98);
                flex-shrink: 0;
            }
            .pm-fbtn {
                flex: 1; padding: 6px 4px; border: none; border-radius: 4px;
                cursor: pointer; font: bold 11px 'Segoe UI', system-ui, sans-serif;
                color: #fff; transition: filter 0.15s;
            }
            .pm-fbtn:hover { filter: brightness(1.2); }
            .pm-fbtn:active { filter: brightness(0.9); }
            .pm-fbtn--regen { background: #2a6; flex: 2; }
            .pm-fbtn--save  { background: #46a; }
            .pm-fbtn--export { background: #555; }

            /* ── Shared controls ──────────────────────────────── */
            .pm-section {
                font-weight: 600; margin: 10px 0 4px; padding-bottom: 2px;
                font-size: 10px; letter-spacing: 0.3px;
                border-bottom: 1px solid;
            }

            .pm-row {
                display: flex; align-items: center; margin: 3px 0; gap: 5px;
            }
            .pm-label {
                width: 95px; text-align: right; color: #778; font-size: 10px;
                flex-shrink: 0;
            }
            .pm-slider {
                flex: 1; accent-color: #5af; height: 14px; cursor: pointer;
            }
            .pm-value {
                width: 48px; text-align: left; color: #ff0; font-size: 10px;
                font-family: monospace; flex-shrink: 0;
            }
            .pm-readout {
                flex: 1; text-align: left; color: #8cf; font-size: 10px;
                font-family: monospace;
            }
            .pm-color {
                width: 32px; height: 20px; border: none; cursor: pointer;
                background: none; padding: 0;
            }
            .pm-check {
                width: 14px; height: 14px; cursor: pointer;
                accent-color: #5af; flex-shrink: 0;
            }
            .pm-select {
                flex: 2; padding: 4px; border: none; border-radius: 4px;
                font-size: 11px; background: rgba(0,0,0,0.5); color: #fff;
                cursor: pointer; outline: none;
            }
            .pm-select option { background: #222; color: #fff; }
            .pm-text {
                flex: 1; background: rgba(0,0,0,0.4); color: #fff;
                border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
                padding: 2px 4px; font-size: 11px;
            }
            .pm-btn-action {
                width: 100%; padding: 6px 4px; border: none; border-radius: 4px;
                cursor: pointer; font: bold 11px 'Segoe UI', system-ui, sans-serif;
                background: rgba(255,255,255,0.1); color: #fff;
                transition: background 0.15s; margin-top: 2px;
            }
            .pm-btn-action:hover { background: rgba(255,255,255,0.2); }
        `;
        document.head.appendChild(style);
        this._styles = style;
    }

    _buildLayout() {
        // ── Root ─────────────────────────────────────────────────────
        const root = document.createElement('div');
        root.id = 'pm-root';

        // ── Sidebar ──────────────────────────────────────────────────
        const sidebar = document.createElement('div');
        sidebar.id = 'pm-sidebar';

        const sidebarTop = document.createElement('div');
        sidebarTop.className = 'pm-sidebar-section pm-sidebar-top';
        sidebar.appendChild(sidebarTop);

        // Spacer pushes bottom tabs down
        const spacer = document.createElement('div');
        spacer.className = 'pm-sidebar-spacer';
        sidebar.appendChild(spacer);

        // Divider line
        const divider = document.createElement('div');
        divider.className = 'pm-sidebar-divider';
        sidebar.appendChild(divider);

        const sidebarBottom = document.createElement('div');
        sidebarBottom.className = 'pm-sidebar-section pm-sidebar-bottom';
        sidebar.appendChild(sidebarBottom);

        root.appendChild(sidebar);

        // ── Detail ───────────────────────────────────────────────────
        const detail = document.createElement('div');
        detail.id = 'pm-detail';

        const detailHeader = document.createElement('div');
        detailHeader.id = 'pm-detail-header';
        detail.appendChild(detailHeader);

        const detailBody = document.createElement('div');
        detailBody.id = 'pm-detail-body';
        detail.appendChild(detailBody);

        // Footer buttons
        const footer = document.createElement('div');
        footer.id = 'pm-footer';

        const btnRegen = document.createElement('button');
        btnRegen.textContent = '🔄 Regenerate';
        btnRegen.className = 'pm-fbtn pm-fbtn--regen';
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
        btnSave.className = 'pm-fbtn pm-fbtn--save';
        btnSave.addEventListener('click', () => {
            this._saveSettings();
            btnSave.textContent = '✅ Saved!';
            setTimeout(() => { btnSave.textContent = '💾 Save'; }, 1500);
        });

        const btnExport = document.createElement('button');
        btnExport.textContent = '📋 Export';
        btnExport.className = 'pm-fbtn pm-fbtn--export';
        btnExport.addEventListener('click', () => {
            const json = JSON.stringify(this.params, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                btnExport.textContent = '✅ Copied!';
                setTimeout(() => { btnExport.textContent = '📋 Export'; }, 1500);
            });
            console.log('[PluginManager] Settings exported:\n', json);
        });

        footer.appendChild(btnRegen);
        footer.appendChild(btnSave);
        footer.appendChild(btnExport);
        detail.appendChild(footer);

        root.appendChild(detail);

        // Prevent game input passthrough
        const stop = (e: Event) => e.stopPropagation();
        root.addEventListener('mousedown', stop);
        root.addEventListener('mousemove', stop);
        root.addEventListener('mouseup', stop);
        root.addEventListener('wheel', stop);
        root.addEventListener('keydown', stop);
        root.addEventListener('keyup', stop);

        document.body.appendChild(root);

        this._root = root;
        this._sidebar = sidebar;
        this._sidebarTop = sidebarTop;
        this._sidebarBottom = sidebarBottom;
        this._detail = detail;
        this._detailHeader = detailHeader;
        this._detailBody = detailBody;
    }

    _saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params));
            console.log('[DebugUIPlugin] Settings saved to localStorage');
        } catch (e) {
            console.warn('[DebugUIPlugin] Failed to save:', e);
        }
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                Object.assign(this.params, JSON.parse(raw));
                console.log('[DebugUIPlugin] Settings loaded from localStorage');
            }
        } catch (e) {
            console.warn('[DebugUIPlugin] Failed to load:', e);
        }
    }

    _bindToggle() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F9' && e.ctrlKey) {
                this._visible = !this._visible;
                if (this._root) this._root.style.display = this._visible ? 'flex' : 'none';
            }
        });
    }

    show() {
        this._visible = true;
        if (this._root) this._root.style.display = 'flex';
    }

    update() {}

    dispose() {
        if (this._root) this._root.remove();
        if (this._styles) this._styles.remove();
    }
}
