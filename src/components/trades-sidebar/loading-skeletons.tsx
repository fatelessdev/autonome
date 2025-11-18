import { Skeleton } from "@/components/ui/skeleton";

export function TradesListSkeleton({ count = 3 }: { count?: number }) {
	return (
		<div className="space-y-4 p-4">
			{Array.from({ length: count }).map((_, index) => (
				<div
					key={index}
					className="rounded-md border border-border/60 bg-muted/20 p-4"
					style={{ width: 350 }}
				>
					<div className="mb-4 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Skeleton className="h-6 w-6 rounded-full" />
							<Skeleton className="h-4 w-24" />
						</div>
						<Skeleton className="h-3 w-16" />
					</div>
					<div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-5 w-14 rounded-full" />
						<Skeleton className="h-4 w-12" />
						<Skeleton className="h-5 w-16 rounded-full" />
					</div>
					<div className="space-y-2">
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-3/4" />
						<Skeleton className="h-3 w-5/6" />
					</div>
					<div className="mt-4 flex items-center justify-between">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-6 w-24" />
					</div>
				</div>
			))}
		</div>
	);
}

export function ModelChatSkeleton({ count = 3 }: { count?: number }) {
	return (
		<div className="space-y-4 p-4">
			{Array.from({ length: count }).map((_, index) => (
				<div
					key={index}
					className="rounded-md border border-border/60 bg-muted/15 p-4"
				>
					<div className="mb-3 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Skeleton className="h-6 w-6 rounded-full" />
							<Skeleton className="h-4 w-28" />
						</div>
						<Skeleton className="h-3 w-20" />
					</div>
					<Skeleton className="h-12 w-full rounded-md" />
					<div className="mt-3 space-y-2">
						<Skeleton className="h-3 w-1/2" />
						<Skeleton className="h-3 w-2/3" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}

export function PositionsListSkeleton({
	groups = 2,
	rows = 3,
}: {
	groups?: number;
	rows?: number;
}) {
	return (
		<div className="space-y-4 p-4">
			{Array.from({ length: groups }).map((_, groupIdx) => (
				<div
					key={groupIdx}
					className="rounded-md border border-border/60 bg-muted/15"
				>
					<div className="flex items-center justify-between border-b px-4 py-3">
						<div className="flex items-center gap-2">
							<Skeleton className="h-6 w-6 rounded-full" />
							<Skeleton className="h-4 w-24" />
						</div>
						<Skeleton className="h-4 w-24" />
					</div>
					<div className="grid grid-cols-6 gap-x-2 border-b bg-muted/30 px-4 py-2">
						{Array.from({ length: 6 }).map((__, idx) => (
							<Skeleton key={idx} className="h-3 w-full" />
						))}
					</div>
					{Array.from({ length: rows }).map((__, rowIdx) => (
						<div
							key={rowIdx}
							className="grid grid-cols-6 gap-x-2 px-4 py-3 text-xs"
						>
							{Array.from({ length: 6 }).map((___, cellIdx) => (
								<Skeleton key={cellIdx} className="h-4 w-full" />
							))}
						</div>
					))}
					<div className="border-t px-4 py-2">
						<Skeleton className="h-4 w-32" />
					</div>
				</div>
			))}
		</div>
	);
}
