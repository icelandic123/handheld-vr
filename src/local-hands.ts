import { AssetManager } from '@iwsdk/core';

/**
 * Serve the generic hand model from this site instead of a CDN. The SDK asks
 * for .../profiles/generic-hand/{left,right}.glb; we answer with the copies in
 * public/hands/ (MIT, webxr-input-profiles), so the app works offline-ish and
 * on networks that block CDNs.
 */
const HAND_URL = /\/profiles\/generic-hand\/(left|right)\.glb$/u;

export function useLocalHandModels(): void {
  const base = `${import.meta.env.BASE_URL}hands/generic-hand/`;
  const original = AssetManager.loadGLTF.bind(AssetManager);
  AssetManager.loadGLTF = ((urlOrKey: string, key?: string) => {
    const m = HAND_URL.exec(urlOrKey);
    return original(m ? `${base}${m[1]}.glb` : urlOrKey, key);
  }) as typeof AssetManager.loadGLTF;
}
