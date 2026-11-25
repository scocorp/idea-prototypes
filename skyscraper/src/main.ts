import './ui/styles.css';
import { App } from './app.ts';

const root = document.getElementById('app')!;
const app = new App(root);
// Handy from the browser console while prototyping.
(window as unknown as { skyscraper: App }).skyscraper = app;
