import ReactDOMServer from 'react-dom/server';
import { flushToHTML } from 'styled-jsx/server';
import SvgWidget from '../components/SvgWidget';
import { PlayHistory } from '../models/PlayHistory';

const baseHeight = 40;
const heightPerItem = 57;
const heightBuffer = 5;

/**
 * Returns SVG as a string.
 */
export function generateSvg(recentlyPlayedItems: PlayHistory[], username: string, width: number): string {
    const count = recentlyPlayedItems.length;
    const height = baseHeight + count * heightPerItem + heightBuffer;
    const svgBody = ReactDOMServer.renderToStaticMarkup(
        <SvgWidget width={width} height={height} recentlyPlayedItems={recentlyPlayedItems} username={username} />
    );
    const svgStyles = flushToHTML();

    return `
    <svg
        width="${width}"
        height="${height}"
        viewBox="0 0 ${width} ${height}"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
    ${svgStyles}
    ${svgBody}
    </svg>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";

/**
 * Returns an SVG error card as a string. Used in the image context (e.g. a GitHub
 * README) where an HTTP redirect would be invisible, so the prompt is rendered
 * directly into the widget.
 */
export function generateErrorSvg(title: string, message: string, link: string, width: number): string {
    const height = 100;

    return `
    <svg
        width="${width}"
        height="${height}"
        viewBox="0 0 ${width} ${height}"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <rect x="0" y="0" rx="10" width="${width}" height="100%" stroke="#212121" fill="#212121" stroke-opacity="1" />
        <foreignObject x="0" y="0" width="${width}" height="${height}">
            <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing: border-box; width: 100%; height: 100%; padding: 16px 20px; display: flex; flex-direction: column; justify-content: center; font-family: ${fontFamily}; color: #ffffff;">
                <div style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">${escapeHtml(title)}</div>
                <div style="font-size: 12px; color: #b3b3b3; line-height: 1.4;">${escapeHtml(message)}</div>
                <a href="${escapeHtml(link)}" style="font-size: 12px; color: #1db954; text-decoration: none; margin-top: 6px; word-break: break-all;">${escapeHtml(link)}</a>
            </div>
        </foreignObject>
    </svg>`;
}
