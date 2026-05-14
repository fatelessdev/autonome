import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelChatTab } from "./model-chat-tab";

describe("model-chat-tab", () => {
	it("can render its empty state", () => {
		const markup = renderToStaticMarkup(
			createElement(ModelChatTab, {
				conversations: [],
				loading: false,
				filterMenu: null,
			}),
		);

		expect(markup).toContain("ModelChat");
		expect(markup).toContain("No conversations yet");
	});
});
