// NotesService: sticky notes everyone at home can see. Stored on the Pi in data/notes.json.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// Must match board/notes.py so a new note doesn't change colour when the server answers.
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'];

export function nextNoteColor(notes) {
  const index = NOTE_COLORS.indexOf(notes[0]?.color);
  return index === -1 ? NOTE_COLORS[0] : NOTE_COLORS[(index + 1) % NOTE_COLORS.length];
}

export function createNotesService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, notes: [] },
    send: (action, body) => postJson(`/api/notes/${action}`, body),
    fetchState: () => getJson('/api/notes'),
  });
  live.on('notes', synced.receive);

  return {
    getNotes: () => synced.state.notes,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    addNote(rawText) {
      const text = rawText.trim().replace(/\s+/g, ' ');
      const id = newId();
      return synced.mutate('add', { text, id }, (s) => {
        s.notes.unshift({ id, text, color: nextNoteColor(s.notes), created: new Date().toISOString() });
        return s;
      });
    },

    removeNote(id) {
      return synced.mutate('remove', { id }, (s) => {
        s.notes = s.notes.filter((note) => note.id !== id);
        return s;
      });
    },

    restoreNotes(ids) {
      return synced.mutate('restore', { ids });
    },
  };
}
