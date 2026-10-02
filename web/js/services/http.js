// JSON over HTTP to the board server. Errors carry a message that's fine to show people.

const OFFLINE_MESSAGE = "Couldn't reach the board. Check that the Pi is on.";

async function request(path, init, fallbackMessage) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new Error(OFFLINE_MESSAGE);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || fallbackMessage);
  return data;
}

export function getJson(path) {
  return request(path, {}, 'Something went wrong. Try again.');
}

export function postJson(path, body) {
  return request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    "That didn't save. Try again.",
  );
}

// crypto.randomUUID needs HTTPS; phones reach the board over plain HTTP.
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
