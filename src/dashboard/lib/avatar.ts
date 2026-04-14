import { createAvatar } from '@dicebear/core';
import { bottts } from '@dicebear/collection';

// Agent avatars are stored as one of:
//   - data:image/png;base64,...   → user-uploaded image
//   - dicebear:<seed>             → generated from the bottts style by seed
//   - empty/undefined             → fallback to deterministic seed from name
//
// Uploaded images are resized client-side to 64×64 before being embedded.

export const DICEBEAR_PREFIX = 'dicebear:';

export function isDataUrl(value: string | undefined | null): boolean {
  return !!value && value.startsWith('data:');
}

export function isDicebear(value: string | undefined | null): boolean {
  return !!value && value.startsWith(DICEBEAR_PREFIX);
}

const svgCache = new Map<string, string>();

function generateDicebearDataUrl(seed: string): string {
  const cached = svgCache.get(seed);
  if (cached) return cached;
  const svg = createAvatar(bottts, { seed, size: 64 }).toString();
  const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  svgCache.set(seed, encoded);
  return encoded;
}

// Turn any avatar value (or fallback seed) into a src usable by <img>.
export function resolveAvatarSrc(
  avatar: string | undefined | null,
  fallbackSeed: string,
): string {
  if (isDataUrl(avatar)) return avatar as string;
  if (isDicebear(avatar)) return generateDicebearDataUrl((avatar as string).slice(DICEBEAR_PREFIX.length));
  return generateDicebearDataUrl(fallbackSeed || 'default');
}

export function presetValue(seed: string): string {
  return `${DICEBEAR_PREFIX}${seed}`;
}

// Generate N random seeds for the avatar picker. Each call returns a fresh
// set so users can keep rolling until they find one they like.
export function generateRandomSeeds(count: number): string[] {
  const seeds: string[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(Math.random().toString(36).slice(2, 10));
  }
  return seeds;
}

// Extract the underlying seed from a dicebear:<seed> value, or null.
export function extractSeed(value: string | undefined | null): string | null {
  if (!value || !value.startsWith(DICEBEAR_PREFIX)) return null;
  return value.slice(DICEBEAR_PREFIX.length);
}

// Resize an uploaded file to a 64×64 data URL. Returns null if the file
// cannot be decoded.
export async function fileToAvatarDataUrl(file: File): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== 'string') return resolve(null);
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        // Cover-fit crop
        const ratio = Math.max(size / img.width, size / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
