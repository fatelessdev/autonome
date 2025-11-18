type ActiveTab = "trades" | "modelchat" | "positions";

type SidebarTabsProps = {
	activeTab: ActiveTab;
	onChange: (tab: ActiveTab) => void;
};

const tabs: { key: ActiveTab; label: string }[] = [
	{ key: "trades", label: "Completed Trades" },
	{ key: "modelchat", label: "ModelChat" },
	{ key: "positions", label: "Positions" },
];

export function SidebarTabs({ activeTab, onChange }: SidebarTabsProps) {
	return (
		<div className="border-b">
			<div className="flex">
				{tabs.map((tab) => {
					const isActive = activeTab === tab.key;
					return (
						<button
							key={tab.key}
							className={`flex-1 px-3 py-0 text-[0.68rem] font-semibold uppercase leading-tight cursor-pointer transition-colors flex items-center justify-center min-h-[44px] ${
								isActive
									? "border-primary border-b-2 bg-background text-foreground"
									: "bg-muted/30 text-muted-foreground hover:bg-muted/50"
							}`}
							onClick={() => onChange(tab.key)}
							type="button"
						>
							<span className="block max-w-[92%] overflow-hidden text-ellipsis whitespace-nowrap">
								{tab.label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export type { ActiveTab };
