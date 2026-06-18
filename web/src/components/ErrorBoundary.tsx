import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";

interface Props {
  children: ReactNode;
  /** Optional compact fallback for in-page boundaries (vs. the full-screen app shell). */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Top-level (and route-level) error boundary. A render throw anywhere below this
 * boundary is caught and replaced with a recoverable fallback instead of
 * white-screening the whole SPA.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; an operator can wire this to a reporter (TODO operator).
    console.error("Render error caught by boundary:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className={
          this.props.compact
            ? ""
            : "mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4"
        }
      >
        <Card className="w-full space-y-3 p-6 text-center">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted">
            The page hit an unexpected error. You can try again or head back home.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button
              variant="outline"
              onClick={() => {
                this.reset();
                window.location.assign("/");
              }}
            >
              Go home
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
