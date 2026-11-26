/**
 * A QR code for `text` as a PNG data URL. `qrcode` is a Wallet dependency that
 * loads on first use, so pages that never show a code do not fetch it.
 */
export async function qrCodeDataUrl(
  text: string,
  layout: { readonly margin: number; readonly width?: number },
): Promise<string> {
  const qrcode = await import('qrcode');
  return await qrcode.toDataURL(text, { errorCorrectionLevel: 'M', ...layout });
}
