import type { XRMode } from "./emulator.js";
import {
  cycled,
  describe,
  getSettings,
  onSettingsChange,
  updateSettings,
} from "./settings.js";
import { PLAY_SUBTITLE, PLAY_TITLE } from "./story.js";

/**
 * The 2D page people see before entering: on a headset an "Enter" button; on a
 * laptop a clear "open this on Quest" note plus a self-playing emulator demo.
 */
export interface LandingActions {
  enter(): void;
  /** Mixed reality: the paper screen in the player's own room (passthrough). */
  enterAR(): void;
  watch(): void;
  tryIt(): void;
}

const LIVE_URL = "https://icelandic123.github.io/handheld-vr/";

const CSS = `
#landing{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 40%,#3a2414 0%,#140b07 60%,#080404 100%);color:#f6e6cc;
  font-family:Georgia,"Times New Roman",serif;padding:16px;box-sizing:border-box;overflow:auto}
#landing .card{max-width:640px;width:100%;text-align:center}
#landing h1{font-size:clamp(28px,6vw,48px);margin:0 0 4px;letter-spacing:.5px}
#landing .sub{font-style:italic;opacity:.85;margin:0 0 20px;font-size:clamp(16px,3vw,20px)}
#landing p{line-height:1.5;font-size:clamp(15px,2.6vw,18px);margin:10px 0}
#landing .lamp{width:72px;height:72px;margin:0 auto 14px;border-radius:50%;
  background:radial-gradient(circle,#ffe2a6 0%,#ffb35c 35%,rgba(255,150,60,0) 70%);
  animation:flick 3s ease-in-out infinite}
@keyframes flick{0%,100%{opacity:.9;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
#landing button{font:inherit;font-size:clamp(16px,2.8vw,19px);margin:8px;padding:14px 26px;border-radius:999px;
  border:2px solid #f0b46a;background:#f0b46a;color:#2a160a;cursor:pointer;min-width:220px}
#landing button.ghost{background:transparent;color:#f6e6cc}
#landing button:focus-visible{outline:3px solid #fff;outline-offset:3px}
#landing .note{font-size:14px;opacity:.75}
#landing code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px;word-break:break-all}
#landing .settings{margin:22px auto 0;max-width:520px;text-align:left;font-size:16px;opacity:.95}
#landing .settings summary{cursor:pointer;text-align:center;font-size:17px}
#landing .settings .row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0}
#landing .settings button{min-width:120px;margin:0;padding:8px 16px;font-size:16px}
#helpbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2001;background:rgba(20,10,5,.85);
  color:#f6e6cc;font:15px Georgia,serif;padding:10px 16px;border-radius:12px;max-width:92vw;text-align:center}
`;

export function showLanding(
  mode: XRMode,
  actions: LandingActions,
  opts: { ar: boolean } = { ar: false },
): { show(): void; hide(): void; help(text: string | null): void } {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "landing";
  const emu = mode === "emulator" || mode === "dev-emulator";
  root.innerHTML = `
    <div class="card" role="dialog" aria-labelledby="lt-title">
      <div class="lamp" aria-hidden="true"></div>
      <h1 id="lt-title">${PLAY_TITLE}</h1>
      <p class="sub">${PLAY_SUBTITLE}</p>
      <p>A hand-shadow puppet play. Sit comfortably, raise your hands into the lamplight,
      and shape a dog, a rabbit, a bird, a swan and a snail on a glowing paper screen.</p>
      ${
        mode === "native"
          ? `<p>Seated, hands only. Controllers are optional.</p>
             <button id="lt-enter">Enter the theatre</button>
             ${opts.ar ? '<button id="lt-enter-ar" class="ghost">Play in your room (passthrough)</button>' : ""}`
          : emu
            ? `<p><strong>Made for Meta Quest hand tracking.</strong> On a headset, open
               <code>${LIVE_URL}</code> in Meta Quest Browser.</p>
               <p>In this browser you can watch the play in an emulated headset:</p>
               <button id="lt-watch">Watch the play</button>
               <button id="lt-try" class="ghost">Try it with emulated hands</button>
               <p class="note">Emulation by IWER (Immersive Web Emulation Runtime).</p>`
            : `<p><strong>This browser can't open immersive WebXR.</strong></p>
               <p>Open <code>${LIVE_URL}</code> in Meta Quest Browser,
               or <a href="?emulator=1" style="color:#f0b46a">watch it in an emulator</a>.</p>`
      }
      <details class="settings">
        <summary>Comfort and settings</summary>
        <div id="lt-settings"></div>
        <p class="note">You can also poke the settings card on the theatre table.</p>
      </details>
    </div>`;
  document.body.appendChild(root);
  const settingsBox = root.querySelector("#lt-settings") as HTMLDivElement;
  const renderSettings = () => {
    settingsBox.innerHTML = describe(getSettings())
      .map(
        (r) =>
          `<div class="row"><span>${r.label}</span><button class="ghost" data-key="${r.key}">${r.value}</button></div>`,
      )
      .join("");
  };
  settingsBox.addEventListener("click", (e) => {
    const key = (e.target as HTMLElement).closest("button")?.dataset.key as
      | keyof ReturnType<typeof getSettings>
      | undefined;
    if (key) updateSettings({ [key]: cycled(key) });
  });
  renderSettings();
  onSettingsChange(renderSettings);
  const bind = (id: string, fn: () => void) =>
    root.querySelector(`#${id}`)?.addEventListener("click", fn);
  bind("lt-enter", actions.enter);
  bind("lt-enter-ar", actions.enterAR);
  bind("lt-watch", actions.watch);
  bind("lt-try", actions.tryIt);
  let bar: HTMLDivElement | null = null;
  return {
    show: () => (root.style.display = "flex"),
    hide: () => (root.style.display = "none"),
    help: (text) => {
      if (!text) {
        bar?.remove();
        bar = null;
        return;
      }
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "helpbar";
        document.body.appendChild(bar);
      }
      bar.textContent = text;
    },
  };
}
