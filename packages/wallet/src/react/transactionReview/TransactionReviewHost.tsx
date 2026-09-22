import {
  Component,
  Suspense,
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { createPortal } from 'react-dom';
import { useSeams } from '../context';
import { ReviewHostController, ReviewOwner, type ReviewCallView } from './controller';
import { TransactionReviewError } from './contract';

const ReviewContext = createContext<ReviewHostController | null>(null);

/** Place below the application providers that review components consume. */
export function TransactionReviewHost({ children }: { children: ReactNode }): ReactNode {
  const { seams } = useSeams();
  const ancestor = useContext(ReviewContext);
  const host = useMemo(() => new ReviewHostController(seams), [seams]);
  if (ancestor?.seams.near === seams.near) {
    throw new TransactionReviewError(
      'review_host_unavailable',
      'Nested TransactionReviewHost components cannot use the same SeamsWeb instance',
    );
  }
  useLayoutEffect(host.retain.bind(host), [host]);
  const call = useSyncExternalStore(host.subscribe, host.snapshot, host.snapshot);
  return (
    <ReviewContext.Provider value={host}>
      {children}
      {call ? <ReviewPortal key={call.review.title} call={call} /> : null}
    </ReviewContext.Provider>
  );
}

export function useTransactionReviewOwner(identity: string | null): {
  readonly host: ReviewHostController | null;
  readonly owner: ReviewOwner;
} {
  const host = useContext(ReviewContext);
  const owner = useMemo(() => new ReviewOwner(), [host, identity]);
  useLayoutEffect(owner.retain.bind(owner), [owner]);
  return { host, owner };
}

function ReviewPortal({ call }: { call: ReviewCallView }): ReactNode {
  const state = useSyncExternalStore(call.subscribe, call.snapshot, call.snapshot);
  if (
    state.kind === 'queued' ||
    state.kind === 'settled' ||
    state.kind === 'wallet_approval' ||
    state.kind === 'signing'
  )
    return null;
  return createPortal(
    <ReviewContent call={call} />,
    state.reservation.slot,
    state.reservation.identity.requestId,
  );
}

function ReviewContent({ call }: { call: ReviewCallView }): ReactNode {
  const state = useSyncExternalStore(call.subscribe, call.snapshot, call.snapshot);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (content.current) content.current.inert = state.kind === 'preparing_approval';
  }, [state.kind]);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [call]);
  return (
    <section className={`seams-transaction-review-content ${call.review.className ?? ''}`}>
      <h2 tabIndex={-1} ref={heading}>
        {call.review.title}
      </h2>
      {state.kind === 'review_failed' ? (
        <ReviewFailure call={call} />
      ) : (
        <div ref={content} aria-hidden={state.kind === 'preparing_approval' ? true : undefined}>
          <ReviewErrorBoundary call={call}>
            <Suspense fallback={<ReviewLoading call={call} />}>
              <RenderReview call={call} />
            </Suspense>
          </ReviewErrorBoundary>
        </div>
      )}
    </section>
  );
}

function RenderReview({ call }: { call: ReviewCallView }): ReactNode {
  const content = call.review.render(call.controls);
  if (content && typeof content === 'object' && 'then' in content) {
    throw new TransactionReviewError(
      'review_render_failed',
      'Review render must return React content synchronously; use Suspense for loading',
    );
  }
  return content;
}

function ReviewLoading({ call }: { call: ReviewCallView }): ReactNode {
  useEffect(scheduleReviewLoadingTimeout.bind(null, call), [call]);
  return (
    <>
      <p role="status">Loading review…</p>
      <button type="button" onClick={call.controls.cancel}>
        Cancel
      </button>
    </>
  );
}

function ReviewFailure({ call }: { call: ReviewCallView }): ReactNode {
  return (
    <>
      <p role="alert">The application review could not be displayed.</p>
      <button type="button" onClick={call.controls.cancel}>
        Dismiss
      </button>
    </>
  );
}

class ReviewErrorBoundary extends Component<
  { call: ReviewCallView; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.call.controls.fail(error);
  }
  render(): ReactNode {
    return this.state.failed ? <ReviewFailure call={this.props.call} /> : this.props.children;
  }
}

function scheduleReviewLoadingTimeout(call: ReviewCallView): () => void {
  const timer = setTimeout(call.loadingTimedOut, 30_000);
  return clearTimeout.bind(null, timer);
}
