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
