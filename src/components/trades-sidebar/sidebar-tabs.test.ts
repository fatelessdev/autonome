import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarTabs } from "./sidebar-tabs";

describe("sidebar-tabs", () => {
	it("can be imported", async () => {
		const mod = await import("./sidebar-tabs");
		expect(mod).toBeDefined();
	});

	it("includes the model chat tab", () => {
		const markup = renderToStaticMarkup(
			createElement(SidebarTabs, {
				activeTab: "trades",
				onChange: () => undefined,
			}),
		);

		expect(markup).toContain("Completed Trades");
		expect(markup).toContain("ModelChat");
		expect(markup).toContain("Positions");
	});
});
