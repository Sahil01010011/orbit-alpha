import dotenv from 'dotenv';
dotenv.config();
import { tavily } from '@tavily/core';

console.log('Key found:', !!process.env.TAVILY_API_KEY);
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
console.log('Searching...');
const r = await client.search('Node.js LTS version', { maxResults: 2 });
console.log('Done. Results:', r.results.length);
console.log(r.results[0].title);