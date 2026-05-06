import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  workspacePath: string;
  onClose?: () => void;
}

export function TerminalPanel({ workspacePath, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    term.current = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono)',
      fontSize: 14,
      theme: {
        background: '#080808',
      }
    });

    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    term.current.open(terminalRef.current);
    fitAddon.current.fit();

    term.current.onData((data) => {
      window.api.ptyWrite(data);
    });

    window.api.onPtyData((data) => {
      term.current?.write(data);
    });

    window.api.onPtyExit((code) => {
      term.current?.write(`\r\n\x1b[33mProcess exited with code ${code}\x1b[0m\r\n`);
    });

    window.api.startPty(workspacePath);

    const handleResize = () => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit();
        window.api.ptyResize(term.current.cols, term.current.rows);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.api.removePtyListeners();
      term.current?.dispose();
      window.removeEventListener('resize', handleResize);
    };
  }, [workspacePath]);

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-header">
        <span>Terminal: {workspacePath}</span>
        {onClose && <button className="terminal-panel-close" onClick={onClose}>Close</button>}
      </div>
      <div ref={terminalRef} className="terminal-panel-body" />
    </div>
  );
}
