export async function copySurfaceText(
  root: Element,
  value: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!root.isConnected || signal?.aborted) return false;
  const document = root.ownerDocument;
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Embedded browsers may deny the Clipboard API while allowing selected-text copy.
    }
  }
  if (!root.isConnected || signal?.aborted) return false;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.readOnly = true;
  textarea.className = 'seams-offscreen';
  root.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
