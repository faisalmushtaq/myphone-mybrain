import { useRef } from 'react';
import { study } from '../config/study';
import { Icon } from './ui/Icon';

interface Props {
  onFiles: (files: FileList) => void;
  disabled?: boolean;
  count: number;
  /** Most images allowed; the family study's limit unless given. */
  max?: number;
  /** Under "Take a photo of the screen": when someone would use it. */
  cameraHint?: string;
}

/**
 * Two ways in: take a photo with the device camera (capture="environment")
 * or choose an existing screenshot. Both use native file inputs so they work
 * with keyboards, screen readers and every mobile browser.
 */
export function ImageCapture({ onFiles, disabled, count, max = study.upload.maxImages, cameraHint = 'If the screen-time summary is on a different phone.' }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = study.upload.acceptedTypes.join(',');
  const full = count >= max;

  const handle = (input: HTMLInputElement | null) => {
    if (input?.files?.length) onFiles(input.files);
    if (input) input.value = '';
  };

  return (
    <div className="mpmb-capture">
      <input ref={fileRef} type="file" accept={accept} multiple className="mpmb-sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => handle(e.target)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="mpmb-sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => handle(e.target)} />
      <button type="button" className="mpmb-capture__btn" disabled={disabled || full} onClick={() => fileRef.current?.click()}>
        <Icon name="image" size={28} />
        <span className="mpmb-capture__title">Choose a screenshot</span>
        <span className="mpmb-capture__hint">From your photos or files. You can pick more than one.</span>
      </button>
      <button type="button" className="mpmb-capture__btn" disabled={disabled || full} onClick={() => cameraRef.current?.click()}>
        <Icon name="camera" size={28} />
        <span className="mpmb-capture__title">Take a photo of the screen</span>
        <span className="mpmb-capture__hint">{cameraHint}</span>
      </button>
      {full && (
        <p className="mpmb-hint" role="status">
          You have added the maximum of {max} images.
        </p>
      )}
    </div>
  );
}
