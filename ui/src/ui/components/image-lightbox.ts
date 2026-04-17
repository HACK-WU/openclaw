/**
 * Image Lightbox Component
 *
 * Renders a modal overlay for viewing images in enlarged format.
 * Supports click-to-close and ESC key for dismissal.
 */

import { html, nothing } from "lit";

export type ImageLightboxProps = {
  /** URL of the image to display */
  url: string | null;
  /** Alt text for the image */
  alt?: string;
  /** Callback when lightbox is closed */
  onClose: () => void;
};

/**
 * Renders an image lightbox overlay.
 * Returns nothing if url is null.
 */
export function renderImageLightbox(props: ImageLightboxProps) {
  const { url, alt = "Image", onClose } = props;

  if (!url) {
    return nothing;
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleBackdropClick = (e: MouseEvent) => {
    // Only close if clicking the backdrop, not the image
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return html`
    <div
      class="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label=${`Enlarged ${alt}`}
      tabindex="-1"
      @click=${handleBackdropClick}
      @keydown=${handleKeydown}
    >
      <div class="image-lightbox__content">
        <button
          class="image-lightbox__close"
          type="button"
          aria-label="Close image"
          @click=${onClose}
        >
          ✕
        </button>
        <img
          class="image-lightbox__image"
          src=${url}
          alt=${alt}
          @click=${(e: Event) => e.stopPropagation()}
        />
      </div>
    </div>
  `;
}
