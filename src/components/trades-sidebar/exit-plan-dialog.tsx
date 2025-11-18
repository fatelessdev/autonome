import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	formatConfidenceValue,
	formatPriceLabel,
} from "@/shared/formatting/numberFormat";
import type { ExitPlanSelection } from "./types";

type ExitPlanDialogProps = {
	selection: ExitPlanSelection | null;
	onClose: () => void;
};

export function ExitPlanDialog({ selection, onClose }: ExitPlanDialogProps) {
	return (
		<Dialog
			open={Boolean(selection)}
			onOpenChange={(open) => !open && onClose()}
		>
			{selection ? (
				<DialogContent
					className="max-w-md"
					style={{ backgroundColor: `${selection.modelColor}15` }}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center justify-between gap-3 ">
							<span>{selection.position.symbol} Exit Plan</span>
						</DialogTitle>
						<DialogDescription className="text-foreground">
							{selection.modelLabel} ·{" "}
							<Badge
								variant="outline"
								className={`font-semibold ${
									selection.position.signal === "HOLD"
										? "border-muted "
										: selection.position.signal === "LONG"
											? "border-green-500/20 bg-green-500/10 text-green-500"
											: "border-red-500/20 bg-red-500/10 text-red-500"
								}`}
							>
								{selection.position.signal ?? selection.position.sign}
							</Badge>
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div
							className="flex items-center justify-between rounded-lg px-3 py-2"
							style={{
								backgroundColor: `${selection.modelColor}14`,
								border: `1px solid ${selection.modelColor}33`,
							}}
						>
							<span className="text-xs font-semibold uppercase tracking-wide">
								Confidence
							</span>
							<span className="text-sm font-semibold tabular-nums">
								{formatConfidenceValue(selection.position.confidence)}
							</span>
						</div>
						<div className="space-y-3 text-sm">
							<div className="flex items-center justify-between">
								<span className=" uppercase tracking-wide">Target</span>
								<span className="font-semibold tabular-nums">
									{formatPriceLabel(selection.position.exitPlan?.target)}
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span className=" uppercase tracking-wide">Stop</span>
								<span className="font-semibold tabular-nums">
									{formatPriceLabel(selection.position.exitPlan?.stop)}
								</span>
							</div>
							<div className="space-y-1">
								<span className=" uppercase tracking-wide">
									Invalid Condition
								</span>
								<p className="rounded-md bg-muted/30 p-2 text-sm leading-relaxed">
									{selection.position.exitPlan?.invalidation ?? "—"}
								</p>
							</div>
						</div>
					</div>
				</DialogContent>
			) : null}
		</Dialog>
	);
}
