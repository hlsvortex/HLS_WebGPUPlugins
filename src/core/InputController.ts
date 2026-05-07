/**
 * InputController.ts
 * Ported from VibeJam_Survival
 */

// Format: { ACTION_NAME: { keyboard?: string|string[], mouse?: number|number[] } }
export const DEFAULT_BINDINGS: Record<string, any> = {
    // ── Movement ──────────────────────────────────────────────────────
    MOVE_FORWARD:   { keyboard: 'KeyW' },
    MOVE_BACK:      { keyboard: 'KeyS' },
    MOVE_LEFT:      { keyboard: 'KeyA' },
    MOVE_RIGHT:     { keyboard: 'KeyD' },
    SPRINT:         { keyboard: 'ShiftLeft' },
    JUMP:           { keyboard: 'Space' },
    DIVE:           { keyboard: ['ControlLeft', 'ControlRight'] },

    // ── Combat ────────────────────────────────────────────────────────
    ATTACK:         { mouse: 0 },
    AIM:            { mouse: 2 },
    ABILITY_1:      { keyboard: 'KeyQ' },
    ABILITY_2:      { keyboard: 'KeyF' },
    ABILITY_3:      { keyboard: 'KeyR' },
    ABILITY_4:      { keyboard: 'KeyC' },

    // ── Interaction ───────────────────────────────────────────────────
    INTERACT:       { keyboard: 'KeyE' },
    SECONDARY_INTERACT: { keyboard: 'KeyF' },
    RECALL:         { keyboard: 'KeyH' },
    TARGET_LOCK:    { mouse: 1 },
    TAME_HOLD:      { keyboard: 'KeyT' },
    TORCH:          { keyboard: 'KeyL' },

    // ── UI ────────────────────────────────────────────────────────────
    INVENTORY:      { keyboard: 'KeyI' },
    CHAT:           { keyboard: 'Enter' }, // Enter for Chat
    EMOTES:         { keyboard: 'KeyG' },

    // ── Build Mode ────────────────────────────────────────────────────
    BUILD_TOGGLE:   { keyboard: 'KeyB' },
    BUILD_ROTATE:   { keyboard: 'KeyR' },
    BUILD_DISMANTLE:{ keyboard: 'KeyX' },
    BUILD_PLACE:    { mouse: 0 },
    BUILD_CYCLE_SUB_LEFT:  { keyboard: 'KeyQ' },
    BUILD_CYCLE_SUB_RIGHT: { keyboard: 'KeyE' },
    BUILD_CYCLE_PAR_LEFT:  { keyboard: ['ControlLeft', 'ControlRight'] },
    BUILD_CYCLE_PAR_RIGHT: { keyboard: ['AltLeft', 'AltRight'] },
    BUILD_PIECE_1:  { keyboard: 'Digit1' },
    BUILD_PIECE_2:  { keyboard: 'Digit2' },
    BUILD_PIECE_3:  { keyboard: 'Digit3' },
    BUILD_PIECE_4:  { keyboard: 'Digit4' },
    BUILD_PIECE_5:  { keyboard: 'Digit5' },
    BUILD_PIECE_6:  { keyboard: 'Digit6' },

    // ── Hotbar ────────────────────────────────────────────────────────
    HOTBAR_1:       { keyboard: 'Digit1' },
    HOTBAR_2:       { keyboard: 'Digit2' },
    HOTBAR_3:       { keyboard: 'Digit3' },
    HOTBAR_4:       { keyboard: 'Digit4' },
    HOTBAR_5:       { keyboard: 'Digit5' },
    HOTBAR_6:       { keyboard: 'Digit6' },
    HOTBAR_7:       { keyboard: 'Digit7' },
    HOTBAR_8:       { keyboard: 'Digit8' },

    // ── Debug ─────────────────────────────────────────────────────────
    DEBUG_ITEMS:    { keyboard: 'KeyK' },
};

