import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
	children: ReactNode;
	/**
	 * Optional fallback component to render when an error occurs.
	 * If not provided, a default error UI will be shown.
	 */
	fallback?: ReactNode;
	/**
	 * Optional callback when an error is caught.
	 */
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
	/**
	 * Optional name for the boundary (used in error messages).
	 */
	name?: string;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * React Error Boundary component that catches JavaScript errors
 * anywhere in its child component tree.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary name="PerformanceGraph">
 *   <PerformanceGraph />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		const { onError, name } = this.props;

		// Log to console with boundary name for debugging
		console.error(
			`[ErrorBoundary${name ? `: ${name}` : ""}] Caught error:`,
			error,
			errorInfo.componentStack,
		);

		// Call optional error callback
		onError?.(error, errorInfo);
	}

	handleReset = () => {
		this.setState({ hasError: false, error: null });
	};

	render() {
		const { hasError, error } = this.state;
		const { children, fallback, name } = this.props;

		if (hasError) {
			if (fallback) {
				return fallback;
			}

			return (
				<div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-6">
					<div className="flex items-center gap-2 text-destructive">
						<AlertTriangle className="h-6 w-6" />
						<h3 className="text-lg font-semibold">Something went wrong</h3>
					</div>
					{name && (
						<p className="text-sm text-muted-foreground">
							Error in: {name}
						</p>
					)}
					{error && (
						<p className="max-w-md text-center text-sm text-muted-foreground">
							{error.message}
						</p>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={this.handleReset}
						className="gap-2"
					>
						<RefreshCw className="h-4 w-4" />
						Try again
					</Button>
				</div>
			);
		}

		return children;
	}
}

/**
 * HOC to wrap a component with an ErrorBoundary.
 *
 * Usage:
 * ```tsx
 * const SafePerformanceGraph = withErrorBoundary(PerformanceGraph, "PerformanceGraph");
 * ```
 */
export function withErrorBoundary<P extends object>(
	WrappedComponent: React.ComponentType<P>,
	name?: string,
) {
	const displayName = WrappedComponent.displayName || WrappedComponent.name || "Component";

	const WithErrorBoundary = (props: P) => (
		<ErrorBoundary name={name || displayName}>
			<WrappedComponent {...props} />
		</ErrorBoundary>
	);

	WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

	return WithErrorBoundary;
}
