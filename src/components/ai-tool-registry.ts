import { tool as createTool } from "ai";
import { z } from "zod";
import { generateObject } from "ai";

// Dynamic UI Component Generation Schema
const uiComponentSchema = z.object({
	component: z.enum([
		"weather-card",
		"calculator",
		"chart-data",
		"todo-list",
		"data-table",
		"progress-indicator",
		"alert-notification",
		"form-input",
		"image-display",
		"text-card",
		"button-group",
		"layout-container",
		"dynamic-text",
	]),
	props: z.record(z.any()).optional(),
	children: z.array(z.any()).optional(), // Simplified to avoid circular reference
	layout: z
		.object({
			direction: z.enum(["horizontal", "vertical"]).optional(),
			align: z.enum(["start", "center", "end", "between", "around"]).optional(),
			gap: z.number().optional(),
		})
		.optional(),
});

// Weather tool - generates dynamic UI components
export const weatherTool = createTool({
	description: "Generate dynamic weather information UI",
	inputSchema: z.object({
		location: z.string().describe("The location to get weather for"),
		style: z
			.enum(["simple", "detailed", "mini", "forecast"])
			.optional()
			.default("detailed"),
		includeForecast: z.boolean().optional().default(false),
	}),
	execute: async ({ location, style, includeForecast }) => {
		await new Promise((resolve) => setTimeout(resolve, 800));

		const weatherConditions = [
			"Sunny",
			"Cloudy",
			"Rainy",
			"Snowy",
			"Partly Cloudy",
		];
		const randomWeather =
			weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
		const temp = Math.floor(Math.random() * 40) + 50;
		const celsius = Math.round(((temp - 32) * 5) / 9);

		// Generate dynamic UI structure based on style
		const component = {
			component: "weather-card" as const,
			props: {
				location,
				condition: randomWeather,
				temperature: celsius,
				humidity: Math.floor(Math.random() * 100),
				windSpeed: Math.floor(Math.random() * 30),
				style,
			},
			children: includeForecast
				? [
						{
							component: "weather-card" as const,
							props: {
								location: `${location} (Tomorrow)`,
								condition:
									weatherConditions[
										Math.floor(Math.random() * weatherConditions.length)
									],
								temperature: Math.round(
									((Math.floor(Math.random() * 40) + 50 - 32) * 5) / 9,
								),
								style: "mini" as const,
							},
						},
						{
							component: "weather-card" as const,
							props: {
								location: `${location} (Day after)`,
								condition:
									weatherConditions[
										Math.floor(Math.random() * weatherConditions.length)
									],
								temperature: Math.round(
									((Math.floor(Math.random() * 40) + 50 - 32) * 5) / 9,
								),
								style: "mini" as const,
							},
						},
					]
				: undefined,
			layout: includeForecast
				? { direction: "horizontal", gap: 16 }
				: undefined,
		};

		return component;
	},
});

// Calculator tool - generates interactive calculator UI
export const calculatorTool = createTool({
	description: "Generate an interactive calculator UI",
	inputSchema: z.object({
		type: z.enum(["basic", "scientific", "currency"]).default("basic"),
		operation: z.string().optional(),
	}),
	execute: async ({ type, operation }) => {
		await new Promise((resolve) => setTimeout(resolve, 500));

		const buttonLayout = {
			basic: [
				["7", "8", "9", "/"],
				["4", "5", "6", "*"],
				["1", "2", "3", "-"],
				["0", ".", "=", "+"],
			],
			scientific: [
				["sin", "cos", "tan", "log"],
				["√", "^", "(", ")"],
				["7", "8", "9", "/"],
				["4", "5", "6", "*"],
				["1", "2", "3", "-"],
				["0", ".", "=", "+"],
			],
			currency: [
				["USD", "EUR", "GBP", "JPY"],
				["7", "8", "9", "/"],
				["4", "5", "6", "*"],
				["1", "2", "3", "-"],
				["0", ".", "=", "+"],
			],
		}[type];

		return {
			component: "calculator" as const,
			props: {
				type,
				buttons: buttonLayout,
				operation,
			},
			children: [
				{
					component: "layout-container" as const,
					props: {
						direction: "vertical",
						gap: 8,
					},
				},
			],
		};
	},
});

