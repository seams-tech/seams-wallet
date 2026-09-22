export function drawerDragTranslate(args: {
  startTranslatePx: number;
  deltaPx: number;
  restTranslatePx: number;
  sheetHeightPx: number;
  viewportHeightPx: number;
  minimumOverpullPx: number;
}): number {
  const target = args.startTranslatePx + args.deltaPx;
  if (target >= args.restTranslatePx) return target;

  const allowance = Math.max(
    args.sheetHeightPx * 0.5,
    args.viewportHeightPx * 0.5,
    args.minimumOverpullPx,
  );
  const overpull = args.restTranslatePx - target;
  return args.restTranslatePx - allowance * (1 - 1 / (overpull / allowance + 1));
}

export function shouldDismissDrawerDrag(args: {
  velocityPxPerMs: number;
  totalDeltaPx: number;
  durationMs: number;
  translatePx: number;
  sheetHeightPx: number;
}): boolean {
  const averageVelocity = args.totalDeltaPx / Math.max(1, args.durationMs);
  // Both flick directions dismiss; a slow upward pull returns to the open rest.
  return (
    Math.min(args.velocityPxPerMs, averageVelocity) <= -0.6 ||
    Math.max(args.velocityPxPerMs, averageVelocity) >= 0.7 ||
    args.translatePx >= args.sheetHeightPx - 50
  );
}
