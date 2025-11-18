import { type ComponentProps, memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";

import { cn } from "@/core/lib/utils";

type ResponseProps = Omit<ComponentProps<typeof ReactMarkdown>, "className"> & {
	className?: string;
};

const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [
	rehypeRaw,
	rehypeHighlight,
	rehypeSanitize,
];

export const Response = memo(
	({ className, ...props }: ResponseProps) => (
		<div
			className={cn(
				"size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
		>
			<ReactMarkdown
				rehypePlugins={rehypePlugins}
				remarkPlugins={remarkPlugins}
				{...props}
			/>
		</div>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
