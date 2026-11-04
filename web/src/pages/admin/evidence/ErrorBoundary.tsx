import { Component, type ReactNode } from 'react';
import { Button } from '../../../components/ui';

export const BOUNDARY_MESSAGE = 'This section could not be displayed. The data returned did not have the expected shape.';

interface Props {
  children: ReactNode;
  /** Called when the person presses Retry, before the section is shown again (the shell uses it to drop cached answers). */
  onRetry?: () => void;
}

/**
 * Keeps one section's failure from taking the whole Evidence Center down. It renders a fixed message and a Retry button and
 * nothing from the data or the error: a response may hold case details, so none of it is shown or logged here.
 */
export class SectionBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-surface p-4">
        <p className="text-base">{BOUNDARY_MESSAGE}</p>
        <Button variant="secondary" onClick={this.retry}>
          Retry
        </Button>
      </div>
    );
  }
}
