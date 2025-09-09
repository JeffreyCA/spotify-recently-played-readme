import ReactDOMServer from 'react-dom/server';
import { flushToHTML } from 'styled-jsx/server';
import SvgWidget from '../components/SvgWidget';
import { PlayHistory } from '../models/PlayHistory';

const baseHeight = 40;
const heightPerItem = 57;
const heightBuffer = 5;

export type ThemeColors = {
    background: string;
    title: string;
    artist: string;
};

const themeColors = {
    radical: {
        background: "#141321",
        title: "#ff0055",
        artist: "#f8f8f2",
    },
    default: {
        background: "#191414",
        title: "#1DB954",
        artist: "#FFFFFF",
    },
};

/**
 * Returns SVG as a string.
 */
export function generateSvg(
    recentlyPlayedItems: PlayHistory[],
    username: string,
    width: number,
    colors: ThemeColors = themeColors.default 
): string {
    const count = recentlyPlayedItems.length;
    const height = baseHeight + count * heightPerItem + heightBuffer;
    const svgBody = ReactDOMServer.renderToStaticMarkup(
        <SvgWidget
            width={width}
            height={height}
            recentlyPlayedItems={recentlyPlayedItems}
            username={username}
        />
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
      <rect width="100%" height="100%" fill="${colors.background}" />
      <text x="20" y="25" font-size="16" font-weight="bold" fill="${colors.title}">
        ${username}'s Recently Played
      </text>
      ${svgStyles}
      ${svgBody}
    </svg>`;
}
