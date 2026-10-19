import { SessionMode, VisibilityState, World } from "@iwsdk/core";
import projectOptions from "virtual:iwsdk-project";
import { Autopilot } from "./autopilot.js";
import { prepareXR } from "./emulator.js";
import { showLanding } from "./landing.js";
import { useLocalHandModels } from "./local-hands.js";
import { PUPPETS } from "./shadow/poses.js";
import { TheatreSystem } from "./theatre.js";

interface DevWithCanvas {
  appCanvas?: HTMLCanvasElement;
}

/** Hide (or show) the emulator's control overlay so the watch mode looks like a film. */
function setDevUIHidden(hidden: boolean): void {
  const tryHide = (left: number) => {
    const canvas = (window as unknown as { IWER_DEVICE?: DevWithCanvas })
      .IWER_DEVICE?.appCanvas;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) {
      if (left > 0) setTimeout(() => tryHide(left - 1), 100);
      return;
    }
    for (const el of Array.from(parent.children)) {
      if (el !== canvas)
        (el as HTMLElement).style.visibility = hidden ? "hidden" : "";
    }
  };
  tryHide(50);
}

async function main(): Promise<void> {
  useLocalHandModels();
  const mode = await prepareXR();
  const world = await World.create(
    document.getElementById("scene-container") as HTMLDivElement,
    projectOptions,
  );
  world.registerSystem(TheatreSystem);
  const theatre = world.getSystem(TheatreSystem);
  if (!theatre) throw new Error("Theatre failed to start");

  const autopilot = new Autopilot(theatre);
  theatre.onFrame = (dt) => autopilot.update(dt);
  (window as unknown as { __autopilot: Autopilot }).__autopilot = autopilot;

  // The IWSDK dev server and the CI recorder drive the emulator themselves.
  const params = new URLSearchParams(location.search);
  if (mode === "dev-emulator" || params.has("nolanding")) return;

  let arSupported = false;
  if (mode === "native") {
    try {
      arSupported =
        (await navigator.xr?.isSessionSupported("immersive-ar")) ?? false;
    } catch {
      arSupported = false;
    }
  }

  const landing = showLanding(
    mode,
    {
      enter: () => {
        theatre.audio.start();
        autopilot.mode = "off";
        landing.hide();
        world.launchXR();
      },
      enterAR: () => {
        theatre.audio.start();
        autopilot.mode = "off";
        landing.hide();
        world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
      },
      watch: () => {
        theatre.audio.start();
        autopilot.mode = "watch";
        theatre.restart();
        landing.hide();
        landing.help("Watching the play. Press Esc to return.");
        world.launchXR();
        setDevUIHidden(true);
      },
      tryIt: () => {
        theatre.audio.start();
        autopilot.snapTo(null);
        theatre.restart();
        landing.hide();
        landing.help(
          `Keys ${PUPPETS.map((p, i) => `${i + 1} ${p.id}`).join(", ")}, 0 rest. ` +
            "N skips a scene, Esc leaves. On a Quest, use your own hands.",
        );
        world.launchXR();
        setDevUIHidden(false);
      },
    },
    { ar: arSupported },
  );

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      world.exitXR();
      return;
    }
    if (autopilot.mode !== "snap") return;
    const n = Number.parseInt(e.key, 10);
    if (Number.isNaN(n)) return;
    autopilot.snapTo(n === 0 ? null : (PUPPETS[n - 1]?.id ?? null));
  });

  world.visibilityState.subscribe((v) => {
    if (v === VisibilityState.NonImmersive) {
      autopilot.mode = "off";
      landing.help(null);
      landing.show();
    }
  });
  if (params.get("autoplay") === "1")
    document.getElementById("lt-watch")?.click();
}

void main();
