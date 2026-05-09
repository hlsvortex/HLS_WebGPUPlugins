export class CSMShadowNode {
	constructor(light: any, data?: {
		cascades?: number;
		maxFar?: number;
		mode?: 'practical' | 'uniform' | 'logarithmic' | 'custom';
		lightMargin?: number;
		customSplitsCallback?: Function;
	});

	camera: any;
	cascades: number;
	maxFar: number;
	mode: string;
	lightMargin: number;
	lights: any[];
	fade: boolean;
	needsUpdate: boolean;
	customCacheKey(): number;
	updateFrustums(): void;
	dispose(): void;
}
