import { useCallback, useState } from "react";

type UseBooleanResult = {
	value: boolean;
	setTrue: () => void;
	setFalse: () => void;
	toggle: () => void;
	set: (next: boolean) => void;
};

export function useBoolean(initial = false): UseBooleanResult {
	const [value, setValue] = useState(initial);

	const setTrue = useCallback(() => setValue(true), []);
	const setFalse = useCallback(() => setValue(false), []);
	const toggle = useCallback(() => setValue((prev) => !prev), []);
	const set = useCallback((next: boolean) => setValue(next), []);

	return { value, setTrue, setFalse, toggle, set };
}