// Chart data tool - generates dynamic charts
export const chartTool = createTool({
	description: "Generate dynamic chart UI for data visualization",
	inputSchema: z.object({
		chartType: z.enum(["line", "bar", "pie", "area", "scatter"]),
		data: z
			.object({
				labels: z.array(z.string()),
				datasets: z.array(
					z.object({
						label: z.string(),
						data: z.array(z.number()),
						color: z.string().optional(),
					}),
				),
			})
			.optional(),
		title: z.string().optional(),
		height: z.number().optional().default(300),
	}),
	execute: async ({ chartType, data, title, height }) => {
		await new Promise((resolve) => setTimeout(resolve, 600));

		// Generate sample data if none provided
		const defaultData = {
			labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
			datasets: [
				{
					label: "Sales",
					data: Array.from({ length: 6 }, () =>
						Math.floor(Math.random() * 100),
					),
					color: "#3b82f6",
				},
				{
					label: "Profit",
					data: Array.from({ length: 6 }, () =>
						Math.floor(Math.random() * 100),
					),
					color: "#10b981",
				},
			],
		};

		return {
			component: "chart-data" as const,
			props: {
				chartType,
				data: data || defaultData,
				title,
				height,
				responsive: true,
			},
		};
	},
});

// Todo list tool - generates interactive todo UI
export const todoTool = createTool({
	description: "Generate an interactive todo list UI",
	inputSchema: z.object({
		title: z.string().default("My Tasks"),
		items: z
			.array(
				z.object({
					text: z.string(),
					completed: z.boolean().default(false),
					priority: z.enum(["low", "medium", "high"]).optional(),
				}),
			)
			.optional(),
	}),
	execute: async ({ title, items }) => {
		await new Promise((resolve) => setTimeout(resolve, 400));

		const defaultItems = [
			{
				text: "Review AI implementation",
				completed: false,
				priority: "high" as const,
			},
			{
				text: "Update documentation",
				completed: true,
				priority: "medium" as const,
			},
			{
				text: "Test dynamic components",
				completed: false,
				priority: "high" as const,
			},
			{
				text: "Optimize rendering performance",
				completed: false,
				priority: "low" as const,
			},
		];

		return {
			component: "todo-list" as const,
			props: {
				title,
				items: items || defaultItems,
				allowAdd: true,
				allowDelete: true,
				showProgress: true,
			},
		};
	},
});

// Dynamic UI Generator - AI can generate any UI structure
export const uiGeneratorTool = createTool({
	description: "Generate any custom UI component based on user request",
	inputSchema: z.object({
		componentType: z.enum([
			"alert-notification",
			"progress-indicator",
			"data-table",
			"form-input",
			"image-display",
			"button-group",
			"text-card",
		]),
		content: z.object({}).passthrough().optional(),
		style: z
			.object({
				theme: z.enum(["light", "dark", "colorful"]).optional(),
				size: z.enum(["small", "medium", "large"]).optional(),
			})
			.optional(),
	}),
	execute: async ({ componentType, content, style }) => {
		await new Promise((resolve) => setTimeout(resolve, 300));

		return {
			component: componentType,
			props: {
				...content,
				style: style || { theme: "dark", size: "medium" },
				interactive: true,
			},
		};
	},
});

// Tool registry with all dynamic tools
export const tools = {
	displayWeather: weatherTool,
	generateCalculator: calculatorTool,
	generateChart: chartTool,
	generateTodoList: todoTool,
	generateUIComponent: uiGeneratorTool,
};
