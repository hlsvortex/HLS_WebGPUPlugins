import { InputController } from '../core/InputController';

export class InputPlugin {
    core: any;
    input: InputController;

    constructor(core: any) {
        this.core = core;
        this.input = new InputController();
        this.core.input = this.input;
    }

    async init() {
        const ui = this.core.debugUI;
        if (!ui) return;

        ui.registerPlugin('Input', '⌨️', '#a8f', { category: 'Core' });

        // ── Camera Controls ──────────────────────────────────────
        ui.addSection('Input', '🎥 Camera Controls', '#5af');

        const controls: [string, string][] = [
            ['Move',        'W A S D'],
            ['Up / Down',   'E / Q'],
            ['Sprint',      'Hold Shift'],
            ['Look',        'Mouse (hold RMB)'],
            ['Zoom',        'Scroll Wheel'],
        ];
        for (const [label, key] of controls) {
            const r = ui.addReadout('Input', label);
            r.textContent = key;
            r.style.color = '#cda';
        }

        // ── Player Controls ──────────────────────────────────────
        ui.addSection('Input', '🚶 Player Mode', '#4fa');

        const playerControls: [string, string][] = [
            ['Toggle Mode', '~ (Backquote)'],
            ['Move',        'W A S D'],
            ['Sprint',      'Hold Shift'],
            ['Jump',        'Space'],
            ['Enter/Exit',  'Click canvas'],
        ];
        for (const [label, key] of playerControls) {
            const r = ui.addReadout('Input', label);
            r.textContent = key;
            r.style.color = '#cda';
        }

        // ── System ───────────────────────────────────────────────
        ui.addSection('Input', '⚙️ System', '#888');

        const sysControls: [string, string][] = [
            ['Debug Panel',  'Ctrl + F9'],
        ];
        for (const [label, key] of sysControls) {
            const r = ui.addReadout('Input', label);
            r.textContent = key;
            r.style.color = '#cda';
        }
    }

    update(_dt: number) {
        // Must be updated first to freeze frame state!
        // NOTE: _alwaysUpdate = true ensures this runs even when toggled off in DebugUI
        this.input.update();
    }

    // Input must always be processed — even when "disabled" in the UI
    _alwaysUpdate = true;
}
