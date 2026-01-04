import { Link } from "@tanstack/react-router";
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
			</div>
			<div className="flex items-center gap-4 sm:gap-8">
				{/*<div className="font-thin text-sm text-muted-foreground">{currentTime}</div>*/}
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
				{/* {isMobile ? null : (
				<Link
					to="/chat"
					className="text-sm font-light text-muted-foreground hover:text-foreground transition-colors"
				>
					AI
				</Link>	
				)} */}
				<Link
					to="/chat"
					className="text-sm font-light text-muted-foreground hover:text-foreground transition-colors"
				>
					AI
				</Link>	
			</div>
		</div>
	);
}
