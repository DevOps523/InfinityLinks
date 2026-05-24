import { ArrowLeft, ListPlus, Plus, RefreshCw, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiJson } from '../api/http';
import { ActionMenu } from '../components/ActionMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useModalFocus } from '../components/useModalFocus';
import { useToast } from '../components/ToastProvider';

type Season = {
  id: number;
  tvShowId: number;
  seasonNumber: number;
  canRepost?: boolean;
};

type SeasonPageProps = {
  tvShowId: number;
  openAddOnEntry?: boolean;
  onAddEntryHandled?: () => void;
  onBack: () => void;
  onManageEpisodes: (seasonId: number) => void;
};

type SeasonDialogProps = {
  open: boolean;
  season: Season | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (seasonNumber: number) => void;
};

function SeasonDialog({ open, season, isSaving, onClose, onSave }: SeasonDialogProps) {
  const [seasonNumber, setSeasonNumber] = useState('');
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
      setSeasonNumber(season ? String(season.seasonNumber) : '');
    }
  }, [open, season]);

  if (!open) {
    return null;
  }

  function submitSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(Number(seasonNumber));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal modal--narrow" role="dialog" aria-modal="true" aria-labelledby="season-dialog-title" ref={dialogRef} onKeyDown={handleKeyDown}>
        <div className="modal__header">
          <h2 id="season-dialog-title">{season ? 'Edit season' : 'Add season'}</h2>
        </div>
        <form className="modal-form" onSubmit={submitSeason}>
          <label>
            Season number
            <input
              ref={inputRef}
              required
              min="1"
              type="number"
              inputMode="numeric"
              value={seasonNumber}
              onChange={(event) => setSeasonNumber(event.target.value)}
            />
          </label>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button className="button button--primary" type="submit" disabled={isSaving}>
              <Save aria-hidden="true" size={16} />
              {isSaving ? 'Saving...' : 'Save season'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SeasonPage({ tvShowId, openAddOnEntry = false, onAddEntryHandled, onBack, onManageEpisodes }: SeasonPageProps) {
  const { showToast } = useToast();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [seasonToDelete, setSeasonToDelete] = useState<Season | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [repostingSeasonId, setRepostingSeasonId] = useState<number | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadSeasons = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!mountedRef.current || signal?.aborted) {
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const payload = await apiJson<{ seasons: Season[] }>(`/api/tv-shows/${tvShowId}/seasons`, { signal });
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setSeasons(payload?.seasons ?? []);
    } catch (loadError) {
      if ((loadError as { name?: string }).name === 'AbortError' || signal?.aborted || requestId !== requestIdRef.current || !mountedRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Unable to load seasons.');
    } finally {
      if (!mountedRef.current || signal?.aborted || requestId !== requestIdRef.current) {
        return;
      }
      setIsLoading(false);
    }
  }, [tvShowId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSeasons(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadSeasons]);

  function openAddSeason() {
    setEditingSeason(null);
    setDialogOpen(true);
  }

  useEffect(() => {
    if (openAddOnEntry) {
      openAddSeason();
      onAddEntryHandled?.();
    }
  }, [openAddOnEntry, onAddEntryHandled]);

  async function saveSeason(seasonNumber: number) {
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
      showToast('Season number must be at least 1.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      if (editingSeason) {
        await apiJson(`/api/seasons/${editingSeason.id}`, {
          method: 'PUT',
          body: JSON.stringify({ seasonNumber })
        });
      } else {
        await apiJson(`/api/tv-shows/${tvShowId}/seasons`, {
          method: 'POST',
          body: JSON.stringify({ seasonNumber })
        });
      }
      if (!mountedRef.current) {
        return;
      }
      setDialogOpen(false);
      setEditingSeason(null);
      await loadSeasons();
      showToast(editingSeason ? 'Season updated.' : 'Season added.');
    } catch (saveError) {
      if (mountedRef.current) {
        showToast(saveError instanceof Error ? saveError.message : 'Unable to save season.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  async function confirmDelete() {
    if (!seasonToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiJson(`/api/seasons/${seasonToDelete.id}`, { method: 'DELETE' });
      if (!mountedRef.current) {
        return;
      }
      setSeasonToDelete(null);
      await loadSeasons();
      showToast('Season deleted and post queue updated.');
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

  async function repostSeason(season: Season) {
    setRepostingSeasonId(season.id);
    try {
      await apiJson(`/api/seasons/${season.id}/repost`, { method: 'POST' });
      if (!mountedRef.current) {
        return;
      }
      await loadSeasons();
      showToast('Season repost queued.');
    } catch (repostError) {
      if (mountedRef.current) {
        showToast(repostError instanceof Error ? repostError.message : 'Unable to repost season.', 'error');
      }
    } finally {
      if (mountedRef.current) {
        setRepostingSeasonId(null);
      }
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <h1>Seasons</h1>
          <p>Manage seasons for TV show #{tvShowId}.</p>
        </div>
        <div className="inline-actions">
          <button className="button button--secondary" type="button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={18} />
            TV Shows
          </button>
          <button className="button button--primary" type="button" onClick={openAddSeason}>
            <Plus aria-hidden="true" size={18} />
            Add Season
          </button>
        </div>
      </div>

      <div className="table-card">
        {isLoading ? <div className="state-panel">Loading seasons...</div> : null}
        {!isLoading && error ? <div className="state-panel state-panel--error">{error}</div> : null}
        {!isLoading && !error && seasons.length === 0 ? <div className="state-panel">No seasons found.</div> : null}
        {!isLoading && !error && seasons.length > 0 ? (
          <div className="table-scroll">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Season number</th>
                  <th>Repost</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.id}>
                    <td>{season.id}</td>
                    <td>{season.seasonNumber}</td>
                    <td>
                      {season.canRepost ? (
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={repostingSeasonId === season.id}
                          onClick={() => repostSeason(season)}
                        >
                          <RefreshCw aria-hidden="true" size={16} />
                          {repostingSeasonId === season.id ? 'Queueing...' : 'Repost Season'}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <ActionMenu
                        extraActions={[
                          {
                            label: 'Add Episode',
                            icon: ListPlus,
                            onSelect: () => onManageEpisodes(season.id)
                          }
                        ]}
                        onEdit={() => {
                          setEditingSeason(season);
                          setDialogOpen(true);
                        }}
                        onDelete={() => setSeasonToDelete(season)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <SeasonDialog
        open={dialogOpen}
        season={editingSeason}
        isSaving={isSaving}
        onClose={() => {
          if (!isSaving) {
            setDialogOpen(false);
            setEditingSeason(null);
          }
        }}
        onSave={saveSeason}
      />
      <ConfirmDialog
        open={Boolean(seasonToDelete)}
        title="Delete season"
        message={seasonToDelete ? `Delete season ${seasonToDelete.seasonNumber} permanently?` : ''}
        isBusy={isDeleting}
        onCancel={() => setSeasonToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
