import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ movies: [] })
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('App', () => {
  it('shows media navigation and the Add Movie link', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /movies/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    expect(within(navigation).getByRole('button', { name: /^movies$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add movie$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^tv shows$/i })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: /^add tv show$/i })).toBeInTheDocument();
  });

  it('renders the Add Movie form after clicking Add Movie', async () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: /media navigation/i });
    fireEvent.click(within(navigation).getByRole('button', { name: /^add movie$/i }));

    expect(screen.getByRole('heading', { name: /^add movie$/i })).toBeInTheDocument();
  });
});
