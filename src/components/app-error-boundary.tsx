"use client";

import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import RecoveryScreen from "./recovery-screen";
import { clearAppStorage, shouldAutoRecoverFromError } from "../lib/app-storage";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  autoRecovered: boolean;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    autoRecovered: false,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      error,
      autoRecovered: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Fatal UI error captured by AppErrorBoundary.", error, errorInfo);
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentDidUpdate(
    _previousProps: AppErrorBoundaryProps,
    previousState: AppErrorBoundaryState,
  ) {
    if (
      this.state.error &&
      this.state.error !== previousState.error &&
      shouldAutoRecoverFromError(this.state.error)
    ) {
      clearAppStorage();
      this.setState({ autoRecovered: true });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  handleWindowError = (event: ErrorEvent) => {
    if (this.state.error) {
      return;
    }

    if (!event.error && !event.message) {
      return;
    }

    const nextError =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || "Terjadi kesalahan fatal pada aplikasi.");

    this.setState({
      error: nextError,
      autoRecovered: false,
    });
  };

  handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (this.state.error) {
      return;
    }

    const nextError =
      event.reason instanceof Error
        ? event.reason
        : new Error("Terjadi kesalahan fatal pada aplikasi.");

    this.setState({
      error: nextError,
      autoRecovered: false,
    });
  };

  render() {
    if (this.state.error) {
      return (
        <RecoveryScreen
          title="Aplikasi sempat crash"
          description="Kami menangkap error render atau hydration. Reset akan membersihkan state lokal yang rusak lalu memuat ulang aplikasi."
          isAutoRecovered={this.state.autoRecovered}
          error={this.state.error}
        />
      );
    }

    return this.props.children;
  }
}
