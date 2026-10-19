/**
 * The play: an opening, puppet scenes, and a curtain call. All text is shown
 * on the paper screen (large serif "printed" captions); every beat has a
 * matching synthesised sound cue.
 */
export type Cue = 'lamp' | 'bark' | 'boing' | 'chirp' | 'honk' | 'bloop' | 'applause' | 'none';

export interface PuppetScene {
  kind: 'puppet';
  /** Puppet id from poses.ts. */
  puppet: string;
  title: string;
  /** Narration shown while the target fades in. */
  narration: string;
  /** How to make the shape (shown during play and as a hint). */
  hint: string;
  /** Line shown when the puppet comes alive. */
  success: string;
  cue: Cue;
}

export interface CurtainScene {
  kind: 'curtain';
  title: string;
  narration: string;
  /** Puppets that take a bow, left to right. */
  cast: string[];
}

export type Scene = PuppetScene | CurtainScene;

export const PLAY_TITLE = 'The Little Lamp Theatre';
export const PLAY_SUBTITLE = 'Tonight: The Night Visitors';

export const SCENES: Scene[] = [
  {
    kind: 'puppet',
    puppet: 'hello',
    title: PLAY_TITLE,
    narration: 'Every evening the little lamp waits for a pair of hands. Say hello to wake it.',
    hint: 'Hold up an open hand, fingers spread, palm toward the lamp.',
    success: 'The lamp wakes. The show can begin!',
    cue: 'lamp',
  },
  {
    kind: 'puppet',
    puppet: 'dog',
    title: 'I. The Dog Who Lost His Bark',
    narration: 'First came a dog who had lost his bark. Can you give him a mouth to find it?',
    hint: 'Hand sideways, fingers together. Thumb up for an ear, drop your little finger for the jaw.',
    success: 'Woof! The dog has found his bark.',
    cue: 'bark',
  },
  {
    kind: 'puppet',
    puppet: 'rabbit',
    title: 'II. The Rabbit Who Wanted the Moon',
    narration: 'The bark woke a rabbit, who dreamed of hopping all the way to the moon.',
    hint: 'Two fingers up for ears. Curl the others down and tuck your thumb over them.',
    success: 'Hop, hop! Higher and higher.',
    cue: 'boing',
  },
  {
    kind: 'puppet',
    puppet: 'bird',
    title: 'III. The Bird Who Gave a Ride',
    narration: 'A kind bird offered to carry the rabbit up into the night sky.',
    hint: 'Cross your wrists and hook your thumbs. Spread your fingers wide as wings.',
    success: 'Up they fly, over the rooftops!',
    cue: 'chirp',
  },
  {
    kind: 'puppet',
    puppet: 'swan',
    title: 'IV. The Swan on the Silver Lake',
    narration: 'The bird set the rabbit down by a moonlit lake, where a swan was waiting.',
    hint: 'Raise your hand on its side, fingers together, and bend them over for the head and beak.',
    success: 'The swan glides across the silver water.',
    cue: 'honk',
  },
  {
    kind: 'puppet',
    puppet: 'snail',
    title: 'V. The Snail Who Was Nearly Late',
    narration: 'Last of all came a snail, slow and steady, hoping to arrive in time for the bow.',
    hint: 'One hand flat and sideways for the body, the other in a fist on top for the shell.',
    success: 'Just in time! Slow and steady wins the night.',
    cue: 'bloop',
  },
  {
    kind: 'curtain',
    title: 'Curtain Call',
    narration: 'And so the night visitors take their bow. Wave goodnight to close the curtain.',
    cast: ['dog', 'rabbit', 'bird', 'swan', 'snail'],
  },
];
