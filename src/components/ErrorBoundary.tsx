import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { STORAGE_KEY } from '../data/seed';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Непредвиденная ошибка интерфейса',
    };
  }

  handleHardReset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-[var(--tone-rose-fg)]">
              <AlertTriangle className="w-6 h-6 shrink-0" strokeWidth={1.75} />
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">Сбой интерфейса Topchan Ops</h1>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Защитный контур перехватил ошибку. Вы можете перезагрузить экран или сбросить
              локальное хранилище до демо-данных.
            </p>
            <div className="bg-[var(--bg-canvas)] border border-[var(--tone-rose-border)] rounded-lg p-3 font-mono text-xs text-[var(--tone-rose-fg)] break-words">
              {this.state.message}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm font-medium text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
              >
                Перезагрузить
              </button>
              <button
                type="button"
                onClick={this.handleHardReset}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-medium text-white transition-colors"
              >
                <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                Сбросить данные
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
