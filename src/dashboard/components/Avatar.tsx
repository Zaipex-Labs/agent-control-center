import { resolveAvatarSrc } from '../lib/avatar';

interface AvatarProps {
  avatar: string | undefined | null;
  seed: string; // fallback seed (e.g. agent name or role) for the bot style
  size?: number;
  background?: string; // shown while the svg is transparent
  title?: string;
}

export default function Avatar({ avatar, seed, size = 32, background, title }: AvatarProps) {
  const src = resolveAvatarSrc(avatar, seed);
  return (
    <div
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: background ?? '#E2DDD4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );
}
