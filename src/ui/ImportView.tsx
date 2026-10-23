import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { RecipeDraft } from '../domain';
import { api, ApiError, type PhotoMediaType } from '../api/client';

interface Props {
  /** Photo import (and better results on pages without recipe data) need the Claude key on the server. */
  claudeEnabled: boolean;
  onDraft: (draft: RecipeDraft) => void;
  onCancel: () => void;
}

const PHOTO_TYPES: PhotoMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIDE = 1600;

/** Shrink a photo in the browser so a 12-megapixel phone shot becomes a sub-megabyte JPEG. */
async function photoToBase64(file: File): Promise<{ data: string; mediaType: PhotoMediaType }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL('image/jpeg', 0.85);
    return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } catch {
    // The browser could not decode it (e.g. HEIC on a non-Apple browser). Send as is when the type is allowed.
    if (!(PHOTO_TYPES as string[]).includes(file.type)) throw new Error('Use a JPEG or PNG photo (on iPhone, Settings → Camera → Formats → Most Compatible).');
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mediaType: file.type as PhotoMediaType };
  }
}

export function ImportView({ claudeEnabled, onDraft, onCancel }: Props) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'url' | 'text' | 'photo'>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function run(kind: 'url' | 'text' | 'photo', work: () => Promise<RecipeDraft>) {
    if (busy) return;
    setBusy(kind);
    setErrors([]);
    try {
      onDraft(await work());
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : [err instanceof Error ? err.message : 'Something went wrong.']);
      setBusy(null);
    }
  }

  function submitUrl(e: FormEvent) {
    e.preventDefault();
    void run('url', () => api.importUrl(url.trim()));
  }
  function submitText(e: FormEvent) {
    e.preventDefault();
    void run('text', () => api.importText(text));
  }
  function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('photo', async () => {
      const { data, mediaType } = await photoToBase64(file);
      return api.importPhoto(data, mediaType);
    });
  }

  return (
    <div className="import-view">
      <div className="toolbar">
        <h2>Import a recipe</h2>
        <button type="button" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </button>
      </div>
      <p className="muted">Whatever comes back opens in the recipe form for you to check before it is saved.</p>

      <form className="card" onSubmit={submitUrl}>
        <h3>From a web page</h3>
        <label>
          Paste the address of the recipe
          <input type="url" inputMode="url" placeholder="https://www.example.com/best-chili" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
        <button type="submit" className="primary" disabled={busy !== null}>
          {busy === 'url' ? 'Reading the page…' : 'Fetch recipe'}
        </button>
      </form>

      <form className="card" onSubmit={submitText}>
        <h3>From text</h3>
        <label>
          Paste or type the recipe
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Lemon pasta\nServes 4\n1 lb spaghetti\n3 cloves garlic, minced\n…\nBoil the pasta…'} required />
        </label>
        <button type="submit" className="primary" disabled={busy !== null}>
          {busy === 'text' ? 'Reading…' : 'Read text'}
        </button>
      </form>

      <div className="card">
        <h3>From a photo</h3>
        {claudeEnabled ? (
          <>
            <p className="muted">A cookbook page, a recipe card, a screenshot. Hold the phone square to the page in good light.</p>
            <label className="file">
              <input type="file" accept="image/*" capture="environment" onChange={choosePhoto} disabled={busy !== null} />
              <span className="primary-look">{busy === 'photo' ? 'Reading the photo…' : 'Take or choose a photo'}</span>
            </label>
          </>
        ) : (
          <p className="muted">Photo import is off because the server has no Claude API key. See docs/deploy.md to turn it on.</p>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
