import { useState, useEffect } from "react";
import type { ComponentType } from "react";

// Dynamic Component Props Interfaces
export interface WeatherProps {
	location: string;
	condition: string;
	temperature: number;
	humidity: number;
	windSpeed: number;
	style: "simple" | "detailed" | "mini" | "forecast";
}

export interface CalculatorProps {
	type: "basic" | "scientific" | "currency";
	buttons: string[][];
	operation?: string;
}

export interface ChartDataProps {
	chartType: "line" | "bar" | "pie" | "area" | "scatter";
	data: {
		labels: string[];
		datasets: Array<{
			label: string;
			data: number[] | number[][];
			color?: string;
		}>;
	};
	title?: string;
	height: number;
	responsive: boolean;
}

export interface TodoListProps {
	title: string;
	items: Array<{
		text: string;
		completed: boolean;
		priority?: "low" | "medium" | "high";
	}>;
	allowAdd: boolean;
	allowDelete: boolean;
	showProgress: boolean;
}

export interface AlertNotificationProps {
	type: "info" | "success" | "warning" | "error";
	message: string;
	title?: string;
}

export interface ProgressIndicatorProps {
	value: number;
	max: number;
	label?: string;
}

export interface DataTableProps {
	columns: string[];
	rows: any[][];
	sortable?: boolean;
	filterable?: boolean;
}

export interface FormInputProps {
	type: "text" | "number" | "email" | "password" | "select";
	label: string;
	placeholder?: string;
	options?: string[];
	required?: boolean;
}

export interface ImageDisplayProps {
	src: string;
	alt: string;
	caption?: string;
	interactive?: boolean;
}

export interface ButtonGroupProps {
	buttons: Array<{
		label: string;
		variant?: "primary" | "secondary" | "danger";
		action?: string;
	}>;
}

export interface TextCardProps {
	title?: string;
	content: string;
	variant: "info" | "warning" | "success" | "error";
}

export interface DynamicTextProps {
	text: string;
	format: "markdown" | "html" | "plain";
}

// Layout Container Props
export interface LayoutContainerProps {
	direction: "horizontal" | "vertical";
	align?: "start" | "center" | "end" | "between" | "around";
	gap?: number;
}

