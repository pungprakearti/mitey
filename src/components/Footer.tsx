import packageInfo from "../../package.json";

export default function Footer() {
  const version = packageInfo.version || "0.0.0";

  return (
    <footer className="flex-none px-6 py-2 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-md flex justify-between items-center">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">
            Mitey
          </span>
          <span className="text-zinc-700 text-xs">/</span>
          <span className="text-[10px] font-medium text-zinc-400">
            Created by{" "}
            <span className="text-zinc-200">Andrew Pungprakearti</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex gap-5 items-center">
          <a
            href="https://github.com/pungprakearti"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-zinc-500 hover:text-emerald-400 transition-all uppercase tracking-tight"
          >
            GitHub
          </a>
          <a
            href="https://www.linkedin.com/in/andrewpungprakearti/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-zinc-500 hover:text-emerald-400 transition-all uppercase tracking-tight"
          >
            LinkedIn
          </a>
          <a
            href="https://www.biscuitsinthebasket.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-zinc-500 hover:text-emerald-400 transition-all uppercase tracking-tight"
          >
            Website
          </a>
        </div>

        <div className="h-3 w-[1px] bg-zinc-800" />

        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-tight">
            v{version}
          </span>
        </div>
      </div>
    </footer>
  );
}
