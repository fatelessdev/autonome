import { tools } from './src/components/ai-tool-registry.ts';

console.log('Tools object:', JSON.stringify(tools, null, 2));
console.log('Tool keys:', Object.keys(tools));