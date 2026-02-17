/**
 * DOM polyfill for Node.js — required by TipTap's markdown-to-doc conversion.
 *
 * TipTap's `elementFromString()` needs `window.DOMParser` to parse HTML
 * fragments when converting markdown that contains inline HTML tokens.
 * Must be imported before any TipTap code.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');

globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
