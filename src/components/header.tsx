import { Maximize2, Minimize2 } from "lucide-react";
import { ThemeToggleButton2 } from "@/components/ui/theme-toggle-button-2";

type HeaderProps = {
	isSidebarExpanded: boolean;
	onToggleSidebar: () => void;
};

export default function Header({
	isSidebarExpanded,
	onToggleSidebar,
}: HeaderProps) {
	return (
		<div className="flex items-center justify-between border-b px-4 py-2.5 sm:px-6 sm:py-4">
			<div className="flex items-center gap-3">
				<img
					alt="Autonome logo"
					src="/logo.png"
					width={32}
					height={32}
					className="h-6 w-6 sm:h-8 sm:w-8"
					style={{ height: "auto" }}
					loading="lazy"
				/>
				<div className="text-base sm:text-lg font-mono tracking-wider text-foreground">
					AutonoMe
				</div>
				{/* Market status indicator — crypto is 24/7 */}
				<div className="hidden sm:flex items-center gap-1.5 ml-2 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5">
					<div className="relative">
						<div className="h-1.5 w-1.5 rounded-full bg-green-500" />
						<div className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-green-500 opacity-75 animate-ping" />
					</div>
					<span className="text-[10px] font-bold uppercase tracking-widest text-green-500">
						LIVE
					</span>
				</div>
			</div>
			<div className="flex items-center gap-4 sm:gap-8">
				<button
					type="button"
					onClick={onToggleSidebar}
					className="cursor-pointer flex items-center gap-1.5 text-sm font-light text-muted-foreground hover:text-foreground transition-colors"
					aria-label={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
				>
					{isSidebarExpanded ? (
						<>
							<Minimize2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
							Collapse
						</>
					) : (
						<>
							<Maximize2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
							Expand
						</>
					)}
				</button>
				<ThemeToggleButton2 className=" cursor-pointer text-muted-foreground hover:text-foreground" />
			</div>
		</div>
	);
}
