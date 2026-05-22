import { ArrowLeft, Link as LinkIcon, Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiJson } from '../api/http';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LinkEditorModal, type MovieLinkInput } from '../components/LinkEditorModal';
import { useModalFocus } from '../components/useModalFocus';
import { useToast } from '../components/ToastProvider';

type EpisodeLink = MovieLinkInput & {
  id: number;
  episodeId: number;
};

type Episode = {
  id: number;
  seasonId: number;
  episodeNumber: number;
  links: EpisodeLink[];
};

type EpisodePageProps = {
  seasonId: number;
  onBack: () => void;
};

type EpisodeDialogProps = {
  open: boolean;
  episode: Episode | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (episodeNumber: number) => void;
};

type DeleteTarget = { kind: 'episode'; episode: Episode } | { kind: 'link'; link: EpisodeLink };

function EpisodeDialog({ open, episode, isSaving, onClose, onSave }: EpisodeDialogProps) {
  const [episodeNumber, setEpisodeNumber] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const handleKeyDown = useModalFocus({
    open,
    dialogRef,
    initialFocusRef: inputRef,
    onClose,
    closeOnEscape: !isSaving
  });

  useEffect(() => {
    if (open) {
      setEpisodeNumber(episode ? String(episode.episodeNumber) : '');
    }
  }, [episode, open]);

  if (!open) {
    return null;
  }

  function submitEpisode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(Number(episodeNumber));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal modal--narrow" role="dialog" aria-modal="true" aria-labelledby="episode-dialog-title" ref={dialogRef} onKeyDown={handleKeyDown}>
        <div className="modal__header">
          <h2 id="episode-dialog-title">Edit episode</h2>
        </div>
        <form className="modal-form" onSubmit={submitEpisode}>
          <label>
            Episode number
            <input
              ref={inputRef}
              required
              min="1"
              type="number"
              inputMode="numeric"
              value={episodeNumber}
              onChange={(event) => setEpisodeNumber(event.target.value)}
            />
          </label>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button className="button button--primary" type="submit" disabled={isSaving}>
              <Save aria-hidden="true" size={16} />
              {isSaving ? 'Saving...' : 'Save episode'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function EpisodePage({ seasonId, onBack }: EpisodePageProps) {
  const { showToast } = useToast();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [startEpisode, setStartEpisode] = useState('1');
  const [episodeCount, setEpisodeCount] = useState('1');
  const [isLoading, setIsLoading] = useState(true);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [isSavingEpisode, setIsSavingEpisode] = useState(false);
  const [linkModal, setLinkModal] = useState<{ episodeId: number; link?: EpisodeLink } | null>(null);
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadEpisodes = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!mountedRef.current || signal?.aborted) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const payload = await apiJson<{ episodes: Array<Omit<Episode, 'links'>> }>(`/api/seasons/${seasonId}/episodes`, { signal });
      const episodeRows = payload?.episodes ?? [];
      const episodesWithLinks = await Promise.all(
        episodeRows.map(async (episode) => {
          const detail = await apiJson<{ episode: Episode }>(`/api/episodes/${episode.id}`, { signal });
          return detail?.episode ?? { ...episode, links: [] };
        })
      );

      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setEpisodes(episodesWithLinks);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === 'AbortError' || signal?.aborted || requestId !== requestIdRef.current || !mountedRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Unable to load episodes.');
    } finally {
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setIsLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadEpisodes(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadEpisodes]);

  async function addEpisodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstEpisode = Number(startEpisode);
    const count = Number(episodeCount);
    if (!Number.isInteger(firstEpisode) || firstEpisode < 1 || !Number.isInteger(count) || count < 1) {
      showToast('Episode start and count must be at least 1.', 'error');
      return;
    }

    setIsBulkSaving(true);
    try {
      await apiJson(`/api/seasons/${seasonId}/episodes/bulk`, {
        method: 'POST',
        body: JSON.stringify({ startEpisode: firstEpisode, count })
      });
      if (!mountedRef.current) {
        return;
      }
      await loadEpisodes();
      setStartEpisode(String(firstEpisode + count));
      setEpisodeCount('1');
      showToast(count === 1 ? 'Episode added.' : 'Episodes added.');
    } catch (saveError) {
      if (mountedRef.current) {
        showToast(saveError instanceof Error ? saveError.message : 'Unable to add episodes.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsBulkSaving(false);
      }
    }
  }

  async function saveEpisode(episodeNumber: number) {
    if (!editingEpisode || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
      showToast('Episode number must be at least 1.', 'error');
      return;
    }

    setIsSavingEpisode(true);
    try {
      await apiJson(`/api/episodes/${editingEpisode.id}`, {
        method: 'PUT',
        body: JSON.stringify({ episodeNumber })
      });
      if (!mountedRef.current) {
        return;
      }
      setEditingEpisode(null);
      await loadEpisodes();
      showToast('Episode updated.');
    } catch (saveError) {
      if (mountedRef.current) {
        showToast(saveError instanceof Error ? saveError.message : 'Unable to save episode.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingEpisode(false);
      }
    }
  }

  async function saveLinks(links: MovieLinkInput[]) {
    if (!linkModal) {
      return;
    }

    if (links.length === 0) {
      showToast('Add at least one complete link before saving.', 'error');
      return;
    }

    if (linkModal.link && links.length !== 1) {
      showToast('Edit one link at a time.', 'error');
      return;
    }

    setIsSavingLinks(true);
    try {
      if (linkModal.link) {
        const [link] = links;
        await apiJson(`/api/episode-links/${linkModal.link.id}`, {
          method: 'PUT',
          body: JSON.stringify(link)
        });
      } else {
        await apiJson(`/api/episodes/${linkModal.episodeId}/links`, {
          method: 'POST',
          body: JSON.stringify({ links })
        });
      }
      if (!mountedRef.current) {
        return;
      }
      setLinkModal(null);
      await loadEpisodes();
      showToast(linkModal.link ? 'Link updated.' : 'Links added.');
    } catch (saveError) {
      if (mountedRef.current) {
        showToast(saveError instanceof Error ? saveError.message : 'Unable to save links.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingLinks(false);
      }
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiJson(deleteTarget.kind === 'episode' ? `/api/episodes/${deleteTarget.episode.id}` : `/api/episode-links/${deleteTarget.link.id}`, {
        method: 'DELETE'
      });
      if (!mountedRef.current) {
        return;
      }
      setDeleteTarget(null);
      await loadEpisodes();
      showToast(deleteTarget.kind === 'episode' ? 'Episode deleted.' : 'Link deleted.');
    } catch (deleteError) {
      if (mountedRef.current) {
        showToast(deleteError instanceof Error ? deleteError.message : 'Delete failed.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsDeleting(false);
      }
    }
  }

  const linkModalLinks = linkModal?.link ? [linkModal.link] : [];
  const deleteTitle = deleteTarget?.kind === 'episode' ? 'Delete episode' : 'Delete link';
  const deleteMessage =
    deleteTarget?.kind === 'episode'
      ? `Delete episode ${deleteTarget.episode.episodeNumber} permanently?`
      : deleteTarget
        ? `Delete "${deleteTarget.link.providerName}" permanently?`
        : '';

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Episodes</h1>
          <p>Manage episodes and download links for season #{seasonId}.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={18} />
          Seasons
        </button>
      </div>

      <form className="filter-bar episode-bulk-form" onSubmit={addEpisodes}>
        <label>
          Start episode
          <input
            required
            min="1"
            type="number"
            inputMode="numeric"
            value={startEpisode}
            onChange={(event) => setStartEpisode(event.target.value)}
          />
        </label>
        <label>
          Count
          <input required min="1" type="number" inputMode="numeric" value={episodeCount} onChange={(event) => setEpisodeCount(event.target.value)} />
        </label>
        <button className="button button--primary" type="submit" disabled={isBulkSaving}>
          <Plus aria-hidden="true" size={18} />
          {isBulkSaving ? 'Adding...' : 'Add Episodes'}
        </button>
      </form>

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading episodes...</div> : null}
        {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
        {!isLoading && !error && episodes.length === 0 ? <div className="state-panel">No episodes found.</div> : null}
        {!isLoading && !error && episodes.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Episode number</th>
                  <th>Links</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((episode) => (
                  <tr key={episode.id}>
                    <td>{episode.id}</td>
                    <td>{episode.episodeNumber}</td>
                    <td>
                      {episode.links.length > 0 ? (
                        <div className="link-list">
                          {episode.links.map((link) => (
                            <div className="link-list__item" key={link.id}>
                              <div>
                                <strong>{link.providerName}</strong>
                                <span>{link.quality} - {link.status}</span>
                                <a href={link.url}>{link.url}</a>
                              </div>
                              <div className="link-list__actions">
                                <button className="button button--secondary" type="button" onClick={() => setLinkModal({ episodeId: episode.id, link })}>
                                  Edit
                                </button>
                                <button className="button button--danger" type="button" onClick={() => setDeleteTarget({ kind: 'link', link })}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        'No links'
                      )}
                    </td>
                    <td>
                      <ActionMenu
                        extraActions={[
                          {
                            label: 'Add Link',
                            icon: LinkIcon,
                            onSelect: () => setLinkModal({ episodeId: episode.id })
                          }
                        ]}
                        onEdit={() => setEditingEpisode(episode)}
                        onDelete={() => setDeleteTarget({ kind: 'episode', episode })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <EpisodeDialog
        open={Boolean(editingEpisode)}
        episode={editingEpisode}
        isSaving={isSavingEpisode}
        onClose={() => {
          if (!isSavingEpisode) {
            setEditingEpisode(null);
          }
        }}
        onSave={saveEpisode}
      />
      <LinkEditorModal
        open={Boolean(linkModal)}
        links={linkModalLinks}
        isSaving={isSavingLinks}
        onClose={() => {
          if (!isSavingLinks) {
            setLinkModal(null);
          }
        }}
        onSave={saveLinks}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTitle}
        message={deleteMessage}
        isBusy={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
