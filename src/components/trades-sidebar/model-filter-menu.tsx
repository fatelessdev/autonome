import { ChevronDown } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { ModelOption } from "./types";

type ModelFilterMenuProps = {
	selectedLabel: string;
	filter: "all" | string;
	onFilterChange: (value: "all" | string) => void;
	options: ModelOption[];
	metaLabel?: string;
	isLoading?: boolean;
};

export function ModelFilterMenu({
	selectedLabel,
	filter,
	onFilterChange,
	options,
	metaLabel,
	isLoading,
}: ModelFilterMenuProps) {
	if (isLoading) {
		return (
			<div className="border-b px-3 py-[7px]">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="font-medium text-xs uppercase tracking-wide">
							Filter:
						</span>
						<Skeleton className="h-7 w-32" />
					</div>
					{metaLabel ? <Skeleton className="h-3 w-28" /> : null}
				</div>
			</div>
		);
	}

	return (
		<div className="border-b px-3 py-[7px]">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 ">
					<span className="font-medium text-xs uppercase tracking-wide">
						Filter:
					</span>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								className="flex items-center gap-1 rounded border bg-background px-2 cursor-pointer py-1 font-medium text-xs transition-colors hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
								type="button"
								disabled={options.length === 0}
								aria-label={`Filter models, current selection ${filter === "all" ? "all models" : selectedLabel}`}
								data-current-filter={filter}
							>
								{selectedLabel}
								<ChevronDown className="h-3 w-3" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem onClick={() => onFilterChange("all")}>
								All Models
							</DropdownMenuItem>
							{options.map((option) => {
								const swatchColor = option.color || "#888888";
								return (
									<DropdownMenuItem
										key={option.id}
										onClick={() => onFilterChange(option.id)}
									>
										<div className="flex items-center gap-2 cursor-pointer">
											<div
												style={{
													width: "16px",
													height: "16px",
													borderRadius: "50%",
													backgroundColor: swatchColor,
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													overflow: "hidden",
												}}
											>
												{option.logo ? (
													<img
														alt={option.label}
														src={option.logo}
														width={10}
														height={10}
														className="h-[10px] w-[10px] object-contain"
														style={{ objectFit: "contain" }}
														loading="lazy"
													/>
												) : null}
											</div>
											{option.label}
										</div>
									</DropdownMenuItem>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{metaLabel ? (
					<span className="text-muted-foreground text-xs">{metaLabel}</span>
				) : null}
			</div>
		</div>
	);
}
