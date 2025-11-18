import { gsap } from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExitPlanDialog } from "@/components/trades-sidebar/exit-plan-dialog";
import { ModelChatTab } from "@/components/trades-sidebar/model-chat-tab";
import { ModelFilterMenu } from "@/components/trades-sidebar/model-filter-menu";
import { PositionsTab } from "@/components/trades-sidebar/positions-tab";
import {
	type ActiveTab,
	SidebarTabs,
} from "@/components/trades-sidebar/sidebar-tabs";
import { TradesTab } from "@/components/trades-sidebar/trades-tab";
import type {
	ExitPlanSelection,
	ModelOption,
} from "@/components/trades-sidebar/types";
import { useTradingDashboardData } from "@/components/trades-sidebar/use-trading-dashboard-data";
import { getModelInfo } from "@/shared/models/modelConfig";

let customEasePromise: Promise<void> | null = null;
const ensureCustomEase = () => {
	if (typeof window === "undefined") {
		return Promise.resolve();
	}

	if (!customEasePromise) {
		customEasePromise = import("gsap/CustomEase")
			.then(({ CustomEase }) => {
				gsap.registerPlugin(CustomEase);
				CustomEase.create(
					"hop",
					"M0,0 C0.091,0.543 0.148,0.662 0.277,0.786 0.405,0.909 0.596,0.979 1,1 ",
				);
			})
			.catch((error) => {
				console.error("[TradesSidebar] Failed to load CustomEase", error);
			});
	}

	return customEasePromise;
};

export const TRADES_SIDEBAR_COLLAPSED_WIDTH = 384; // px
const COLLAPSED_WIDTH = `${TRADES_SIDEBAR_COLLAPSED_WIDTH}px`;
const EXPANDED_WIDTH = "100vw";

type TradesSidebarProps = {
	isExpanded: boolean;
	isMobile: boolean;
	onToggle?: () => void;
};

type FilterValue = "all" | string;

export default function TradesSidebar({
	isExpanded,
	isMobile,
}: TradesSidebarProps) {
	const [filter, setFilter] = useState<FilterValue>("all");
	const [activeTab, setActiveTab] = useState<ActiveTab>("trades");
	const [selectedExitPlan, setSelectedExitPlan] =
		useState<ExitPlanSelection | null>(null);
	const sidebarRef = useRef<HTMLDivElement>(null);
	const isAnimating = useRef(false);
	const firstRender = useRef(true);

	const { trades, conversations, positions, modelOptions, loading } =
		useTradingDashboardData();

	const collapsedWidth = isMobile ? "0px" : COLLAPSED_WIDTH;
	const targetWidth = isExpanded ? EXPANDED_WIDTH : collapsedWidth;

	// GSAP animation effect
	useEffect(() => {
		if (typeof window === "undefined") return;
		const element = sidebarRef.current;
		if (!element) return;

		if (firstRender.current) {
			firstRender.current = false;
			gsap.set(element, { width: targetWidth });
			return;
		}

		let cancelled = false;

		const animate = () => {
			if (cancelled) {
				return;
			}

			isAnimating.current = true;
			gsap.killTweensOf(element);

			gsap.to(element, {
				width: targetWidth,
				duration: 1,
				ease: "hop",
				onComplete: () => {
					if (!cancelled) {
						isAnimating.current = false;
					}
				},
			});
		};

		void ensureCustomEase().then(animate);

		return () => {
			cancelled = true;
			gsap.killTweensOf(element);
		};
	}, [targetWidth]);

	const filteredTrades = useMemo(() => {
		if (filter === "all") return trades;
		return trades.filter((trade) => trade.modelKey === filter);
	}, [filter, trades]);

	const filteredConversations = useMemo(() => {
		if (filter === "all") return conversations;
		return conversations.filter(
			(conversation) =>
				(conversation.modelLogo || conversation.modelName) === filter,
		);
	}, [conversations, filter]);

	const filteredPositions = useMemo(() => {
		if (filter === "all") return positions;
		return positions.filter(
			(positionGroup) =>
				(positionGroup.modelLogo || positionGroup.modelName) === filter,
		);
	}, [filter, positions]);

	const modelOptionsLookup = useMemo(() => {
		const lookup = new Map<string, ModelOption>();
		modelOptions.forEach((option) => lookup.set(option.id, option));
		return lookup;
	}, [modelOptions]);

	const selectedModelLabel =
		filter === "all"
			? "All Models"
			: (modelOptionsLookup.get(filter)?.label ?? getModelInfo(filter).label);

	const effectiveLoading = loading;
	const isInitialLoading = loading && modelOptions.length === 0;

	const renderFilterMenu = (metaLabel?: string) => (
		<ModelFilterMenu
			selectedLabel={selectedModelLabel}
			filter={filter}
			onFilterChange={setFilter}
			options={modelOptions}
			metaLabel={metaLabel}
			isLoading={isInitialLoading}
		/>
	);

	return (
		<div
			ref={sidebarRef}
			aria-hidden={!isExpanded && isMobile}
			className={`flex h-full min-h-0 flex-col bg-background overflow-hidden ${
				!isMobile || isExpanded ? "border-l" : "border-l-0"
			}`}
			style={{
				position: "absolute",
				right: 0,
				top: 0,
				bottom: 0,
				zIndex: 50,
				backgroundColor: "hsl(var(--background))",
				pointerEvents: !isExpanded && isMobile ? "none" : "auto",
			}}
		>
			<SidebarTabs activeTab={activeTab} onChange={setActiveTab} />

			{activeTab === "trades" ? (
				<TradesTab
					trades={filteredTrades}
					loading={effectiveLoading}
					filterMenu={renderFilterMenu("Showing Last 100 Trades")}
				/>
			) : null}

			{activeTab === "modelchat" ? (
				<ModelChatTab
					conversations={filteredConversations}
					loading={effectiveLoading}
					filterMenu={renderFilterMenu("Showing Last 100 Chats")}
				/>
			) : null}

			{activeTab === "positions" ? (
				<PositionsTab
					positions={filteredPositions}
					loading={effectiveLoading}
					filterMenu={renderFilterMenu()}
					onSelectExitPlan={setSelectedExitPlan}
				/>
			) : null}

			<ExitPlanDialog
				selection={selectedExitPlan}
				onClose={() => setSelectedExitPlan(null)}
			/>
		</div>
	);
}
