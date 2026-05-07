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
        if (ui) {
            ui.registerPlugin('Input', '⌨️', '#a8f', 'Core');
        }
    }

    update(dt: number) {
        // Must be updated first to freeze frame state!
        this.input.update();
    }
}
