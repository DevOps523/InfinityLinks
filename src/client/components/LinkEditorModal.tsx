import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type MovieLinkInput = {
  providerName: string;
  quality: string;
  status: string;
  url: string;
};

type LinkEditorModalProps = {
  open: boolean;
  links: MovieLinkInput[];
  onClose: () => void;
  onSave: (links: MovieLinkInput[]) => void;
};

const qualities = ['SD', 'HD', 'Full HD', '2K', '4K'];

function emptyLink(): MovieLinkInput {
  return {
    providerName: '',
    quality: 'HD',
    status: 'active',
    url: ''
  };
}

export function LinkEditorModal({ open, links, onClose, onSave }: LinkEditorModalProps) {
  const [draftLinks, setDraftLinks] = useState<MovieLinkInput[]>(links.length > 0 ? links : [emptyLink()]);
  const [error, setError] = useState('');
  const addButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setDraftLinks(links.length > 0 ? links : [emptyLink()]);
      setError('');
    }
  }, [links, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => addButtonRef.current?.focus(), 0);

    return () => {
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function updateLink(index: number, field: keyof MovieLinkInput, value: string) {
    setDraftLinks((current) => current.map((link, linkIndex) => (linkIndex === index ? { ...link, [field]: value } : link)));
  }

  function removeLink(index: number) {
    setDraftLinks((current) => {
      const next = current.filter((_, linkIndex) => linkIndex !== index);
      return next.length > 0 ? next : [emptyLink()];
    });
  }

  function handleSave() {
    const nonEmptyLinks = draftLinks.filter((link) => link.providerName.trim() || link.url.trim());
    const hasPartialLink = nonEmptyLinks.some((link) => !link.providerName.trim() || !link.url.trim());

    if (hasPartialLink) {
      setError('Each saved link needs both a provider and URL.');
      return;
    }

    onSave(
      nonEmptyLinks.map((link) => ({
        ...link,
        providerName: link.providerName.trim(),
        url: link.url.trim()
      }))
    );
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="links-title" onKeyDown={handleKeyDown}>
        <div className="modal__header">
          <h2 id="links-title">Streaming links</h2>
          <button
            className="button button--secondary"
            type="button"
            ref={addButtonRef}
            onClick={() => setDraftLinks((current) => [...current, emptyLink()])}
          >
            <Plus aria-hidden="true" size={16} />
            Add link
          </button>
        </div>
        <div className="link-editor">
          {draftLinks.map((link, index) => (
            <div className="link-editor__row" key={index}>
              <label>
                Provider
                <input value={link.providerName} onChange={(event) => updateLink(index, 'providerName', event.target.value)} />
              </label>
              <label>
                Quality
                <select value={link.quality} onChange={(event) => updateLink(index, 'quality', event.target.value)}>
                  {qualities.map((quality) => (
                    <option key={quality}>{quality}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={link.status} onChange={(event) => updateLink(index, 'status', event.target.value)}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
              <label>
                URL
                <input type="url" value={link.url} onChange={(event) => updateLink(index, 'url', event.target.value)} />
              </label>
              <button className="icon-button icon-button--danger" type="button" aria-label="Remove link" onClick={() => removeLink(index)}>
                <Trash2 aria-hidden="true" size={18} />
              </button>
            </div>
          ))}
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="modal__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button--primary" type="button" onClick={handleSave}>
            <Save aria-hidden="true" size={16} />
            Save links
          </button>
        </div>
      </section>
    </div>
  );
}