export const CONTEXT_ALLOW: Record<string, string[]> = {
    gameplay: [
        'MOVE_FORWARD','MOVE_BACK','MOVE_LEFT','MOVE_RIGHT',
        'SPRINT','JUMP','DIVE',
        'ATTACK','AIM',
        'ABILITY_1','ABILITY_2','ABILITY_3','ABILITY_4',
        'INTERACT','SECONDARY_INTERACT','RECALL','TARGET_LOCK','TAME_HOLD','TORCH',
        'INVENTORY','BUILD_TOGGLE','CHAT','EMOTES',
        'HOTBAR_1','HOTBAR_2','HOTBAR_3','HOTBAR_4',
        'HOTBAR_5','HOTBAR_6','HOTBAR_7','HOTBAR_8',
        'DEBUG_ITEMS',
    ],
    build: [
        'MOVE_FORWARD','MOVE_BACK','MOVE_LEFT','MOVE_RIGHT',
        'SPRINT','JUMP','DIVE',
        'BUILD_TOGGLE','BUILD_ROTATE','BUILD_DISMANTLE','BUILD_PLACE',
        'BUILD_CYCLE_SUB_LEFT','BUILD_CYCLE_SUB_RIGHT','BUILD_CYCLE_PAR_LEFT','BUILD_CYCLE_PAR_RIGHT',
        'BUILD_PIECE_1','BUILD_PIECE_2','BUILD_PIECE_3',
        'BUILD_PIECE_4','BUILD_PIECE_5','BUILD_PIECE_6',
        'CHAT','EMOTES',
    ],
    ui: [
        'INVENTORY','CHAT','EMOTES',
    ],
};

const STORAGE_KEY = 'vibejam_keybindings_v1';

export class InputController {
    _liveKeys: Set<string> = new Set();
    _liveMouse: Set<number> = new Set();
    _wheelAccumulator: number = 0;

    _keysDown: Set<string> = new Set();
    _mouseDown: Set<number> = new Set();
    wheelDelta: number = 0;

    _keysPrev: Set<string> = new Set();
    _mousePrev: Set<number> = new Set();

    _context: string = 'gameplay';
    _bindings: Record<string, any>;

    _keyToActions: Map<string, string[]> = new Map();
    _mouseToActions: Map<number, string[]> = new Map();

    constructor() {
        this._bindings = this._loadBindings();
        this._buildReverseLookup();

        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);
        this._onMouseDown = this._handleMouseDown.bind(this);
        this._onMouseUp = this._handleMouseUp.bind(this);
        this._onWheel = (e: WheelEvent) => { this._wheelAccumulator += Math.sign(e.deltaY); };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        document.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('mouseup', this._onMouseUp);
        document.addEventListener('wheel', this._onWheel, { passive: true });

        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    update() {
        this._keysPrev = new Set(this._keysDown);
        this._mousePrev = new Set(this._mouseDown);

        this._keysDown = new Set(this._liveKeys);
        this._mouseDown = new Set(this._liveMouse);

        this.wheelDelta = this._wheelAccumulator;
        this._wheelAccumulator = 0;
    }

    isHeld(action: string): boolean {
        if (!this._isActionAllowed(action)) return false;
        const b = this._bindings[action];
        if (!b) return false;
        if (b.keyboard) {
            const keys = Array.isArray(b.keyboard) ? b.keyboard : [b.keyboard];
            if (keys.some((k: string) => this._keysDown.has(k))) return true;
        }
        if (b.mouse !== undefined && b.mouse !== null) {
            const btns = Array.isArray(b.mouse) ? b.mouse : [b.mouse];
            if (btns.some((m: number) => this._mouseDown.has(m))) return true;
        }
        return false;
    }

    justPressed(action: string): boolean {
        if (!this._isActionAllowed(action)) return false;
        const b = this._bindings[action];
        if (!b) return false;
        if (b.keyboard) {
            const keys = Array.isArray(b.keyboard) ? b.keyboard : [b.keyboard];
            if (keys.some((k: string) => this._keysDown.has(k) && !this._keysPrev.has(k))) return true;
        }
        if (b.mouse !== undefined && b.mouse !== null) {
            const btns = Array.isArray(b.mouse) ? b.mouse : [b.mouse];
            if (btns.some((m: number) => this._mouseDown.has(m) && !this._mousePrev.has(m))) return true;
        }
        return false;
    }

    justReleased(action: string): boolean {
        if (!this._isActionAllowed(action)) return false;
        const b = this._bindings[action];
        if (!b) return false;
        if (b.keyboard) {
            const keys = Array.isArray(b.keyboard) ? b.keyboard : [b.keyboard];
            if (keys.some((k: string) => !this._keysDown.has(k) && this._keysPrev.has(k))) return true;
        }
        if (b.mouse !== undefined && b.mouse !== null) {
            const btns = Array.isArray(b.mouse) ? b.mouse : [b.mouse];
            if (btns.some((m: number) => !this._mouseDown.has(m) && this._mousePrev.has(m))) return true;
        }
        return false;
    }

    setContext(ctx: string) {
        if (!CONTEXT_ALLOW[ctx]) {
            console.warn(`[InputController] Unknown context: '${ctx}'`);
            return;
        }
        this._context = ctx;
        this._liveKeys.clear();
        this._liveMouse.clear();
        this._keysDown.clear();
        this._mouseDown.clear();
    }

    getContext() {
        return this._context;
    }