// Dynamic Component Registry
export const componentRegistry: Record<string, ComponentType<any>> = {
	// Weather Card Component
	"weather-card": ({
		location,
		condition,
		temperature,
		humidity,
		windSpeed,
		style,
	}: WeatherProps) => {
		const sizeClasses = {
			simple: "p-3 text-sm",
			detailed: "p-4 text-base",
			mini: "p-2 text-xs",
			forecast: "p-3 text-sm",
		};

		return (
			<div
				className={`rounded-2xl border border-white/10 bg-white/5 text-white ${sizeClasses[style]}`}
			>
				<div className="flex justify-between items-start">
					<div>
						<h3 className="font-semibold mb-1">{location}</h3>
						<p className="text-white/80">{condition}</p>
					</div>
					<div className="text-right">
						<div className="text-2xl font-bold">{temperature}°C</div>
						{style !== "mini" && (
							<div className="text-xs text-white/60">
								Wind: {windSpeed}km/h | Humidity: {humidity}%
							</div>
						)}
					</div>
				</div>
				{style === "forecast" && (
					<div className="mt-2 text-xs text-white/60">
						<i className="mr-1">🌤️</i> Weather forecast data
					</div>
				)}
			</div>
		);
	},

	// Interactive Calculator Component
	calculator: ({ type, buttons, operation }: CalculatorProps) => {
		const [display, setDisplay] = useState(operation || "0");
		const [history, setHistory] = useState<string[]>([]);

		const handleButtonClick = (btn: string) => {
			if (btn === "=") {
				try {
					const result = eval(display.replace(/[^0-9+\-*/().]/g, ""));
					setHistory((h) => [...h, `${display} = ${result}`]);
					setDisplay(String(result));
				} catch {
					setDisplay("Error");
				}
			} else if (btn === "C") {
				setDisplay("0");
			} else {
				setDisplay(display === "0" ? btn : display + btn);
			}
		};

		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white">
				<div className="mb-3">
					<div className="text-right text-lg font-mono bg-black/20 p-2 rounded">
						{display}
					</div>
					{history.length > 0 && (
						<div className="text-xs text-white/60 mt-1">
							Recent: {history[history.length - 1]}
						</div>
					)}
				</div>
				<div className="grid grid-cols-4 gap-2">
					{buttons.flat().map((btn, i) => (
						<button
							key={i}
							onClick={() => handleButtonClick(btn)}
							className={`p-2 rounded text-sm font-medium transition-colors ${
								["+", "-", "*", "/", "="].includes(btn)
									? "bg-blue-600 hover:bg-blue-500"
									: btn === "C"
										? "bg-red-600 hover:bg-red-500"
										: "bg-white/10 hover:bg-white/20"
							}`}
						>
							{btn}
						</button>
					))}
				</div>
				{type === "scientific" && (
					<div className="mt-2 text-xs text-white/60">
						Scientific calculator with advanced functions
					</div>
				)}
			</div>
		);
	},

	// Chart Data Visualization
	"chart-data": ({ chartType, data, title, height }: ChartDataProps) => {
		const maxValue = Math.max(
			...data.datasets.flatMap((d) => {
				if (chartType === "scatter") {
					return d.data.flat();
				}
				return d.data as number[];
			}),
		);

		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white">
				{title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
				<div
					style={{ height: `${height}px` }}
					className="flex flex-col justify-end items-center"
				>
					{chartType === "bar" && (
						<div className="flex items-end gap-1 w-full h-full">
							{data.labels.map((label, i) => (
								<div key={i} className="flex flex-col items-center flex-1">
									<div className="w-full bg-gradient-to-t from-blue-500 to-purple-600 rounded-t-sm flex-1 flex items-end justify-center">
										<span className="text-xs text-white/80 pb-1">
											{data.datasets[0]?.data[i] || 0}
										</span>
									</div>
									<div className="text-xs text-white/60 mt-1">{label}</div>
								</div>
							))}
						</div>
					)}
					{chartType === "pie" && (
						<div className="relative w-48 h-48 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
							<div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-center text-xs">
								<div>
									<div className="font-bold">{data.labels[0]}</div>
									<div className="text-white/80">
										{data.datasets[0]?.data[0] || 0}
									</div>
								</div>
							</div>
						</div>
					)}
					{chartType === "line" && (
						<div className="w-full h-full flex items-end gap-2">
							<svg className="w-full h-full">
								{data.datasets.map((dataset, i) => (
									<polyline
										key={i}
										points={(dataset.data as number[])
											.map((value, j) => {
												const x = (j / (dataset.data.length - 1)) * 100;
												const y = 100 - (value / maxValue) * 80;
												return `${x},${y}`;
											})
											.join(" ")}
										fill="none"
										stroke={dataset.color || `hsl(${i * 60}, 70%, 60%)`}
										strokeWidth="2"
									/>
								))}
							</svg>
						</div>
					)}
					{chartType === "scatter" && (
						<div className="w-full h-full flex items-center justify-center">
							<svg
								className="w-full h-full"
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
							>
								{data.datasets.map((dataset, i) => (
									<g key={i}>
										{(dataset.data as number[][]).map((point, j) => {
											const [x, y] = point;
											const xPos = (x / maxValue) * 90 + 5;
											const yPos = 95 - (y / maxValue) * 90;
											return (
												<circle
													key={j}
													cx={xPos}
													cy={yPos}
													r="2"
													fill={dataset.color || `hsl(${i * 60}, 70%, 60%)`}
													opacity="0.8"
												/>
											);
										})}
									</g>
								))}
							</svg>
						</div>
					)}
				</div>
				<div className="mt-4 flex flex-wrap gap-2">
					{data.datasets.map((dataset, i) => (
						<div key={i} className="flex items-center gap-1 text-xs">
							<div
								className="w-3 h-3 rounded"
								style={{
									backgroundColor: dataset.color || `hsl(${i * 60}, 70%, 60%)`,
								}}
							/>
							<span>{dataset.label}</span>
						</div>
					))}
				</div>
			</div>
		);
	},

	// Interactive Todo List
	"todo-list": ({
		title,
		items,
		allowAdd,
		allowDelete,
		showProgress,
	}: TodoListProps) => {
		const [todoItems, setTodoItems] = useState(items);
		const [newTask, setNewTask] = useState("");

		const toggleTask = (index: number) => {
			setTodoItems((prev) =>
				prev.map((item, i) =>
					i === index ? { ...item, completed: !item.completed } : item,
				),
			);
		};

		const addTask = () => {
			if (newTask.trim()) {
				setTodoItems((prev) => [
					...prev,
					{ text: newTask, completed: false, priority: "medium" },
				]);
				setNewTask("");
			}
		};

		const removeTask = (index: number) => {
			setTodoItems((prev) => prev.filter((_, i) => i !== index));
		};

		const completedCount = todoItems.filter((item) => item.completed).length;
		const progress =
			todoItems.length > 0 ? (completedCount / todoItems.length) * 100 : 0;

		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white">
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-semibold">{title}</h3>
					{showProgress && (
						<div className="text-xs text-white/60">
							{completedCount}/{todoItems.length} completed
						</div>
					)}
				</div>

				{showProgress && (
					<div className="mb-4">
						<div className="w-full bg-white/10 rounded-full h-2">
							<div
								className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>
				)}

				<div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
					{todoItems.map((item, index) => (
						<div
							key={index}
							className={`flex items-center gap-2 p-2 rounded ${
								item.completed ? "bg-green-500/10" : "bg-white/5"
							}`}
						>
							<button
								onClick={() => toggleTask(index)}
								className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
									item.completed
										? "bg-green-500 border-green-500"
										: "border-white/30"
								}`}
							>
								{item.completed && "✓"}
							</button>
							<span
								className={`flex-1 text-sm ${
									item.completed ? "line-through text-white/50" : ""
								}`}
							>
								{item.text}
							</span>
							{item.priority && (
								<span
									className={`text-xs px-1 py-0.5 rounded ${
										item.priority === "high"
											? "bg-red-500/20 text-red-300"
											: item.priority === "medium"
												? "bg-yellow-500/20 text-yellow-300"
												: "bg-blue-500/20 text-blue-300"
									}`}
								>
									{item.priority}
								</span>
							)}
							{allowDelete && (
								<button
									onClick={() => removeTask(index)}
									className="text-red-400 hover:text-red-300 text-xs"
								>
									✕
								</button>
							)}
						</div>
					))}
				</div>

				{allowAdd && (
					<div className="flex gap-2">
						<input
							type="text"
							value={newTask}
							onChange={(e) => setNewTask(e.target.value)}
							placeholder="Add new task..."
							className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/50"
							onKeyPress={(e) => e.key === "Enter" && addTask()}
						/>
						<button
							onClick={addTask}
							className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-sm"
						>
							Add
						</button>
					</div>
				)}
			</div>
		);
	},

	// Alert Notifications
	"alert-notification": ({ type, message, title }: AlertNotificationProps) => {
		const typeStyles = {
			info: "bg-blue-500/10 border-blue-500/30 text-blue-100",
			success: "bg-green-500/10 border-green-500/30 text-green-100",
			warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-100",
			error: "bg-red-500/10 border-red-500/30 text-red-100",
		};

		const icons = {
			info: "ℹ️",
			success: "✅",
			warning: "⚠️",
			error: "❌",
		};

		return (
			<div className={`rounded-2xl border p-3 ${typeStyles[type]}`}>
				<div className="flex items-start gap-2">
					<span className="text-lg">{icons[type]}</span>
					<div className="flex-1">
						{title && <div className="font-semibold mb-1">{title}</div>}
						<div className="text-sm">{message}</div>
					</div>
				</div>
			</div>
		);
	},

	// Progress Indicators
	"progress-indicator": ({ value, max, label }: ProgressIndicatorProps) => {
		const percentage = (value / max) * 100;

		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white">
				{label && <div className="text-sm mb-2">{label}</div>}
				<div className="w-full bg-white/10 rounded-full h-3">
					<div
						className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all"
						style={{ width: `${percentage}%` }}
					/>
				</div>
				<div className="text-xs text-white/60 mt-1">
					{value} / {max} ({percentage.toFixed(1)}%)
				</div>
			</div>
		);
	},

	// Data Tables
	"data-table": ({
		columns = [],
		rows = [],
		sortable,
		filterable,
	}: DataTableProps) => {
		// Handle empty data gracefully
		if (!columns || columns.length === 0) {
			return (
				<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white/60 text-center">
					No data available
				</div>
			);
		}

		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 overflow-hidden text-white">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="bg-white/5">
								{columns.map((col, i) => (
									<th
										key={i}
										className={`px-4 py-2 text-left text-sm font-semibold ${
											sortable ? "cursor-pointer hover:bg-white/10" : ""
										}`}
									>
										{col}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => (
								<tr
									key={i}
									className="border-t border-white/10 hover:bg-white/5 transition-colors"
								>
									{row.map((cell, j) => (
										<td key={j} className="px-4 py-2 text-sm">
											{cell}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{filterable && (
					<div className="p-2 border-t border-white/10">
						<input
							type="text"
							placeholder="Filter rows..."
							className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/50"
						/>
					</div>
				)}
			</div>
		);
	},

	// Form Inputs
	"form-input": ({
		type,
		label,
		placeholder,
		options,
		required,
	}: FormInputProps) => {
		const [value, setValue] = useState("");

		if (type === "select" && options) {
			return (
				<div className="space-y-1">
					<label className="block text-sm text-white/80">
						{label}
						{required && <span className="text-red-400 ml-1">*</span>}
					</label>
					<select
						value={value}
						onChange={(e) => setValue(e.target.value)}
						className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
					>
						<option value="">{placeholder || "Select option..."}</option>
						{options.map((option, i) => (
							<option key={i} value={option} className="bg-slate-800">
								{option}
							</option>
						))}
					</select>
				</div>
			);
		}

		return (
			<div className="space-y-1">
				<label className="block text-sm text-white/80">
					{label}
					{required && <span className="text-red-400 ml-1">*</span>}
				</label>
				<input
					type={type}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={placeholder}
					required={required}
					className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/50"
				/>
			</div>
		);
	},

	// Image Display
	"image-display": ({ src, alt, caption, interactive }: ImageDisplayProps) => {
		return (
			<div className="bg-white/[0.05] rounded-2xl border border-white/10 overflow-hidden text-white">
				<div
					className={`${interactive ? "cursor-pointer hover:opacity-80" : ""}`}
				>
					<img src={src} alt={alt} className="w-full h-auto" />
				</div>
				{(caption || alt) && (
					<div className="p-3 border-t border-white/10">
						<p className="text-sm text-white/80">{caption || alt}</p>
					</div>
				)}
			</div>
		);
	},

	// Button Groups
	"button-group": ({ buttons }: ButtonGroupProps) => {
		const variantStyles = {
			primary: "bg-blue-600 hover:bg-blue-500",
			secondary: "bg-white/10 hover:bg-white/20",
			danger: "bg-red-600 hover:bg-red-500",
		};

		if (!buttons || !Array.isArray(buttons)) {
			return (
				<div className="bg-white/[0.05] rounded-2xl border border-white/10 p-4 text-white/60 text-center">
					No buttons available
				</div>
			);
		}

		return (
			<div className="flex flex-wrap gap-2">
				{buttons.map((button, i) => (
					<button
						key={i}
						onClick={() => {
							if (button.action) {
								alert(`Button "${button.label}" clicked!`);
							}
						}}
						className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
							variantStyles[button.variant || "secondary"]
						} text-white`}
					>
						{button.label}
					</button>
				))}
			</div>
		);
	},

	// Text Cards
	"text-card": ({ title, content, variant }: TextCardProps) => {
		const variantStyles = {
			info: "bg-blue-500/10 border-blue-500/30",
			warning: "bg-yellow-500/10 border-yellow-500/30",
			success: "bg-green-500/10 border-green-500/30",
			error: "bg-red-500/10 border-red-500/30",
		};

		return (
			<div
				className={`rounded-2xl border p-4 ${variantStyles[variant]} text-white`}
			>
				{title && <h3 className="font-semibold mb-2">{title}</h3>}
				<p className="text-sm leading-relaxed">{content}</p>
			</div>
		);
	},

	// Dynamic Text
	"dynamic-text": ({ text, format }: DynamicTextProps) => {
		return (
			<div className="text-white">
				{format === "markdown" ? (
					<div
						dangerouslySetInnerHTML={{
							__html: text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
						}}
					/>
				) : format === "html" ? (
					<div dangerouslySetInnerHTML={{ __html: text }} />
				) : (
					<p>{text}</p>
				)}
			</div>
		);
	},

	// Layout Container
	"layout-container": ({
		direction,
		align,
		gap = 8,
		children,
	}: LayoutContainerProps & { children?: any[] }) => {
		const directionClass = direction === "horizontal" ? "flex-row" : "flex-col";
		const alignClass = {
			start: "items-start",
			center: "items-center",
			end: "items-end",
			between: "justify-between",
			around: "justify-around",
		}[align || "start"];

		return (
			<div
				className={`flex ${directionClass} ${alignClass}`}
				style={{ gap: `${gap}px` }}
			>
				{children}
			</div>
		);
	},
};
