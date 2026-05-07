// Ported from VibeJam_Survival

export const CameraDB: Record<string, any> = {
  "normal": {
    "armLength": 2.5,
    "headHeight": 1.7,
    "shoulderOffset": 0.5,
    "verticalOffset": 0,
    "fov": 72,
    "lerpSpeed": 4
  },
  "sprint": {
    "armLength": 3,
    "headHeight": 1.8,
    "shoulderOffset": 0.3,
    "verticalOffset": 0,
    "fov": 73,
    "lerpSpeed": 3.5
  },
  "aim": {
    "armLength": 2.1,
    "headHeight": 1.7,
    "shoulderOffset": 0.5,
    "verticalOffset": -0.1,
    "fov": 40,
    "lerpSpeed": 8
  },
  "build": {
    "armLength": 5,
    "headHeight": 2.45,
    "shoulderOffset": 0.8,
    "verticalOffset": 0,
    "fov": 70,
    "lerpSpeed": 3.5
  },
  "glide": {
    "armLength": 4,
    "headHeight": 1.9,
    "shoulderOffset": 0,
    "verticalOffset": 0.5,
    "fov": 75,
    "lerpSpeed": 3
  },
  "inventory": {
    "armLength": 3,
    "headHeight": 1.2,
    "shoulderOffset": 1.2,
    "verticalOffset": 0,
    "fov": 65,
    "lerpSpeed": 10
  },
};

export function getCameraProfile(key: string) {
    if (!key) return null;
    return CameraDB[key] || CameraDB['normal'];
}
