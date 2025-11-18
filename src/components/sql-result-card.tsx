import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/core/lib/utils";

export type SqlResultPayload = {
	question: string;
	sql: string;
	durationMs: number;
	rowCount: number;
	truncated: boolean;
	columns: string[];
	rows: Record<string, unknown>[];
	reasoning?: string;
};

export function SqlResultCard({
	payload,
	className,
}: {
	payload: SqlResultPayload;
	className?: string;
}) {
	const columnHeaders = payload.columns.length
		? payload.columns
		: Array.from(new Set(payload.rows.flatMap((row) => Object.keys(row))));

	const formattedDuration = useMemo(
		() => `${payload.durationMs.toFixed(0)} ms`,
		[payload.durationMs],
	);

	return (
		<Card
			className={cn(
				"rounded-2xl border border-border/60 bg-card/75 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/60",
				className,
			)}
		>
			<CardHeader className="space-y-4">
				<div className="flex flex-col gap-1">
					<CardTitle className="text-base font-semibold">
						SQL Analysis Result
					</CardTitle>
					<CardDescription className="text-sm">
						{payload.rowCount} row{payload.rowCount === 1 ? "" : "s"} •{" "}
						{formattedDuration}
						{payload.truncated ? " • showing first 100 rows" : ""}
					</CardDescription>
				</div>
				<div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
						Clarified question
					</p>
					<p className="mt-1 text-sm text-foreground">{payload.question}</p>
				</div>
				{payload.reasoning && (
					<div className="rounded-xl border border-border/40 bg-muted/20 p-4 text-xs text-muted-foreground">
						<span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
							Model rationale
						</span>
						<p className="mt-2 leading-relaxed">{payload.reasoning}</p>
					</div>
				)}
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="rounded-xl border border-border/60 bg-muted/25 p-4 text-xs">
					<div className="flex flex-wrap items-center justify-between gap-2 pb-3">
						<span className="font-semibold uppercase tracking-wide text-muted-foreground">
							Generated SQL
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-3 text-xs"
							onClick={() => navigator.clipboard.writeText(payload.sql)}
						>
							Copy
						</Button>
					</div>
					<pre className="whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
						<code>{payload.sql}</code>
					</pre>
				</div>
				{columnHeaders.length > 0 ? (
					<ScrollArea className="max-h-[28rem] w-full rounded-2xl border border-border/60">
						<div className="min-w-full overflow-x-auto">
							<table className="min-w-full divide-y divide-border text-left text-sm">
								<thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
									<tr>
										{columnHeaders.map((column) => (
											<th key={column} className="px-4 py-3 font-semibold">
												{column}
											</th>
										))}
									</tr>
								</thead>
								<tbody className="divide-y divide-border/60">
									{payload.rows.map((row, rowIndex) => (
										<tr
											key={`row-${rowIndex}`}
											className="odd:bg-background even:bg-muted/40"
										>
											{columnHeaders.map((column) => (
												<td
													key={`${rowIndex}-${column}`}
													className="px-4 py-3 align-top text-sm text-foreground/90"
												>
													<span className="whitespace-pre-wrap break-words">
														{formatCellValue(row[column])}
													</span>
												</td>
											))}
										</tr>
									))}
									{payload.rows.length === 0 && (
										<tr>
											<td
												colSpan={columnHeaders.length}
												className="px-4 py-8 text-center text-sm text-muted-foreground"
											>
												No rows returned.
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</ScrollArea>
				) : (
					<div className="rounded-xl border border-dashed border-border/60 p-5 text-center text-sm text-muted-foreground">
						Query executed successfully but returned no columns.
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function formatCellValue(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "number") {
		return value.toLocaleString("en-US", {
			maximumFractionDigits: 6,
		});
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}
