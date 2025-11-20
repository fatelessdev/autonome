import { useEffect, useState } from "react";
import { useAIState } from "./ai-state-provider";

interface AIDataProviderProps {
    url: string;
    method?: "GET" | "POST";
    body?: any;
    interval?: number;
    dataKey: string; // Key in state to store data: "data.bitcoin"
    children: React.ReactNode;
}

export function AIDataProvider({
    url,
    method = "GET",
    body,
    interval,
    dataKey,
    children,
}: AIDataProviderProps) {
    const { dispatch } = useAIState();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch(url, {
                method,
                headers: body ? { "Content-Type": "application/json" } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);

            const data = await res.json();

            dispatch({
                type: "SET",
                key: dataKey,
                value: data,
            });
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        if (interval) {
            const id = setInterval(fetchData, interval);
            return () => clearInterval(id);
        }
    }, [url, interval]);

    if (loading) {
        return <div className="animate-pulse bg-white/5 rounded p-4 h-20 w-full" />;
    }

    if (error) {
        return (
            <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-3 rounded text-sm">
                Failed to load data: {error}
            </div>
        );
    }

    return <>{children}</>;
}
