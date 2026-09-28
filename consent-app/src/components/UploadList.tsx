import { formatBytes } from '../lib/image';
import { imageStore } from '../lib/imageStore';
import type { DonationImage } from '../model/types';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

interface Props {
  images: DonationImage[];
  onRemove: (image: DonationImage) => void;
  onRetry: (image: DonationImage) => void;
  onEdit: (image: DonationImage) => void;
  busy?: boolean;
}

function statusText(image: DonationImage): string {
  switch (image.status) {
    case 'pending':
      return 'Ready to send';
    case 'uploading':
      return `Uploading… ${Math.round(image.progress * 100)}%`;
    case 'uploaded':
      return 'Uploaded';
    case 'failed':
      return 'Upload failed';
  }
}

/** Preview cards with status, and actions to hide parts, retry or remove. */
export function UploadList({ images, onRemove, onRetry, onEdit, busy }: Props) {
  if (!images.length) return null;
  return (
    <ul className="mpmb-uploads" role="list" aria-label="Your images">
      {images.map((image, i) => {
        const stored = imageStore.get(image.id);
        const n = i + 1;
        return (
          <li key={image.id} className={`mpmb-upload is-${image.status}`}>
            <div className="mpmb-upload__preview">
              {stored ? (
                <img src={stored.url} alt={`Image ${n}: ${image.name}${image.redacted ? ', with hidden areas' : ''}`} />
              ) : (
                <div className="mpmb-upload__nopreview">
                  <Icon name="image" size={28} />
                  <span>Preview not available after refresh</span>
                </div>
              )}
              {image.status === 'uploading' && (
                <div className="mpmb-upload__progress" aria-hidden="true">
                  <span style={{ width: `${Math.round(image.progress * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="mpmb-upload__meta">
              <p className="mpmb-upload__name">
                Image {n}
                <span className="mpmb-upload__size"> · {formatBytes(image.size)}</span>
                {image.redacted && <span className="mpmb-upload__flag">Parts hidden</span>}
                {image.cropped && <span className="mpmb-upload__flag">Cropped</span>}
              </p>
              <p className={`mpmb-upload__status is-${image.status}`}>
                {image.status === 'uploaded' && <Icon name="check" size={16} />}
                {image.status === 'failed' && <Icon name="warning" size={16} />}
                {statusText(image)}
              </p>
              {image.error && <p className="mpmb-error">{image.error}</p>}
              <div className="mpmb-upload__actions">
                {image.status === 'failed' && (
                  <Button variant="secondary" onClick={() => onRetry(image)} aria-label={`Try sending image ${n} again`} disabled={busy}>
                    Try again
                  </Button>
                )}
                {stored && image.status !== 'uploading' && (
                  <Button variant="secondary" onClick={() => onEdit(image)} aria-label={`Hide part of image ${n}`} disabled={busy}>
                    Hide part of it
                  </Button>
                )}
                <Button variant="link" onClick={() => onRemove(image)} aria-label={`Remove image ${n}`} disabled={busy}>
                  Remove
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
