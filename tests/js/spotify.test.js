import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockTime, describe, progressAt, statusLabel } from '../../web/js/apps/spotify/format.js';

const song = { title: 'Song', artist: 'Band', playing: true, progress_ms: 10000, duration_ms: 60000, at: 1000 };

test('the playhead moves on from where the server last saw it, only while playing', () => {
  assert.equal(progressAt(song, 6000), 15000);
  assert.equal(progressAt(song, 500), 10000, 'never backwards for a screen whose clock is behind');
  assert.equal(progressAt(song, 999999), 60000, 'stops at the end of the song');
  assert.equal(progressAt({ ...song, playing: false }, 6000), 10000);
  assert.equal(progressAt(null, 6000), 0);
});

test('times read like a music player', () => {
  assert.equal(clockTime(0), '0:00');
  assert.equal(clockTime(187400), '3:07');
  assert.equal(clockTime(3765000), '1:02:45');
});

test('the status line and what a screen reader hears', () => {
  assert.equal(statusLabel({ configured: false }), 'Not set up');
  assert.equal(statusLabel({ configured: true, linked: false }), 'Not connected');
  assert.equal(statusLabel({ configured: true, linked: true, track: null, error: 'x' }), 'Offline');
  assert.equal(statusLabel({ configured: true, linked: true, track: null }), 'Nothing playing');
  assert.equal(statusLabel({ configured: true, linked: true, track: { ...song, playing: false } }), 'Paused');
  assert.equal(describe({ configured: true, linked: true, track: song }), 'Spotify, playing: Song by Band');
});
