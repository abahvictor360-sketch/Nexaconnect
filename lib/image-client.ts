/**
 * Browser-side image preparation. Runs before upload so the request stays
 * small and inside the model's per-image limits.
 */
export const MAX_EDGE = 1568; // Sonnet 4.6's long-edge limit; above it, tokens are wasted.
export const ACCEPTED = 'image/png,image/jpeg,image/webp,image/gif';

export interface PreparedImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  /** Raw base64, no data: URL prefix. */
  data: string;
  /** A data URL for the on-screen preview. */
  preview: string;
  fileName: string;
  bytes: number;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not an image we can read'));
    image.src = src;
  });
}

/**
 * Downscales anything longer than MAX_EDGE and re-encodes as JPEG. Animated
 * GIFs are passed through untouched, since redrawing one to a canvas would
 * silently keep only the first frame.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED.split(',').includes(file.type)) {
    throw new Error('Please attach a PNG, JPEG, WebP or GIF image.');
  }

  const dataUrl = await readAsDataUrl(file);

  if (file.type === 'image/gif') {
    const data = dataUrl.split(',')[1] ?? '';
    return {
      mediaType: 'image/gif',
      data,
      preview: dataUrl,
      fileName: file.name,
      bytes: Math.floor((data.length * 3) / 4),
    };
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));

  if (scale === 1 && file.size <= 1_500_000) {
    const data = dataUrl.split(',')[1] ?? '';
    return {
      mediaType: file.type as PreparedImage['mediaType'],
      data,
      preview: dataUrl,
      fileName: file.name,
      bytes: file.size,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process that image');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const resized = canvas.toDataURL('image/jpeg', 0.85);
  const data = resized.split(',')[1] ?? '';

  return {
    mediaType: 'image/jpeg',
    data,
    preview: resized,
    fileName: file.name,
    bytes: Math.floor((data.length * 3) / 4),
  };
}
