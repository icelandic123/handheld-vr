/**
 * Decides how this browser will run the theatre:
 *  - 'native'        a real WebXR headset browser (e.g. Meta Quest Browser)
 *  - 'emulator'      no immersive-vr support (a laptop): load the IWER emulator
 *                    lazily so judges can still watch / try the play
 *  - 'dev-emulator'  the IWSDK dev server already injected IWER
 *
 * The emulator is only loaded when the browser itself reports that it cannot
 * run immersive-vr, so a headset browser is never overridden. `?emulator=1`
 * forces it (useful on desktops that have a PC VR runtime installed but no
 * headset), `?emulator=0` disables it.
 */
export type XRMode = 'native' | 'emulator' | 'dev-emulator' | 'none';

interface EmulatedDevice {
  position: { set(x: number, y: number, z: number): void };
  primaryInputMode: 'controller' | 'hand';
}

export async function prepareXR(): Promise<XRMode> {
  const w = window as unknown as { IWER_DEVICE?: EmulatedDevice };
  if (w.IWER_DEVICE) {
    seat(w.IWER_DEVICE);
    return 'dev-emulator';
  }
  const force = new URLSearchParams(location.search).get('emulator');
  let native = false;
  if (navigator.xr && force !== '1') {
    try {
      native = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      native = false;
    }
  }
  if (native) return 'native';
  if (force === '0') return 'none';
  try {
    const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([import('iwer'), import('@iwer/devui')]);
    const device = new XRDevice(metaQuest3);
    device.installRuntime({ forceInstall: true });
    device.installDevUI(DevUI);
    seat(device as unknown as EmulatedDevice);
    w.IWER_DEVICE = device as unknown as EmulatedDevice;
    return 'emulator';
  } catch (e) {
    console.warn('Emulator unavailable', e);
    return 'none';
  }
}

/** Seated player: eyes at 1.2 m, hand tracking. */
function seat(d: EmulatedDevice): void {
  d.position.set(0, 1.2, 0);
  d.primaryInputMode = 'hand';
}