    rebind(action: string, device: 'keyboard'|'mouse', code: string|number) {
        if (!this._bindings[action]) {
            console.warn(`[InputController] Unknown action: '${action}'`);
            return;
        }
        this._bindings[action][device] = code;
        this._buildReverseLookup();
        this._saveBindings();
    }

    unbind(action: string, device: 'keyboard'|'mouse') {
        if (!this._bindings[action]) return;
        this._bindings[action][device] = null;
        this._buildReverseLookup();
        this._saveBindings();
    }

    resetToDefaults() {
        this._bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
        this._buildReverseLookup();
        localStorage.removeItem(STORAGE_KEY);
    }

    getKeyLabel(action: string) {
        const b = this._bindings[action];
        if (!b || !b.keyboard) return '—';
        const keys = Array.isArray(b.keyboard) ? b.keyboard : [b.keyboard];
        return keys.map((k: string) => this._formatKeyCode(k)).join('/');
    }

    getAllBindings() {
        return JSON.parse(JSON.stringify(this._bindings));
    }

    isKeyHeld(code: string) {
        return this._keysDown.has(code);
    }

    isKeyJustPressed(code: string) {
        return this._keysDown.has(code) && !this._keysPrev.has(code);
    }

    _onKeyDown: (e: KeyboardEvent) => void;
    _onKeyUp: (e: KeyboardEvent) => void;
    _onMouseDown: (e: MouseEvent) => void;
    _onMouseUp: (e: MouseEvent) => void;
    _onWheel: (e: WheelEvent) => void;

    _handleKeyDown(e: KeyboardEvent) {
        if (e.target && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA')) return;

        if (e.code === 'Tab' || e.code === 'Space') {
            e.preventDefault();
        }

        this._liveKeys.add(e.code);
    }

    _handleKeyUp(e: KeyboardEvent) {
        this._liveKeys.delete(e.code);
    }

    _handleMouseDown(e: MouseEvent) {
        this._liveMouse.add(e.button);
    }

    _handleMouseUp(e: MouseEvent) {
        this._liveMouse.delete(e.button);
    }

    _isActionAllowed(action: string) {
        const allowed = CONTEXT_ALLOW[this._context];
        return allowed ? allowed.includes(action) : false;
    }

    _buildReverseLookup() {
        this._keyToActions.clear();
        this._mouseToActions.clear();
        for (const [action, binding] of Object.entries(this._bindings)) {
            if (binding.keyboard) {
                const keys = Array.isArray(binding.keyboard) ? binding.keyboard : [binding.keyboard];
                for (const k of keys) {
                    if (!this._keyToActions.has(k)) this._keyToActions.set(k, []);
                    this._keyToActions.get(k)!.push(action);
                }
            }
            if (binding.mouse !== undefined && binding.mouse !== null) {
                const btns = Array.isArray(binding.mouse) ? binding.mouse : [binding.mouse];
                for (const m of btns) {
                    if (!this._mouseToActions.has(m)) this._mouseToActions.set(m, []);
                    this._mouseToActions.get(m)!.push(action);
                }
            }
        }
    }

    _saveBindings() {
        try {
            const overrides: Record<string, any> = {};
            for (const [action, binding] of Object.entries(this._bindings)) {
                const def = DEFAULT_BINDINGS[action];
                const isDiff =
                    JSON.stringify(binding.keyboard) !== JSON.stringify(def?.keyboard) ||
                    JSON.stringify(binding.mouse) !== JSON.stringify(def?.mouse);
                if (isDiff) overrides[action] = binding;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
        } catch (e) {
            console.warn('[InputController] Failed to save bindings:', e);
        }
    }

    _loadBindings() {
        const bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const overrides = JSON.parse(saved);
                for (const [action, binding] of Object.entries(overrides)) {
                    if (bindings[action]) {
                        Object.assign(bindings[action], binding);
                    }
                }
            }
        } catch (e) {
            console.warn('[InputController] Failed to load saved bindings:', e);
        }
        return bindings;
    }

    _formatKeyCode(code: string) {
        const map: Record<string, string> = {
            ShiftLeft: 'Shift', ShiftRight: 'Shift',
            ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
            AltLeft: 'Alt', AltRight: 'Alt',
            Space: 'Space', Tab: 'Tab', Escape: 'Esc',
            ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
        };
        if (map[code]) return map[code];
        if (code.startsWith('Key'))   return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        return code;
    }

    destroy() {
        document.removeEventListener('keydown',   this._onKeyDown);
        document.removeEventListener('keyup',     this._onKeyUp);
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('mouseup',   this._onMouseUp);
        document.removeEventListener('wheel',     this._onWheel);
    }
}
