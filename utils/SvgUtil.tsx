import ReactDOMServer from 'react-dom/server';
import { flushToHTML } from 'styled-jsx/server';
import SvgWidget from '../components/SvgWidget';
import { RecentlyPlayedResponse } from '../models/RecentlyPlayedResponse';

const baseHeight = 40;
const heightPerItem = 57;
const heightBuffer = 5;

/**
 * Returns SVG as a string.
 */
export function generateSvg(recentlyPlayedRes: RecentlyPlayedResponse, username: string, width: number): string {
    const count = recentlyPlayedRes.items.length;
    const height = baseHeight + count * heightPerItem + heightBuffer;
    const svgBody = ReactDOMServer.renderToStaticMarkup(
        <SvgWidget width={width} height={height} recentlyPlayedResponse={recentlyPlayedRes} username={username} />
    );
    const svgStyles = flushToHTML();

    return `
    <svg
        width="auto"
        height="auto"
        viewBox="0 0 ${width} ${height}"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMinYMin meet"
        style="max-width: ${width}px;"
    >
    ${svgStyles}
    ${svgBody}
    </svg>`;
}
