# Devpost submission: The Little Lamp Theatre

Draft for the Meta VR Start Developer Competition 2026. Fields follow the
Devpost project form and the competition requirements. Items marked TODO need
a person (the YouTube upload).

## Project name
The Little Lamp Theatre

## Elevator pitch (200 characters max)
A hand-shadow puppet play for Meta Quest. Raise your real hands into a lamp's
light and shape a dog, a rabbit, a bird, a swan and a snail on a paper screen
until they come alive.

## Category
Entertainment. It is a short, gentle play, not a score-chasing game.

Special awards it fits: Best First Five Minutes (your own hands cast shadows
within seconds of entering, with nothing to learn) and Best Accessibility
Forward (seated, hands only, forgiving matching, subtitles, larger text and a
choice of hand).

## Links
- Play (WebXR, open in Meta Quest Browser): https://icelandic123.github.io/handheld-vr/
- Code (MIT): https://github.com/icelandic123/handheld-vr
- Demo video: TODO, the YouTube upload of `little-lamp-theatre-demo.mp4` from the
  `demo-video` branch (https://github.com/icelandic123/handheld-vr/tree/demo-video).
  It was recorded in the IWER emulator, as the rules allow.

## About the project

### Inspiration
Hand-shadow puppets are one of the oldest kinds of theatre, and nearly
everyone has made a shadow dog on a bedroom wall. They need only two things:
your hands and a lamp. Quest hand tracking gives us the hands. We built the
lamp, the screen and a small play to perform.

### What it does
You sit at a small table in a dark room. A brass lamp glows in front of you and
a paper screen hangs beyond it. When you raise your hands, their shadows appear
on the screen, live, following every finger.

The play has a prologue, five acts and a curtain call:
- **Prologue:** say hello with an open hand and the lamp wakes up.
- **I. The Dog Who Lost His Bark:** hand sideways, thumb up for an ear, little finger dropped for the jaw.
- **II. The Rabbit Who Wanted the Moon:** two fingers up for ears.
- **III. The Bird Who Gave a Ride:** wrists crossed, thumbs hooked for the head, fingers spread as wings.
- **IV. The Swan on the Silver Lake:** hand on its side, fingers bent over for the head and beak.
- **V. The Snail Who Was Nearly Late:** one hand flat for the body, a fist on top for the shell.
- **Curtain call:** the whole cast bows. You wave goodnight and the velvet curtain closes.

In each act a faint outline shows the target, with a small ink drawing of the
character in the corner. As your shadow gets close to the shape, it opens an
eye. Hold the shape for half a second and the puppet comes alive: the dog barks,
the rabbit hops toward the moon, the bird flies, the swan glides and the snail
arrives just in time. A brass bell on the table skips an act, so nobody gets
stuck. The other bell leaves.

### How hand tracking is central
The hands are the game. There are no buttons to learn and no controllers. Every
action is your own hand pose: making the shapes, poking the bells, and poking
the settings card. The shadow is not a gesture icon. It is the real projection
of your tracked hand, so whatever your fingers do, the shadow does too. That is
what makes the first ten seconds feel like magic.

### Seated, comfortable, easy in and out
- Built for sitting. The stage anchors to your head when you enter, and
  everything is within a relaxed arm's reach in front of you.
- The settings card on the table (also on the start page) sets:
  - subtitles on or off;
  - larger text;
  - screen distance (near, normal or far);
  - which hand makes the one-hand puppets (right by default, mirrored for left-handers).
- Matching is forgiving on purpose: 80% overlap, held for half a second.
- On headsets that support it, "Play in your room" starts the same play in
  passthrough, with the paper screen floating in your own room.
- One button enters the theatre. The "leave" bell or the system menu exits.
- On a laptop the same link explains how to open it on a Quest. It also offers
  to play the show in an emulated headset, so anyone can see it first.

### How we built it
- **Meta Immersive Web SDK (IWSDK) 1.0.1:** WebXR with hand tracking, ECS
  systems and the project config. It is hosted as a static site on GitHub Pages.
- **Real shadows, cheaply.** For a point light and a flat screen, a shadow is
  the perspective projection of the hands from the light onto that plane. We
  render capsule hands (built from the 25 tracked joints) from the lamp with an
  off-axis camera whose image plane is the screen, into a small texture. The
  screen shader softens it into a penumbra. The forearm is drawn in its own
  channel and blurred, the way a real lamp blurs anything held close to it.
- **Targets a real hand can make.** Each puppet is a set of joint angles on a
  hand rig built from a real tracked-hand skeleton. Its silhouette is rendered
  through the same pipeline, at the player's measured hand size.
- **Scoring:** centroid and scale alignment, then a tolerant overlap score on a
  128x85 grid, about 0.07 ms per call. A pose passes only when it also beats
  every look-alike puppet by a margin, so an open hand can't pass as the
  rabbit.
- **A look-alike check in CI.** Every push poses all six puppets in the IWER
  emulator under headless Chromium and fails if any shape passes as another.
  Today: 0 of 240 wrong poses pass, and 94% of correct poses with up to 20
  degrees of jitter do.
- **Sound:** every sound is synthesised with WebAudio (bark, boing, chirp, honk,
  applause, curtain). There are no audio files.
- **Art:** procedural shaders and hand-drawn canvas paths. There are no image
  assets, apart from the open-source generic hand model (MIT).

### Challenges we ran into
- **No headset.** We built without a physical Quest. Everything was tested in
  Meta's IWER emulator, driven by Playwright with poses generated from the
  same hand rig. That is why matching is forgiving and why the CI check exists.
- **Look-alike shapes.** An open hand and the rabbit cover most of the same
  pixels. The fix was a negative check against the other puppets' silhouettes,
  not a tighter threshold.
- **The forearm.** It sits close to the lamp, so its shadow threw a huge wedge
  across the screen. It now has its own soft channel and is never scored.

### Accomplishments that we're proud of
- Your real hands cast the shadows: no gesture recognition, and no fixed set of
  "allowed" poses beyond the targets.
- The whole show is playable on a laptop in the emulator, which made the demo
  video possible without a headset.

### What we learned
A shadow is a good interface. People already know how to read one, and it
forgives small tracking errors that a 3D hand model would show.

### What's next
- A new short story with new puppets each day.
- Two-person duets (one hand each).
- A free-play stage for inventing your own animals.
- Tuning the thresholds on real headsets.

## Requirements checklist
- Usable end to end with hands only; controllers are optional and never needed: yes.
- Designed for seated, stationary use: yes.
- Easy to enter and exit: one button to enter; a bell or the system menu to leave.
- New project built during the competition window: first commit 2026-10-19.
- WebXR built with Meta's Immersive Web SDK, submitted as a hosted link: yes.
- Demo video captured in an XR emulator: yes (IWER, captioned).

## Tools (AI disclosure)
- **Claude Code (Anthropic)** built this project end to end for bladoi: the
  code, puppet poses, story text, shaders, synthesised sound, tests, CI
  workflows, demo video script and this write-up. bladoi set the brief, made
  the decisions and reviewed the results.
- No AI models run inside the experience.
- Open-source libraries: Meta Immersive Web SDK and IWER (MIT), three.js (MIT),
  the WebXR generic hand model from @webxr-input-profiles/assets (MIT), Vite,
  Playwright and ffmpeg (for the video).

## Built with
webxr, meta-immersive-web-sdk, iwer, three.js, typescript, webaudio, vite,
github-pages, github-actions, playwright, ffmpeg

## Team
bladoi (icelandic123)
