import { ANIMATION_CHANNELS, keyedChannel } from './model.js';

// Key selection belongs to a clip and is independent of the playback cursor.
export function selectedAnimationKeys(state, clip) {
  if (!clip) return [];
  const seen = new Set();
  return (state.selectedAnimationKeys || []).filter(key => key.clipUid === clip.uid
    && state.project.getNode(key.uid)?.type === 'group'
    && ANIMATION_CHANNELS.some(channel => keyedChannel(clip, key.uid, channel, key.frame)))
    .filter(key => {
      const id = `${key.uid}:${key.frame}`;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
}
